/**
 * @file Módulo heredado de correo directo, conservado en el repositorio. No está
 * requerido por el servidor vigente: los flujos actuales usan notifications.js y outbox. Sus
 * textos de publicación y registro describen una versión anterior.
 */

/**
 * Configuración del transporte Gmail heredado.
 *
 * GMAIL_USER y GMAIL_APP_PASSWORD habilitan el transporte; se eliminan los
 * espacios de la contraseña de aplicación. ADMIN_NOTIFICATION_EMAIL define
 * el destinatario administrativo y, si falta, se utiliza GMAIL_USER.
 * Sin credenciales, las funciones de envío devuelven sent=false.
 * Este módulo no persiste solicitudes: esa responsabilidad corresponde al llamador.
 * Los flujos vigentes utilizan notifications.js y la bandeja outbox.
 *
 * @see https://myaccount.google.com/apppasswords
 */

const nodemailer = require('nodemailer');

let transporter = null;
/**
 * Crea y reutiliza un transporte Gmail si hay credenciales, o devuelve null. Este módulo es
 * heredado; el flujo actual usa notifications.js y su cola persistente.
 *
 * @returns {Object|null} Transporte Gmail reutilizado o null si faltan variables de entorno.
 * @example
 * const transport = getTransporter();
 */
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, ''),
    },
  });
  return transporter;
}

/**
 * Indica si existen las dos variables de Gmail, sin probar su validez. Esta utilidad pertenece
 * al módulo de correo heredado.
 *
 * @returns {boolean} true si existen ambas variables de Gmail, sin autenticarlas.
 * @example
 * const configured = isConfigured();
 */
function isConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/**
 * Construye texto y HTML para avisar a Skilly de una solicitud invitada y los envía directamente
 * por Gmail. Resuelve sent/reason; no participa en la cola actual ni en sus reintentos.
 *
 * @param {Object} request - Solicitud heredada con id, orgName, professionalName, date, time, contactName y email.
 * @param {string} [request.phone] - Teléfono de contacto opcional.
 * @param {string} [request.notes] - Notas opcionales de la solicitud.
 * @returns {Promise<{sent: boolean, reason: (string|undefined)}>} sent indica aceptación SMTP; reason explica falta de configuración o fallo de envío.
 * @example
 * const result = await sendGuestRequestEmail(guestRequest);
 */
