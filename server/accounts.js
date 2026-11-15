const {
  db
} = require('./db');
const S = require('./security');
const notify = require('./notifications');
const {
  validateAvailability
} = require('./scheduling');
const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
const email = value => {
  const v = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 254) S.fail(400, 'Correo inválido.');
  return v;
};
const text = (v, max = 1000) => {
  if (typeof v !== 'string' || v.length > max) S.fail(400, 'Texto inválido o demasiado largo.');
  return v.trim();
};
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
function authRoutes(app) {
  const base = () => app.locals.kind === 'admin' ? process.env.ADMIN_URL || 'http://localhost:3001' : process.env.BASE_URL || 'http://localhost:3000';
  app.get('/api/auth/me', (req, res) => res.json(req.user?.role === 'invitado' ? {
    role: 'invitado',
    guestBookingId: req.user.guestBookingId,
    name: 'Invitado'
  } : S.publicUser(req.user) || null));
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
  app.post('/api/auth/logout', wrap(async (req, res) => {
    await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(S.hash(S.tokenFrom(req)));
    res.clearCookie(S.cookieName(req), {
      path: '/'
    });
    res.json({
      ok: true
    });
  }));
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
  app.post('/api/auth/verify', wrap(async (req, res) => {
    await db.transaction(async () => {
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
  app.post('/api/auth/reset', wrap(async (req, res) => {
    S.rateLimit(req, 'reset', 10);
    const hashed = await S.passwordHash(req.body.password);
    await db.transaction(async () => {
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
  app.get('/api/admin/users', wrap(async (req, res) => {
    S.admin(req);
    res.json((await db.prepare('SELECT * FROM users ORDER BY created_at DESC').all()).map(S.publicUser));
  }));
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
  app.get('/api/admin/audit', wrap(async (req, res) => {
    S.admin(req);
    res.json(await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all());
  }));
  app.get('/api/admin/outbox', wrap(async (req, res) => {
    S.admin(req);
    if (process.env.NODE_ENV === 'production') S.fail(404, 'No disponible.');
    res.json(await db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 100').all());
  }));
  app.post('/api/guest/access', wrap(async (req, res) => {
    if (app.locals.kind === 'admin') S.fail(403, 'Utiliza Skilly.');
    S.rateLimit(req, 'guest-access');
    await db.transaction(async () => {
      const t = await S.useToken(req.body.token, 'guest');
      await S.session(req, res, null, t.subject);
      await db.prepare('UPDATE access_tokens SET used_at=? WHERE token_hash=?').run(Date.now(), t.token_hash);
    }).immediate();
    res.json({
      ok: true
    });
  }));
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
