require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const Database=require('better-sqlite3');
const source=path.resolve(process.env.DB_PATH||path.join(__dirname,'../server/skilly.db'));
async function backup(){
  if(!fs.existsSync(source)){console.log('Todavía no existe una base de datos que respaldar.');return;}
  const dir=path.resolve(process.env.BACKUP_DIR||path.join(__dirname,'../.local/backups'));
  fs.mkdirSync(dir,{recursive:true});
  const destination=path.join(dir,'skilly-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db');
  const db=new Database(source,{readonly:true,fileMustExist:true});
  try{await db.backup(destination);console.log('Respaldo consistente guardado en: '+destination);}
  finally{db.close();}
}
backup().catch(e=>{console.error('No se pudo respaldar: '+e.message);process.exitCode=1;});
