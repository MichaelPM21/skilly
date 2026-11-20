/**
 * @file Cuentas y sesiones: registro → correo de verificación → acceso por cookie.
 * El registro profesional guarda usuario, perfil y primer servicio pendientes; recuperación e
 * invitaciones consumen tokens. Los invitados acceden a una sola reserva.
 */

const {
  db
} = require('./db');
const S = require('./security');
const notify = require('./notifications');
const {
  validateAvailability
} = require('./scheduling');
/**
 * Adapta una función asíncrona de ruta a Express. Captura tanto excepciones síncronas como
 * rechazos y los entrega a next para conservar el formato común de error.
 *
 * @param {Function} fn - Operación que ejecutará el adaptador; sus errores se propagan al llamador.
 * @returns {import("express").RequestHandler} Manejador que deriva rechazos y excepciones a next.
 * @example
 * app.get("/api/example", wrap(async (req, res) => { res.json({ok:true}); }));
 */
const wrap = fn => /* Devuelve el middleware de Express que ejecuta fn con req/res y deriva cualquier error a next. */ (req, res, next) => Promise.resolve().then(/* Devuelve el middleware de Express que ejecuta fn con req/res y deriva cualquier error a next. */ () => fn(req, res)).catch(next);
/**
 * Normaliza el correo a minúsculas sin espacios exteriores y valida formato básico y longitud
 * máxima de 254 caracteres. Lanza un error HTTP 400 si no cumple.
 *
 * @param {string} value - Correo recibido; se recorta y normaliza a minúsculas.
 * @returns {string} Correo normalizado que supera el formato validado.
 * @throws {Error} Error 400 si el correo no cumple la validación.
 * @example
 * email(" Persona@Example.test "); // persona@example.test
 */
const email = value => {
  const v = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 254) S.fail(400, 'Correo inválido.');
  return v;
};
/**
 * Exige una cadena dentro del tamaño máximo y devuelve su contenido sin espacios exteriores. La
 * obligatoriedad del texto debe comprobarla el llamador.
 *
 * @param {string} v - Texto a normalizar; se verifica tipo antes de recortar.
 * @param {number} [max=1000] - Longitud máxima admitida antes de trim.
 * @returns {string} Cadena sin espacios exteriores.
 * @throws {Error} Error 400 si el valor no es texto o excede max.
 * @example
 * text("  Asesoría  ", 180); // Asesoría
 */
const text = (v, max = 1000) => {
  if (typeof v !== 'string' || v.length > max) S.fail(400, 'Texto inválido o demasiado largo.');
  return v.trim();
};
/**
 * Normaliza enlaces de LinkedIn, agregando HTTPS a los que comienzan por su dominio. Rechaza
 * otros dominios, protocolos, credenciales embebidas y URLs excesivas con un mensaje de
 * validación.
 *
 * @param {string} value - URL de perfil que debe utilizar un dominio LinkedIn permitido.
 * @returns {string} URL HTTPS normalizada del perfil.
 * @throws {Error} Error 400 si falta el perfil o la URL no corresponde a LinkedIn.
 * @example
 * linkedin("https://www.linkedin.com/in/perfil-demo");
 */
