/**
 * Flujo del módulo. Devoluciones y liquidación externa. Cancelar registra primero una operación,
 * luego llama al proveedor y concilia su resultado. Una orden de payout registra trabajo
 * administrativo: la transferencia bancaria se realiza fuera de Skilly.
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
const {
  refundPercent
} = require('./policies');
const notify = require('./notifications');
/**
 * Registra de forma atómica una devolución ya confirmada, actualiza pago y notificaciones y,
 * salvo cobros tardíos, cancela la reserva. Guarda el remanente como pendiente de acuerdo, sin
 * convertirlo automáticamente en comisión o liquidación.
 */
async function finish(op, reference) {
  await db.transaction(async () => {
    // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
    
    const b = await db.prepare('SELECT * FROM bookings WHERE id=?').get(op.booking_id);
    await db.prepare("UPDATE refund_operations SET status='completado',reference=? WHERE id=?").run(reference, op.id);
    if (op.kind !== 'tardio') await db.prepare("UPDATE bookings SET status='cancelado',refund_amount=?,refund_percent=?,cancelled_at=?,cancel_reason=?,cancellation_status=NULL,retained_amount=?,retention_destination=? WHERE id=?").run(op.amount, op.percent, Date.now(), op.reason, op.payment_id ? Math.max(0, b.amount - op.amount) : 0, op.payment_id && op.amount < b.amount ? 'pendiente_acuerdo' : 'sin_retencion', b.id);
    if (op.payment_id) await db.prepare("UPDATE payments SET status='reembolsado',refund_amount=?,refund_id=?,refunded_at=? WHERE id=?").run(op.amount, reference, Date.now(), op.payment_id);
    await notify.booking(b, 'Cancelación y devolución registradas', `${b.id}: devolución ${op.amount} CLP. Motivo: ${op.reason}`, 'refund:' + op.id);
  }).immediate();
}
/**
 * Registra cotización de cancelación, devolución y conciliación manual, además de órdenes y
 * confirmaciones de transferencias externas. Valida conformidad, reclamos, importe y
 * comprobante; registrar una transferencia no la ejecuta en el banco.
 *
 * @param {import("express").Express} app - Aplicación pública o administrativa que recibe los manejadores HTTP.
 * @returns {void} Registra rutas y middleware en app; no inicia el servidor.
 * @example
 * // Durante la construcción de la aplicación Express:
 * routes(app);
 */
