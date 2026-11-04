// ============================================================
// Notificaciones por correo a Skilly (Gmail)
// ------------------------------------------------------------
// Se usa cuando una organización agenda un profesional SIN
// registrarse: en vez de crear una cuenta, se le avisa por correo
// al equipo de Skilly para que gestione manualmente el contacto,
// el método de pago, etc.
//
// Requiere configurar en tu archivo .env:
//   GMAIL_USER=tu-cuenta@gmail.com
//   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx   (Contraseña de aplicación, NO tu clave normal)
//   ADMIN_NOTIFICATION_EMAIL=admin@skilly.cl  (a quién le llega el aviso; por defecto GMAIL_USER)
//
// Cómo generar una "Contraseña de aplicación" de Gmail:
//   1. Activa la verificación en dos pasos en la cuenta de Gmail que usarás para enviar.
//   2. Ve a https://myaccount.google.com/apppasswords
//   3. Crea una nueva contraseña de aplicación (nombre sugerido: "Skilly").
//   4. Copia el código de 16 caracteres y pégalo en GMAIL_APP_PASSWORD (con o sin espacios).
//
// Si no configuras estas variables, el servidor sigue funcionando:
// la solicitud queda guardada en la base de datos igual, solo que
// no se envía el correo (se registra en la consola del servidor).
// ============================================================

const nodemailer = require('nodemailer');

let transporter = null;
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

function isConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { sendGuestRequestEmail, sendProfessionalStatusEmail, isConfigured };
