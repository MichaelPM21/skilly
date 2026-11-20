/**
 * @file Reclamos y mediaciones: apertura → respuesta → decisión pendiente →
 * ejecución/conformidad → resolución, con una apelación. El trabajador público revisa atrasos y
 * correos cada minuto. Nunca libera dinero por silencio ni prueba ausencia automáticamente.
 */

const {
  db
} = require('./db');
const S = require('./security');
const {
  wrap,
  text
} = require('./accounts');
const {
  access,
  customer
} = require('./bookings');
const P = require('./policies');
const notify = require('./notifications');
const categories = ['inasistencia_profesional', 'abandono', 'cancelacion_profesional', 'inasistencia_cliente', 'calidad', 'fuerza_mayor', 'otro'];
/**
 * Normaliza un texto de hasta 4000 caracteres y exige contenido. Usa el mensaje del llamador
 * para rechazar explicaciones o fundamentos vacíos.
 *
 * @param {string} value - Texto obligatorio de hasta 4000 caracteres.
 * @param {string} label - Mensaje de error cuando el contenido está vacío.
 * @returns {string} Texto recortado con contenido.
 * @throws {Error} Error 400 ante texto vacío o longitud/tipo inválidos.
 * @example
 * required("  Solicito revisión  ", "Explica lo ocurrido.");
 */
function required(value, label) {
  const result = text(value || '', 4000);
  if (!result) S.fail(400, label);
  return result;
}
/**
 * Agrega un evento con autor, tipo, texto y fecha a case_events. La secuencia generada por
 * PostgreSQL permite distinguir decisión y conformidad incluso con igual milisegundo.
 *
 * @param {string} id - Identificador del reclamo o mediación.
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {string} kind - Clase de evento: apertura, respuesta, propuesta u otra admitida por el llamador.
 * @param {string} body - Contenido del evento.
 * @returns {Promise<void>} Persiste un evento con autor, fecha y secuencia.
 * @example
 * await event(caseId, req, "respuesta", "Adjunto antecedentes de la atención.");
 */
async function event(id, req, kind, body) {
  await db.prepare('INSERT INTO case_events(id,case_id,actor,kind,body,created_at) VALUES(?,?,?,?,?,?)').run(S.id('evt'), id, req.user?.id || 'system', kind, body, Date.now());
}
/**
 * Carga un reclamo y reutiliza access para limitarlo a los participantes de su reserva o
 * administración. Devuelve la fila o lanza un error de acceso.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {string} id - Identificador de incidents.
 * @returns {Promise<Object>} Reclamo accesible por la persona autenticada.
 * @throws {Error} Error 401/403/404 por falta de acceso o caso inexistente.
 * @example
 * const claim = await incident(req, req.params.id);
 */
async function incident(req, id) {
  const i = await db.prepare('SELECT * FROM incidents WHERE id=?').get(id);
  if (!i) S.fail(404, 'Reclamo no encontrado.');
  await access(req, i.booking_id);
  return i;
}
/**
 * Abre un caso si no existe otro sin resolver para la reserva, fija plazos hábiles y registra
 * apertura y avisos. Devuelve su id; el caso pendiente bloquea liquidaciones mediante las
 * comprobaciones de pago.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {Object} b - Reserva previamente autorizada.
 * @param {string} category - Categoría validada por la ruta.
 * @param {string} body - Fundamento del reclamo.
 * @param {string} [evidence=""] - Descripción de antecedentes o evidencia.
 * @param {string} [remedy="revision"] - Solución solicitada.
 * @returns {Promise<string>} ID del reclamo insertado con plazos, evento y avisos.
 * @throws {Error} Error 409 si la reserva tiene otro reclamo sin resolver.
 * @example
 * const id = await createIncident(req, bookingRow, "calidad", "El entregable requiere revisión");
 */
