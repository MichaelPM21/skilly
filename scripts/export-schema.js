// Reproduce the application schema in memory. Never read the working database.
const fs = require('node:fs');
const path = require('node:path');
process.env.DB_PATH = ':memory:';
const {db} = require('../server/db');
require('../server/schema').migrate();
const output = path.join(__dirname, '..', 'docs', 'entrega3', 'base-datos');
fs.mkdirSync(output, {recursive:true});
const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all().map(x=>x.sql+';').join('\n');
const quote = name => '"'+name.replaceAll('"','""')+'"';
const withoutFK = sql => sql.replace(/,\s*FOREIGN KEY\s*\([^)]+\)\s*REFERENCES\s+\w+\s*\([^)]+\)/gi,'')
  .replace(/\s+REFERENCES\s+\w+\s*\([^)]+\)/gi,'');
const withoutPK = sql => sql.replace(/\s+PRIMARY KEY(?:\s+AUTOINCREMENT)?/gi,'');
const warning = '-- SQLite: ejercicio de reconstrucción en una base desechable. NO ejecutar sobre datos de trabajo.\n';
const write = (name, content) => fs.writeFileSync(path.join(output,name),content,'utf8');
function rebuild(transform) {
  return warning+'PRAGMA foreign_keys=OFF;\nBEGIN;\n'+tables.map(t=>{
    const columns=db.prepare('PRAGMA table_info('+quote(t.name)+')').all().map(c=>quote(c.name)).join(',');
    const temporary='e3_rebuild_'+t.name;
    const sql=transform(t.sql).replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|\w+)/i,'CREATE TABLE '+quote(temporary));
    return sql+';\nINSERT INTO '+quote(temporary)+' ('+columns+') SELECT '+columns+' FROM '+quote(t.name)+';\nDROP TABLE '+quote(t.name)+';\nALTER TABLE '+quote(temporary)+' RENAME TO '+quote(t.name)+';';
  }).join('\n\n')+'\nCOMMIT;\nPRAGMA foreign_keys=ON;\n';
}
write('01-tablas.sql',warning+'BEGIN;\n'+tables.map(t=>withoutPK(withoutFK(t.sql))+';').join('\n\n')+'\nCOMMIT;\n');
write('02-claves-primarias.sql',rebuild(withoutFK));
write('03-claves-foraneas.sql',rebuild(sql=>sql));
write('04-indices.sql',warning+indexes+'\n');
write('90-eliminar-claves-foraneas.sql',rebuild(withoutFK)+indexes+'\n');
write('99-eliminar-tablas.sql',warning+'PRAGMA foreign_keys=OFF;\nBEGIN;\n'+[...tables].reverse().map(t=>'DROP TABLE IF EXISTS '+quote(t.name)+';').join('\n')+'\nCOMMIT;\nPRAGMA foreign_keys=ON;\n');
write('esquema-completo.sql',warning+'PRAGMA foreign_keys=ON;\nBEGIN;\n'+tables.map(t=>t.sql+';').join('\n\n')+'\n'+indexes+"\nINSERT INTO settings(id,admin_weekly_review_capacity,default_cancellation_refund_percent) VALUES(1,3,80);\nCOMMIT;\n");
const descriptions={professionals:'Perfil, antecedentes y agenda compartida del profesional.',users:'Cuenta y credenciales. Una organización se representa por una cuenta de este rol.',sessions:'Sesiones por aplicación y acceso acotado de invitado.',access_tokens:'Tokens de un uso para verificación, recuperación e invitados.',services:'Borrador y versión publicada del servicio.',bookings:'Reserva y copia de precio, comisión y condiciones al contratar.',payments:'Operación de pago y referencias del proveedor.',guest_requests:'Solicitud sin registro y su conversión a reserva.',evaluations:'Estrellas y argumentos privados para administración.',messages:'Mensajes de la reserva.',settings:'Configuración global, fila id=1.',incidents:'Reclamos, decisión y plazos.',attachments:'Documentos de la reserva en BLOB.',audit_log:'Trazabilidad de acciones.',outbox:'Cola de correo y reintentos.',schema_migrations:'Versiones de migraciones aplicadas.',case_events:'Eventos de incidencias y mediaciones (relación polimórfica).',service_appeals:'Mediación de una revisión de servicio.',refund_operations:'Intentos y conciliación de devoluciones.',payouts:'Transferencias externas y evidencia.'};
let dictionary='# Diccionario físico de datos\n\nGenerado desde `server/db.js` y `server/schema.js` sobre una base en memoria con `npm run db:docs`. No contiene datos personales.\n\nFechas `INTEGER`: milisegundos Unix; `date`: AAAA-MM-DD; `time`: HH:mm de America/Santiago. Importes de reserva en CLP enteros; montos esperados de proveedor pueden usar otra moneda. JSON se conserva como TEXT y requiere validación de aplicación. PK en SQLite no implica siempre NOT NULL explícito para TEXT; se informa cada restricción por separado.\n';
let physical='# Modelo físico implementado\n\nLas líneas representan únicamente claves foráneas declaradas, no todas las asociaciones de negocio.\n\n```mermaid\nerDiagram\n';
let fkCount=0;
for(const t of tables){
  const cols=db.prepare('PRAGMA table_info('+quote(t.name)+')').all();
  const fks=db.prepare('PRAGMA foreign_key_list('+quote(t.name)+')').all();fkCount+=fks.length;
  dictionary+='\n## '+t.name+'\n\n'+(descriptions[t.name]||'')+'\n\n| Campo | Tipo | NOT NULL | PK | Predeterminado | FK declarada |\n|---|---|---|---|---|---|\n';
  for(const c of cols)dictionary+='| '+[c.name,c.type,c.notnull?'Sí':'No',c.pk||'—',String(c.dflt_value??'—').replaceAll('|','\\|'),fks.filter(f=>f.from===c.name).map(f=>f.table+'.'+f.to).join(', ')||'—'].join(' | ')+' |\n';
  dictionary+='\nÍndices:\n\n';
  for(const i of db.prepare('PRAGMA index_list('+quote(t.name)+')').all()){
    const fields=db.prepare('PRAGMA index_info('+quote(i.name)+')').all().map(c=>c.name).join(', ');
    dictionary+='- `'+i.name+'` ('+fields+'): '+(i.unique?'único':'no único')+(i.partial?', parcial':'')+'.\n';
  }
  if(!db.prepare('PRAGMA index_list('+quote(t.name)+')').all().length)dictionary+='- Sin índice adicional.\n';
  physical+='  '+t.name+' {\n'+cols.filter(c=>c.pk||fks.some(f=>f.from===c.name)).map(c=>'    '+c.type+' '+c.name+(c.pk?' PK':' FK')).join('\n')+'\n  }\n';
  for(const f of fks)physical+='  '+f.table+' ||--o{ '+t.name+' : "'+f.from+'"\n';
}
write('diccionario.md',dictionary);
write('modelo-fisico.md',physical+'```\n\n'+tables.length+' tablas; '+fkCount+' referencias FK declaradas. Las asociaciones sin FK se describen en el modelo lógico y no deben presentarse como restricciones existentes.\n');
db.close();
console.log('Esquema, scripts separados, diccionario y modelo físico exportados: '+tables.length+' tablas, '+fkCount+' FK.');
