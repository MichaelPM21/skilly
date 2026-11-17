/**
 * Flujo del módulo. Cálculos puros de presentación compartidos por el navegador y pruebas Node.
 * Distingue estados de servicio y de pago y no modifica los snapshots financieros de la reserva.
 */

/* Shared presentation rules. They never change the contractual financial snapshot. */
(function (root) {
  // Encapsula las reglas puras de presentación y las exporta para Node o como SkillyView en el navegador.
  
  const terminal = new Set(['completado', 'cancelado', 'rechazado', 'expirado']);
  /**
   * Convierte un valor a número finito o cero para cálculos de presentación. No modifica los
   * importes contractuales almacenados.
   */
  const money = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  /**
   * Calcula solicitudes pendientes, próximas reservas, neto pendiente, gasto menos devoluciones y
   * completadas. Excluye cancelaciones en conciliación del neto pendiente; no prueba
   * transferencias bancarias.
   */
  function metrics(bookings, now = Date.now()) {
    return {
      pending: bookings.filter(/* Conserva los elementos según la condición ['solicitado', 'gestion_skilly'].includes(b.status). Se evalúan los datos ya cargados. */ b => ['solicitado', 'gestion_skilly'].includes(b.status)).length,
      upcoming: bookings.filter(/* Conserva los elementos según la condición ['aceptado', 'pagado'].includes(b.status) && Number(b.startAt) > now. Se evalúan los datos ya cargados. */ b => ['aceptado', 'pagado'].includes(b.status) && Number(b.startAt) > now).length,
      pendingNet: bookings.filter(/* Conserva los elementos según la condición b.paidAt && ['pagado', 'entregado', 'confirmado'].includes(b.status) && !b.cancellationStatus. Se evalúan los datos ya cargados. */ b => b.paidAt && ['pagado', 'entregado', 'confirmado'].includes(b.status) && !b.cancellationStatus)
        .reduce(/* Acumula el neto contractual de las reservas seleccionadas para el indicador del profesional. */ (sum, b) => sum + money(b.professionalNet), 0),
      paidNet: bookings.filter(/* Conserva los elementos según la condición b.paidAt. Se evalúan los datos ya cargados. */ b => b.paidAt).reduce(/* Acumula el importe pagado menos devoluciones, sin restar más que el total de cada reserva. */ (sum, b) => sum + Math.max(0, money(b.amount) - money(b.refundAmount)), 0),
      completed: bookings.filter(/* Conserva los elementos según la condición b.status === 'completado'. Se evalúan los datos ya cargados. */ b => b.status === 'completado').length
    };
  }
  /**
   * Devuelve pares etiqueta/importe según el estado: para cancelaciones muestra devolución y
   * remanente pendiente, para conciliación indica suspensión y para otras reservas muestra
   * comisión y neto acordados.
   */
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
  /**
   * Traduce estados de pago a etiquetas financieras sin confundirlos con entrega o avance del
   * servicio.
   */
  function paymentLabel(status) {
    return ({ iniciado:'Pago iniciado', procesando:'Pago en proceso', revision:'Pago en revisión',
      pagado:'Pago confirmado', liberado:'Pago liquidado', reembolsado:'Devolución registrada',
      rechazado:'Pago rechazado' })[status] || status;
  }
  const api = { metrics, financialLines, paymentLabel, /* Indica si una reserva está completada, cancelada, rechazada o expirada para agruparla en el historial. */ isTerminal: b => terminal.has(b.status) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SkillyView = api;
})(typeof window !== 'undefined' ? window : globalThis);