function routes(app) {
  /**
   * GET /api/bookings/:id/cancellation-quote. Devuelve porcentaje y monto de devolución voluntaria
   * calculados con la política guardada y el momento actual. No cancela ni garantiza que la
   * operación esté habilitada.
   */
  app.get('/api/bookings/:id/cancellation-quote', wrap(async (req, res) => {
    const b = await access(req, req.params.id);
    res.json({
      percent: refundPercent(b),
      amount: b.paid_at ? Math.round(b.amount * refundPercent(b) / 100) : 0
    });
  }));
  /**
   * POST /api/bookings/:id/cancel. Valida actor, estado, casos y operaciones pendientes; fija
   * monto y registra una devolución en proceso bajo transacción. Llama al proveedor fuera de ella
   * y confirma con finish o bloquea para conciliación; incumplimiento profesional aprobado fuerza
   * devolución total.
   */
  app.post('/api/bookings/:id/cancel', wrap(async (req, res) => {
    let op, payment;
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const b = await access(req, req.params.id),
        admin = req.user.role === 'admin';
      if (admin) S.admin(req);else await customer(req, b);
      if (b.cancellation_status || (await db.prepare("SELECT 1 FROM payouts WHERE booking_id=? AND status='pendiente_transferencia'").get(b.id))) S.fail(409, 'Hay una operación pendiente de conciliación.');
      if (['cancelado', 'rechazado', 'expirado'].includes(b.status)) S.fail(409, 'La reserva ya está cerrada.');
      const i = await db.prepare("SELECT * FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id);
      if (!admin && (i || ['entregado', 'confirmado', 'completado'].includes(b.status))) S.fail(409, 'Solicita la devolución desde un reclamo para que Skilly revise la prestación.');
      if (admin && ['entregado', 'confirmado', 'completado'].includes(b.status) && !i) S.fail(409, 'Abre y documenta un reclamo antes de devolver una prestación entregada.');
      if (await db.prepare("SELECT 1 FROM payments WHERE booking_id=? AND status IN ('iniciado','procesando','revision')").get(b.id)) S.fail(409, 'Concilia primero el pago pendiente.');
      payment = await db.prepare("SELECT * FROM payments WHERE booking_id=? AND status IN ('pagado','liberado')").get(b.id);
      if (b.paid_at && !payment) S.fail(409, 'No hay saldo reembolsable; revisa los pagos.');
      let pct = refundPercent(b);
      if (admin && i) {
        if (i.status !== 'pendiente_accion' || !['reembolso_total', 'incumplimiento_profesional', 'reembolso_parcial'].includes(i.outcome)) S.fail(409, 'Registra primero la decisión de devolución en el reclamo.');
        pct = i.outcome === 'reembolso_parcial' ? require('./services').percent(req.body.refundPercent) : 100;
      } else if (admin && req.body.refundPercent !== undefined) pct = require('./services').percent(req.body.refundPercent);
      const reason = text(req.body.reason || '', 2000);
      if (!reason) S.fail(400, 'Indica el motivo.');
      op = {
        id: S.id('ref'),
        booking_id: b.id,
        payment_id: payment?.id || null,
        amount: payment ? Math.round(payment.amount * pct / 100) : 0,
        percent: pct,
        reason
      };
      await db.prepare("INSERT INTO refund_operations(id,booking_id,payment_id,amount,percent,reason,status,created_at) VALUES(?,?,?,?,?,?,'procesando',?)").run(op.id, b.id, op.payment_id, op.amount, pct, reason, Date.now());
      await db.prepare("UPDATE bookings SET cancellation_status='procesando',cancelled_by=? WHERE id=?").run(req.user.role, b.id);
    }).immediate();
    try {
      let result = {
        id: op.id
      };
      const providers = app.locals.providers || {
        webpay: require('./webpay'),
        paypal: require('./paypal')
      };
      if (payment && op.amount > 0) {
        if (payment.provider === 'webpay') {
          result = await providers.webpay.refundTransaction(payment.provider_token, op.amount);
          if (result.response_code !== undefined && result.response_code !== 0) throw new Error('Rechazado');
        } else if (payment.provider === 'paypal') {
          result = await providers.paypal.refundCapture(payment.authorization_code, Math.round(payment.expected_amount * op.amount / payment.amount * 100) / 100, op.id);
          if (result.status !== 'COMPLETED') throw new Error('Pendiente');
        } else if (payment.provider !== 'simulado') throw new Error('Proveedor desconocido');
      }
      await finish(op, result.id || op.id);
      await S.audit(req, 'refund_completed', op.id, String(op.amount));
      res.json({
        ok: true,
        refundAmount: op.amount
      });
    } catch {
      await db.transaction(async () => {
        // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
        
        await db.prepare("UPDATE refund_operations SET status='revision' WHERE id=?").run(op.id);
        await db.prepare("UPDATE bookings SET cancellation_status='revision' WHERE id=?").run(op.booking_id);
      }).immediate();
      S.fail(502, 'Devolución pendiente de conciliación. No se repetirá el cobro ni la devolución automáticamente.');
    }
  }));
  /**
   * POST /api/admin/refunds/:id/reconcile. Registra evidencia y referencia verificadas de una
   * devolución incierta. Confirma con finish o marca no_ejecutado y desbloquea según el tipo; no
   * vuelve a llamar al proveedor.
   */
  app.post('/api/admin/refunds/:id/reconcile', wrap(async (req, res) => {
    S.admin(req);
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const op = await db.prepare("SELECT * FROM refund_operations WHERE id=? AND status='revision'").get(req.params.id);
      if (!op) S.fail(409, 'Operación no pendiente.');
      const reference = text(req.body.reference || '', 200),
        evidence = text(req.body.evidence || '', 4000);
      if (!reference || !evidence) S.fail(400, 'Registra referencia y evidencia verificada con el proveedor.');
      if (!['confirmado', 'no_ejecutado'].includes(req.body.result)) S.fail(400, 'Resultado inválido.');
      await db.prepare('UPDATE refund_operations SET evidence=?,reference=? WHERE id=?').run(evidence, reference, op.id);
      if (req.body.result === 'confirmado') await finish(op, reference);else {
        if (op.kind === 'tardio') await db.prepare("UPDATE payments SET status='revision' WHERE id=?").run(op.payment_id);
        await db.prepare("UPDATE refund_operations SET status='no_ejecutado' WHERE id=?").run(op.id);
        await db.prepare('UPDATE bookings SET cancellation_status=NULL WHERE id=?').run(op.booking_id);
      }
      await S.audit(req, 'refund_external_reconciliation', op.id, JSON.stringify(req.body));
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/admin/bookings/:id/payout. Crea una única orden de transferencia externa por el neto
   * contractual si hay pago no simulado, conformidad y ausencia de casos o cancelaciones. No
   * inicia un movimiento bancario.
   */
  app.post('/api/admin/bookings/:id/payout', wrap(async (req, res) => {
    S.admin(req);
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const b = await access(req, req.params.id);
      if (b.status !== 'confirmado' || b.cancellation_status || (await db.prepare("SELECT 1 FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id))) S.fail(409, 'Falta conformidad o hay un reclamo/cancelación pendiente.');
      const p = await db.prepare("SELECT * FROM payments WHERE booking_id=? AND status='pagado'").get(b.id);
      if (!p || p.provider === 'simulado') S.fail(409, 'Se requiere un cobro real confirmado.');
      if (await db.prepare('SELECT 1 FROM payouts WHERE booking_id=?').get(b.id)) S.fail(409, 'Ya existe una liquidación. Revisa la operación registrada.');
      await db.prepare("INSERT INTO payouts(id,booking_id,amount,status,created_at) VALUES(?,?,?,'pendiente_transferencia',?)").run(S.id('out'), b.id, b.professional_net, Date.now());
      await S.audit(req, 'payout_prepared', b.id, String(b.professional_net));
    }).immediate();
    res.json({
      ok: true,
      message: 'Orden registrada. Realiza y verifica la transferencia fuera de Skilly antes de confirmarla.'
    });
  }));
  /**
   * POST /api/admin/payouts/:id/confirm. Exige orden pendiente, importe exacto, referencia
   * bancaria única y adjunto de esa reserva. Registra la transferencia externa verificada,
   * completa la reserva y marca el pago liberado.
   */
  app.post('/api/admin/payouts/:id/confirm', wrap(async (req, res) => {
    S.admin(req);
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const p = await db.prepare("SELECT * FROM payouts WHERE id=? AND status='pendiente_transferencia'").get(req.params.id);
      if (!p) S.fail(409, 'Liquidación no pendiente.');
      const b = await access(req, p.booking_id);
      if (b.cancellation_status || b.status !== 'confirmado' || (await db.prepare("SELECT 1 FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id))) S.fail(409, 'Resuelve el reclamo antes de confirmar. Si ya transferiste, concilia el caso con Skilly.');
      const reference = text(req.body.reference || '', 200),
        a = await db.prepare('SELECT id FROM attachments WHERE id=? AND booking_id=?').get(req.body.evidenceId || '', b.id);
      if (!reference || !a || Number(req.body.amount) !== p.amount) S.fail(400, 'Indica referencia bancaria, monto exacto y documento adjunto de esta reserva.');
      if (await db.prepare('SELECT 1 FROM payouts WHERE reference=?').get(reference)) S.fail(409, 'Referencia bancaria ya registrada.');
      await db.prepare("UPDATE payouts SET status='transferido',reference=?,evidence_id=?,confirmed_at=? WHERE id=?").run(reference, a.id, Date.now(), p.id);
      await db.prepare("UPDATE payments SET status='liberado',released_at=? WHERE booking_id=? AND status='pagado'").run(Date.now(), b.id);
      await db.prepare("UPDATE bookings SET status='completado' WHERE id=?").run(b.id);
      await S.audit(req, 'external_payout_confirmed', p.id, reference);
      await notify.booking(b, 'Transferencia externa registrada', `${b.id}: ${p.amount} CLP. Referencia ${reference}.`);
    }).immediate();
    res.json({
      ok: true
    });
  }));
  /**
   * POST /api/admin/payouts/:id/void. Elimina una orden todavía pendiente solo con evidencia de
   * que no se transfirió y deja auditoría. No anula una transferencia bancaria realizada.
   */
  app.post('/api/admin/payouts/:id/void', wrap(async (req, res) => {
    S.admin(req);
    const evidence = text(req.body.evidence || '', 4000);
    if (!evidence) S.fail(400, 'Documenta la confirmación bancaria de que no se transfirió.');
    await db.transaction(async () => {
      // Agrupa las comprobaciones y escrituras de esta operación en una transacción: confirma al terminar o revierte ante un error. Las llamadas anidadas usan un SAVEPOINT.
      
      const p = await db.prepare("SELECT * FROM payouts WHERE id=? AND status='pendiente_transferencia'").get(req.params.id);
      if (!p) S.fail(409, 'Orden no pendiente.');
      await db.prepare('DELETE FROM payouts WHERE id=?').run(p.id);
      await S.audit(req, 'payout_not_executed', p.booking_id, evidence);
    }).immediate();
    res.json({
      ok: true
    });
  }));
}
module.exports = {
  routes
};
