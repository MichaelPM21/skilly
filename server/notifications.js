/**
 * Flujo del módulo. Bandeja persistente outbox. enqueue guarda; deliver adquiere un bloqueo
 * temporal e intenta SMTP; flush procesa pendientes. Incluye cinco intentos y espera creciente;
 * un fallo tras aceptación SMTP todavía puede producir duplicado al reintentar.
 */

const {
  db
} = require('./db');
const nodemailer = require('nodemailer');
/**
 * Guarda un correo en outbox y devuelve el id insertado o null si dedupe_key ya existía. No
 * llama a SMTP: permite encolar notificaciones dentro de una transacción.
 */
async function enqueue(to, subject, body, key = null) {
  const r = await db.prepare('INSERT INTO outbox(recipient,subject,body,created_at,dedupe_key) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id').run(to, subject, body, Date.now(), key);
  return r.changes ? r.lastInsertRowid : null;
}
/**
 * Intenta enviar un mensaje con un transporte inyectado o Gmail. Adquiere un bloqueo temporal de
 * dos minutos, limita a cinco intentos y programa espera exponencial al fallar; resuelve true
 * solo al confirmar SMTP, sin garantizar entrega única extremo a extremo.
 */
async function deliver(id, transport) {
  if (!transport && (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD)) return false;
  const now = Date.now();
  const locked = await db.prepare('UPDATE outbox SET lease_until=?,attempts=attempts+1 WHERE id=? AND sent=0 AND lease_until<=? AND next_attempt_at<=? AND attempts<5').run(now + 120000, id, now, now);
  if (!locked.changes) return false;
  const row = await db.prepare('SELECT * FROM outbox WHERE id=?').get(id);
  try {
    transport ||= nodemailer.createTransport({
      service: 'gmail',
      connectionTimeout: 15000,
      socketTimeout: 30000,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '')
      }
    });
    await transport.sendMail({
      from: `Skilly <${process.env.GMAIL_USER}>`,
      to: row.recipient,
      subject: row.subject,
      text: row.body,
      messageId: `<skilly-${row.id}@notifications.skilly>`
    });
    await db.prepare('UPDATE outbox SET sent=1,lease_until=0,last_error=NULL WHERE id=?').run(id);
    return true;
  } catch {
    await db.prepare('UPDATE outbox SET lease_until=0,next_attempt_at=?,last_error=? WHERE id=?').run(now + Math.min(24 * 3600000, 60000 * 2 ** row.attempts), 'No se pudo confirmar la entrega SMTP', id);
    return false;
  }
}
/**
 * Encola un correo y realiza un intento inmediato de entrega. Resuelve el resultado SMTP; si no
 * hay configuración, el mensaje permanece pendiente en outbox.
 */
async function send(to, subject, body) {
  return await deliver(await enqueue(to, subject, body));
}
/**
 * Procesa hasta 20 correos pendientes cuyo plazo y bloqueo permiten reintento. Envía
 * secuencialmente mediante deliver y admite un transporte simulado para pruebas.
 */
async function flush(transport) {
  for (const r of await db.prepare('SELECT id FROM outbox WHERE sent=0 AND attempts<5 AND next_attempt_at<=? AND lease_until<=? ORDER BY id LIMIT 20').all(Date.now(), Date.now())) await deliver(r.id, transport);
}
/**
 * Encola el aviso para cliente, profesional y correo administrativo configurado, sin repetir
 * destinatarios. Si recibe una clave, la combina con cada correo para evitar duplicar ese aviso.
 */
async function booking(b, subject, body, key) {
  for (const email of new Set([b.org_email, b.professional_email, process.env.ADMIN_NOTIFICATION_EMAIL || process.env.GMAIL_USER].filter(Boolean))) await enqueue(email, subject, body, key ? key + ':' + email : null);
}
module.exports = {
  send,
  enqueue,
  flush,
  deliver,
  booking
};
