/**
 * @file Resolución y ejecución de herramientas PostgreSQL para
 * respaldo/restauración. Las credenciales vienen de DATABASE_URL y se entregan al proceso por
 * variables de entorno.
 */

const path=require('node:path');
const fs=require('node:fs');
const {execFile}=require('node:child_process');
const run=require('node:util').promisify(execFile);
/**
 * Resuelve el ejecutable PostgreSQL desde PG_BIN, instalaciones de Windows ordenadas por versión
 * o PATH. Devuelve la ruta sin ejecutar el programa.
 *
 * @param {string} name - Nombre de utilidad, por ejemplo pg_dump o pg_restore.
 * @returns {string} Ruta preferida o nombre para resolución por PATH; no comprueba todos los destinos.
 * @example
 * const executable = binary("pg_dump");
 */
function binary(name){
  if(process.env.PG_BIN)return path.join(process.env.PG_BIN,name+(process.platform==='win32'?'.exe':''));
  if(process.platform==='win32'){
    const root=path.join(process.env.ProgramFiles||'C:\\Program Files','PostgreSQL');
    if(fs.existsSync(root))for(const version of fs.readdirSync(root).sort(/* Ordena las versiones instaladas de PostgreSQL de mayor a menor para buscar primero la herramienta más reciente. */ (a,b)=>Number(b)-Number(a))){const exe=path.join(root,version,'bin',name+'.exe');if(fs.existsSync(exe))return exe;}
  }
  return name;
}
/**
 * Ejecuta una utilidad PostgreSQL usando DATABASE_URL para preparar variables PG*. Pasa la
 * contraseña por el entorno, no por los argumentos, oculta ventanas auxiliares y devuelve el
 * resultado de execFile.
 *
 * @param {string} name - Utilidad PostgreSQL a ejecutar.
 * @param {string[]} args - Argumentos, añadidos después de --no-password.
 * @returns {Promise<{stdout: string, stderr: string}>} Salida del proceso ejecutado con las variables PG* derivadas de DATABASE_URL.
 * @throws {Error} Propaga URL inválida, ejecutable ausente, salida excesiva o código de proceso no satisfactorio.
 * @example
 * const output = await pgTool("pg_dump", ["--version"]);
 */
async function pgTool(name,args){
  const url=new URL(process.env.DATABASE_URL);
  const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1))};
  if(url.searchParams.has('sslmode'))env.PGSSLMODE=url.searchParams.get('sslmode');
  return run(binary(name),['--no-password',...args],{env,windowsHide:true,maxBuffer:10*1024*1024});
}
module.exports={pgTool};
