const {db}=require('./db');
const S=require('./security');
const {wrap,text}=require('./accounts');
const {access,customer}=require('./bookings');
const {refundPercent}=require('./policies');
const notify=require('./notifications');
function finish(op,reference){
  db.transaction(()=>{
    const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(op.booking_id);
    db.prepare("UPDATE refund_operations SET status='completado',reference=? WHERE id=?").run(reference,op.id);
    if(op.kind!=='tardio')db.prepare("UPDATE bookings SET status='cancelado',refund_amount=?,refund_percent=?,cancelled_at=?,cancel_reason=?,cancellation_status=NULL,retained_amount=?,retention_destination=? WHERE id=?")
      .run(op.amount,op.percent,Date.now(),op.reason,op.payment_id?Math.max(0,b.amount-op.amount):0,op.payment_id&&op.amount<b.amount?'pendiente_acuerdo':'sin_retencion',b.id);
    if(op.payment_id)db.prepare("UPDATE payments SET status='reembolsado',refund_amount=?,refund_id=?,refunded_at=? WHERE id=?").run(op.amount,reference,Date.now(),op.payment_id);
    notify.booking(b,'Cancelación y devolución registradas',`${b.id}: devolución ${op.amount} CLP. Motivo: ${op.reason}`,'refund:'+op.id);
  }).immediate();
}
function routes(app){
  app.get('/api/bookings/:id/cancellation-quote',wrap((req,res)=>{const b=access(req,req.params.id);res.json({percent:refundPercent(b),amount:b.paid_at?Math.round(b.amount*refundPercent(b)/100):0});}));
  app.post('/api/bookings/:id/cancel',wrap(async(req,res)=>{
    let op,payment;
    db.transaction(()=>{
      const b=access(req,req.params.id),admin=req.user.role==='admin';if(admin)S.admin(req);else customer(req,b);
      if(b.cancellation_status||db.prepare("SELECT 1 FROM payouts WHERE booking_id=? AND status='pendiente_transferencia'").get(b.id))S.fail(409,'Hay una operación pendiente de conciliación.');
      if(['cancelado','rechazado','expirado'].includes(b.status))S.fail(409,'La reserva ya está cerrada.');
      const i=db.prepare("SELECT * FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id);
      if(!admin&&(i||['entregado','confirmado','completado'].includes(b.status)))S.fail(409,'Solicita la devolución desde un reclamo para que Skilly revise la prestación.');
      if(admin&&['entregado','confirmado','completado'].includes(b.status)&&!i)S.fail(409,'Abre y documenta un reclamo antes de devolver una prestación entregada.');
      if(db.prepare("SELECT 1 FROM payments WHERE booking_id=? AND status IN ('iniciado','procesando','revision')").get(b.id))S.fail(409,'Concilia primero el pago pendiente.');
      payment=db.prepare("SELECT * FROM payments WHERE booking_id=? AND status IN ('pagado','liberado')").get(b.id);
      if(b.paid_at&&!payment)S.fail(409,'No hay saldo reembolsable; revisa los pagos.');
      let pct=refundPercent(b);
      if(admin&&i){if(i.status!=='pendiente_accion'||!['reembolso_total','incumplimiento_profesional','reembolso_parcial'].includes(i.outcome))S.fail(409,'Registra primero la decisión de devolución en el reclamo.');pct=i.outcome==='reembolso_parcial'?require('./services').percent(req.body.refundPercent):100;}
      else if(admin&&req.body.refundPercent!==undefined)pct=require('./services').percent(req.body.refundPercent);
      const reason=text(req.body.reason||'',2000);if(!reason)S.fail(400,'Indica el motivo.');
      op={id:S.id('ref'),booking_id:b.id,payment_id:payment?.id||'',amount:payment?Math.round(payment.amount*pct/100):0,percent:pct,reason};
      db.prepare("INSERT INTO refund_operations(id,booking_id,payment_id,amount,percent,reason,status,created_at) VALUES(?,?,?,?,?,?,'procesando',?)").run(op.id,b.id,op.payment_id,op.amount,pct,reason,Date.now());
      db.prepare("UPDATE bookings SET cancellation_status='procesando',cancelled_by=? WHERE id=?").run(req.user.role,b.id);
    }).immediate();
    try{
      let result={id:op.id};const providers=app.locals.providers||{webpay:require('./webpay'),paypal:require('./paypal')};
      if(payment&&op.amount>0){
        if(payment.provider==='webpay'){result=await providers.webpay.refundTransaction(payment.provider_token,op.amount);if(result.response_code!==undefined&&result.response_code!==0)throw new Error('Rechazado');}
        else if(payment.provider==='paypal'){result=await providers.paypal.refundCapture(payment.authorization_code,Math.round(payment.expected_amount*op.amount/payment.amount*100)/100,op.id);if(result.status!=='COMPLETED')throw new Error('Pendiente');}
        else if(payment.provider!=='simulado')throw new Error('Proveedor desconocido');
      }
      finish(op,result.id||op.id);S.audit(req,'refund_completed',op.id,String(op.amount));res.json({ok:true,refundAmount:op.amount});
    }catch{db.transaction(()=>{db.prepare("UPDATE refund_operations SET status='revision' WHERE id=?").run(op.id);db.prepare("UPDATE bookings SET cancellation_status='revision' WHERE id=?").run(op.booking_id);}).immediate();S.fail(502,'Devolución pendiente de conciliación. No se repetirá el cobro ni la devolución automáticamente.');}
  }));
  app.post('/api/admin/refunds/:id/reconcile',wrap((req,res)=>{S.admin(req);db.transaction(()=>{
    const op=db.prepare("SELECT * FROM refund_operations WHERE id=? AND status='revision'").get(req.params.id);if(!op)S.fail(409,'Operación no pendiente.');
    const reference=text(req.body.reference||'',200),evidence=text(req.body.evidence||'',4000);if(!reference||!evidence)S.fail(400,'Registra referencia y evidencia verificada con el proveedor.');
    if(!['confirmado','no_ejecutado'].includes(req.body.result))S.fail(400,'Resultado inválido.');
    db.prepare('UPDATE refund_operations SET evidence=?,reference=? WHERE id=?').run(evidence,reference,op.id);
    if(req.body.result==='confirmado')finish(op,reference);
    else {if(op.kind==='tardio')db.prepare("UPDATE payments SET status='revision' WHERE id=?").run(op.payment_id);db.prepare("UPDATE refund_operations SET status='no_ejecutado' WHERE id=?").run(op.id);db.prepare('UPDATE bookings SET cancellation_status=NULL WHERE id=?').run(op.booking_id);}
    S.audit(req,'refund_external_reconciliation',op.id,JSON.stringify(req.body));
  }).immediate();res.json({ok:true});}));
  app.post('/api/admin/bookings/:id/payout',wrap((req,res)=>{S.admin(req);db.transaction(()=>{
    const b=access(req,req.params.id);if(b.status!=='confirmado'||b.cancellation_status||db.prepare("SELECT 1 FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id))S.fail(409,'Falta conformidad o hay un reclamo/cancelación pendiente.');
    const p=db.prepare("SELECT * FROM payments WHERE booking_id=? AND status='pagado'").get(b.id);if(!p||p.provider==='simulado')S.fail(409,'Se requiere un cobro real confirmado.');
    if(db.prepare('SELECT 1 FROM payouts WHERE booking_id=?').get(b.id))S.fail(409,'Ya existe una liquidación. Revisa la operación registrada.');
    db.prepare("INSERT INTO payouts(id,booking_id,amount,status,created_at) VALUES(?,?,?,'pendiente_transferencia',?)").run(S.id('out'),b.id,b.professional_net,Date.now());S.audit(req,'payout_prepared',b.id,String(b.professional_net));
  }).immediate();res.json({ok:true,message:'Orden registrada. Realiza y verifica la transferencia fuera de Skilly antes de confirmarla.'});}));
  app.post('/api/admin/payouts/:id/confirm',wrap((req,res)=>{S.admin(req);db.transaction(()=>{
    const p=db.prepare("SELECT * FROM payouts WHERE id=? AND status='pendiente_transferencia'").get(req.params.id);if(!p)S.fail(409,'Liquidación no pendiente.');const b=access(req,p.booking_id);
    if(b.cancellation_status||b.status!=='confirmado'||db.prepare("SELECT 1 FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id))S.fail(409,'Resuelve el reclamo antes de confirmar. Si ya transferiste, concilia el caso con Skilly.');
    const reference=text(req.body.reference||'',200),a=db.prepare('SELECT id FROM attachments WHERE id=? AND booking_id=?').get(req.body.evidenceId||'',b.id);
    if(!reference||!a||Number(req.body.amount)!==p.amount)S.fail(400,'Indica referencia bancaria, monto exacto y documento adjunto de esta reserva.');
    if(db.prepare('SELECT 1 FROM payouts WHERE reference=?').get(reference))S.fail(409,'Referencia bancaria ya registrada.');
    db.prepare("UPDATE payouts SET status='transferido',reference=?,evidence_id=?,confirmed_at=? WHERE id=?").run(reference,a.id,Date.now(),p.id);
    db.prepare("UPDATE payments SET status='liberado',released_at=? WHERE booking_id=? AND status='pagado'").run(Date.now(),b.id);db.prepare("UPDATE bookings SET status='completado' WHERE id=?").run(b.id);
    S.audit(req,'external_payout_confirmed',p.id,reference);notify.booking(b,'Transferencia externa registrada',`${b.id}: ${p.amount} CLP. Referencia ${reference}.`);
  }).immediate();res.json({ok:true});}));
  app.post('/api/admin/payouts/:id/void',wrap((req,res)=>{S.admin(req);const evidence=text(req.body.evidence||'',4000);if(!evidence)S.fail(400,'Documenta la confirmación bancaria de que no se transfirió.');db.transaction(()=>{const p=db.prepare("SELECT * FROM payouts WHERE id=? AND status='pendiente_transferencia'").get(req.params.id);if(!p)S.fail(409,'Orden no pendiente.');db.prepare('DELETE FROM payouts WHERE id=?').run(p.id);S.audit(req,'payout_not_executed',p.booking_id,evidence);}).immediate();res.json({ok:true});}));
}
module.exports={routes};
