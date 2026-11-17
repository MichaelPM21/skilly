/**
 * Flujo del módulo. Acceso PostgreSQL asíncrono. Conserva prepare/get/all/run para los módulos
 * existentes y propaga transacciones mediante AsyncLocalStorage. Los valores SQL se parametrizan
 * y el bloqueo asesor serializa las transacciones de negocio de ambos procesos.
 */

// PostgreSQL only. SQLite is read exclusively by the one-time import script.
require('dotenv').config();
const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

types.setTypeParser(20, value => {
  // Convierte BIGINT de PostgreSQL a Number y rechaza valores fuera del rango entero seguro para evitar pérdida silenciosa de precisión.
  
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('PostgreSQL devolvió un entero fuera del rango seguro.');
  return n;
});
if (!process.env.DATABASE_URL) throw new Error('Configura DATABASE_URL para conectar Skilly a PostgreSQL.');
const schema = process.env.PGSCHEMA || 'public';
if (schema !== 'public' && !(process.env.NODE_ENV === 'test' && /^skilly_test_[a-z0-9_]+$/.test(schema))) {
  throw new Error('Esquema PostgreSQL no permitido.');
}
const pool = new Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:5000,
  statement_timeout:15000,lock_timeout:10000,application_name:'skilly',options:`-c search_path=${schema}`});
pool.on('error', /* Registra el error del recurso y aplica el cierre o código de salida indicado por este manejador. */ error => console.error('Conexión PostgreSQL interrumpida:', error.code || 'connection_error'));
const context = new AsyncLocalStorage();

// Bind values separately: neither positional nor named values become SQL text.
/**
 * Convierte marcadores ? o @nombre en parámetros $1, $2, etc., sin sustituir contenido dentro de
 * literales SQL entre comillas. Devuelve text y values por separado y rechaza argumentos
 * ausentes o cantidades incompatibles.
 */
function bind(sql,args) {
  const named=args.length===1 && args[0]!==null && typeof args[0]==='object' && !Buffer.isBuffer(args[0]) && !Array.isArray(args[0]);
  const values=[];let index=0;
  const text=sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?|@[a-zA-Z_][a-zA-Z0-9_]*/g, token=>{
    // Sustituye únicamente marcadores SQL fuera de comillas por parámetros numerados y acumula sus valores por separado.
    
    if(token[0]==="'"||token[0]==='"')return token;
    const value=token==='?'?args[index++]:named?args[0][token.slice(1)]:undefined;
    if(value===undefined)throw new Error('Falta un parámetro de consulta.');
    values.push(value);return '$'+values.length;
  });
  if(!named&&index!==args.length)throw new Error('Cantidad de parámetros incorrecta.');
  return {text,values};
}
/**
 * Ejecuta SQL parametrizado en el cliente de la transacción actual, si existe, o en el pool.
 * AsyncLocalStorage mantiene la conexión durante las llamadas asíncronas relacionadas.
 */
async function query(text,values=[]) {return (context.getStore()?.client||pool).query(text,values);}
/**
 * Ejecuta una operación atómica: la transacción principal toma un bloqueo asesor compartido por
 * ambos procesos; una llamada anidada utiliza SAVEPOINT. Confirma el resultado o revierte y
 * propaga el error, liberando la conexión.
 */
async function transaction(fn) {
  if(context.getStore()) {
    const savepoint='nested_'+randomUUID().replaceAll('-','');
    await query('SAVEPOINT '+savepoint);
    try {const result=await fn();await query('RELEASE SAVEPOINT '+savepoint);return result;}
    catch(error){await query('ROLLBACK TO SAVEPOINT '+savepoint);throw error;}
  }
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    // Preserve the single-writer business invariant across public/admin servers.
    // External provider calls stay outside these short critical transactions.
    await client.query('SELECT pg_advisory_xact_lock(831955, 1)');
    const result=await context.run({client},fn);
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
const db={
  query,
  /**
   * Construye un adaptador de consulta con get, all y run. Cada ejecución convierte los parámetros
   * con bind y delega en query; no prepara una sentencia persistente en PostgreSQL.
   */
  prepare(sql) {
    /**
     * Vincula los argumentos de una consulta preparada a sus marcadores SQL y devuelve la promesa de
     * ejecución sobre la conexión activa.
     */
    const execute=args=>{const q=bind(sql,args);return query(q.text,q.values);};
    return {
      /**
       * Ejecuta la consulta y resuelve su primera fila, o undefined si no hay coincidencias.
       */
      async get(...args){return (await execute(args)).rows[0];},
      /**
       * Ejecuta la consulta y resuelve el arreglo completo de filas, vacío si no hay resultados.
       */
      async all(...args){return (await execute(args)).rows;},
      /**
       * Ejecuta la sentencia y resuelve changes con el número de filas afectadas y lastInsertRowid con
       * el id devuelto por RETURNING, si existe.
       */
      async run(...args){const r=await execute(args);return {changes:r.rowCount,lastInsertRowid:r.rows[0]?.id};}
    };
  },
  /**
   * Conserva la interfaz db.transaction(fn).immediate() usada por los módulos de negocio. Devuelve
   * una función invocable que abre una transacción PostgreSQL; immediate es un alias de esa misma
   * función.
   */
  transaction(fn){/* Propaga los argumentos recibidos a la función de negocio dentro de una transacción. La misma referencia se expone como immediate para compatibilidad con los llamadores. */ const run=(...args)=>transaction(/* Invoca la función de negocio con sus argumentos dentro de la conexión y transacción activas. */ ()=>fn(...args));run.immediate=run;return run;},
  /**
   * Ejecuta SQL sin parámetros a través de query. Se utiliza principalmente para DDL y control de
   * migraciones; no debe recibir texto construido con datos no validados del usuario.
   */
  async exec(sql){return query(sql);},
  /**
   * Cierra el pool PostgreSQL y devuelve la promesa de finalización. Se usa al detener servidores,
   * scripts y pruebas.
   */
  async close(){return pool.end();}
};
/**
 * Devuelve un identificador compuesto por prefijo y UUID sin guiones. Es una utilidad de
 * compatibilidad; los módulos de negocio actuales usan principalmente security.id.
 */
const uid=prefix=>prefix+'_'+randomUUID().replaceAll('-','');
/**
 * Lee la única fila de configuración, identificada por id=1. Resuelve los porcentajes y límites
 * que usan los servicios y las nuevas reservas.
 */
async function getSettings(){return db.prepare('SELECT * FROM settings WHERE id=1').get();}
/**
 * Combina un parche con la configuración actual y persiste capacidad semanal y porcentaje de
 * devolución. Es un adaptador heredado: la ruta administrativa actual actualiza también
 * comisiones y plazos directamente.
 */
async function updateSettings(patch){const next={...await getSettings(),...patch};await db.prepare('UPDATE settings SET admin_weekly_review_capacity=?,default_cancellation_refund_percent=? WHERE id=1').run(next.admin_weekly_review_capacity,next.default_cancellation_refund_percent);return getSettings();}
module.exports={db,uid,getSettings,updateSettings,bind};
