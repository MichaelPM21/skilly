const {
  db,
  getSettings
} = require('./db');
const S = require('./security');
const {
  wrap,
  text,
  linkedin
} = require('./accounts');
const schedule = require('./scheduling');
const notify = require('./notifications');
function integer(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) S.fail(400, `${label}: valor inválido.`);
  return n;
}
function percent(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) S.fail(400, 'El porcentaje debe estar entre 0 y 100.');
  return n;
}
function validateService(b) {
  const title = text(b.title, 180),
    description = text(b.description || '', 5000);
  if (!title || !description) S.fail(400, 'Completa título y descripción.');
  const price = integer(typeof b.price === 'string' ? b.price.replace(/[^0-9]/g, '') : b.price, 1, 100000000, 'Precio');
  const tags = Array.isArray(b.tags) ? b.tags.map(t => text(t, 50)).slice(0, 20) : [];
  const result = {
    title,
    description,
    price,
    category: text(b.category || 'Consultoría', 80),
    modality: text(b.modality || 'Remoto', 80),
    tags,
    durationMinutes: integer(b.durationMinutes ?? 60, 15, 720, 'Duración'),
    prepMinutes: integer(b.prepMinutes ?? 0, 0, 720, 'Preparación'),
    followupMinutes: integer(b.followupMinutes ?? 0, 0, 720, 'Seguimiento')
  };
  if (result.durationMinutes + result.prepMinutes + result.followupMinutes > 1440) S.fail(400, 'La dedicación total debe caber en un día.');
  return result;
}
function professional(p) {
  return {
    bookingSuspended: !!p.booking_suspended,
    suspensionReason: p.suspension_reason,
    id: p.id,
    name: p.name,
    email: p.email,
    title: p.title,
    description: p.description,
    category: p.category,
    price: p.price,
    modality: p.modality,
    tags: JSON.parse(p.tags || '[]'),
    status: p.status,
    recommended: !!p.recommended,
    adminNotes: p.admin_notes,
    validation: JSON.parse(p.validation || '{}'),
    availability: JSON.parse(p.availability || '{}'),
    blockedDates: JSON.parse(p.blocked_dates || '[]'),
    workStart: p.work_start,
    workEnd: p.work_end,
    maxPerDay: p.max_per_day,
    maxPerWeek: p.max_per_week,
    maxPerMonth: p.max_per_month,
    durationMinutes: p.duration_minutes,
    prepMinutes: p.prep_minutes,
    followupMinutes: p.followup_minutes,
    assignedTo: p.assigned_to,
    createdAt: p.created_at,
    reviewedAt: p.reviewed_at
  };
}
async function serviceView(s, privateView = false) {
  const p = await db.prepare('SELECT * FROM professionals WHERE id=?').get(s.professional_id);
  const value = JSON.parse((privateView ? s.draft : s.published) || '{}');
  const result = {
    ...value,
    id: s.id,
    status: privateView ? s.status : 'validado',
    recommended: !!p.recommended,
    availability: JSON.parse(p.availability || '{}')
  };
  if (privateView) Object.assign(result, {
    professionalId: p.id,
    professionalName: p.name,
    professionalStatus: p.status,
    published: s.published ? JSON.parse(s.published) : null,
    adminNotes: s.admin_notes,
    revision: S.hash(s.draft),
    commissionPercent: s.commission_percent,
    effectiveCommission: s.commission_percent ?? (await getSettings()).commission_percent
  });
  return result;
}
function servicesRoutes(app) {
  app.get('/api/services', wrap(async (req, res) => {
    let rows;
    if (req.user?.role === 'profesional') rows = await db.prepare('SELECT * FROM services WHERE professional_id=? ORDER BY created_at DESC').all(req.user.professional_id);else if (req.user?.role === 'admin') {
      S.admin(req);
      rows = await db.prepare('SELECT * FROM services ORDER BY created_at DESC').all();
    } else rows = await db.prepare(`SELECT s.* FROM services s JOIN professionals p ON p.id=s.professional_id WHERE s.published IS NOT NULL AND p.status='validado' ORDER BY s.created_at DESC`).all();
    res.json(await Promise.all(rows.map(async s => await serviceView(s, ['admin', 'profesional'].includes(req.user?.role)))));
  }));
  app.post('/api/services', wrap(async (req, res) => {
    S.requireRole(req, 'profesional');
    const value = validateService(req.body),
      id = S.id('svc');
    await db.prepare(`INSERT INTO services(id,professional_id,draft,status,created_at,updated_at) VALUES(?,?,?,'pendiente',?,?)`).run(id, req.user.professional_id, JSON.stringify(value), Date.now(), Date.now());
    res.status(201).json(await serviceView(await db.prepare('SELECT * FROM services WHERE id=?').get(id), true));
  }));
  app.patch('/api/services/:id', wrap(async (req, res) => {
    S.requireRole(req, 'profesional');
    const s = await db.prepare('SELECT * FROM services WHERE id=? AND professional_id=?').get(req.params.id, req.user.professional_id);
    if (!s) S.fail(404, 'Servicio no encontrado.');
    if (await db.prepare("SELECT 1 FROM service_appeals WHERE service_id=? AND status IN ('abierta','propuesta')").get(s.id)) S.fail(409, 'Finaliza o retira la mediación antes de editar la propuesta.');
    const value = validateService({
      ...JSON.parse(s.draft),
      ...req.body
    });
    // All customer-facing edits are reviewed, including duration and preparation.
    await db.prepare(`UPDATE services SET draft=?,status='pendiente',updated_at=? WHERE id=?`).run(JSON.stringify(value), Date.now(), s.id);
    res.json(await serviceView(await db.prepare('SELECT * FROM services WHERE id=?').get(s.id), true));
  }));
  app.patch('/api/admin/services/:id', wrap(async (req, res) => {
    S.admin(req);
    let notification;
    const serviceId = await db.transaction(async () => {
      const s = await db.prepare('SELECT * FROM services WHERE id=?').get(req.params.id);
      if (!s) S.fail(404, 'Servicio no encontrado.');
      if (req.body.commissionPercent !== undefined) await db.prepare('UPDATE services SET commission_percent=? WHERE id=?').run(req.body.commissionPercent === null ? null : percent(req.body.commissionPercent), s.id);
      if (req.body.status) {
        if (req.body.revision !== S.hash(s.draft)) S.fail(409, 'El servicio cambió desde que lo abriste. Actualiza la página y revisa la nueva versión.');
        if (!['validado', 'rechazado', 'info_solicitada'].includes(req.body.status)) S.fail(400, 'Estado inválido.');
        if (await db.prepare("SELECT 1 FROM service_appeals WHERE service_id=? AND status IN ('abierta','propuesta')").get(s.id)) S.fail(409, 'Resuelve la mediación antes de revisar la publicación.');
        const notes = text(req.body.adminNotes || '', 2000);
        if (req.body.status !== 'validado' && !notes) S.fail(400, 'Indica las observaciones.');
        const p = await db.prepare('SELECT * FROM professionals WHERE id=?').get(s.professional_id);
        if (req.body.status === 'validado' && p.status !== 'validado') S.fail(409, 'Primero valida los antecedentes del profesional.');
        await db.prepare('UPDATE services SET status=?,admin_notes=?,published=?,updated_at=? WHERE id=?').run(req.body.status, notes, req.body.status === 'validado' ? s.draft : s.published, Date.now(), s.id);
        notification = {
          email: p.email,
          body: `${JSON.parse(s.draft).title}: ${req.body.status}.\n${notes}`
        };
      }
      await S.audit(req, 'service_review', s.id, JSON.stringify(req.body));
      return s.id;
    }).immediate();
    if (notification) await notify.send(notification.email, 'Revisión de tu servicio en Skilly', notification.body);
    res.json(await serviceView(await db.prepare('SELECT * FROM services WHERE id=?').get(serviceId), true));
  }));
  app.get('/api/services/:id/availability', wrap(async (req, res) => {
    const s = await db.prepare('SELECT * FROM services WHERE id=? AND published IS NOT NULL').get(req.params.id);
    if (!s) S.fail(404, 'Servicio no disponible.');
    const p = await db.prepare('SELECT * FROM professionals WHERE id=?').get(s.professional_id);
    if (req.user?.role === 'profesional' && p.id !== req.user.professional_id) S.fail(403, 'Solo puedes consultar tu agenda.');
    if (p.status !== 'validado') S.fail(404, 'Servicio no disponible.');
    const service = JSON.parse(s.published),
      date = req.query.date;
    schedule.timestamp(date, '12:00');
    const hours = JSON.parse(p.availability || '{}').hours || [];
    const slots = [];
    for (const time of hours) {
      try {
        await schedule.available(p, service, date, time);
        slots.push(time);
      } catch (error) {
        if (error.status !== 409) throw error;
      }
    }
    res.json({
      date,
      slots,
      timeZone: 'America/Santiago'
    });
  }));
  app.get('/api/professionals', wrap(async (req, res) => {
    if (req.user?.role === 'admin') {
      S.admin(req);
      return res.json((await db.prepare('SELECT * FROM professionals').all()).map(professional));
    }
    if (req.user?.role === 'profesional') return res.json((await db.prepare('SELECT * FROM professionals WHERE id=?').all(req.user.professional_id)).map(professional));
    res.json([]);
  }));
  async function updateProfessional(req, res, adminMode) {
    if (adminMode) S.admin(req);else S.requireRole(req, 'profesional');
    if (!adminMode && req.params.id !== req.user.professional_id) S.fail(403, 'Solo puedes editar tu perfil.');
    const p = await db.prepare('SELECT * FROM professionals WHERE id=?').get(req.params.id);
    if (!p) S.fail(404, 'Perfil no encontrado.');
    const b = req.body;
    let patch = {};
    for (const [key, col] of [['maxPerDay', 'max_per_day'], ['maxPerWeek', 'max_per_week'], ['maxPerMonth', 'max_per_month']]) if (b[key] !== undefined) patch[col] = b[key] === null ? null : integer(b[key], 0, 10000, key);
    if (b.availability !== undefined) patch.availability = JSON.stringify(schedule.validateAvailability(b.availability));
    if (b.blockedDates !== undefined) {
      if (!Array.isArray(b.blockedDates) || b.blockedDates.length > 730) S.fail(400, 'Fechas bloqueadas inválidas.');
      b.blockedDates.forEach(d => schedule.timestamp(d, '12:00'));
      patch.blocked_dates = JSON.stringify([...new Set(b.blockedDates)]);
    }
    for (const [key, col] of [['workStart', 'work_start'], ['workEnd', 'work_end']]) if (b[key] !== undefined) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b[key])) S.fail(400, 'Horario de trabajo inválido.');
      patch[col] = b[key];
    }
    if ((patch.work_start || p.work_start) >= (patch.work_end || p.work_end)) S.fail(400, 'El fin de la jornada debe ser posterior al inicio.');
    if (b.validation !== undefined) {
      if (!b.validation.linkedin || !b.validation.cv || !b.validation.yearsExperience) S.fail(400, 'Completa los antecedentes obligatorios.');
      patch.validation = JSON.stringify({
        ...b.validation,
        linkedin: linkedin(b.validation.linkedin)
      });
      patch.status = 'pendiente';
    }
    if (adminMode) {
      if (b.status !== undefined) {
        if (!['validado', 'rechazado', 'info_solicitada', 'pendiente'].includes(b.status)) S.fail(400, 'Estado inválido.');
        patch.status = b.status;
        patch.reviewed_at = Date.now();
      }
      if (b.adminNotes !== undefined) patch.admin_notes = text(b.adminNotes, 2000);
      if (b.recommended !== undefined) patch.recommended = b.recommended ? 1 : 0;
      if (b.assignedTo !== undefined) patch.assigned_to = text(b.assignedTo, 160);
    }
    if (Object.keys(patch).length) await db.prepare(`UPDATE professionals SET ${Object.keys(patch).map(k => k + '=?').join(',')} WHERE id=?`).run(...Object.values(patch), p.id);
    let sent = false;
    if (adminMode && b.status) {
      sent = await notify.send(p.email, 'Validación de antecedentes en Skilly', `Estado: ${b.status}\n${b.adminNotes || ''}`);
      await S.audit(req, 'professional_review', p.id, b.status);
    }
    res.json({
      ...professional(await db.prepare('SELECT * FROM professionals WHERE id=?').get(p.id)),
      notificationEmailSent: sent
    });
  }
  app.patch('/api/professionals/:id/self', wrap(async (req, res) => await updateProfessional(req, res, false)));
  app.patch('/api/professionals/:id', wrap(async (req, res) => await updateProfessional(req, res, true)));
  app.get('/api/admin/settings', wrap(async (req, res) => {
    S.admin(req);
    res.json(await getSettings());
  }));
  app.patch('/api/admin/settings', wrap(async (req, res) => {
    S.admin(req);
    const b = req.body,
      patch = {};
    for (const [key, col] of [['commissionPercent', 'commission_percent'], ['defaultCancellationRefundPercent', 'default_cancellation_refund_percent']]) if (b[key] !== undefined) patch[col] = percent(b[key]);
    for (const [key, col] of [['responseHours', 'response_hours'], ['paymentHours', 'payment_hours'], ['adminWeeklyReviewCapacity', 'admin_weekly_review_capacity']]) if (b[key] !== undefined) patch[col] = integer(b[key], 1, 720, key);
    if (Object.keys(patch).length) await db.prepare(`UPDATE settings SET ${Object.keys(patch).map(k => k + '=?').join(',')} WHERE id=1`).run(...Object.values(patch));
    await S.audit(req, 'settings', 'global', JSON.stringify(patch));
    res.json(await getSettings());
  }));
}
module.exports = {
  servicesRoutes,
  validateService,
  professional,
  serviceView,
  integer,
  percent
};