async function sendGuestRequestEmail(request) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] GMAIL_USER / GMAIL_APP_PASSWORD no configurados: no se envió el correo. La solicitud quedó guardada igual.');
    return { sent: false, reason: 'not_configured' };
  }
  const to = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER;
  const subject = `Skilly · Nueva solicitud sin registro — ${request.orgName}`;
  const text = `Se recibió una solicitud de agendamiento de una organización que NO se registró en la plataforma.
Un administrador debe contactarla manualmente para coordinar el servicio y el método de pago.

Profesional solicitado: ${request.professionalName}
Fecha / hora solicitada: ${request.date} ${request.time}

Datos de contacto:
  Nombre de contacto: ${request.contactName}
  Organización: ${request.orgName}
  Correo: ${request.email}
  Teléfono: ${request.phone || '(no indicado)'}

Notas del solicitante:
  ${request.notes || '(sin notas)'}

ID de la solicitud: ${request.id}
Gestiona esta solicitud desde el panel de administración de Skilly, pestaña "Solicitudes sin registro".`;

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#17202A;line-height:1.5">
      <p><b>Nueva solicitud de agendamiento sin registro</b></p>
      <p>Una organización pidió agendar a un profesional sin crear una cuenta en Skilly. Un administrador debe contactarla para coordinar el servicio y el método de pago.</p>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td><b>Profesional</b></td><td>${escapeHtml(request.professionalName)}</td></tr>
        <tr><td><b>Fecha / hora</b></td><td>${escapeHtml(request.date)} ${escapeHtml(request.time)}</td></tr>
        <tr><td><b>Nombre de contacto</b></td><td>${escapeHtml(request.contactName)}</td></tr>
        <tr><td><b>Organización</b></td><td>${escapeHtml(request.orgName)}</td></tr>
        <tr><td><b>Correo</b></td><td>${escapeHtml(request.email)}</td></tr>
        <tr><td><b>Teléfono</b></td><td>${escapeHtml(request.phone || '(no indicado)')}</td></tr>
        <tr><td><b>Notas</b></td><td>${escapeHtml(request.notes || '(sin notas)')}</td></tr>
      </table>
      <p style="color:#65717B;font-size:12px">ID de la solicitud: ${request.id}<br>Gestiónala desde el panel de administración → "Solicitudes sin registro".</p>
    </div>`;

  try {
    await t.sendMail({
      from: `"Skilly" <${process.env.GMAIL_USER}>`,
      to,
      replyTo: request.email,
      subject, text, html,
    });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] Error enviando el correo de la solicitud:', err.message);
    return { sent: false, reason: err.message };
  }
}

/**
 * Construye el aviso de aprobación, rechazo o información faltante y lo envía directamente. Es
 * una implementación heredada: la revisión actual usa notifications.js y separa perfil de
 * publicación.
 *
 * @param {Object} professional - Perfil heredado con name, email y status.
 * @param {string} [professional.adminNotes] - Observaciones que se incorporan al aviso.
 * @returns {Promise<{sent: boolean, reason: (string|undefined)}>} Resultado del intento; no garantiza recepción final del destinatario.
 * @example
 * const result = await sendProfessionalStatusEmail(profile);
 */
async function sendProfessionalStatusEmail(professional) {
  const t = getTransporter();
  if (!t) {
    console.warn('[mailer] GMAIL_USER / GMAIL_APP_PASSWORD no configurados: no se notificó al profesional por correo.');
    return { sent: false, reason: 'not_configured' };
  }
  const labels = {
    validado: { subject: '¡Tu perfil fue validado en Skilly!', line: 'Tu perfil ya fue revisado y aprobado por el equipo de Skilly. Tu servicio ya es visible para las organizaciones en el marketplace.' },
    rechazado: { subject: 'Tu solicitud en Skilly no fue validada', line: 'Revisamos tu solicitud y, por ahora, no fue validada.' },
    info_solicitada: { subject: 'Skilly necesita información adicional de tu perfil', line: 'Revisamos tu solicitud y necesitamos que completes o corrijas algunos datos antes de continuar.' },
  };
  const info = labels[professional.status];
  if (!info) return { sent: false, reason: 'status_not_notifiable' };

  const notesLine = professional.adminNotes ? `\n\nComentario del equipo de Skilly:\n${professional.adminNotes}` : '';
  const text = `Hola ${professional.name},\n\n${info.line}${notesLine}\n\nPuedes revisar el detalle y, si corresponde, actualizar tu información desde tu panel en Skilly.\n\n— Equipo Skilly`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#17202A;line-height:1.6">
    <p>Hola <b>${escapeHtml(professional.name)}</b>,</p>
    <p>${escapeHtml(info.line)}</p>
    ${professional.adminNotes ? `<p style="background:#f7f9fa;border-radius:8px;padding:10px 14px"><b>Comentario del equipo de Skilly:</b><br>${escapeHtml(professional.adminNotes)}</p>` : ''}
    <p>Puedes revisar el detalle y, si corresponde, actualizar tu información desde tu panel en Skilly.</p>
    <p style="color:#65717B;font-size:12px">— Equipo Skilly</p>
  </div>`;

  try {
    await t.sendMail({ from: `"Skilly" <${process.env.GMAIL_USER}>`, to: professional.email, subject: info.subject, text, html });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] Error notificando al profesional:', err.message);
    return { sent: false, reason: err.message };
  }
}

/**
 * Escapa caracteres con significado en HTML al interpolar datos en las plantillas heredadas de
 * correo.
 *
 * @param {*} s - Valor convertido a texto; null y undefined se tratan como vacío.
 * @returns {string} Texto con &, <, >, comillas y apóstrofos escapados.
 * @example
 * escapeHtml("<b>"); // &lt;b&gt;
 */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, /* Sustituye cada carácter especial por su entidad HTML para interpolar texto sin convertirlo en etiquetas. */ c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendGuestRequestEmail, sendProfessionalStatusEmail, isConfigured };
