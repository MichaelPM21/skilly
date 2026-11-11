const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const run=require('node:util').promisify(execFile);
const Database=require('better-sqlite3');

test('First administrator setup seeds services and creates a consistent backup',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'skilly-startup-'));
  const databasePath=path.join(directory,'setup.db');
  const env={...process.env,DB_PATH:databasePath,SEED_DEMO:'true',
    BOOTSTRAP_ADMIN_EMAIL:'setup@example.test',BOOTSTRAP_ADMIN_NAME:'Setup test',
    BOOTSTRAP_ADMIN_PASSWORD:'Setup-local-test-2026!',BACKUP_DIR:path.join(directory,'backups')};
  try{
    await run(process.execPath,['scripts/create-admin.js'],{cwd:path.join(__dirname,'..'),env,windowsHide:true});
    const db=new Database(databasePath,{readonly:true});
    try{
      assert.equal(db.prepare('SELECT COUNT(*) n FROM services').get().n,4);
      assert.equal(db.prepare("SELECT role FROM users WHERE email='setup@example.test'").get().role,'admin');
    }finally{db.close();}
    await run(process.execPath,['scripts/backup.js'],{cwd:path.join(__dirname,'..'),env,windowsHide:true});
    const backups=fs.readdirSync(env.BACKUP_DIR);assert.equal(backups.length,1);
    const copy=new Database(path.join(env.BACKUP_DIR,backups[0]),{readonly:true});
    try{assert.equal(copy.pragma('integrity_check',{simple:true}),'ok');assert.equal(copy.prepare('SELECT COUNT(*) n FROM users').get().n,1);}
    finally{copy.close();}
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Both processes can initialize a new shared database concurrently',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'skilly-concurrent-'));
  const env={...process.env,DB_PATH:path.join(directory,'shared.db'),SEED_DEMO:'true'};
  try{
    // Wait for both children even if one fails; cleanup must not hide the original startup error.
    const results=await Promise.allSettled([0,1].map(()=>run(process.execPath,['-e',"require('./server/index'); require('./server/db').db.close()"],{cwd:path.join(__dirname,'..'),env,windowsHide:true})));
    for(const result of results)if(result.status==='rejected')assert.ifError(result.reason);
    const db=new Database(env.DB_PATH,{readonly:true});
    try{
      assert.equal(db.prepare('SELECT COUNT(*) n FROM professionals').get().n,4);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM services').get().n,4);
      assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
    }finally{db.close();}
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
