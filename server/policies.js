const HOUR = 3600000;
const VERSION = '2026-10-v2';
// El tramo tardío conserva el porcentaje configurable; no se inventa una multa adicional.
function snapshot(settings) {
  return {version:VERSION,earlyHours:48,earlyRefund:100,lateRefund:settings.default_cancellation_refund_percent,
    toleranceMinutes:15,responseBusinessDays:1,resolutionBusinessDays:2,claimDays:30,
    retentionDestination:'pendiente_acuerdo',confirmationDays:3};
}
function policy(b) { return JSON.parse(b.policy_snapshot || 'null'); }
function refundPercent(b,now=Date.now()) {
  const p=policy(b);
  return p && b.start_at-now>=p.earlyHours*HOUR ? p.earlyRefund : p?.lateRefund??b.refund_policy_percent;
}
function businessDeadline(days,now=Date.now()) {
  const d=new Date(now);
  while(days>0){d.setUTCDate(d.getUTCDate()+1);const day=new Intl.DateTimeFormat('en-US',{timeZone:'America/Santiago',weekday:'short'}).format(d);if(!['Sat','Sun'].includes(day))days--;}
  return d.getTime();
}
module.exports={VERSION,HOUR,snapshot,policy,refundPercent,businessDeadline};
