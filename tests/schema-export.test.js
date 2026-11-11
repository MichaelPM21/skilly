const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Database=require('better-sqlite3');
const directory=path.join(__dirname,'..','docs','entrega3','base-datos');
const sql=name=>fs.readFileSync(path.join(directory,name),'utf8');
test('Separated SQL scripts create keys, preserve rows on rebuild and remove constraints and tables',()=>{
  const db=new Database(':memory:');
  try {
    db.exec(sql('01-tablas.sql'));
    db.prepare("INSERT INTO professionals(id,name,email,created_at) VALUES('p','Test','test@example.test',1)").run();
    assert.equal(db.pragma('table_info(professionals)').find(c=>c.name==='id').pk,0);
    db.exec(sql('02-claves-primarias.sql'));
    assert.equal(db.pragma('table_info(professionals)').find(c=>c.name==='id').pk,1);
    assert.equal(db.pragma('foreign_key_list(bookings)').length,0);
    db.exec(sql('03-claves-foraneas.sql'));db.exec(sql('04-indices.sql'));
    assert.equal(db.prepare('SELECT name FROM professionals').get().name,'Test');
    assert.throws(()=>db.exec("INSERT INTO bookings(id,professional_id,created_at) VALUES('bad','absent',1)"),/FOREIGN KEY/);
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
    db.exec(sql('90-eliminar-claves-foraneas.sql'));
    assert.equal(db.pragma('foreign_key_list(bookings)').length,0);
    assert.equal(db.pragma('table_info(professionals)').find(c=>c.name==='id').pk,1);
    db.exec(sql('99-eliminar-tablas.sql'));
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,0);
  } finally { db.close(); }
});
test('Exported full schema matches the application tables, columns, foreign keys and explicit indexes',()=>{
  process.env.DB_PATH=':memory:';
  const {db}=require('../server/db');require('../server/schema').migrate();
  const copy=new Database(':memory:');
  const catalog=d=>d.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('table','index') ORDER BY type,name").all();
  try {copy.exec(sql('esquema-completo.sql'));assert.deepEqual(catalog(copy),catalog(db));}
  finally{copy.close();db.close();}
});
