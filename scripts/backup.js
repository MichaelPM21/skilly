require('dotenv').config();
const fs=require('node:fs'),path=require('node:path');
const {pgTool}=require('./postgres-tools');
async function backup(){
  const dir=path.resolve(process.env.BACKUP_DIR||path.join(__dirname,'../.local/backups'));
  fs.mkdirSync(dir,{recursive:true});
  const destination=path.join(dir,'skilly-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump');
  const args=['--format=custom','--file',destination];
  if(process.env.PGSCHEMA)args.push('--schema',process.env.PGSCHEMA);
  await pgTool('pg_dump',args);
  console.log('Respaldo PostgreSQL guardado en: '+destination);
  return destination;
}
if(require.main===module)backup().catch(error=>{console.error('No se pudo respaldar PostgreSQL:',error.message);process.exitCode=1;});
module.exports={backup};