async function createIncident(req, b, category, body, evidence = '', remedy = 'revision') {
  if (await db.prepare("SELECT 1 FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id)) S.fail(409, 'Ya existe un reclamo abierto. Agrega tu respuesta al caso.');
  const id = S.id('inc');
  await db.prepare('INSERT INTO incidents(id,booking_id,author_id,body,created_at,category,evidence,requested_remedy,response_due,resolution_due) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, b.id, req.user?.id || null, body, Date.now(), category, evidence, remedy, P.businessDeadline(1), P.businessDeadline(2));
  await event(id, req, 'apertura', body);
  await notify.booking(b, 'Reclamo abierto en Skilly', `${b.id}: ${body}. Responde desde la reserva. La liquidación queda bloqueada.`, id);
  return id;
}
/**
 * Comprueba que el servicio exista y que lo consulte su profesional propietario o un
 * administrador de la aplicación administrativa. Devuelve la fila privada del servicio.
 *
 * @param {import("express").Request} req - Solicitud Express; la autenticación previa agrega user y session.
 * @param {string} id - ID del servicio solicitado.
 * @returns {Promise<Object>} Fila privada de services accesible para su profesional o administración.
 * @throws {Error} Error 401/403/404 por sesión, propiedad o servicio inexistente.
 * @example
 * const service = await serviceAccess(req, req.params.id);
 */
async function serviceAccess(req, id) {
  const s = await db.prepare('SELECT * FROM services WHERE id=?').get(id);
  if (!s) S.fail(404, 'Servicio no encontrado.');
  if (req.user?.role === 'admin') S.admin(req);else {
    S.requireRole(req, 'profesional');
    if (s.professional_id !== req.user.professional_id) S.fail(403, 'Servicio ajeno.');
  }
  return s;
}
/**
 * Registra confirmación sin evaluación, reclamos, respuestas, apelaciones, decisiones,
 * suspensión, mediación y operaciones pendientes. Resolver un caso no ejecuta una transferencia
 * o devolución: exige las acciones y conformidades correspondientes.
 *
 * @param {import("express").Express} app - Aplicación pública o administrativa que recibe los manejadores HTTP.
 * @returns {void} Registra rutas y middleware en app; no inicia el servidor.
 * @example
 * // Durante la construcción de la aplicación Express:
 * routes(app);
 */
function routes(app) {
  /**
   * POST /api/bookings/:id/confirm. Permite al cliente confirmar una entrega sin escribir
   * evaluación. Actualiza confirmado y fecha dentro de una transacción y encola avisos; no libera
   * el pago.
   */
  app.post('/api/bookings/:id/confirm', wrap(async (req, res) => {
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const b = await access(req, req.params.id);
      await customer(req, b);
      if (b.status !== 'entregado' || b.cancellation_status) S.fail(409, 'La entrega no está disponible para confirmar.');
      await db.prepare("UPDATE bookings SET status='confirmado',confirmed_at=? WHERE id=?").run(Date.now(), b.id);
      await notify.booking(b, 'Entrega confirmada', `La organización confirmó ${b.service}.`);
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/bookings/:id/incidents. Valida categoría, acceso, tolerancia de inasistencia y plazo
   * posterior a liquidación. Abre un único caso pendiente con evidencia y solución solicitada;
   * permite cancelación profesional aceptada antes del pago.
   */
  app.post('/api/bookings/:id/incidents', wrap(async (req, res) => {
    let id;
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const b = await access(req, req.params.id),
        category = req.body.category || 'otro';
      if (!categories.includes(category)) S.fail(400, 'Motivo inválido.');
      if (!b.paid_at && !(req.user.role === 'profesional' && b.status === 'aceptado' && category === 'cancelacion_profesional')) S.fail(409, 'Esta reserva no admite este reclamo.');
      const released = await db.prepare('SELECT released_at FROM payments WHERE booking_id=? AND released_at IS NOT NULL').get(b.id);
      if (released && Date.now() > released.released_at + (P.policy(b)?.claimDays || 30) * 24 * P.HOUR) S.fail(409, 'Venció el plazo de 30 días para reclamar tras la liquidación. Contacta a Skilly.');
      if (category === 'inasistencia_profesional') {
        if (req.user.role !== 'admin') await customer(req, b);
        const appointment = require('./scheduling').timestamp(b.date, b.time);
        if (Date.now() < appointment + (P.policy(b)?.toleranceMinutes || 15) * 60000) S.fail(409, 'Aún no termina la tolerancia de asistencia de 15 minutos.');
      }
      if (['inasistencia_cliente', 'cancelacion_profesional'].includes(category)) S.requireRole(req, 'profesional');
      const remedy = req.body.remedy || 'revision';
      if (!['revision', 'reembolso', 'reprogramacion', 'correccion'].includes(remedy)) S.fail(400, 'Solución inválida.');
      id = await createIncident(req, b, category, required(req.body.body, 'Describe lo ocurrido.'), text(req.body.evidence || '', 4000), remedy);
    }).immediate();
    res.status(201).json({
      id
    });
  }));
  /**
   * GET /api/bookings/:id/incidents. Devuelve reclamos y sus eventos a los participantes
   * autorizados de la reserva.
   */
  app.get('/api/bookings/:id/incidents', wrap(async (req, res) => {
    await access(req, req.params.id);
    res.json(await Promise.all((await db.prepare('SELECT * FROM incidents WHERE booking_id=? ORDER BY created_at').all(req.params.id)).map(/* Obtiene y transforma cada registro de forma asíncrona; el llamador reúne los resultados con Promise.all. */ async i => ({
      ...i,
      events: await db.prepare('SELECT * FROM case_events WHERE case_id=? ORDER BY created_at').all(i.id)
    }))));
  }));
  /**
   * POST /api/incidents/:id/reply. Agrega una respuesta fundamentada a un caso no resuelto y
   * notifica a las partes. Un caso resuelto requiere apelación para reabrirse.
   */
  app.post('/api/incidents/:id/reply', wrap(async (req, res) => {
    const i = await incident(req, req.params.id);
    if (i.status === 'resuelta') S.fail(409, 'Solicita una apelación para reabrir.');
    const body = required(req.body.body, 'Escribe tu respuesta y evidencia.');
    await event(i.id, req, 'respuesta', body);
    await notify.booking(await access(req, i.booking_id), 'Respuesta a un reclamo', `${i.id}: ${body}`);
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/incidents/:id/appeal. Permite una apelación fundamentada dentro de siete días de la
   * resolución. Reabre el caso, renueva el plazo de revisión y registra historial y avisos.
   */
  app.post('/api/incidents/:id/appeal', wrap(async (req, res) => {
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const i = await incident(req, req.params.id);
      if (i.status !== 'resuelta' || i.appeals >= 1) S.fail(409, 'Solo se permite una apelación de un caso resuelto.');
      if (Date.now() - i.resolved_at > 7 * 24 * P.HOUR) S.fail(409, 'Venció el plazo de apelación de 7 días.');
      const body = required(req.body.body, 'Fundamenta la apelación.');
      await db.prepare("UPDATE incidents SET status='abierta',appeals=appeals+1,resolution_due=? WHERE id=?").run(P.businessDeadline(2), i.id);
      await event(i.id, req, 'apelacion', body);
      await notify.booking(await access(req, i.booking_id), 'Apelación abierta', body);
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * GET /api/admin/incidents. Lista reclamos con servicio y organización para la gestión
   * administrativa.
   */
  app.get('/api/admin/incidents', wrap(async (req, res) => {
    S.admin(req);
    res.json(await db.prepare('SELECT i.*,b.service,b.org_name FROM incidents i JOIN bookings b ON b.id=i.booking_id ORDER BY i.created_at DESC').all());
  }));
  /**
   * PATCH /api/admin/incidents/:id. Registra decisión pendiente o cierre con resultado y
   * fundamento. Exige devolución ejecutada para reembolsos y conformidad posterior a la decisión
   * para corrección/reprogramación; asigna administrador, audita y avisa.
   */
  app.patch('/api/admin/incidents/:id', wrap(async (req, res) => {
    S.admin(req);
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const i = await incident(req, req.params.id),
        b = await access(req, i.booking_id);
      if (i.status === 'resuelta') S.fail(409, 'El caso ya fue resuelto.');
      const resolution = required(req.body.resolution, 'Describe la decisión y su evidencia.'),
        outcome = req.body.outcome || 'sin_compensacion';
      if (!['reembolso_total', 'reembolso_parcial', 'correccion', 'reprogramacion', 'sin_compensacion', 'incumplimiento_profesional'].includes(outcome)) S.fail(400, 'Resultado inválido.');
      const close = req.body.close !== false;
      if (close && b.paid_at && ['reembolso_total', 'incumplimiento_profesional'].includes(outcome) && Number(b.refund_amount) < b.amount) S.fail(409, 'Ejecuta y concilia el reembolso completo antes de cerrar.');
      if (close && outcome === 'reembolso_parcial' && !(b.refund_amount > 0)) S.fail(409, 'Falta ejecutar el reembolso acordado.');
      if (close && ['correccion', 'reprogramacion'].includes(outcome) && !(await db.prepare("SELECT 1 FROM case_events e WHERE case_id=? AND kind='conformidad' AND event_sequence > COALESCE((SELECT MAX(event_sequence) FROM case_events WHERE case_id=e.case_id AND kind='decision'),0)").get(i.id))) S.fail(409, 'Falta la conformidad de la organización con la solución.');
      await db.prepare('UPDATE incidents SET status=?,outcome=?,resolution=?,assigned_to=?,resolved_at=? WHERE id=?').run(close ? 'resuelta' : 'pendiente_accion', outcome, resolution, req.user.id, close ? Date.now() : null, i.id);
      await event(i.id, req, close ? 'resolucion' : 'decision', resolution);
      await S.audit(req, 'incident_decision', i.id, JSON.stringify({
        outcome,
        close
      }));
      await notify.booking(b, close ? 'Reclamo resuelto' : 'Acción pendiente en tu reclamo', `${i.id}: ${resolution}`);
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/incidents/:id/accept. Registra la conformidad del cliente con una solución
   * pendiente. Agrega un evento; el administrador todavía debe cerrar el caso.
   */
  app.post('/api/incidents/:id/accept', wrap(async (req, res) => {
    const i = await incident(req, req.params.id),
      b = await access(req, i.booking_id);
    await customer(req, b);
    if (i.status !== 'pendiente_accion') S.fail(409, 'No hay solución pendiente.');
    await event(i.id, req, 'conformidad', required(req.body.body, 'Confirma qué solución recibiste.'));
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/admin/professionals/:id/suspension. Guarda suspensión o habilitación de nuevas
   * contrataciones con motivo obligatorio. Conserva cuenta, historial y acceso a casos existentes
   * y encola el aviso.
   */
  app.post('/api/admin/professionals/:id/suspension', wrap(async (req, res) => {
    S.admin(req);
    const reason = required(req.body.reason, 'Indica motivo y condiciones para levantar la suspensión.');
    if (typeof req.body.suspended !== 'boolean') S.fail(400, 'Estado inválido.');
    const p = await db.prepare('SELECT * FROM professionals WHERE id=?').get(req.params.id);
    if (!p) S.fail(404, 'Profesional no encontrado.');
    await db.prepare('UPDATE professionals SET booking_suspended=?,suspension_reason=? WHERE id=?').run(req.body.suspended ? 1 : 0, reason, p.id);
    await S.audit(req, 'professional_suspension', p.id, reason);
    await notify.enqueue(p.email, 'Estado de nuevas contrataciones', reason);
    res.json({
      ok: true
    });
  }));
  /**
   * GET /api/services/:id/appeals. Comprueba acceso privado al servicio y devuelve sus mediaciones
   * con eventos.
   */
  app.get('/api/services/:id/appeals', wrap(async (req, res) => {
    await serviceAccess(req, req.params.id);
    res.json(await Promise.all((await db.prepare('SELECT * FROM service_appeals WHERE service_id=? ORDER BY created_at DESC').all(req.params.id)).map(/* Obtiene y transforma cada registro de forma asíncrona; el llamador reúne los resultados con Promise.all. */ async a => ({
      ...a,
      events: await db.prepare('SELECT * FROM case_events WHERE case_id=? ORDER BY created_at').all(a.id)
    }))));
  }));
  /**
   * POST /api/services/:id/appeals. Permite al propietario abrir mediación sobre un servicio
   * rechazado o con información solicitada, sin otra mediación activa. Guarda hash del borrador,
   * justificación, contacto y plazo hábil.
   */
  app.post('/api/services/:id/appeals', wrap(async (req, res) => {
    S.requireRole(req, 'profesional');
    let id;
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const s = await serviceAccess(req, req.params.id);
      if (!['rechazado', 'info_solicitada'].includes(s.status)) S.fail(409, 'El servicio no tiene observaciones pendientes.');
      if (await db.prepare("SELECT 1 FROM service_appeals WHERE service_id=? AND status IN ('abierta','propuesta')").get(s.id)) S.fail(409, 'Ya hay una mediación abierta.');
      const body = required(req.body.body, 'Justifica tu propuesta.'),
        contact = text(req.body.contact || 'correo', 160);
      if (!contact) S.fail(400, 'Indica correo o teléfono de contacto.');
      id = S.id('apl');
      await db.prepare('INSERT INTO service_appeals(id,service_id,revision,body,contact,due_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id, s.id, S.hash(s.draft), body, contact, P.businessDeadline(2), Date.now());
      await event(id, req, 'apertura', body);
      const admin = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER;
      if (admin) await notify.enqueue(admin, 'Mediación de servicio solicitada', `${id}: ${body}. Contacto: ${contact}`);
    }).immediate();
    res.status(201).json({
      id
    });
  }));
  /**
   * POST /api/service-appeals/:id/events. Aplica acciones de administrador o profesional según el
   * estado de mediación. Rechazar reabre conversación y aceptar exige propuesta y revisión
   * vigente; registra el acuerdo sin editar ni publicar el servicio.
   */
  app.post('/api/service-appeals/:id/events', wrap(async (req, res) => {
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const a = await db.prepare('SELECT * FROM service_appeals WHERE id=?').get(req.params.id);
      if (!a) S.fail(404, 'Mediación no encontrada.');
      const s = await serviceAccess(req, a.service_id),
        kind = req.body.kind;
      if (!['abierta', 'propuesta'].includes(a.status)) S.fail(409, 'La mediación está cerrada.');
      const body = required(req.body.body, 'Registra el fundamento o acuerdo.');
      if (req.user.role === 'admin') {
        if (!['contacto', 'propuesta', 'cierre'].includes(kind)) S.fail(400, 'Acción inválida.');
        await db.prepare('UPDATE service_appeals SET status=?,resolution=?,assigned_to=?,due_at=? WHERE id=?').run(kind === 'cierre' ? 'cerrada' : kind === 'propuesta' ? 'propuesta' : a.status, body, req.user.id, P.businessDeadline(2), a.id);
      } else {
        if (!['respuesta', 'aceptar', 'rechazar', 'retirar'].includes(kind)) S.fail(400, 'Acción inválida.');
        if (['aceptar', 'rechazar'].includes(kind) && a.status !== 'propuesta') S.fail(409, 'Falta una propuesta concreta de Skilly.');
        if (kind === 'aceptar' && a.revision !== S.hash(s.draft)) S.fail(409, 'El servicio cambió. Solicita una nueva revisión del acuerdo.');
        await db.prepare('UPDATE service_appeals SET status=?,due_at=? WHERE id=?').run(kind === 'aceptar' ? 'acordada' : kind === 'retirar' ? 'retirada' : kind === 'rechazar' ? 'abierta' : a.status, P.businessDeadline(2), a.id);
      }
      await event(a.id, req, kind, body);
      await S.audit(req, 'service_mediation', a.id, kind);
      const p = await db.prepare('SELECT email FROM professionals WHERE id=?').get(s.professional_id);
      for (const email of new Set([p.email, process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER].filter(Boolean))) await notify.enqueue(email, 'Actualización de mediación', `${a.id}: ${kind}. ${body}`);
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * GET /api/admin/operations. Devuelve devoluciones en revisión, transferencias, correos
   * pendientes y mediaciones abiertas para el panel operativo.
   */
  app.get('/api/admin/operations', wrap(async (req, res) => {
    S.admin(req);
    res.json({
      refunds: await db.prepare("SELECT * FROM refund_operations WHERE status='revision'").all(),
      payouts: await db.prepare('SELECT * FROM payouts ORDER BY created_at DESC').all(),
      emails: await db.prepare('SELECT id,recipient,subject,attempts,next_attempt_at,last_error FROM outbox WHERE sent=0 ORDER BY created_at DESC LIMIT 100').all(),
      appeals: await db.prepare("SELECT * FROM service_appeals WHERE status IN ('abierta','propuesta')").all()
    });
  }));
  /**
   * POST /api/admin/outbox/:id/retry. Reinicia contador y plazo de un correo pendiente sin bloqueo
   * activo y audita el reintento. No envía de inmediato ni extiende la vigencia de los enlaces del
   * cuerpo.
   */
  app.post('/api/admin/outbox/:id/retry', wrap(async (req, res) => {
    S.admin(req);
    await db.prepare('UPDATE outbox SET attempts=0,next_attempt_at=0 WHERE id=? AND sent=0 AND lease_until<=?').run(req.params.id, Date.now());
    await S.audit(req, 'email_retry', req.params.id);
    res.json({
      ok: true
    });
  }));
}
/**
 * Revisa reservas pagadas sin entrega por más de 24 horas, entregas sin confirmar por tres días
 * y casos vencidos. Crea una revisión de abandono solo si no había incidentes y encola avisos
 * deduplicados; no atribuye culpa ni libera dinero.
 *
 * @param {number} [now=Date.now()] - Reloj de evaluación de plazos en milisegundos Unix.
 * @returns {Promise<void>} Detecta casos que requieren seguimiento y registra avisos sin duplicarlos.
 * @example
 * await sweep(Date.now());
 */
async function sweep(now = Date.now()) {
  await db.transaction(async () => {
    // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
    
    for (const b of await db.prepare("SELECT * FROM bookings WHERE status='pagado' AND end_at<? AND cancellation_status IS NULL").all(now - 24 * P.HOUR)) {
      if (!(await db.prepare('SELECT 1 FROM incidents WHERE booking_id=?').get(b.id))) await createIncident({}, b, 'abandono', 'La reserva lleva más de 24 horas sin entrega después de su término. Skilly debe verificar lo ocurrido.');
    }
    for (const b of await db.prepare("SELECT * FROM bookings WHERE status='entregado' AND delivered_at<?").all(now - 3 * 24 * P.HOUR)) await notify.booking(b, 'Entrega pendiente de confirmación', `${b.id}: confirma la entrega o informa un problema. Skilly revisará el caso; no se libera el pago automáticamente.`, 'confirmation:' + b.id);
    for (const i of await db.prepare("SELECT * FROM incidents WHERE status<>'resuelta' AND resolution_due<?").all(now)) await notify.booking(await db.prepare('SELECT * FROM bookings WHERE id=?').get(i.booking_id), 'Reclamo fuera de plazo', `${i.id}: requiere atención de Skilly.`, 'overdue:' + i.id + ':' + i.appeals);
    for (const a of await db.prepare("SELECT * FROM service_appeals WHERE status IN ('abierta','propuesta') AND due_at<?").all(now)) {
      const email = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER;
      if (email) await notify.enqueue(email, 'Mediación fuera de plazo', `${a.id}: contacta al profesional y registra la gestión.`, 'appeal:' + a.id + ':' + a.due_at);
    }
  }).immediate();
}
let worker;
/**
 * Inicia una sola tarea periódica por proceso y realiza una primera ejecución inmediata. Cada
 * minuto ejecuta sweep y flush sin solaparse; unref evita que el temporizador mantenga vivo por
 * sí solo el proceso.
 *
 * @returns {Promise<void>} Finaliza tras el primer ciclo o si el temporizador ya existe.
 */
async function startWorker() {
  if (worker) return;
  let running = false;
  /**
   * Ejecuta el seguimiento y envío de correos de forma secuencial, omitiendo el ciclo si el
   * anterior sigue activo. Registra errores y siempre libera la bandera running para permitir
   * próximos intentos.
   *
   * @returns {Promise<void>} Termina el ciclo o lo omite si ya está en ejecución; registra sus errores.
   */
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await sweep();
      await notify.flush();
    } catch (e) {
      console.error('Seguimiento pendiente:', e.message);
    } finally {
      running = false;
    }
  };
  worker = setInterval(run, 60000);
  worker.unref();
  await run();
}
module.exports = {
  routes,
  sweep,
  startWorker,
  createIncident
};
