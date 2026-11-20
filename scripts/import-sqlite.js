/**
 * @file Importación de una sola vez: SQLite en modo lectura → validación →
 * PostgreSQL vacío → comparación de contenido → commit. Es la única ruta de aplicación que lee
 * datos del motor anterior.
 */

// One-time, atomic import into an empty PostgreSQL database. Source is read-only.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Database=require('better-sqlite3');
/**
 * Escapa comillas dobles de un identificador y lo delimita para construir nombres de tablas y
 * columnas. No sustituye la parametrización de valores.
 *
 * @param {string} name - Nombre de tabla o columna que requiere comillas SQL.
 * @returns {string} Identificador delimitado; las comillas internas se duplican.
 * @example
 * quote("users"); // "users" con comillas de identificador
 */
const quote=name=>'"'+name.replaceAll('"','""')+'"';
/**
 * Calcula SHA-256 de filas normalizadas: ordena sus claves y convierte buffers a hexadecimal.
 * Permite comparar el contenido SQLite con PostgreSQL sin depender del orden de propiedades.
 *
 * @param {Object[]} rows - Filas ordenadas de forma equivalente en origen y destino.
 * @returns {string} SHA-256 hexadecimal de los valores con claves ordenadas y buffers normalizados.
 * @example
 * const checksum = digest([{id:1, name:"Demo"}]);
 */
const digest=rows=>crypto.createHash('sha256').update(JSON.stringify(rows.map(/* Transforma cada elemento con Object.keys(row).sort().map(k=>[k,Buffer.isBuffer(row[k])?{hex:row[k].toString('hex')}:row[k]]) para construir la colección utilizada por esta operación. */ row=>Object.keys(row).sort().map(/* Transforma cada elemento con [k,Buffer.isBuffer(row[k])?{hex:row[k].toString('hex')}:row[k]] para construir la colección utilizada por esta operación. */ k=>[k,Buffer.isBuffer(row[k])?{hex:row[k].toString('hex')}:row[k]])))).digest('hex');
/**
 * Lee un respaldo SQLite en modo de solo lectura, comprueba integridad y exige destino
 * PostgreSQL sin datos de negocio. Importa todas las filas en una transacción, normaliza
 * referencias heredadas, verifica hashes y ajusta secuencias; devuelve un informe o revierte
 * ante errores.
 *
 * @param {string} sourcePath - Ruta a una base SQLite existente que se abre solo para lectura.
 * @returns {Promise<Object[]>} Por tabla: table, sourceRows, targetRows, sha256 y normalized; no escribe este informe por sí misma.
 * @throws {Error} Error ante origen inválido, destino no vacío, diferencias de esquema o contenido; propaga errores de BD. La transacción de importación revierte al fallar.
 * @example
 * // Solo contra un destino PostgreSQL vacío preparado para la migración:
 * const result = await importSqlite(sourcePath);
 */
