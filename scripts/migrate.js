/**
 * @file Punto de entrada de npm run db:migrate. Ejecuta la migración PostgreSQL y
 * cierra el pool tanto si termina bien como si informa un error.
 */

require('dotenv').config();
const {db}=require('../server/db');
require('../server/schema').migrate().then(/* Continúa la operación cuando la promesa anterior termina correctamente. */ ()=>console.log('Esquema PostgreSQL actualizado.')).catch(error=>{
  // Registra el error recibido y conserva el indicador de fallo del script o propaga el error al siguiente manejador.
  console.error(error.message);process.exitCode=1;}).finally(/* Cierra el pool al terminar, tanto en éxito como en error, para no dejar conexiones abiertas. */ ()=>db.close());
