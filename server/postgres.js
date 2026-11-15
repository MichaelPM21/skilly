// PostgreSQL only. SQLite is read exclusively by the one-time import script.
require('dotenv').config();
const { Pool, types } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

types.setTypeParser(20, value => {
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
pool.on('error', error => console.error('Conexión PostgreSQL interrumpida:', error.code || 'connection_error'));
const context = new AsyncLocalStorage();

// Bind values separately: neither positional nor named values become SQL text.
function bind(sql,args) {
  const named=args.length===1 && args[0]!==null && typeof args[0]==='object' && !Buffer.isBuffer(args[0]) && !Array.isArray(args[0]);
  const values=[];let index=0;
  const text=sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?|@[a-zA-Z_][a-zA-Z0-9_]*/g, token=>{
    if(token[0]==="'"||token[0]==='"')return token;
    const value=token==='?'?args[index++]:named?args[0][token.slice(1)]:undefined;
    if(value===undefined)throw new Error('Falta un parámetro de consulta.');
    values.push(value);return '$'+values.length;
  });
  if(!named&&index!==args.length)throw new Error('Cantidad de parámetros incorrecta.');
  return {text,values};
}
async function query(text,values=[]) {return (context.getStore()?.client||pool).query(text,values);}
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
  prepare(sql) {
    const execute=args=>{const q=bind(sql,args);return query(q.text,q.values);};
    return {
      async get(...args){return (await execute(args)).rows[0];},
      async all(...args){return (await execute(args)).rows;},
      async run(...args){const r=await execute(args);return {changes:r.rowCount,lastInsertRowid:r.rows[0]?.id};}
    };
  },
  transaction(fn){const run=(...args)=>transaction(()=>fn(...args));run.immediate=run;return run;},
  async exec(sql){return query(sql);},
  async close(){return pool.end();}
};
const uid=prefix=>prefix+'_'+randomUUID().replaceAll('-','');
async function getSettings(){return db.prepare('SELECT * FROM settings WHERE id=1').get();}
async function updateSettings(patch){const next={...await getSettings(),...patch};await db.prepare('UPDATE settings SET admin_weekly_review_capacity=?,default_cancellation_refund_percent=? WHERE id=1').run(next.admin_weekly_review_capacity,next.default_cancellation_refund_percent);return getSettings();}
module.exports={db,uid,getSettings,updateSettings,bind};
