/**
 * Flujo del módulo. npm start inicia dos procesos Node con el mismo entorno: público y
 * administración. Las señales y salidas con error cierran los hijos; no incluye recarga
 * automática al editar archivos.
 */

const {spawn}=require('child_process');
const children=['server/index.js','server/admin.js'].map(/* Inicia cada aplicación en su propio proceso Node, heredando entorno y salida de la terminal. */ file=>spawn(process.execPath,[file],{stdio:'inherit',env:process.env,windowsHide:true}));
/**
 * Solicita la terminación de los dos procesos hijos, público y administrativo. Se usa al recibir
 * una señal o detectar la salida con error de uno de ellos.
 */
function stop(){for(const child of children)child.kill();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
children.forEach(/* Registra el control de salida de cada proceso hijo para detener el conjunto si alguno falla. */ c=>c.on('exit',code=>{
  // Si un hijo termina con error, detiene los otros procesos y conserva su código de salida.
  if(code){stop();process.exitCode=code;}}));
