/**
 * @file Utilidades de autenticación y autorización compartidas. Contraseñas: scrypt
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
 *
 * No recibe argumentos.
 * @returns {string} Secreto aleatorio de 64 caracteres hexadecimales.
 * @example
 * const token = random(); // 32 bytes; no registrar el secreto.
 */
const random = () => crypto.randomBytes(32).toString('hex');
/**
 * Devuelve el SHA-256 hexadecimal del valor recibido. Permite guardar tokens sin almacenar el
 * secreto original; las contraseñas usan passwordHash, no esta función.
 *
 * @param {string|Buffer} value - Contenido que se transforma a SHA-256.
 * @returns {string} Resumen hexadecimal; no sirve como sustituto del hash de contraseñas.
 * @example
 * const digest = hash("token-de-prueba");
 */
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
/**
 * Construye un identificador con prefijo y UUID sin guiones para distinguir entidades sin
 * depender de un contador.
 *
 * @param {string} prefix - Prefijo de entidad, por ejemplo usr o bkg.
 * @returns {string} Prefijo, guion bajo y UUID sin guiones.
 * @example
 * const bookingId = id("bkg");
 */
const id = prefix => prefix + '_' + crypto.randomUUID().replaceAll('-', '');
/**
 * Interrumpe la operación lanzando un Error con estado HTTP y mensaje público. wrap y el
 * manejador de errores de index.js lo convierten en una respuesta JSON.
 *
 * @param {number} status - Estado HTTP que utilizará el manejador de errores.
 * @param {string} message - Mensaje apto para enviar al cliente; no debe contener secretos.
 * @returns {never} Siempre lanza una excepción; no devuelve un valor.
 * @throws {Error} Error con la propiedad status y el mensaje recibido.
 * @example
 * fail(400, "El precio es inválido.");
 */
const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
/**
 * Valida una contraseña de 12 a 128 caracteres, genera una sal aleatoria y deriva 64 bytes con
 * scrypt. Resuelve una cadena sal:hash; no guarda ni permite recuperar la contraseña original.
 *
 * @param {string} password - Contraseña de 12 a 128 caracteres; no se persiste en texto plano.
 * @returns {Promise<string>} Sal hexadecimal y clave derivada de 64 bytes, separadas por dos puntos.
 * @throws {Error} Error con status 400 si la longitud o el tipo son inválidos; también propaga errores de scrypt.
 * @example
 * const stored = await passwordHash("Clave-De-Prueba-2026!");
 */
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
/**
 * Deriva el hash de la contraseña recibida usando la sal guardada y compara los bytes con
 * timingSafeEqual. Resuelve false para entradas inválidas o una credencial inexistente.
 *
 * @param {string} password - Contraseña presentada durante el ingreso.
 * @param {string} stored - Credencial sal:hash generada por passwordHash; ausencia de hash produce false.
 * @returns {Promise<boolean>} true si la clave derivada coincide; false para clave incorrecta o entrada inválida.
 * @throws {Error} Error de criptografía si el digest almacenado está malformado o su longitud es incompatible.
 * @example
 * const stored = await passwordHash("Clave-De-Prueba-2026!");
 * const matches = await passwordMatches("Clave-De-Prueba-2026!", stored); // true
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
 *
 * @param {Object|null|undefined} u - Fila users; profile debe contener JSON válido si existe.
 * @returns {Object|null|undefined} Cuenta sin password_hash; conserva null/undefined cuando no existe fila.
 * @example
 * const visible = publicUser({id:"usr_demo", name:"Demo", role:"organizacion", verified:1, profile:"{}"});
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
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @returns {string} Nombre de la cookie según app.locals.kind.
 * @example
 * cookieName({app:{locals:{kind:"admin"}}}); // skilly_admin_session
 */
function cookieName(req) {
  return req.app.locals.kind === 'admin' ? 'skilly_admin_session' : 'skilly_session_v2';
}
/**
 * Extrae el valor de la cookie correspondiente a esta aplicación. Devuelve una cadena vacía
 * cuando no existe; no valida por sí sola la sesión.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @returns {string} Valor de la cookie de esta audiencia o cadena vacía.
 * @example
 * tokenFrom({app:{locals:{kind:"public"}}, headers:{cookie:""}}); // ""
 */
