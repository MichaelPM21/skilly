/**
 * @file Respaldo PostgreSQL mediante pg_dump en formato custom. No realiza
 * exportación SQLite ni incluye archivos externos a la base.
 */

require('dotenv').config();
const fs=require('node:fs'),path=require('node:path');
const {pgTool}=require('./postgres-tools');
/**
 * Crea la carpeta de respaldos y ejecuta pg_dump en formato custom con un nombre fechado. Usa
 * BACKUP_DIR o .local/backups y, si existe PGSCHEMA, limita el respaldo a ese esquema; devuelve
 * la ruta del archivo.
 *
 * @returns {Promise<string>} Ruta absoluta del archivo .dump creado por pg_dump.
 * @throws {Error} Propaga fallos de creación de carpeta, configuración y ejecución de pg_dump.
 * @example
 * const dumpPath = await backup();
 */
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
if(require.main===module)backup().catch(error=>{
  // Registra el error recibido y conserva el indicador de fallo del script o propaga el error al siguiente manejador.
  console.error('No se pudo respaldar PostgreSQL:',error.message);process.exitCode=1;});
module.exports={backup};
