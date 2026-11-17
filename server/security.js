/**
 * Flujo del módulo. Utilidades de autenticación y autorización compartidas. Contraseñas: scrypt
 * con sal; tokens: aleatorios y hash SHA-256; sesiones: cookie HttpOnly con audiencia
 * pública/admin. La propiedad de reservas se comprueba en bookings.access.
 */

const crypto = require('crypto');
const {
  promisify
} = require('util');
const scrypt = promisify(crypto.scrypt);
const {
  db
} = require('./db');
/**
 * Genera 32 bytes aleatorios y los devuelve como 64 caracteres hexadecimales. Se usa para
 * secretos de sesión y enlaces, no para contraseñas elegidas por el usuario.
 */
const random = () => crypto.randomBytes(32).toString('hex');
/**
 * Devuelve el SHA-256 hexadecimal del valor recibido. Permite guardar tokens sin almacenar el
 * secreto original; las contraseñas usan passwordHash, no esta función.
 */
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
/**
 * Construye un identificador con prefijo y UUID sin guiones para distinguir entidades sin
 * depender de un contador.
 */
const id = prefix => prefix + '_' + crypto.randomUUID().replaceAll('-', '');
/**
 * Interrumpe la operación lanzando un Error con estado HTTP y mensaje público. wrap y el
 * manejador de errores de index.js lo convierten en una respuesta JSON.
 */
const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
/**
 * Valida una contraseña de 12 a 128 caracteres, genera una sal aleatoria y deriva 64 bytes con
 * scrypt. Resuelve una cadena sal:hash; no guarda ni permite recuperar la contraseña original.
 */
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
/**
 * Deriva el hash de la contraseña recibida usando la sal guardada y compara los bytes con
 * timingSafeEqual. Resuelve false para entradas inválidas o una credencial inexistente.
 */
async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, digest] = (stored || '').split(':');
  const calculated = await scrypt(password, salt || 'skilly-dummy-salt', 64);
  return !!digest && crypto.timingSafeEqual(calculated, Buffer.from(digest, 'hex'));
}
/**
 * Proyecta la fila interna de users a los datos de cuenta que recibe el navegador. Convierte
 * verified y profile y excluye password_hash y secretos de sesión.
 */
const publicUser = u => u && {
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  professionalId: u.professional_id,
  verified: !!u.verified,
  profile: JSON.parse(u.profile || '{}')
};
/**
 * Selecciona la cookie según la aplicación pública o administrativa. El nombre distinto y la
 * audiencia de la sesión separan ambos accesos.
 */
function cookieName(req) {
  return req.app.locals.kind === 'admin' ? 'skilly_admin_session' : 'skilly_session_v2';
}
/**
 * Extrae el valor de la cookie correspondiente a esta aplicación. Devuelve una cadena vacía
 * cuando no existe; no valida por sí sola la sesión.
 */
function tokenFrom(req) {
  const entry = (req.headers.cookie || '').split(';').map(/* Elimina espacios exteriores de cada valor antes de descartar entradas vacías o enviar los datos. */ v => v.trim()).find(/* Busca el primer elemento según la condición v.startsWith(cookieName(req) + '='). Se evalúan los datos ya cargados. */ v => v.startsWith(cookieName(req) + '='));
  return entry ? entry.slice(entry.indexOf('=') + 1) : '';
}
/**
 * Crea una sesión de 12 horas para una cuenta o de 2 horas para una reserva invitada. Persiste
 * solo el hash y envía el token en una cookie HttpOnly, SameSite=Lax y Secure según
 * configuración.
 */
async function session(req, res, userId, guestBookingId) {
  const token = random();
  const ttl = guestBookingId ? 2 * 3600000 : 12 * 3600000;
  await db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(hash(token), userId || null, guestBookingId || null, req.app.locals.kind, Date.now() + ttl);
  res.cookie(cookieName(req), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: ttl,
    path: '/'
  });
}
/**
 * Busca una sesión vigente de la audiencia actual usando el hash de la cookie. Adjunta
 * req.session y una cuenta activa o un invitado limitado a una reserva, y continúa con next.
 */
