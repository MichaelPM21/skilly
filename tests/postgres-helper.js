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
async function setup(){const client=new Client({connectionString:testUrl});await client.connect();try{await client.query('CREATE SCHEMA '+schema);}finally{await client.end();}await require('../server/schema').migrate();}
async function cleanup(){await require('../server/db').db.close();const client=new Client({connectionString:testUrl});await client.connect();try{await client.query('DROP SCHEMA '+schema+' CASCADE');}finally{await client.end();}}
module.exports={setup,cleanup,schema,testUrl};
