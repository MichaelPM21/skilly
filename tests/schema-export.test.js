/**
 * @file Pruebas de integridad relacional, parametrización, transacciones anidadas y
 * scripts DDL académicos. Trabajan en esquemas de prueba desechables, nunca sobre tablas de
 * producción.
 */

const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const pgTest=require('./postgres-helper');
const {db,bind}=require('../server/db');
before(pgTest.setup);after(pgTest.cleanup);
/**
 * Verifica cantidad de tablas y claves foráneas, unicidad de correo sin distinguir mayúsculas y
 * rechazo de referencias inexistentes en PostgreSQL.
 */
test('PostgreSQL has twenty tables, twenty-two foreign keys and case-insensitive account uniqueness',async()=>{
 assert.equal((await db.query('SELECT count(*) n FROM pg_tables WHERE schemaname=current_schema()')).rows[0].n,20);
 assert.equal((await db.query("SELECT count(*) n FROM pg_constraint WHERE contype='f' AND connamespace=current_schema()::regnamespace")).rows[0].n,22);
 await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES('one','User@Test.cl','Test','hash','organizacion',1)").run();
 await assert.rejects(db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES('two','user@test.cl','Test','hash','organizacion',1)").run(),/* Comprueba el código de error esperado de la operación rechazada, distinguiendo la restricción de PostgreSQL que se está probando. */ e=>e.code==='23505');
 await assert.rejects(db.prepare("INSERT INTO bookings(id,professional_id,created_at) VALUES('bad','missing',1)").run(),/* Comprueba el código de error esperado de la operación rechazada, distinguiendo la restricción de PostgreSQL que se está probando. */ e=>e.code==='23503');
});
/**
 * Verifica que los valores se parametrizan sin convertirse en SQL y que transacciones y
 * SAVEPOINT revierten cambios fallidos manteniendo el estado exterior.
 */
test('PostgreSQL parameters, transactions and savepoints preserve isolation and rollback',async()=>{
 const hostile="x'); DROP TABLE users; --";
 assert.deepEqual(bind("SELECT '?' AS literal, ? AS value",[hostile]),{text:"SELECT '?' AS literal, $1 AS value",values:[hostile]});
 assert.deepEqual(bind('SELECT @name, @name',[{name:hostile}]),{text:'SELECT $1, $2',values:[hostile,hostile]});
 await assert.rejects(db.transaction(async()=>{
   // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
   await db.prepare("UPDATE users SET name='rollback' WHERE id='one'").run();throw new Error('rollback');}).immediate(),/rollback/);
 assert.equal((await db.prepare("SELECT name FROM users WHERE id='one'").get()).name,'Test');
 await db.transaction(async()=>{
   // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
   
   await db.prepare("UPDATE users SET name='outer' WHERE id='one'").run();
   await assert.rejects(db.transaction(async()=>{
     // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
     await db.prepare("UPDATE users SET name='inner' WHERE id='one'").run();throw new Error('nested');}).immediate(),/nested/);
   assert.equal((await db.prepare("SELECT name FROM users WHERE id='one'").get()).name,'outer');
 }).immediate();
});
/**
 * Ejecuta scripts académicos de creación y eliminación en un esquema desechable y verifica
 * restricciones y tablas. No debe apuntar al esquema de trabajo.
 */
test('Exported academic scripts create and remove PostgreSQL keys and tables in a disposable schema',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const schema=pgTest.schema+'_ddl';
 await db.transaction(async()=>{
   // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
   
  await db.exec('CREATE SCHEMA '+schema);
  await db.exec('SET LOCAL search_path='+schema);
  for(const name of ['01-tablas.sql','02-claves-primarias.sql','03-claves-foraneas.sql','04-indices.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../database/schema-exports',name),'utf8'));
  assert.equal((await db.query("SELECT count(*) n FROM pg_constraint WHERE contype='f' AND connamespace=current_schema()::regnamespace")).rows[0].n,22);
  assert.equal((await db.query("SELECT count(*) n FROM pg_constraint WHERE contype='p' AND connamespace=current_schema()::regnamespace")).rows[0].n,20);
  await db.exec(fs.readFileSync(path.join(__dirname,'../database/schema-exports/90-eliminar-claves-foraneas.sql'),'utf8'));
  assert.equal((await db.query("SELECT count(*) n FROM pg_constraint WHERE contype='f' AND connamespace=current_schema()::regnamespace")).rows[0].n,0);
  await db.exec(fs.readFileSync(path.join(__dirname,'../database/schema-exports/99-eliminar-tablas.sql'),'utf8'));
  assert.equal((await db.query('SELECT count(*) n FROM pg_tables WHERE schemaname=current_schema()')).rows[0].n,0);
  await db.exec('DROP SCHEMA '+schema);
 }).immediate();
});
