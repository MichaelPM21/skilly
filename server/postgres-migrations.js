/**
 * Flujo del módulo. Migración inicial PostgreSQL con registro de versión y comprobación de
 * integridad del SQL. No editar el SQL inicial después de aplicarlo: el código detecta ese
 * cambio; futuras modificaciones requieren una migración nueva.
 */

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {db}=require('./db');
/**
 * Aplica el esquema inicial PostgreSQL una sola vez, dentro de una transacción. Guarda su hash
 * normalizando CRLF, rechaza cambios posteriores del SQL ya aplicado y asegura la fila de
 * settings sin crear cuentas demo.
 */
async function migrate(){
  const sql=fs.readFileSync(path.join(__dirname,'../database/postgres/001-initial.sql'),'utf8');
  const version='postgres-001-'+crypto.createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex');
  await db.transaction(async()=>{
    // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
    
    await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,applied_at BIGINT NOT NULL)');
    const existing=await db.prepare("SELECT version FROM schema_migrations WHERE version LIKE 'postgres-001-%'").get();
    if(existing&&existing.version!==version)throw new Error('El esquema inicial cambió después de aplicarlo. Crea una nueva migración.');
    if(!existing){
      await db.exec(sql);
      await db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(version,Date.now());
    }
    await db.exec('INSERT INTO settings(id,admin_weekly_review_capacity,default_cancellation_refund_percent) VALUES(1,3,80) ON CONFLICT(id) DO NOTHING');
  }).immediate();
}
module.exports={migrate};
