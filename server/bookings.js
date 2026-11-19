/**
 * Flujo del módulo. Ciclo principal: gestion_skilly (invitado) → solicitado → aceptado → pagado
 * → entregado → confirmado → completado. Este módulo crea solicitudes y gestiona agenda,
 * entrega, chat y documentos; pagos y políticas completan las otras transiciones.
 */

const {
  db,
  getSettings
} = require('./db');
const S = require('./security');
const {
  wrap,
  text,
  email,
  guestLink
} = require('./accounts');
const {
  integer
} = require('./services');
const schedule = require('./scheduling');
const notify = require('./notifications');
/**
 * Carga una reserva y verifica que pertenezca a la organización, al profesional o a la sesión
 * invitada, o que se acceda como administrador. Devuelve la fila interna; lanza 404, 401 o 403
 * según el caso.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {string} id - Identificador de reserva a consultar.
 * @returns {Promise<Object>} Fila bookings autorizada; administración conserva acceso conforme a su audiencia.
 * @throws {Error} Error 401/403/404 por sesión, titularidad o reserva inexistente.
 * @example
 * const booking = await access(req, req.params.id);
 */
async function access(req, id) {
  const b = await db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  if (!b) S.fail(404, 'Reserva no encontrada.');
  const u = req.user;
  if (!u) S.fail(401, 'Inicia sesión o utiliza el enlace seguro de tu reserva.');
  if (u.role === 'admin') {
    S.admin(req);
    return b;
  }
  if (u.role === 'profesional' && u.professional_id === b.professional_id) return b;
  if (u.role === 'organizacion' && u.id === b.org_user_id) return b;
  if (u.role === 'invitado' && u.guestBookingId === b.id) return b;
  S.fail(403, 'No puedes acceder a esta reserva.');
}
/**
 * Comprueba acceso a la reserva y exige rol organización o invitado. Se usa para acciones que
 * corresponden a quien contrata, como pagar o confirmar una entrega.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {Object} b - Fila de reserva ya cargada para comprobar titularidad.
 * @returns {Promise<void>} No devuelve datos; autoriza al cliente o invitado de esa reserva.
 * @throws {Error} Error 403 para un actor que no sea el cliente autorizado.
 * @example
 * await customer(req, booking);
 */
async function customer(req, b) {
  await access(req, b.id);
  S.requireRole(req, 'organizacion', 'invitado');
}
/**
 * Proyecta la reserva para la API según el rol y paid_at. Oculta identidad antes del pago a
 * clientes, limita datos financieros internos y agrega política congelada y devolución vigente;
 * no altera el contrato almacenado.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {Object} b - Fila bookings a proyectar según el usuario que consulta.
 * @returns {Promise<Object>} Reserva en camelCase; la identidad profesional depende del rol y del pago.
 * @example
 * const visibleBooking = await bookingView(req, bookingRow);
 */
async function bookingView(req, b) {
  const internal = ['admin', 'profesional'].includes(req.user?.role);
  const p = await db.prepare('SELECT validation FROM professionals WHERE id=?').get(b.professional_id);
  return {
    id: b.id,
    professionalId: internal ? b.professional_id : undefined,
    professionalName: internal || b.paid_at ? b.professional_name : undefined,
    linkedin: b.paid_at ? JSON.parse(p?.validation || '{}').linkedin : undefined,
    orgName: b.org_name,
    orgEmail: internal && req.user?.role !== 'admin' ? undefined : b.org_email,
    serviceId: b.service_id,
    service: b.service,
    notes: b.notes,
    amount: b.amount,
    date: b.date,
    time: b.time,
    status: b.status,
    createdAt: b.created_at,
    responseDeadline: b.response_deadline,
    paymentDeadline: b.payment_deadline,
    paidAt: b.paid_at,
    confirmedAt: b.confirmed_at,
    startAt: b.start_at,
    endAt: b.end_at,
    durationMinutes: b.duration_minutes,
    prepMinutes: b.prep_minutes,
    followupMinutes: b.followup_minutes,
    commissionPercent: internal ? b.commission_percent : undefined,
    commissionAmount: internal ? b.commission_amount : undefined,
    professionalNet: internal ? b.professional_net : undefined,
    refundAmount: b.refund_amount,
    refundPercent: b.refund_percent,
    refundPolicyPercent: b.refund_policy_percent,
    cancelReason: b.cancel_reason,
    cancellationStatus: b.cancellation_status,
    policy: require('./policies').policy(b),
    cancellationRefundNow: require('./policies').refundPercent(b),
    retainedAmount: b.retained_amount,
    retentionDestination: b.retention_destination,
    guest: !!b.guest,
    serviceSnapshot: JSON.parse(b.service_snapshot || '{}')
  };
}
/**
 * Consulta únicamente las reservas visibles para la sesión. Administración recibe todas,
 * profesional y organización las propias, invitado una sola; sin sesión devuelve un arreglo
 * vacío.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @returns {Promise<Object[]>} Reservas permitidas para el rol y la titularidad de req.user.
 * @example
 * const bookings = await listBookings(req);
 */
