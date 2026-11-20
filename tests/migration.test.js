/**
 * @file Prueba de importación SQLite → PostgreSQL con origen temporal y esquema
 * aislado. Verifica rollback, contenido y conservación de referencias y secuencias.
 */

const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const pgTest=require('./postgres-helper');
const {db}=require('../server/db');
const {importSqlite}=require('../scripts/import-sqlite');
const Database=require('better-sqlite3');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'skilly-pg-import-'));
before(pgTest.setup);
/**
 * Libera servidores, conexiones y recursos temporales al finalizar la suite, incluso si una
 * aserción falló.
 */
after(async()=>{await pgTest.cleanup();fs.rmSync(dir,{recursive:true,force:true});});
/**
 * Comprueba que una importación inválida revierta y que una válida conserve filas, hashes,
 * documentos binarios y orden de eventos. Usa un SQLite temporal y un esquema PostgreSQL de
 * prueba; también rechaza repetir la importación.
 */
test('SQLite import rolls back invalid references and preserves all rows, hashes, binary documents and event order',async()=>{
 const filename=path.join(dir,'source.db'),source=new Database(filename);
 try{
  source.exec(fs.readFileSync(path.join(__dirname,'fixtures/sqlite-legacy.sql'),'utf8'));
  source.prepare("INSERT INTO professionals(id,name,email,created_at) VALUES('p','Test','p@test.cl',1)").run();
  source.prepare("INSERT INTO users(id,email,name,password_hash,role,professional_id,created_at) VALUES('u','u@test.cl','Test','original-hash','profesional','missing',1)").run();
  await assert.rejects(importSqlite(filename),/* Comprueba el código de error esperado de la operación rechazada, distinguiendo la restricción de PostgreSQL que se está probando. */ error=>error.code==='23503');
  assert.equal((await db.prepare('SELECT count(*) n FROM professionals').get()).n,0);
  source.prepare("UPDATE users SET professional_id='p'").run();
  source.prepare("INSERT INTO bookings(id,professional_id,created_at) VALUES('b','p',1)").run();
  source.prepare("INSERT INTO attachments VALUES('a','b','test.pdf','application/pdf',?,'u',1)").run(Buffer.from('%PDF-1.4 test'));
  source.prepare("INSERT INTO refund_operations(id,booking_id,payment_id,amount,percent,reason,status,created_at) VALUES('r','b','',0,100,'Sin pago','completado',1)").run();
  source.prepare("INSERT INTO case_events VALUES('z','case','u','decision','Primero',1),('a','case','u','conformidad','Segundo',1)").run();
  const report=await importSqlite(filename);assert.equal(report.length,20);assert.ok(report.every(/* Comprueba que todos los elementos según la condición t.sourceRows===t.targetRows. Se evalúan los datos ya cargados. */ t=>t.sourceRows===t.targetRows));
  assert.equal((await db.prepare("SELECT password_hash FROM users WHERE id='u'").get()).password_hash,'original-hash');
  assert.deepEqual((await db.prepare("SELECT data FROM attachments WHERE id='a'").get()).data,Buffer.from('%PDF-1.4 test'));
  assert.equal((await db.prepare("SELECT payment_id FROM refund_operations WHERE id='r'").get()).payment_id,null);
  assert.deepEqual((await db.prepare('SELECT id FROM case_events ORDER BY event_sequence').all()).map(/* Extrae r.id de cada elemento para formar la lista que necesita esta operación. */ r=>r.id),['z','a']);
  await db.prepare("INSERT INTO case_events(id,case_id,actor,kind,body,created_at) VALUES('n','case','u','respuesta','Tercero',1)").run();
  assert.equal((await db.prepare("SELECT event_sequence FROM case_events WHERE id='n'").get()).event_sequence,3);
  await assert.rejects(importSqlite(filename),/destino|importación/);
 }finally{source.close();}
});
