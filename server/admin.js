/**
 * Flujo del módulo. Entrada del proceso administrativo: reutiliza index.start con kind=admin,
 * puerto y cookie propios. Comparte PostgreSQL y módulos de negocio con el sitio público; no
 * ejecuta el trabajador periódico.
 */

require('./index').start('admin').catch(error=>{
  // Informa el fallo de arranque y cierra la conexión antes de terminar con código de error.
  console.error('No se pudo iniciar administración:',error.message);require('./db').db.close().finally(()=>{
  // Ejecuta la limpieza o salida final después del resultado, tanto si la promesa resolvió como si rechazó.
  process.exitCode=1;});});
