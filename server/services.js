/**
 * Flujo del módulo. Servicios independientes del perfil. draft guarda la propuesta editable y
 * published la última aprobada; una revisión usa el hash del borrador. Las comisiones pueden ser
 * particulares o heredar settings y quedan congeladas al reservar.
 */

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
const { clpPrice } = require('../public/js/input-validation');
/**
 * Convierte el valor a número y exige un entero dentro del intervalo inclusivo. Lanza 400 usando
 * la etiqueta del campo para explicar el error.
 *
 * @param {number|string} v - Valor convertible a número.
 * @param {number} min - Límite inferior incluido.
 * @param {number} max - Límite superior incluido.
 * @param {string} label - Nombre del campo para el mensaje de error.
 * @returns {number} Entero dentro de [min, max].
 * @throws {Error} Error 400 si no es entero o queda fuera del intervalo.
 * @example
 * integer("60", 15, 720, "Duración"); // 60
 */
function integer(v, min, max, label) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) S.fail(400, `${label}: valor inválido.`);
  return n;
}
/**
 * Convierte y valida un porcentaje finito entre 0 y 100, inclusive. Permite decimales; la
 * columna de destino determina cómo se almacena.
 *
 * @param {number|string} v - Porcentaje convertible a número, con decimales permitidos.
 * @returns {number} Número finito entre 0 y 100, incluidos.
 * @throws {Error} Error 400 para NaN, infinito o valor fuera del rango.
 * @example
 * percent("15.5"); // 15.5
 */
function percent(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) S.fail(400, 'El porcentaje debe estar entre 0 y 100.');
  return n;
}
/**
 * Normaliza título, descripción, precio CLP, etiquetas y duración del servicio. Valida rangos y
 * exige que atención, preparación y seguimiento sumen como máximo un día; devuelve el objeto
 * apto para guardar como borrador.
 *
 * @param {Object} b - Campos propuestos para un servicio; no se escribe la base.
 * @param {string} b.title - Título obligatorio, máximo 180 caracteres.
 * @param {string} b.description - Descripción obligatoria, máximo 5000 caracteres.
 * @param {number|string} b.price - Precio CLP entero entre 1 y 100000000; admite $35.000.
 * @param {number} [b.durationMinutes=60] - Atención de 15 a 720 minutos.
 * @param {number} [b.prepMinutes=0] - Preparación de 0 a 720 minutos.
 * @param {number} [b.followupMinutes=0] - Seguimiento de 0 a 720 minutos.
 * @param {string[]} [b.tags=[]] - Hasta 20 etiquetas de máximo 50 caracteres.
 * @param {string} [b.category="Consultoría"] - Categoría de hasta 80 caracteres.
 * @param {string} [b.modality="Remoto"] - Modalidad de hasta 80 caracteres.
 * @returns {Object} Borrador normalizado; dedicación total máxima de 1440 minutos.
 * @throws {Error} Error 400 por campos inválidos o dedicación total superior a un día.
 * @example
 * const draft = validateService({title:"Asesoría", description:"Diagnóstico", price:"$35.000"});
 * // draft.price === 35000; draft.durationMinutes === 60
 */
