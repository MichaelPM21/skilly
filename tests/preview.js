const path=require('path');
require('fs').mkdirSync(path.resolve('.local'),{recursive:true});
const pgTest=require('./postgres-helper');
process.env.BASE_URL='http://localhost:3100';process.env.ADMIN_URL='http://localhost:3101';process.env.GMAIL_USER='';process.env.GMAIL_APP_PASSWORD='';
const {createApp}=require('../server/index');const {db}=require('../server/db');const S=require('../server/security');
(async()=>{
 await pgTest.setup();
 if(require('fs').existsSync('.local/preview.db'))await require('../scripts/import-sqlite').importSqlite('.local/preview.db');
 const password=await S.passwordHash('Skilly-prueba-local-2026!');
 for(const u of [{email:'admin@prueba.cl',name:'Equipo Skilly',role:'admin'},{email:'empresa@prueba.cl',name:'Organización de prueba',role:'organizacion'},{email:'camila@demo.cl',name:'Camila Morales',role:'profesional'}]){
  const pro=u.role==='profesional'?await db.prepare('SELECT id FROM professionals WHERE email=?').get(u.email):null;
  if(!await db.prepare('SELECT id FROM users WHERE email=?').get(u.email))await db.prepare('INSERT INTO users(id,email,name,password_hash,role,professional_id,verified,created_at) VALUES(?,?,?,?,?,?,1,?)').run(S.id('usr'),u.email,u.name,password,u.role,pro?.id||null,Date.now());
 }
 createApp('public').listen(3100,'127.0.0.1',()=>console.log('Vista de prueba: http://localhost:3100'));
 createApp('admin').listen(3101,'127.0.0.1',()=>console.log('Administración de prueba: http://localhost:3101'));
 process.on('SIGINT',()=>pgTest.cleanup().finally(()=>process.exit()));
})().catch(e=>{console.error(e);pgTest.cleanup().finally(()=>{process.exitCode=1;});});
