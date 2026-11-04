const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const { db } = require('./db');
const random = () => crypto.randomBytes(32).toString('hex');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const id = prefix => prefix + '_' + crypto.randomUUID().replaceAll('-', '');
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, digest] = (stored || '').split(':');
  const calculated = await scrypt(password, salt || 'skilly-dummy-salt', 64);
  return !!digest && crypto.timingSafeEqual(calculated, Buffer.from(digest, 'hex'));
}
const publicUser = u => u && ({ id: u.id, name: u.name, email: u.email, role: u.role, professionalId: u.professional_id, verified: !!u.verified, profile: JSON.parse(u.profile || '{}') });
function cookieName(req) { return req.app.locals.kind === 'admin' ? 'skilly_admin_session' : 'skilly_session_v2'; }
function tokenFrom(req) {
  const entry = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName(req) + '='));
  return entry ? entry.slice(entry.indexOf('=') + 1) : '';
}
function session(req, res, userId, guestBookingId) {
  const token = random();
  const ttl = guestBookingId ? 2 * 3600000 : 12 * 3600000;
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(hash(token), userId || null, guestBookingId || null, req.app.locals.kind, Date.now() + ttl);
  res.cookie(cookieName(req), token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: ttl, path: '/' });
}
function auth(req, res, next) {
  const token = tokenFrom(req);
  const s = token && db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>? AND audience=?').get(hash(token), Date.now(), req.app.locals.kind);
  if (s) {
    req.session = s;
    if (s.user_id) req.user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(s.user_id);
    else if (s.guest_booking_id) req.user = { role: 'invitado', guestBookingId: s.guest_booking_id, id: 'guest:' + s.guest_booking_id };
  }
  next();
}
function requireRole(req, ...roles) {
  if (!req.user) fail(401, 'Inicia sesión para continuar.');
  if (!roles.includes(req.user.role)) fail(403, 'No tienes permiso para esta operación.');
}
function admin(req) {
  requireRole(req, 'admin');
  if (req.app.locals.kind !== 'admin') fail(403, 'Utiliza la aplicación administrativa.');
}
function audit(req, action, target, detail = '') {
  db.prepare('INSERT INTO audit_log(actor,action,target,detail,created_at) VALUES(?,?,?,?,?)').run(req.user?.id || 'system', action, target || '', detail, Date.now());
}
const attempts = new Map();
function rateLimit(req, key, max = 20) {
  const now = Date.now();
  if (attempts.size > 10000) for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const k = req.ip + ':' + key;
  let bucket = attempts.get(k);
  if (!bucket || bucket.until < now) { bucket = { count: 0, until: now + 15 * 60000 }; attempts.set(k, bucket); }
  if (++bucket.count > max) fail(429, 'Demasiados intentos. Vuelve a intentarlo en 15 minutos.');
}
function issueToken(purpose, subject, ttl) {
  const token = random();
  db.prepare('INSERT INTO access_tokens(token_hash,purpose,subject,expires_at) VALUES(?,?,?,?)').run(hash(token), purpose, subject, Date.now() + ttl);
  return token;
}
function useToken(token, purpose) {
  if (typeof token !== 'string' || token.length !== 64) fail(400, 'Enlace inválido o vencido.');
  const row = db.prepare('SELECT * FROM access_tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>?').get(hash(token), purpose, Date.now());
  if (!row) fail(400, 'Enlace inválido o vencido.');
  return row;
}
module.exports = { random, hash, id, fail, passwordHash, passwordMatches, publicUser, session, auth, requireRole, admin, audit, rateLimit, issueToken, useToken, tokenFrom, cookieName };
