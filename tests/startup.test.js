/**
 * @file Pruebas de migración concurrente, alta administrativa y
 * respaldo/restauración en PostgreSQL de prueba. Requieren pg_dump/pg_restore; la eliminación
 * del esquema se limita al creado por postgres-helper.
 */

const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process');
const run=require('node:util').promisify(execFile);
const pgTest=require('./postgres-helper');
const {db}=require('../server/db');
const {pgTool}=require('../scripts/postgres-tools');
before(pgTest.setup);after(pgTest.cleanup);
/**
 * Lanza dos procesos de migración sobre el mismo esquema temporal y comprueba que solo se
 * registre una migración inicial.
 */
test('Both processes initialize the same PostgreSQL schema without duplicate migrations',async()=>{
 const results=await Promise.allSettled([0,1].map(/* Transforma cada registro en la estructura requerida por la inicialización del módulo, conservando su posición en el arreglo resultante. */ ()=>run(process.execPath,['-e',"require('./server/schema').migrate().finally(()=>require('./server/db').db.close())"],{cwd:path.join(__dirname,'..'),env:process.env,windowsHide:true})));
 for(const result of results)if(result.status==='rejected')throw result.reason;
 assert.equal((await db.prepare("SELECT count(*) n FROM schema_migrations WHERE version LIKE 'postgres-001-%'").get()).n,1);
});
/**
 * Crea un administrador de prueba, respalda y restaura el esquema temporal con herramientas
 * PostgreSQL. Verifica que sobrevivan la cuenta y las claves foráneas.
 */
test('Administrator setup and PostgreSQL backup restore preserve accounts and constraints',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skilly-pg-backup-'));
 try{
  const env={...process.env,BOOTSTRAP_ADMIN_EMAIL:'setup@example.test',BOOTSTRAP_ADMIN_NAME:'Setup test',BOOTSTRAP_ADMIN_PASSWORD:'Setup-local-test-2026!',BACKUP_DIR:dir};
  await run(process.execPath,['scripts/create-admin.js'],{cwd:path.join(__dirname,'..'),env,windowsHide:true});
  await run(process.execPath,['scripts/backup.js'],{cwd:path.join(__dirname,'..'),env,windowsHide:true});
  const files=fs.readdirSync(dir);assert.equal(files.length,1);
  const file=path.join(dir,files[0]);assert.ok(fs.statSync(file).size>0);
  await db.exec('DROP SCHEMA '+pgTest.schema+' CASCADE');
  await pgTool('pg_restore',['--dbname',new URL(pgTest.testUrl).pathname.slice(1),'--exit-on-error','--single-transaction','--no-owner',file]);
  assert.equal((await db.prepare("SELECT role FROM users WHERE email='setup@example.test'").get()).role,'admin');
  assert.equal((await db.query("SELECT count(*) n FROM pg_constraint WHERE contype='f' AND connamespace=current_schema()::regnamespace")).rows[0].n,22);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