function tokenFrom(req) {
  const entry = (req.headers.cookie || '').split(';').map(/* Elimina espacios exteriores de cada valor antes de descartar entradas vacías o enviar los datos. */ v => v.trim()).find(/* Busca el primer elemento según la condición v.startsWith(cookieName(req) + '='). Se evalúan los datos ya cargados. */ v => v.startsWith(cookieName(req) + '='));
  return entry ? entry.slice(entry.indexOf('=') + 1) : '';
}
/**
 * Crea una sesión de 12 horas para una cuenta o de 2 horas para una reserva invitada. Persiste
 * solo el hash y envía el token en una cookie HttpOnly, SameSite=Lax y Secure según
 * configuración.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {import("express").Response} res - Respuesta HTTP sobre la que se escriben cookies, JSON o redirecciones.
 * @param {string|null} userId - Identificador de cuenta; null para una reserva invitada.
 * @param {string} [guestBookingId] - Reserva invitada; cuando existe, la vigencia es de 2 horas en lugar de 12.
 * @returns {Promise<void>} Persiste el hash en sessions y escribe la cookie; no devuelve el token.
 * @throws {Error} Propaga errores de PostgreSQL o de escritura de respuesta.
 * @example
 * // En un controlador autenticado, con req y res de Express:
 * await session(req, res, req.user.id);
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
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {import("express").Response} res - Respuesta HTTP sobre la que se escriben cookies, JSON o redirecciones.
 * @param {import("express").NextFunction} next - Continuación de Express, invocada tras resolver la sesión.
 * @returns {Promise<void>} Agrega req.session y req.user cuando corresponde; después llama a next.
 * @example
 * app.use(auth);
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
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {...string} roles - Roles permitidos para esta operación.
 * @returns {void} Continúa sin valor si el rol está autorizado.
 * @throws {Error} Error 401 sin sesión o 403 si el rol no está permitido.
 * @example
 * requireRole(req, "organizacion", "admin");
 */
function requireRole(req, ...roles) {
  if (!req.user) fail(401, 'Inicia sesión para continuar.');
  if (!roles.includes(req.user.role)) fail(403, 'No tienes permiso para esta operación.');
}
/**
 * Exige rol admin y acceso desde la aplicación administrativa. Evita que una cuenta
 * administrativa utilice las operaciones de gestión a través del sitio público.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @returns {void} Continúa únicamente con rol admin en la aplicación administrativa.
 * @throws {Error} Error 401/403 cuando falta sesión, rol o audiencia administrativa.
 * @example
 * admin(req);
 */
function admin(req) {
  requireRole(req, 'admin');
  if (req.app.locals.kind !== 'admin') fail(403, 'Utiliza la aplicación administrativa.');
}
/**
 * Inserta actor, acción, objetivo, detalle y fecha en audit_log. Usa system cuando no hay
 * usuario asociado y deja trazabilidad de las operaciones que la invocan.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {string} action - Acción identificable en el registro de auditoría.
 * @param {string} target - Entidad afectada; se guarda vacío si no se proporciona.
 * @param {string} [detail=""] - Detalle público de la operación; excluir contraseñas y tokens.
 * @returns {Promise<void>} Inserta un evento en audit_log con actor y fecha.
 * @example
 * await audit(req, "service.review", serviceId, "Aprobado");
 */
async function audit(req, action, target, detail = '') {
  await db.prepare('INSERT INTO audit_log(actor,action,target,detail,created_at) VALUES(?,?,?,?,?)').run(req.user?.id || 'system', action, target || '', detail, Date.now());
}
const attempts = new Map();
/**
 * Cuenta intentos por IP y operación durante 15 minutos y lanza 429 al exceder el máximo. El
 * contador vive en memoria de este proceso y no se comparte entre servidores.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {string} key - Nombre del grupo de operación combinado con req.ip.
 * @param {number} [max=20] - Máximo de intentos permitidos en una ventana de 15 minutos.
 * @returns {void} Actualiza el contador en memoria; no es un límite distribuido.
 * @throws {Error} Error 429 al superar max dentro de la ventana.
 * @example
 * rateLimit(req, "login", 20);
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
 *
 * @param {string} purpose - Propósito del enlace, por ejemplo verify o reset.
 * @param {string} subject - Identificador de cuenta o reserva asociado.
 * @param {number} ttl - Vigencia en milisegundos desde Date.now().
 * @returns {Promise<string>} Token original para el enlace; en la base solo se almacena su hash.
 * @example
 * const token = await issueToken("verify", userId, 48 * 3600000);
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
 *
 * @param {string} token - Secreto de 64 caracteres presentado por el cliente.
 * @param {string} purpose - Propósito que debe coincidir con el registro.
 * @returns {Promise<Object>} Fila access_tokens válida; esta función no marca used_at.
 * @throws {Error} Error 400 para token inválido, vencido, usado o de otro propósito.
 * @example
 * // Dentro de la misma transacción que aplica la acción y consume used_at:
 * const record = await useToken(token, "verify");
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
