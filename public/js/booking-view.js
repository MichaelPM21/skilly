/* Shared presentation rules. They never change the contractual financial snapshot. */
(function (root) {
  const terminal = new Set(['completado', 'cancelado', 'rechazado', 'expirado']);
  const money = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  function metrics(bookings, now = Date.now()) {
    return {
      pending: bookings.filter(b => ['solicitado', 'gestion_skilly'].includes(b.status)).length,
      upcoming: bookings.filter(b => ['aceptado', 'pagado'].includes(b.status) && Number(b.startAt) > now).length,
      pendingNet: bookings.filter(b => b.paidAt && ['pagado', 'entregado', 'confirmado'].includes(b.status) && !b.cancellationStatus)
        .reduce((sum, b) => sum + money(b.professionalNet), 0),
      paidNet: bookings.filter(b => b.paidAt).reduce((sum, b) => sum + Math.max(0, money(b.amount) - money(b.refundAmount)), 0),
      completed: bookings.filter(b => b.status === 'completado').length
    };
  }
  function financialLines(b) {
    if (b.status === 'cancelado') return [
      ['Devolución registrada', money(b.refundAmount)],
      ['Retención pendiente de acuerdo (no liquidada)', money(b.retainedAmount)]
    ];
    if (b.cancellationStatus) return [['Liquidación suspendida: cancelación en conciliación', null]];
    return [
      ['Comisión acordada (' + money(b.commissionPercent) + ' %)', money(b.commissionAmount)],
      [b.status === 'completado' ? 'Neto liquidado registrado' : 'Neto acordado para el servicio', money(b.professionalNet)]
    ];
  }
  function paymentLabel(status) {
    return ({ iniciado:'Pago iniciado', procesando:'Pago en proceso', revision:'Pago en revisión',
      pagado:'Pago confirmado', liberado:'Pago liquidado', reembolsado:'Devolución registrada',
      rechazado:'Pago rechazado' })[status] || status;
  }
  const api = { metrics, financialLines, paymentLabel, isTerminal: b => terminal.has(b.status) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SkillyView = api;
})(typeof window !== 'undefined' ? window : globalThis);