async function listBookings(req) {
  if (!req.user) return [];
  if (req.user.role === 'admin') {
    S.admin(req);
    return await db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all();
  }
  if (req.user.role === 'profesional') return await db.prepare('SELECT * FROM bookings WHERE professional_id=? ORDER BY created_at DESC').all(req.user.professional_id);
  if (req.user.role === 'organizacion') return await db.prepare('SELECT * FROM bookings WHERE org_user_id=? ORDER BY created_at DESC').all(req.user.id);
  return await db.prepare('SELECT * FROM bookings WHERE id=?').all(req.user.guestBookingId);
}
/**
 * Valida publicación, perfil y agenda; toma precio y comisión desde el servidor y guarda una
 * copia del servicio y política. Crea solicitado o gestion_skilly con plazo limitado por el
 * inicio reservado; el llamador la ejecuta dentro de una transacción para evitar solapamientos.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {boolean} guest - true utiliza contacto invitado y estado gestion_skilly; false usa la cuenta.
 * @returns {Promise<Object>} Fila insertada con precio, comisión, política y plazos congelados.
 * @throws {Error} Error 400/404/409 por entrada inválida, servicio inaccesible, suspensión o conflicto de agenda.
 * @example
 * // req.body incluye serviceId, date, time y notes; ejecutar con transacción:
 * const booking = await db.transaction(() => createBooking(req, false)).immediate();
 */
async function createBooking(req, guest) {
  const b = req.body,
    s = await db.prepare('SELECT * FROM services WHERE id=? AND published IS NOT NULL').get(b.serviceId || b.professionalId);
  if (!s) S.fail(404, 'Servicio no disponible.');
  const p = await db.prepare('SELECT * FROM professionals WHERE id=?').get(s.professional_id);
  if (p.booking_suspended) S.fail(409, 'Profesional temporalmente suspendido para nuevas reservas.');
  if (p.status !== 'validado') S.fail(409, 'Profesional pendiente de validación.');
  const service = JSON.parse(s.published),
    limits = await schedule.available(p, service, b.date, b.time),
    settings = await getSettings();
  const rate = s.commission_percent ?? settings.commission_percent,
    fee = Math.round(service.price * rate / 100);
  const id = S.id('bkg'),
    now = Date.now();
  const orgName = guest ? text(b.orgName, 160) : req.user.name,
    orgEmail = guest ? email(b.email) : req.user.email;
  if (!orgName) S.fail(400, 'Falta el nombre de la organización.');
  await db.prepare(`INSERT INTO bookings(id,professional_id,professional_name,professional_email,org_name,org_email,date,time,service,notes,amount,status,created_at,
    service_id,org_user_id,guest,service_snapshot,commission_percent,commission_amount,professional_net,response_deadline,duration_minutes,prep_minutes,followup_minutes,start_at,end_at,refund_policy_percent)
    VALUES(@id,@pid,@pname,@pmail,@orgName,@orgEmail,@date,@time,@title,@notes,@amount,@status,@now,@sid,@uid,@guest,@snapshot,@rate,@fee,@net,@deadline,@duration,@prep,@follow,@start,@end,@refund)`).run({
    id,
    pid: p.id,
    pname: p.name,
    pmail: p.email,
    orgName,
    orgEmail,
    date: b.date,
    time: b.time,
    title: service.title,
    notes: text(b.notes || '', 4000),
    amount: service.price,
    status: guest ? 'gestion_skilly' : 'solicitado',
    now,
    sid: s.id,
    uid: guest ? null : req.user.id,
    guest: guest ? 1 : 0,
    snapshot: s.published,
    rate,
    fee,
    net: service.price - fee,
    deadline: Math.min(now + settings.response_hours * 3600000, limits.start),
    duration: service.durationMinutes,
    prep: service.prepMinutes,
    follow: service.followupMinutes,
    start: limits.start,
    end: limits.end,
    refund: settings.default_cancellation_refund_percent
  });
  await db.prepare('UPDATE bookings SET policy_snapshot=? WHERE id=?').run(JSON.stringify(require('./policies').snapshot(settings)), id);
  return await db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
}
/**
 * Registra creación y consulta de reservas, gestión de invitados, cambios de estado,
 * evaluaciones, chat y documentos. Los accesos se validan en servidor y la entrega profesional
 * exige fin del intervalo y descripción de evidencia.
 *
 * @param {import("express").Express} app - Aplicación pública o administrativa que recibe los manejadores HTTP.
 * @returns {void} Registra rutas y middleware en app; no inicia el servidor.
 * @example
 * // Durante la construcción de la aplicación Express:
 * bookingsRoutes(app);
 */
