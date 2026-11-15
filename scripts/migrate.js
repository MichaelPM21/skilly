require('dotenv').config();
const {db}=require('../server/db');
require('../server/schema').migrate().then(()=>console.log('Esquema PostgreSQL actualizado.')).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.close());