function linkedin(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  try {
    const url = new URL(/^(?:[a-z0-9-]+\.)*linkedin\.com\//i.test(raw) ? 'https://' + raw : raw);
    if (raw.length > 2000 || url.protocol !== 'https:' || !/(^|\.)linkedin\.com$/.test(url.hostname) || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    S.fail(400, 'Revisa el enlace de LinkedIn. Ejemplo: https://www.linkedin.com/in/tu-usuario');
  }
}
/**
 * Registra registro, ingreso, sesiones, verificación, recuperación, perfil y accesos invitados.
 * La cuenta profesional crea perfil y primer servicio en una transacción; las rutas
 * administrativas gestionan invitaciones y auditoría.
 *
 * @param {import("express").Express} app - Aplicación pública o administrativa que recibe los manejadores HTTP.
 * @returns {void} Registra rutas y middleware en app; no inicia el servidor.
 * @example
 * // Durante la construcción de la aplicación Express:
 * authRoutes(app);
 */
function authRoutes(app) {
  /**
   * Obtiene la URL de la aplicación actual para construir enlaces de correo. Usa ADMIN_URL para
   * administración y BASE_URL para el sitio público, con valores locales por defecto.
   *
   * @returns {string} URL base configurada para la aplicación actual.
   */
  const base = () => app.locals.kind === 'admin' ? process.env.ADMIN_URL || 'http://localhost:3001' : process.env.BASE_URL || 'http://localhost:3000';
  /**
   * GET /api/auth/me. Devuelve la cuenta de la sesión o el alcance del invitado; sin autenticación
   * responde null. No envía contraseñas ni tokens.
   */
  app.get('/api/auth/me', (req, res) => res.json(req.user?.role === 'invitado' ? {
    role: 'invitado',
    guestBookingId: req.user.guestBookingId,
    name: 'Invitado'
  } : S.publicUser(req.user) || null));
  /**
   * POST /api/auth/login. Valida correo, contraseña y aplicación correspondiente al rol. Crea la
   * cookie de sesión y audita el ingreso; limita intentos y devuelve la cuenta pública.
   */
  app.post('/api/auth/login', wrap(async (req, res) => {
    S.rateLimit(req, 'login');
    const u = await db.prepare('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1').get(String(req.body.email || '').toLowerCase());
    const ok = await S.passwordMatches(req.body.password, u?.password_hash);
    if (!ok || app.locals.kind === 'admin' !== (u.role === 'admin')) S.fail(401, 'Correo o contraseña incorrectos para este acceso.');
    await S.session(req, res, u.id);
    await S.audit({
      ...req,
      user: u
    }, 'login', u.id);
    res.json(S.publicUser(u));
  }));
  /**
   * POST /api/auth/logout. Elimina la sesión identificada por la cookie y solicita borrarla del
   * navegador. Devuelve ok aunque no hubiera sesión vigente.
   */
  app.post('/api/auth/logout', wrap(async (req, res) => {
    await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(S.hash(S.tokenFrom(req)));
    res.clearCookie(S.cookieName(req), {
      path: '/'
    });
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/auth/register. Valida nombre, correo, rol y contraseña; para profesionales crea
   * perfil y primer servicio dentro de una transacción. Inicia sesión y envía verificación,
   * manteniendo perfil y publicación pendientes.
   */
  app.post('/api/auth/register', wrap(async (req, res) => {
    if (app.locals.kind === 'admin') S.fail(403, 'Los administradores crean las cuentas desde su panel.');
    S.rateLimit(req, 'register', 10);
    const b = req.body,
      mail = email(b.email),
      name = text(b.name, 160);
    if (!name || !['organizacion', 'profesional'].includes(b.role)) S.fail(400, 'Completa nombre y tipo de cuenta.');
    if (await db.prepare('SELECT id FROM users WHERE email=?').get(mail)) S.fail(409, 'Ya existe una cuenta con ese correo.');
    const existing = b.role === 'profesional' && (await db.prepare('SELECT id FROM professionals WHERE lower(email)=lower(?)').get(mail));
    if (existing) S.fail(409, 'Este perfil ya existe. Solicita a Skilly que habilite tu cuenta para recuperar el acceso.');
    const password = await S.passwordHash(b.password),
      uid = S.id('usr');
    let pid = null;
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      if (b.role === 'profesional') {
        const v = b.validation;
        if (!v?.linkedin || !v?.cv || !v?.yearsExperience) S.fail(400, 'Completa LinkedIn, experiencia y antecedentes.');
        v.linkedin = linkedin(v.linkedin);
        const {
          validateService
        } = require('./services');
        const service = validateService(b);
        pid = S.id('prof');
        await db.prepare(`INSERT INTO professionals(id,name,email,category,title,description,price,modality,tags,status,validation,availability,created_at) VALUES(?,?,?,?,?,?,?,?,?,'pendiente',?,?,?)`).run(pid, name, mail, service.category, service.title, service.description, String(service.price), service.modality, JSON.stringify(service.tags), JSON.stringify(v), JSON.stringify(validateAvailability(b.availability || {
          days: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'],
          hours: ['09:00', '11:00', '15:00']
        })), Date.now());
        await db.prepare('INSERT INTO services(id,professional_id,draft,status,created_at,updated_at) VALUES(?,?,?,\'pendiente\',?,?)').run(S.id('svc'), pid, JSON.stringify(service), Date.now(), Date.now());
      }
      await db.prepare('INSERT INTO users(id,email,name,password_hash,role,professional_id,created_at) VALUES(?,?,?,?,?,?,?)').run(uid, mail, name, password, b.role, pid, Date.now());
    }).immediate();
    await S.session(req, res, uid);
    const token = await S.issueToken('verify', uid, 24 * 3600000);
    await notify.send(mail, 'Confirma tu correo en Skilly', `Abre este enlace para verificar tu correo: ${base()}/#verify=${token}`);
    res.status(201).json(S.publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(uid)));
  }));
  /**
   * POST /api/auth/verify. Valida y consume el token de verificación en una transacción. Marca el
   * correo verificado y vincula historial importado no invitado por ese correo a una organización.
   */
  app.post('/api/auth/verify', wrap(async (req, res) => {
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const t = await S.useToken(req.body.token, 'verify');
      const u = await db.prepare('SELECT * FROM users WHERE id=?').get(t.subject);
      await db.prepare('UPDATE users SET verified=1 WHERE id=?').run(u.id);
      // Imported registered-client history only. Guest reservations stay separately scoped.
      if (u.role === 'organizacion') await db.prepare('UPDATE bookings SET org_user_id=? WHERE org_user_id IS NULL AND guest=0 AND lower(org_email)=lower(?)').run(u.id, u.email);
      await db.prepare('UPDATE access_tokens SET used_at=? WHERE token_hash=?').run(Date.now(), t.token_hash);
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/auth/forgot. Emite un enlace de recuperación de 30 minutos si la cuenta activa
   * pertenece a esta aplicación. Siempre responde un mensaje genérico para no revelar existencia
   * de cuentas.
   */
  app.post('/api/auth/forgot', wrap(async (req, res) => {
    S.rateLimit(req, 'recovery', 5);
    const mail = email(req.body.email);
    const u = await db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(mail);
    if (u && app.locals.kind === 'admin' === (u.role === 'admin')) {
      const token = await S.issueToken('reset', u.id, 30 * 60000);
      await notify.send(mail, 'Recuperación de acceso a Skilly', `Crea una nueva contraseña en ${base()}/#reset=${token}\nEl enlace vence en 30 minutos.`);
    }
    res.json({
      ok: true,
      message: 'Si existe una cuenta, recibirás un enlace de recuperación.'
    });
  }));
  /**
   * POST /api/auth/reset. Valida contraseña y token de recuperación, verifica la aplicación,
   * actualiza el hash y consume el enlace. Marca correo verificado y revoca sesiones anteriores de
   * la cuenta.
   */
  app.post('/api/auth/reset', wrap(async (req, res) => {
    S.rateLimit(req, 'reset', 10);
    const hashed = await S.passwordHash(req.body.password);
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const t = await S.useToken(req.body.token, 'reset');
      const u = await db.prepare('SELECT * FROM users WHERE id=?').get(t.subject);
      if (!u || app.locals.kind === 'admin' !== (u.role === 'admin')) S.fail(400, 'Enlace inválido para este acceso.');
      await db.prepare('UPDATE users SET password_hash=?,verified=1 WHERE id=?').run(hashed, t.subject);
      if (u.role === 'organizacion') await db.prepare('UPDATE bookings SET org_user_id=? WHERE org_user_id IS NULL AND guest=0 AND lower(org_email)=lower(?)').run(u.id, u.email);
      await db.prepare('UPDATE access_tokens SET used_at=? WHERE token_hash=?').run(Date.now(), t.token_hash);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.subject);
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * PATCH /api/auth/profile. Valida nombre y contacto antes de actualizar users y, cuando
   * corresponde, el nombre del perfil profesional. No cambia correo ni rol.
   */
  app.patch('/api/auth/profile', wrap(async (req, res) => {
    S.requireRole(req, 'organizacion', 'profesional', 'admin');
    const name = text(req.body.name, 160);
    if (!name) S.fail(400, 'Ingresa un nombre.');
    let profile;
    try {
      profile = require('./profile-validation').contactProfile(req.body);
    } catch (error) {
      S.fail(400, error.message);
    }
    await db.prepare('UPDATE users SET name=?,profile=? WHERE id=?').run(name, JSON.stringify(profile), req.user.id);
    if (req.user.professional_id) await db.prepare('UPDATE professionals SET name=? WHERE id=?').run(name, req.user.professional_id);
    res.json(S.publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
  }));
  /**
   * GET /api/admin/users. Exige administración y lista cuentas usando publicUser, excluyendo
   * hashes de contraseña.
   */
  app.get('/api/admin/users', wrap(async (req, res) => {
    S.admin(req);
    res.json((await db.prepare('SELECT * FROM users ORDER BY created_at DESC').all()).map(S.publicUser));
  }));
  /**
   * POST /api/admin/users. Crea una cuenta administrativa o habilita un perfil profesional
   * heredado sin cuenta. Envía un enlace para elegir contraseña, rechaza correos existentes y
   * registra auditoría.
   */
  app.post('/api/admin/users', wrap(async (req, res) => {
    S.admin(req);
    const mail = email(req.body.email),
      name = text(req.body.name, 160);
    if (!name) S.fail(400, 'Falta el nombre.');
    if (await db.prepare('SELECT 1 FROM users WHERE email=?').get(mail)) S.fail(409, 'Ese correo ya tiene cuenta.');
    const role = req.body.role === 'profesional' ? 'profesional' : 'admin';
    const pro = role === 'profesional' ? await db.prepare('SELECT * FROM professionals WHERE lower(email)=lower(?)').get(mail) : null;
    if (role === 'profesional' && !pro) S.fail(400, 'No existe un perfil anterior con ese correo.');
    const uid = S.id('usr'),
      hash = await S.passwordHash(S.random());
    await db.prepare('INSERT INTO users(id,email,name,password_hash,role,professional_id,created_at) VALUES(?,?,?,?,?,?,?)').run(uid, mail, name, hash, role, pro?.id || null, Date.now());
    const token = await S.issueToken('reset', uid, 24 * 3600000);
    const target = role === 'admin' ? process.env.ADMIN_URL || 'http://localhost:3001' : process.env.BASE_URL || 'http://localhost:3000';
    const sent = await notify.send(mail, 'Activa tu cuenta en Skilly', `Configura tu contraseña en ${target}/#reset=${token}\nEste enlace vence en 24 horas.`);
    await S.audit(req, 'create_account', uid, role);
    res.status(201).json({
      ok: true,
      emailSent: sent
    });
  }));
  /**
   * GET /api/admin/audit. Devuelve hasta 200 eventos recientes de auditoría únicamente al
   * administrador.
   */
  app.get('/api/admin/audit', wrap(async (req, res) => {
    S.admin(req);
    res.json(await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all());
  }));
  /**
   * GET /api/admin/outbox. Permite al administrador consultar hasta 100 correos de prueba,
   * incluidos sus enlaces. Responde 404 cuando NODE_ENV es production.
   */
  app.get('/api/admin/outbox', wrap(async (req, res) => {
    S.admin(req);
    if (process.env.NODE_ENV === 'production') S.fail(404, 'No disponible.');
    res.json(await db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 100').all());
  }));
  /**
   * POST /api/guest/access. Canjea un token invitado vigente por una sesión limitada a su reserva
   * y marca el enlace usado dentro de la transacción. No está disponible desde la aplicación
   * administrativa.
   */
  app.post('/api/guest/access', wrap(async (req, res) => {
    if (app.locals.kind === 'admin') S.fail(403, 'Utiliza Skilly.');
    S.rateLimit(req, 'guest-access');
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const t = await S.useToken(req.body.token, 'guest');
      await S.session(req, res, null, t.subject);
      await db.prepare('UPDATE access_tokens SET used_at=? WHERE token_hash=?').run(Date.now(), t.token_hash);
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/guest/recover. Verifica en privado reserva invitada y correo y, si coinciden, envía
   * otro enlace. Devuelve respuesta genérica y limita intentos.
   */
  app.post('/api/guest/recover', wrap(async (req, res) => {
    S.rateLimit(req, 'guest-recover', 5);
    const mail = email(req.body.email);
    const b = await db.prepare('SELECT * FROM bookings WHERE id=? AND guest=1 AND lower(org_email)=lower(?)').get(req.body.bookingId, mail);
    if (b) await guestLink(b);
    res.json({
      ok: true,
      message: 'Si los datos coinciden, recibirás un nuevo enlace.'
    });
  }));
}
/**
 * Emite un token de invitado válido por 48 horas y encola/envía el enlace de una reserva
 * concreta. Resuelve si se confirmó el envío SMTP; el acceso posterior crea una sesión limitada
 * a esa reserva.
 *
 * @param {Object} b - Reserva invitada con id y org_email.
 * @returns {Promise<boolean>} Resultado del intento de envío del enlace seguro al correo del invitado.
 * @example
 * const sent = await guestLink(guestBooking);
 */
async function guestLink(b) {
  const token = await S.issueToken('guest', b.id, 48 * 3600000);
  return await notify.send(b.org_email, 'Tu reserva en Skilly', `Reserva ${b.id}\nServicio: ${b.service}\nAccede de forma segura: ${process.env.BASE_URL || 'http://localhost:3000'}/#guest=${token}\nEnlace de un uso, válido por 48 horas. Puedes solicitar uno nuevo con tu correo y el número de reserva.`);
}
module.exports = {
  authRoutes,
  wrap,
  email,
  text,
  linkedin,
  guestLink
};
