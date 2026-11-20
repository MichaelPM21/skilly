/**
 * @file Alta local del primer administrador: aplica migración, solicita
 * nombre/correo, genera contraseña si no se suministra y guarda su hash. No reemplaza una cuenta
 * existente ni crea una clave compartida.
 */

require('dotenv').config();
const readline = require('node:readline/promises');
const {
  migrate
} = require('../server/schema');
const {
  db
} = require('../server/db');
const S = require('../server/security');
(async () => {
  // Ejecuta el alta administrativa local completa y cierra lectura de terminal y base cuando termina correctamente.
  
  await migrate();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || (await rl.question('Correo del administrador: '))).trim().toLowerCase();
  const name = process.env.BOOTSTRAP_ADMIN_NAME || (await rl.question('Nombre: '));
  // Generated credential is printed once locally; no shared default password exists.
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || S.random().slice(0, 20);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) throw new Error('Correo y nombre obligatorios.');
  if (await db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new Error('Ya existe una cuenta con ese correo.');
  const hashed = await S.passwordHash(password);
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,verified,created_at) VALUES(?,?,?,?,'admin',1,?)").run(S.id('usr'), email, name, hashed, Date.now());
  console.log('Administrador creado.');
  if (!process.env.BOOTSTRAP_ADMIN_PASSWORD) console.log('Contraseña inicial (guárdala): ' + password);
  rl.close();
  await db.close();
})().catch(e => {
  // Registra el error recibido y conserva el indicador de fallo del script o propaga el error al siguiente manejador.
  
  console.error(e.message);
  process.exit(1);
});
