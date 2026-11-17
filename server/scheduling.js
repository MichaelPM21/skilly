/**
 * Flujo del módulo. Agenda compartida por todos los servicios de un profesional, en
 * America/Santiago. Intervalo reservado: preparación + atención + seguimiento. Se comprueban
 * jornada, bloqueos, cupos y solapamientos antes de crear o reprogramar.
 */

const {
  db
} = require('./db');
const {
  fail
} = require('./security');
const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const zone = 'America/Santiago';
/**
 * Convierte milisegundos Unix en fecha AAAA-MM-DD y hora HH:mm de America/Santiago mediante
 * Intl. Evita depender de la zona horaria del servidor.
 */
function localParts(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map(/* Transforma cada elemento con [x.type, x.value] para construir la colección utilizada por esta operación. */ x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`
  };
}
/**
 * Valida fecha y hora locales y calcula su instante Unix ajustando iterativamente la zona
 * America/Santiago. Comprueba el resultado y rechaza fechas imposibles u horas inexistentes por
 * el cambio horario.
 */
function timestamp(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) fail(400, 'Fecha u hora inválida.');
  const desired = Date.parse(date + 'T' + time + ':00Z');
  if (!Number.isFinite(desired) || new Date(desired).toISOString().slice(0, 10) !== date) fail(400, 'Fecha inválida.');
  let result = desired;
  for (let i = 0; i < 4; i++) {
    const p = localParts(result);
    const delta = desired - Date.parse(p.date + 'T' + p.time + ':00Z');
    if (!delta) break;
    result += delta;
  }
  const p = localParts(result);
  if (p.date !== date || p.time !== time) fail(400, 'Este horario no existe por el cambio de hora en Chile.');
  return result;
}
/**
 * Marca como expiradas las solicitudes sin respuesta y aceptaciones sin pago que superaron su
 * plazo. Actualiza también las solicitudes invitadas vinculadas; puede escribir aunque la
 * invoque una consulta de disponibilidad.
 */
async function expire() {
  const now = Date.now();
  await db.prepare(`UPDATE bookings SET status='expirado' WHERE
    (status IN ('solicitado','gestion_skilly') AND response_deadline IS NOT NULL AND response_deadline<=?) OR
    (status='aceptado' AND payment_deadline IS NOT NULL AND payment_deadline<=?)`).run(now, now);
  await db.prepare(`UPDATE guest_requests SET status='expirada' WHERE booking_id IN (SELECT id FROM bookings WHERE status='expirado') AND status NOT IN ('descartada','expirada')`).run();
}
const inactive = new Set(['cancelado', 'rechazado', 'expirado']);
/**
 * Convierte una hora HH:mm en minutos desde medianoche para comparar la jornada y la dedicación
 * del servicio.
 */
function minutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
/**
 * Comprueba un horario futuro contra días disponibles, bloqueos, jornada, capacidad y reservas
 * de todos los servicios del profesional. Incluye preparación y seguimiento, permite excluir una
 * reserva al reprogramar y devuelve inicio, término e inicio de atención; lanza 409 ante
 * conflictos.
 */
async function available(pro, service, date, time, ignoreId) {
  await expire();
  const start = timestamp(date, time);
  if (start <= Date.now()) fail(409, 'Elige un horario futuro.');
  const weekday = DAYS[new Date(date + 'T12:00:00Z').getUTCDay()];
  const av = JSON.parse(pro.availability || '{}');
  if (!(av.days || []).includes(weekday) || !(av.hours || []).includes(time) || JSON.parse(pro.blocked_dates || '[]').includes(date)) fail(409, 'El profesional no está disponible ese día u horario.');
  const prep = Number(service.prepMinutes || 0),
    duration = Number(service.durationMinutes || 60),
    follow = Number(service.followupMinutes || 0);
  if (minutes(time) - prep < minutes(pro.work_start) || minutes(time) + duration + follow > minutes(pro.work_end)) fail(409, 'El servicio completo no cabe dentro de la jornada laboral.');
  const from = start - prep * 60000,
    until = start + (duration + follow) * 60000;
  if (from <= Date.now()) fail(409, 'La preparación del servicio debe comenzar en un horario futuro.');
  const rows = (await db.prepare('SELECT * FROM bookings WHERE professional_id=?').all(pro.id)).filter(/* Conserva los elementos según la condición b.id !== ignoreId && !inactive.has(b.status). Se evalúan los datos ya cargados. */ b => b.id !== ignoreId && !inactive.has(b.status));
  for (const b of rows) {
    let bs, be;
    try {
      bs = b.start_at || timestamp(b.date, b.time) - (b.prep_minutes || 0) * 60000;
      be = b.end_at || timestamp(b.date, b.time) + ((b.duration_minutes || 60) + (b.followup_minutes || 0)) * 60000;
    } catch {
      continue;
    }
    if (from < be && until > bs) fail(409, 'Ese horario ya está reservado, incluyendo preparación y seguimiento.');
  }
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  const monday = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 7);
  const nextMonday = d.toISOString().slice(0, 10);
  const checks = [[pro.max_per_day, rows.filter(/* Conserva los elementos según la condición b.date === date. Se evalúan los datos ya cargados. */ b => b.date === date).length], [pro.max_per_week, rows.filter(/* Conserva los elementos según la condición b.date >= monday && b.date < nextMonday. Se evalúan los datos ya cargados. */ b => b.date >= monday && b.date < nextMonday).length], [pro.max_per_month, rows.filter(/* Conserva los elementos según la condición b.date?.slice(0, 7) === date.slice(0, 7). Se evalúan los datos ya cargados. */ b => b.date?.slice(0, 7) === date.slice(0, 7)).length]];
  if (checks.some(/* Comprueba si existe algún elemento según la condición limit !== null && limit !== undefined && count >= limit. Se evalúan los datos ya cargados. */ ([limit, count]) => limit !== null && limit !== undefined && count >= limit)) fail(409, 'Se alcanzó la capacidad de atención del profesional.');
  return {
    start: from,
    end: until,
    appointment: start
  };
}
/**
 * Valida arreglos de días en español y horas HH:mm, elimina duplicados y ordena horarios.
 * Devuelve la disponibilidad normalizada; admite arreglos vacíos para no ofrecer horarios.
 */
function validateAvailability(a) {
  if (!a || !Array.isArray(a.days) || !Array.isArray(a.hours) || a.days.some(/* Comprueba si existe algún elemento según la condición !DAYS.includes(d). Se evalúan los datos ya cargados. */ d => !DAYS.includes(d)) || a.hours.some(/* Comprueba si existe algún elemento según la condición !/^([01]\d|2[0-3]):[0-5]\d$/.test(t). Se evalúan los datos ya cargados. */ t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) fail(400, 'Disponibilidad inválida.');
  return {
    days: [...new Set(a.days)],
    hours: [...new Set(a.hours)].sort()
  };
}
module.exports = {
  timestamp,
  localParts,
  expire,
  available,
  validateAvailability,
  inactive
};