async function importSqlite(sourcePath){
  const {db}=require('../server/db');
  const source=new Database(path.resolve(sourcePath),{readonly:true,fileMustExist:true});
  try {
    if(source.pragma('integrity_check',{simple:true})!=='ok')throw new Error('El respaldo SQLite no supera integrity_check.');
    if(source.pragma('foreign_key_check').length)throw new Error('El origen tiene referencias SQLite inválidas.');
    const names=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(/* Extrae r.name de cada elemento para formar la lista que necesita esta operación. */ r=>r.name);
    const tables=names.map(name=>{
      // Lee columnas y filas de cada tabla SQLite, conserva orden de claves y normaliza referencias heredadas antes de importar.
      
      const columns=source.prepare('PRAGMA table_info('+quote(name)+')').all();
      const order=columns.filter(/* Conserva los elementos según la condición c.pk. Se evalúan los datos ya cargados. */ c=>c.pk).sort(/* Ordena las columnas por su posición en la clave primaria para comparar filas de forma determinista. */ (a,b)=>a.pk-b.pk).map(/* Transforma cada elemento con quote(c.name) para construir la colección utilizada por esta operación. */ c=>quote(c.name)).join(',');
      if(!order)throw new Error('Falta PK en '+name);
      const rows=source.prepare('SELECT '+(name==='case_events'?'rowid AS event_sequence,*':'*')+' FROM '+quote(name)+' ORDER BY '+order).all();
      let normalized=0;
      // Legacy cancellations without a payment used an empty string as sentinel.
      if(name==='refund_operations')for(const row of rows)if(row.payment_id===''){if(row.amount!==0)throw new Error('Devolución con monto sin pago asociado.');row.payment_id=null;normalized++;}
      return {name,columns:columns.map(/* Extrae c.name de cada elemento para formar la lista que necesita esta operación. */ c=>c.name).concat(name==='case_events'?['event_sequence']:[]),order,rows,normalized};
    });
    await require('../server/schema').migrate();
    return await db.transaction(async()=>{
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const targetNames=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename")).rows.map(/* Extrae r.tablename de cada elemento para formar la lista que necesita esta operación. */ r=>r.tablename);
      if(JSON.stringify(targetNames)!==JSON.stringify(names))throw new Error('Las tablas de origen y destino no coinciden. Revisa el esquema antes de importar.');
      for(const table of tables){
        if(table.name==='schema_migrations'){
          if((await db.query("SELECT 1 FROM schema_migrations WHERE version NOT LIKE 'postgres-001-%' LIMIT 1")).rowCount)throw new Error('El destino ya contiene una importación.');
        }else if(table.name==='settings'){
          const rows=(await db.query('SELECT * FROM settings')).rows;
          if(rows.length!==1||rows[0].id!==1||rows[0].commission_percent!==15||rows[0].response_hours!==24||rows[0].payment_hours!==24||rows[0].admin_weekly_review_capacity!==3||rows[0].default_cancellation_refund_percent!==80)throw new Error('El destino tiene configuración propia; no se reemplazará.');
        }else if((await db.query('SELECT 1 FROM '+quote(table.name)+' LIMIT 1')).rowCount)throw new Error('El destino no está vacío: '+table.name);
      }
      await db.exec('SET CONSTRAINTS ALL DEFERRED');
      await db.exec('DELETE FROM settings');
      const report=[];
      for(const table of tables){
        const columns=table.columns.map(quote).join(',');
        const sql='INSERT INTO '+quote(table.name)+' ('+columns+') VALUES ('+table.columns.map(/* Transforma cada elemento con '$'+(i+1) para construir la colección utilizada por esta operación. */ (_,i)=>'$'+(i+1)).join(',')+')';
        for(const row of table.rows)await db.query(sql,table.columns.map(/* Extrae row[c] de cada elemento para formar la lista que necesita esta operación. */ c=>row[c]));
        const actual=(await db.query('SELECT '+columns+' FROM '+quote(table.name)+(table.name==='schema_migrations'?" WHERE version NOT LIKE 'postgres-001-%'":'')+' ORDER BY '+table.order)).rows;
        if(digest(actual)!==digest(table.rows))throw new Error('Verificación de contenido fallida: '+table.name);
        report.push({table:table.name,sourceRows:table.rows.length,targetRows:actual.length,sha256:digest(actual),normalized:table.normalized});
      }
      await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
      for(const [table,col] of [['audit_log','id'],['outbox','id'],['case_events','event_sequence']]){
        await db.query(`SELECT setval(pg_get_serial_sequence($1,$2),COALESCE(MAX(${quote(col)}),1),MAX(${quote(col)}) IS NOT NULL) FROM ${quote(table)}`,[table,col]);
      }
      return report;
    }).immediate();
  }finally{source.close();}
}
if(require.main===module){
  require('dotenv').config();
  const source=process.argv[2];
  if(!source){console.error('Uso: node scripts/import-sqlite.js RUTA_DEL_RESPALDO_SQLITE');process.exitCode=1;}
  else importSqlite(source).then(report=>{
    // Guarda el informe de importación confirmado y muestra el número de tablas y filas verificadas.
    
    fs.mkdirSync('.local',{recursive:true});
    fs.writeFileSync('.local/postgres-import-report.json',JSON.stringify({at:new Date().toISOString(),source:path.resolve(source),tables:report},null,2));
    console.log('Importación confirmada: '+report.length+' tablas; '+report.reduce(/* Acumula n+t.sourceRows sobre la colección seleccionada para calcular su resumen. */ (n,t)=>n+t.sourceRows,0)+' filas verificadas por contenido.');
  }).catch(error=>{
    // Registra el error recibido y conserva el indicador de fallo del script o propaga el error al siguiente manejador.
    console.error('No se completó la importación:',error.message);process.exitCode=1;}).finally(/* Cierra el pool al terminar, tanto en éxito como en error, para no dejar conexiones abiertas. */ ()=>require('../server/db').db.close());
}
module.exports={importSqlite};