function validateService(b) {
  const title = text(b.title, 180),
    description = text(b.description || '', 5000);
  if (!title || !description) S.fail(400, 'Completa título y descripción.');
  const price = integer(clpPrice(b.price), 1, 100000000, 'Precio');
  const tags = Array.isArray(b.tags) ? b.tags.map(/* Transforma cada elemento con text(t, 50) para construir la colección utilizada por esta operación. */ t => text(t, 50)).slice(0, 20) : [];
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
/**
 * Convierte una fila de professionals al contrato camelCase de los paneles privados. Deserializa
 * antecedentes y disponibilidad e incluye revisión, capacidad, bloqueos y suspensión.
 *
 * @param {Object} p - Fila professionals con JSON válido en tags, validation y availability.
 * @returns {Object} Perfil privado en camelCase con revisión, capacidad y antecedentes.
 * @example
 * const view = professional(professionalRow);
 */
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
/**
 * Construye la representación pública publicada o la privada del borrador. La vista privada
 * agrega propietario, observaciones, hash de revisión y comisión efectiva; la pública no agrega
 * nombre ni antecedentes del profesional.
 *
 * @param {Object} s - Fila services con professional_id y borrador/publicación JSON.
 * @param {boolean} [privateView=false] - true selecciona el borrador y agrega información de gestión.
 * @returns {Promise<Object>} Representación pública publicada o privada; el profesional asociado debe existir.
 * @example
 * const publicView = await serviceView(serviceRow);
 * const privateView = await serviceView(serviceRow, true);
 */
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
/**
 * Registra catálogo, borradores, disponibilidad, revisión de servicios, perfiles y
 * configuración. Selecciona datos por rol y conserva la versión publicada hasta que Skilly
 * aprueba la nueva revisión.
 *
 * @param {import("express").Express} app - Aplicación pública o administrativa que recibe los manejadores HTTP.
 * @returns {void} Registra rutas y middleware en app; no inicia el servidor.
 * @example
 * // Durante la construcción de la aplicación Express:
 * servicesRoutes(app);
 */
function servicesRoutes(app) {
  /**
   * GET /api/services. Selecciona borradores propios para profesionales, todos para administración
   * o publicaciones con perfil validado para visitantes/clientes. serviceView limita los campos
   * según la vista.
   */
  app.get('/api/services', wrap(async (req, res) => {
    let rows;
    if (req.user?.role === 'profesional') rows = await db.prepare('SELECT * FROM services WHERE professional_id=? ORDER BY created_at DESC').all(req.user.professional_id);else if (req.user?.role === 'admin') {
      S.admin(req);
      rows = await db.prepare('SELECT * FROM services ORDER BY created_at DESC').all();
    } else rows = await db.prepare(`SELECT s.* FROM services s JOIN professionals p ON p.id=s.professional_id WHERE s.published IS NOT NULL AND p.status='validado' ORDER BY s.created_at DESC`).all();
    res.json(await Promise.all(rows.map(/* Obtiene y transforma cada registro de forma asíncrona; el llamador reúne los resultados con Promise.all. */ async s => await serviceView(s, ['admin', 'profesional'].includes(req.user?.role)))));
  }));
  /**
   * POST /api/services. Exige profesional, valida los datos y crea un servicio propio pendiente de
   * revisión. Devuelve su representación privada.
   */
  app.post('/api/services', wrap(async (req, res) => {
    S.requireRole(req, 'profesional');
    const value = validateService(req.body),
      id = S.id('svc');
    await db.prepare(`INSERT INTO services(id,professional_id,draft,status,created_at,updated_at) VALUES(?,?,?,'pendiente',?,?)`).run(id, req.user.professional_id, JSON.stringify(value), Date.now(), Date.now());
    res.status(201).json(await serviceView(await db.prepare('SELECT * FROM services WHERE id=?').get(id), true));
  }));
  /**
   * PATCH /api/services/:id. Exige propiedad y ausencia de mediación abierta; fusiona cambios con
   * el borrador, valida y lo deja pendiente. Conserva la publicación anterior hasta una nueva
   * aprobación.
   */
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
  /**
   * PATCH /api/admin/services/:id. Permite cambiar comisión y revisar una versión concreta
   * mediante su hash. Exige observaciones para rechazar o pedir información, bloquea mediaciones
   * abiertas y requiere perfil validado para publicar; audita y notifica.
   */
  app.patch('/api/admin/services/:id', wrap(async (req, res) => {
    S.admin(req);
    let notification;
    const serviceId = await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
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
  /**
   * GET /api/services/:id/availability. Valida publicación, perfil y fecha, prueba cada hora
   * ofrecida y devuelve las que no generan conflicto. Un profesional solo puede consultar su
   * propia agenda.
   */
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
  /**
   * GET /api/professionals. Devuelve todos los perfiles a administración, el propio al profesional
   * o un arreglo vacío a visitantes y clientes. Evita exponer antecedentes en el catálogo.
   */
  app.get('/api/professionals', wrap(async (req, res) => {
    if (req.user?.role === 'admin') {
      S.admin(req);
      return res.json((await db.prepare('SELECT * FROM professionals').all()).map(professional));
    }
    if (req.user?.role === 'profesional') return res.json((await db.prepare('SELECT * FROM professionals WHERE id=?').all(req.user.professional_id)).map(professional));
    res.json([]);
  }));
  /**
   * Actualiza disponibilidad, jornada, capacidad y antecedentes del perfil autorizado. El modo
   * administrativo permite además revisar, recomendar y asignar responsable; reenviar antecedentes
   * vuelve el perfil a pendiente y la revisión administrativa puede notificar por correo.
   */
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
      b.blockedDates.forEach(/* Valida cada fecha bloqueada mediante la conversión de calendario antes de guardarla. */ d => schedule.timestamp(d, '12:00'));
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
    if (Object.keys(patch).length) await db.prepare(`UPDATE professionals SET ${Object.keys(patch).map(/* Transforma cada elemento con k + '=?' para construir la colección utilizada por esta operación. */ k => k + '=?').join(',')} WHERE id=?`).run(...Object.values(patch), p.id);
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
  /**
   * PATCH /api/professionals/:id/self. Delega en updateProfessional en modo propietario para
   * editar agenda y antecedentes del profesional autenticado.
   */
  app.patch('/api/professionals/:id/self', wrap(async (req, res) => await updateProfessional(req, res, false)));
  /**
   * PATCH /api/professionals/:id. Delega en updateProfessional en modo administrativo para revisar
   * perfiles, capacidad, recomendación y asignación.
   */
  app.patch('/api/professionals/:id', wrap(async (req, res) => await updateProfessional(req, res, true)));
  /**
   * GET /api/admin/settings. Exige administración y devuelve la única fila de configuración
   * operativa.
   */
  app.get('/api/admin/settings', wrap(async (req, res) => {
    S.admin(req);
    res.json(await getSettings());
  }));
  /**
   * PATCH /api/admin/settings. Valida porcentajes y límites del parche, actualiza exclusivamente
   * campos permitidos y audita el cambio. Las reservas ya creadas conservan sus condiciones.
   */
  app.patch('/api/admin/settings', wrap(async (req, res) => {
    S.admin(req);
    const b = req.body,
      patch = {};
    for (const [key, col] of [['commissionPercent', 'commission_percent'], ['defaultCancellationRefundPercent', 'default_cancellation_refund_percent']]) if (b[key] !== undefined) patch[col] = percent(b[key]);
    for (const [key, col] of [['responseHours', 'response_hours'], ['paymentHours', 'payment_hours'], ['adminWeeklyReviewCapacity', 'admin_weekly_review_capacity']]) if (b[key] !== undefined) patch[col] = integer(b[key], 1, 720, key);
    if (Object.keys(patch).length) await db.prepare(`UPDATE settings SET ${Object.keys(patch).map(/* Transforma cada elemento con k + '=?' para construir la colección utilizada por esta operación. */ k => k + '=?').join(',')} WHERE id=1`).run(...Object.values(patch));
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
