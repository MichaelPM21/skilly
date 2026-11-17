/**
 * Flujo del módulo. Servidor de demostración aislado en puertos 3100/3101 usando un esquema
 * PostgreSQL de pruebas. Puede importar .local/preview.db si existe; sin ese respaldo no crea
 * automáticamente un perfil para la cuenta profesional demo.
 */

const path=require('path');
require('fs').mkdirSync(path.resolve('.local'),{recursive:true});
const pgTest=require('./postgres-helper');
process.env.BASE_URL='http://localhost:3100';process.env.ADMIN_URL='http://localhost:3101';process.env.GMAIL_USER='';process.env.GMAIL_APP_PASSWORD='';
const {createApp}=require('../server/index');const {db}=require('../server/db');const S=require('../server/security');
(async()=>{
  // Prepara el esquema aislado, crea accesos de demostración e inicia las dos aplicaciones locales de vista previa.
  
 await pgTest.setup();
 if(require('fs').existsSync('.local/preview.db'))await require('../scripts/import-sqlite').importSqlite('.local/preview.db');
 const password=await S.passwordHash('Skilly-prueba-local-2026!');
 for(const u of [{email:'admin@prueba.cl',name:'Equipo Skilly',role:'admin'},{email:'empresa@prueba.cl',name:'Organización de prueba',role:'organizacion'},{email:'camila@demo.cl',name:'Camila Morales',role:'profesional'}]){
  const pro=u.role==='profesional'?await db.prepare('SELECT id FROM professionals WHERE email=?').get(u.email):null;
  if(!await db.prepare('SELECT id FROM users WHERE email=?').get(u.email))await db.prepare('INSERT INTO users(id,email,name,password_hash,role,professional_id,verified,created_at) VALUES(?,?,?,?,?,?,1,?)').run(S.id('usr'),u.email,u.name,password,u.role,pro?.id||null,Date.now());
 }
 createApp('public').listen(3100,'127.0.0.1',/* Informa la dirección local cuando el servidor terminó de abrir su puerto. */ ()=>console.log('Vista de prueba: http://localhost:3100'));
 createApp('admin').listen(3101,'127.0.0.1',/* Informa la dirección local cuando el servidor terminó de abrir su puerto. */ ()=>console.log('Administración de prueba: http://localhost:3101'));
 process.on('SIGINT',/* Limpia el esquema de demostración al interrumpir el proceso y termina cuando concluye la limpieza. */ ()=>pgTest.cleanup().finally(/* Ejecuta la limpieza o salida final después del resultado, tanto si la promesa resolvió como si rechazó. */ ()=>process.exit()));
})().catch(e=>{
  // Informa el fallo de la vista de prueba y elimina su esquema temporal antes de finalizar.
  console.error(e);pgTest.cleanup().finally(()=>{
  // Ejecuta la limpieza o salida final después del resultado, tanto si la promesa resolvió como si rechazó.
  process.exitCode=1;});});
