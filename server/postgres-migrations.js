const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {db}=require('./db');
async function migrate(){
  const sql=fs.readFileSync(path.join(__dirname,'../database/postgres/001-initial.sql'),'utf8');
  const version='postgres-001-'+crypto.createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex');
  await db.transaction(async()=>{
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
