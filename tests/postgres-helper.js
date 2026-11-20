/**
 * @file Aislamiento PostgreSQL de pruebas: exige TEST_DATABASE_URL terminada en
 * _test, crea un esquema aleatorio, configura PGSCHEMA y desactiva Gmail. setup prepara el
 * esquema y cleanup lo elimina al terminar.
 */

const fs=require('node:fs');
const crypto=require('node:crypto');
const {Client}=require('pg');
require('dotenv').config();
const local='.local/postgres-app.env';
const testUrl=process.env.TEST_DATABASE_URL||(fs.existsSync(local)?require('dotenv').parse(fs.readFileSync(local)).TEST_DATABASE_URL:null);
if(!testUrl)throw new Error('Configura TEST_DATABASE_URL para ejecutar las pruebas en PostgreSQL.');
const url=new URL(testUrl);
if(!url.pathname.endsWith('_test'))throw new Error('La base de pruebas debe terminar en _test.');
const schema='skilly_test_'+crypto.randomBytes(12).toString('hex');
process.env.DATABASE_URL=testUrl;
process.env.PGSCHEMA=schema;
process.env.NODE_ENV='test';
process.env.GMAIL_USER='';process.env.GMAIL_APP_PASSWORD='';
/**
 * Crea un esquema aleatorio exclusivo de esta suite en TEST_DATABASE_URL y aplica la migración
 * dentro de él. El módulo exige una base cuyo nombre termine en _test y desactiva Gmail.
 *
 * @returns {Promise<void>} Crea y migra el esquema aleatorio configurado para esta suite.
 * @throws {Error} Propaga fallos de conexión, creación de esquema o migración.
 * @example
 * await setup();
 */
async function setup(){const client=new Client({connectionString:testUrl});await client.connect();try{await client.query('CREATE SCHEMA '+schema);}finally{await client.end();}await require('../server/schema').migrate();}
/**
 * Cierra el pool de la suite y elimina con CASCADE únicamente su esquema temporal. Debe
 * ejecutarse después de cerrar servidores y consultas que usen ese esquema.
 *
 * @returns {Promise<void>} Cierra el pool y elimina únicamente el esquema temporal de esta suite.
 * @throws {Error} Propaga errores de cierre o eliminación del esquema.
 * @example
 * // Después de cerrar servidores y consultas del ensayo:
 * await cleanup();
 */
async function cleanup(){await require('../server/db').db.close();const client=new Client({connectionString:testUrl});await client.connect();try{await client.query('DROP SCHEMA '+schema+' CASCADE');}finally{await client.end();}}
module.exports={setup,cleanup,schema,testUrl};