async function auth(req, res, next) {
  const token = tokenFrom(req);
  const s = token && (await db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>? AND audience=?').get(hash(token), Date.now(), req.app.locals.kind));
  if (s) {
    req.session = s;
    if (s.user_id) req.user = await db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(s.user_id);else if (s.guest_booking_id) req.user = {
      role: 'invitado',
      guestBookingId: s.guest_booking_id,
      id: 'guest:' + s.guest_booking_id
    };
  }
  next();
}
/**
 * Exige autenticación y uno de los roles recibidos. Lanza 401 si no hay usuario y 403 si el rol
 * no permite la operación; no comprueba propiedad de reservas.
 */
function requireRole(req, ...roles) {
  if (!req.user) fail(401, 'Inicia sesión para continuar.');
  if (!roles.includes(req.user.role)) fail(403, 'No tienes permiso para esta operación.');
}
/**
 * Exige rol admin y acceso desde la aplicación administrativa. Evita que una cuenta
 * administrativa utilice las operaciones de gestión a través del sitio público.
 */
function admin(req) {
  requireRole(req, 'admin');
  if (req.app.locals.kind !== 'admin') fail(403, 'Utiliza la aplicación administrativa.');
}
/**
 * Inserta actor, acción, objetivo, detalle y fecha en audit_log. Usa system cuando no hay
 * usuario asociado y deja trazabilidad de las operaciones que la invocan.
 */
async function audit(req, action, target, detail = '') {
  await db.prepare('INSERT INTO audit_log(actor,action,target,detail,created_at) VALUES(?,?,?,?,?)').run(req.user?.id || 'system', action, target || '', detail, Date.now());
}
const attempts = new Map();
/**
 * Cuenta intentos por IP y operación durante 15 minutos y lanza 429 al exceder el máximo. El
 * contador vive en memoria de este proceso y no se comparte entre servidores.
 */
function rateLimit(req, key, max = 20) {
  const now = Date.now();
  if (attempts.size > 10000) for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const k = req.ip + ':' + key;
  let bucket = attempts.get(k);
  if (!bucket || bucket.until < now) {
    bucket = {
      count: 0,
      until: now + 15 * 60000
    };
    attempts.set(k, bucket);
  }
  if (++bucket.count > max) fail(429, 'Demasiados intentos. Vuelve a intentarlo en 15 minutos.');
}
/**
 * Genera un enlace secreto con propósito, sujeto y vencimiento; guarda solo su hash en
 * access_tokens. Devuelve el token original para incorporarlo al correo.
 */
async function issueToken(purpose, subject, ttl) {
  const token = random();
  await db.prepare('INSERT INTO access_tokens(token_hash,purpose,subject,expires_at) VALUES(?,?,?,?)').run(hash(token), purpose, subject, Date.now() + ttl);
  return token;
}
/**
 * Valida longitud, propósito, vigencia y ausencia de uso de un token y devuelve su fila. No lo
 * consume: el llamador debe guardar used_at dentro de la misma transacción que realiza la
 * acción.
 */
async function useToken(token, purpose) {
  if (typeof token !== 'string' || token.length !== 64) fail(400, 'Enlace inválido o vencido.');
  const row = await db.prepare('SELECT * FROM access_tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?').get(hash(token), purpose, Date.now());
  if (!row) fail(400, 'Enlace inválido o vencido.');
  return row;
}
module.exports = {
  random,
  hash,
  id,
  fail,
  passwordHash,
  passwordMatches,
  publicUser,
  session,
  auth,
  requireRole,
  admin,
  audit,
  rateLimit,
  issueToken,
  useToken,
  tokenFrom,
  cookieName
};