function bookingsRoutes(app) {
  /**
   * GET /api/bookings. Expira plazos vencidos y responde las reservas autorizadas mediante
   * bookingView. Aunque es GET, la limpieza de vencimientos puede actualizar registros.
   */
  app.get('/api/bookings', wrap(async (req, res) => {
    await schedule.expire();
    res.json(await Promise.all((await listBookings(req)).map(/* Obtiene y transforma cada registro de forma asíncrona; el llamador reúne los resultados con Promise.all. */ async b => await bookingView(req, b))));
  }));
  /**
   * POST /api/bookings. Exige organización y crea la solicitud dentro de una transacción para
   * proteger disponibilidad. Notifica al profesional después de guardar y responde la reserva sin
   * identidad previa al pago.
   */
  app.post('/api/bookings', wrap(async (req, res) => {
    S.requireRole(req, 'organizacion');
    const b = await db.transaction(/* Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT. */ async () => await createBooking(req, false)).immediate();
    await notify.send(b.professional_email, 'Nueva solicitud de servicio', `${b.service}: ${b.date} ${b.time}. Revisa tu panel para aceptar o rechazar.`);
    res.status(201).json(await bookingView(req, b));
  }));
  /**
   * POST /api/guest-requests. Valida contacto, limita intentos y guarda reserva gestion_skilly y
   * solicitud invitada juntas. Envía acceso seguro al cliente y aviso a Skilly; no acepta ni paga
   * la reserva.
   */
  app.post('/api/guest-requests', wrap(async (req, res) => {
    if (req.user && req.user.role !== 'invitado') S.fail(403, 'Solicita desde tu cuenta de organización.');
    S.rateLimit(req, 'guest-request', 10);
    const contact = text(req.body.contactName, 160);
    if (!contact) S.fail(400, 'Falta el nombre de contacto.');
    let b,
      gid = S.id('guest');
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      b = await createBooking(req, true);
      await db.prepare(`INSERT INTO guest_requests(id,professional_id,professional_name,contact_name,org_name,email,phone,date,time,notes,status,booking_id,service_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'nueva',?,?,?)`).run(gid, b.professional_id, b.professional_name, contact, b.org_name, b.org_email, text(req.body.phone || '', 40), b.date, b.time, b.notes, b.id, b.service_id, Date.now());
    }).immediate();
    const sent = await guestLink(b);
    const adminSent = await notify.send(process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER || 'admin@localhost', 'Nueva solicitud sin registro', `${b.org_name} solicita ${b.service} el ${b.date} a las ${b.time}. Reserva ${b.id}. Revisar en administración.`);
    await db.prepare('UPDATE guest_requests SET email_sent=? WHERE id=?').run(adminSent ? 1 : 0, gid);
    res.status(201).json({
      id: gid,
      bookingId: b.id,
      emailSent: sent
    });
  }));
  /**
   * GET /api/admin/guest-requests. Expira solicitudes vencidas y devuelve los datos de gestión y
   * contacto de invitados a administración.
   */
  app.get('/api/admin/guest-requests', wrap(async (req, res) => {
    S.admin(req);
    await schedule.expire();
    res.json((await db.prepare('SELECT * FROM guest_requests ORDER BY created_at DESC').all()).map(/* Transforma cada registro en la estructura requerida por GET /api/admin/guest-requests, conservando su posición en el arreglo resultante. */ g => ({
      id: g.id,
      professionalName: g.professional_name,
      contactName: g.contact_name,
      orgName: g.org_name,
      email: g.email,
      phone: g.phone,
      date: g.date,
      time: g.time,
      notes: g.notes,
      status: g.status,
      bookingId: g.booking_id,
      adminNotes: g.admin_notes,
      assignedTo: g.assigned_to,
      emailSent: !!g.email_sent,
      createdAt: g.created_at
    })));
  }));
  /**
   * PATCH /api/admin/guest-requests/:id. Guarda contacto o descarte, observaciones y responsable.
   * Solo descarta directamente una reserva aún en gestion_skilly; los casos tramitados deben usar
   * cancelación.
   */
  app.patch('/api/admin/guest-requests/:id', wrap(async (req, res) => {
    S.admin(req);
    const g = await db.prepare('SELECT * FROM guest_requests WHERE id=?').get(req.params.id);
    if (!g) S.fail(404, 'Solicitud no encontrada.');
    if (!['contactada', 'descartada'].includes(req.body.status)) S.fail(400, 'Estado inválido.');
    const b = g.booking_id && (await db.prepare('SELECT * FROM bookings WHERE id=?').get(g.booking_id));
    if (req.body.status === 'descartada' && b && b.status !== 'gestion_skilly') S.fail(409, 'Gestiona la cancelación desde la reserva vinculada.');
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      await db.prepare('UPDATE guest_requests SET status=?,admin_notes=?,assigned_to=?,handled_at=? WHERE id=?').run(req.body.status, text(req.body.adminNotes || '', 2000), text(req.body.assignedTo || '', 160), Date.now(), g.id);
      if (req.body.status === 'descartada' && b) await db.prepare("UPDATE bookings SET status='rechazado' WHERE id=?").run(b.id);
    }).immediate();
    await S.audit(req, 'guest_review', g.id, req.body.status);
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/admin/guest-requests/:id/convert. Tramita la solicitud invitada hacia solicitado
   * para que el profesional responda. Si es una solicitud antigua sin reserva, crea el vínculo;
   * notifica y audita sin aprobar automáticamente.
   */
  app.post('/api/admin/guest-requests/:id/convert', wrap(async (req, res) => {
    S.admin(req);
    await schedule.expire();
    const g = await db.prepare('SELECT * FROM guest_requests WHERE id=?').get(req.params.id);
    if (!g) S.fail(404, 'Solicitud no encontrada.');
    let b;
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      if (!g.booking_id) {
        const service = await db.prepare('SELECT id FROM services WHERE professional_id=? AND published IS NOT NULL ORDER BY created_at LIMIT 1').get(g.professional_id);
        if (!service) S.fail(409, 'El servicio necesita aprobación antes de tramitar esta solicitud anterior.');
        b = await createBooking({
          ...req,
          body: {
            serviceId: service.id,
            date: g.date,
            time: g.time,
            orgName: g.org_name,
            email: g.email,
            notes: g.notes
          }
        }, true);
        await db.prepare('UPDATE guest_requests SET booking_id=?,service_id=? WHERE id=?').run(b.id, service.id, g.id);
      } else b = await access(req, g.booking_id);
      if (b.status !== 'gestion_skilly') S.fail(409, 'La solicitud ya fue tramitada o venció.');
      await db.prepare("UPDATE bookings SET status='solicitado' WHERE id=?").run(b.id);
      await db.prepare("UPDATE guest_requests SET status='convertida',handled_at=? WHERE id=?").run(Date.now(), g.id);
    }).immediate();
    await notify.send(b.professional_email, 'Solicitud revisada por Skilly', `${b.service}: ${b.date} ${b.time}. Acepta o rechaza desde tu panel.`);
    if (!g.booking_id) await guestLink(b);
    await S.audit(req, 'guest_forwarded', b.id);
    res.json({
      ok: true
    });
  }));
  /**
   * PATCH /api/bookings/:id. Permite reprogramar a administración o aceptar, rechazar y entregar
   * al profesional propietario. Revalida estado y agenda bajo transacción; entregar exige pago,
   * término del intervalo y evidencia textual.
   */
  app.patch('/api/bookings/:id', wrap(async (req, res) => {
    await schedule.expire();
    let b = await access(req, req.params.id);
    const wanted = req.body.status;
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      b = await access(req, req.params.id);
      if (req.body.date || req.body.time) {
        S.admin(req);
        if (!['solicitado', 'aceptado', 'pagado', 'gestion_skilly'].includes(b.status)) S.fail(409, 'No se puede reprogramar este estado.');
        if (await db.prepare("SELECT 1 FROM payments WHERE booking_id=? AND status IN ('iniciado','procesando','revision')").get(b.id)) S.fail(409, 'Hay un pago en proceso.');
        const date = req.body.date || b.date,
          time = req.body.time || b.time,
          p = await db.prepare('SELECT * FROM professionals WHERE id=?').get(b.professional_id);
        const limits = await schedule.available(p, {
          durationMinutes: b.duration_minutes,
          prepMinutes: b.prep_minutes,
          followupMinutes: b.followup_minutes
        }, date, time, b.id);
        await db.prepare('UPDATE bookings SET date=?,time=?,start_at=?,end_at=?,response_deadline=CASE WHEN response_deadline IS NULL THEN NULL ELSE LEAST(response_deadline,?) END,payment_deadline=CASE WHEN payment_deadline IS NULL THEN NULL ELSE LEAST(payment_deadline,?) END WHERE id=?').run(date, time, limits.start, limits.end, limits.start, limits.start, b.id);
        await S.audit(req, 'reschedule', b.id, `${date} ${time}`);
      } else if (['aceptado', 'rechazado'].includes(wanted)) {
        S.requireRole(req, 'profesional');
        if (b.professional_id !== req.user.professional_id || b.status !== 'solicitado') S.fail(409, 'Esta solicitud no está pendiente de tu respuesta.');
        const deadline = Math.min(Date.now() + (await getSettings()).payment_hours * 3600000, b.start_at || schedule.timestamp(b.date, b.time));
        await db.prepare('UPDATE bookings SET status=?,payment_deadline=? WHERE id=?').run(wanted, wanted === 'aceptado' ? deadline : null, b.id);
      } else if (wanted === 'entregado') {
        S.requireRole(req, 'profesional');
        if (b.status !== 'pagado' || b.professional_id !== req.user.professional_id) S.fail(409, 'Solo puedes entregar tus reservas pagadas.');
        if (b.cancellation_status) S.fail(409, 'Hay una devolución pendiente.');
        if (Date.now() < b.end_at) S.fail(409, 'La dedicación reservada todavía no termina.');
        const evidence = text(req.body.evidence || '', 4000);
        if (!evidence) S.fail(400, 'Describe la prestación y sus entregables.');
        await db.prepare('UPDATE bookings SET delivery_evidence=? WHERE id=?').run(evidence, b.id);
        await db.prepare("UPDATE bookings SET status='entregado',delivered_at=? WHERE id=?").run(Date.now(), b.id);
      } else S.fail(400, 'Cambio de estado no permitido.');
    }).immediate();
    b = await access(req, b.id);
    await notify.send(b.org_email, 'Actualización de tu reserva', `${b.service}: ${b.status}. ${b.date} ${b.time}. Revisa tu reserva en Skilly.`);
    if (b.guest && wanted === 'aceptado') await guestLink(b);
    res.json(await bookingView(req, b));
  }));
  /**
   * POST /api/evaluations. Exige cliente de una reserva entregada o confirmada, puntaje válido y
   * comentario privado. Impide duplicados y registra la evaluación junto con la confirmación de
   * entrega.
   */
  app.post('/api/evaluations', wrap(async (req, res) => {
    const b = await access(req, req.body.bookingId);
    await customer(req, b);
    if (!['entregado', 'confirmado'].includes(b.status)) S.fail(409, 'Primero el profesional debe marcar el servicio como entregado.');
    const comment = text(req.body.comment || '', 4000);
    if (!comment) S.fail(400, 'Escribe tu evaluación privada.');
    if (!['number', 'string'].includes(typeof req.body.stars)) S.fail(400, 'Selecciona una evaluación entre 1 y 5.');
    const stars = integer(req.body.stars, 1, 5, 'Evaluación');
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const current = await access(req, b.id);
      if (!['entregado', 'confirmado'].includes(current.status) || (await db.prepare('SELECT 1 FROM evaluations WHERE booking_id=?').get(b.id))) S.fail(409, 'La entrega ya fue confirmada.');
      await db.prepare('INSERT INTO evaluations(id,professional_id,professional_name,booking_id,org_name,org_email,stars,comment,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(S.id('ev'), b.professional_id, b.professional_name, b.id, b.org_name, b.org_email, stars, comment, Date.now());
      await db.prepare("UPDATE bookings SET status='confirmado',confirmed_at=? WHERE id=?").run(Date.now(), b.id);
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * GET /api/bookings/:id/messages. Exige acceso a la reserva y pago confirmado antes de devolver
   * los mensajes ordenados.
   */
  app.get('/api/bookings/:id/messages', wrap(async (req, res) => {
    const b = await access(req, req.params.id);
    if (!b.paid_at) S.fail(403, 'El chat se habilita después del pago.');
    res.json((await db.prepare('SELECT * FROM messages WHERE booking_id=? ORDER BY created_at').all(b.id)).map(/* Transforma cada elemento con { id: m.id, senderRole: m.sender_role, senderName: m.sender_name, body: m.body, createdAt: m.created_at } para construir la colección utilizada por esta operación. */ m => ({
      id: m.id,
      senderRole: m.sender_role,
      senderName: m.sender_name,
      body: m.body,
      createdAt: m.created_at
    })));
  }));
  /**
   * POST /api/bookings/:id/messages. Exige acceso y pago, limita frecuencia y valida el texto.
   * Obtiene autor y rol de la sesión, ignorando una identidad enviada por el cliente.
   */
  app.post('/api/bookings/:id/messages', wrap(async (req, res) => {
    const b = await access(req, req.params.id);
    if (!b.paid_at) S.fail(403, 'El chat se habilita después del pago.');
    S.rateLimit(req, 'chat', 120);
    const body = text(req.body.body, 4000);
    if (!body) S.fail(400, 'Escribe un mensaje.');
    const role = req.user.role === 'invitado' ? 'organizacion' : req.user.role,
      name = req.user.role === 'admin' ? 'Skilly' : req.user.role === 'profesional' ? b.professional_name : b.org_name;
    await db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(S.id('msg'), b.id, role, name, body, Date.now());
    res.status(201).json({
      ok: true
    });
  }));
  /**
   * GET /api/bookings/:id/attachments. Comprueba propiedad de la reserva y devuelve metadatos de
   * documentos, sin incluir sus bytes.
   */
  app.get('/api/bookings/:id/attachments', wrap(async (req, res) => {
    const b = await access(req, req.params.id);
    res.json(await db.prepare('SELECT id,name,mime,created_at FROM attachments WHERE booking_id=?').all(b.id));
  }));
  /**
   * POST /api/bookings/:id/attachments. Exige pago y acceso; decodifica Base64 y valida firma
   * PDF/PNG/JPEG, tamaño máximo de 5 MB y hasta 20 adjuntos. Guarda contenido binario y autor en
   * PostgreSQL.
   */
  app.post('/api/bookings/:id/attachments', wrap(async (req, res) => {
    const b = await access(req, req.params.id);
    if (!b.paid_at) S.fail(409, 'Adjunta documentos después del pago.');
    const data = Buffer.from(String(req.body.data || ''), 'base64'),
      mime = req.body.mime;
    const valid = mime === 'application/pdf' && data.subarray(0, 5).toString() === '%PDF-' || mime === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || mime === 'image/jpeg' && data[0] === 255 && data[1] === 216;
    if (!valid || data.length > 5 * 1024 * 1024) S.fail(400, 'Adjunta un PDF, PNG o JPG de hasta 5 MB.');
    const name = text(req.body.name, 180).replace(/[\r\n\\/]/g, '_');
    const count = (await db.prepare('SELECT COUNT(*) n FROM attachments WHERE booking_id=?').get(b.id)).n;
    if (count >= 20) S.fail(400, 'Máximo 20 documentos por reserva.');
    await db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)').run(S.id('doc'), b.id, name, mime, data, req.user.id, Date.now());
    res.status(201).json({
      ok: true
    });
  }));
  /**
   * GET /api/attachments/:id. Busca el documento, verifica acceso a su reserva y devuelve sus
   * bytes con tipo y nombre de descarga.
   */
  app.get('/api/attachments/:id', wrap(async (req, res) => {
    const a = await db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
    if (!a) S.fail(404, 'Documento no encontrado.');
    await access(req, a.booking_id);
    res.set('Content-Type', a.mime).set('Content-Disposition', `attachment; filename="documento"; filename*=UTF-8''${encodeURIComponent(a.name)}`).send(a.data);
  }));
}
module.exports = {
  bookingsRoutes,
  access,
  customer,
  bookingView,
  listBookings
};
