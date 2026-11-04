require('dotenv').config();
process.env.APP_KIND='admin';
const {createApp}=require('./index');
const port=process.env.ADMIN_PORT||3001;
createApp('admin').listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Skilly administración: http://localhost:${port}`));
