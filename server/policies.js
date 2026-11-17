/**
 * Flujo del módulo. Reglas congeladas por reserva. Distingue devolución voluntaria, tolerancia y
 * plazos; el incumplimiento profesional confirmado se aplica desde settlements/governance. Son
 * reglas del producto codificadas, no una validación jurídica.
 */

const HOUR = 3600000;
const VERSION = '2026-10-v2';
// El tramo tardío conserva el porcentaje configurable; no se inventa una multa adicional.
/**
 * Construye la política que se guarda con cada nueva reserva: devolución temprana de 100% con 48
 * horas, tramo tardío configurable, tolerancia y plazos de reclamo. Congela valores para que
 * cambios futuros no alteren lo acordado.
 */
function snapshot(settings) {
  return {version:VERSION,earlyHours:48,earlyRefund:100,lateRefund:settings.default_cancellation_refund_percent,
    toleranceMinutes:15,responseBusinessDays:1,resolutionBusinessDays:2,claimDays:30,
    retentionDestination:'pendiente_acuerdo',confirmationDays:3};
}
/**
 * Deserializa policy_snapshot de la reserva y devuelve null si no existe. Las reservas antiguas
 * sin versión utilizan los campos heredados para calcular devoluciones.
 */
function policy(b) { return JSON.parse(b.policy_snapshot || 'null'); }
/**
 * Calcula la devolución voluntaria usando el inicio de la dedicación, que incluye preparación.
 * Aplica el tramo temprano o tardío guardado y conserva refund_policy_percent para reservas sin
 * política versionada.
 */
function refundPercent(b,now=Date.now()) {
  const p=policy(b);
  return p && b.start_at-now>=p.earlyHours*HOUR ? p.earlyRefund : p?.lateRefund??b.refund_policy_percent;
}
/**
 * Avanza el número indicado de días excluyendo sábados y domingos según America/Santiago.
 * Devuelve milisegundos Unix; no consulta feriados y conserva el avance horario UTC del Date.
 */
function businessDeadline(days,now=Date.now()) {
  const d=new Date(now);
  while(days>0){d.setUTCDate(d.getUTCDate()+1);const day=new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',weekday:'short'}).format(d);if(!['Sat','Sun'].includes(day))days--;}
  return d.getTime();
}
module.exports={VERSION,HOUR,snapshot,policy,refundPercent,businessDeadline};
