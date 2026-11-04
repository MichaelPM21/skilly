const {db,getSettings}=require('./db');
const S=require('./security');
const {wrap,text}=require('./accounts');
const {access,customer,listBookings}=require('./bookings');
const {expire}=require('./scheduling');
function paymentView(p) {return {id:p.id,bookingId:p.booking_id,professionalId:p.professional_id,professionalName:p.professional_name,orgName:p.org_name,orgEmail:p.org_email,amount:p.amount,method:p.method,status:p.status,invoiceNumber:p.invoice_number,createdAt:p.created_at,releasedAt:p.released_at,provider:p.provider,authorizationCode:p.authorization_code,cardLast4:p.card_last4,paymentTypeCode:p.payment_type_code,currency:p.currency,refundAmount:p.refund_amount};}
function prepare(req,provider) {
  expire();const b=access(req,req.body.bookingId);customer(req,b);
  if(b.status!=='aceptado'||b.paid_at)S.fail(409,'La reserva debe estar aceptada y dentro del plazo de pago.');
  if(db.prepare("SELECT 1 FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id))S.fail(409,'Resuelve el reclamo antes de pagar.');
  if(req.body.acceptTerms!==true)S.fail(400,'Debes aceptar las condiciones de contratación y cancelación.');
  if(db.prepare("SELECT 1 FROM payments WHERE booking_id=? AND status IN ('iniciado','procesando','revision','pagado','liberado')").get(b.id))S.fail(409,'Ya existe un pago para esta reserva. Si quedó pendiente, solicita su revisión a Skilly.');
  const id=S.id('pay');
  db.prepare(`INSERT INTO payments(id,booking_id,professional_id,professional_name,org_name,org_email,amount,method,status,provider,created_at,operation_key) VALUES(?,?,?,?,?,?,?,?,'iniciado',?,?,?)`)
    .run(id,b.id,b.professional_id,b.professional_name,b.org_name,b.org_email,b.amount,{webpay:'Webpay Plus',paypal:'PayPal',simulado:'Pago simulado'}[provider],provider,Date.now(),S.random());
  db.prepare('UPDATE bookings SET terms_accepted_at=?,terms_version=? WHERE id=?').run(Date.now(),require('./policies').policy(b)?.version||'2026-10-v1',b.id);
  return {b,id};
}
function settle(paymentId,details) {
  return db.transaction(()=>{
    const p=db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if(['pagado','liberado','reembolsado'].includes(p.status))return 'success';
    const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(p.booking_id);
    // A late successful charge must be reconciled; never resurrect an expired slot.
    const late=b.status!=='aceptado'||b.payment_deadline<=Date.now()||b.paid_at;
    db.prepare('UPDATE payments SET status=?,invoice_number=?,authorization_code=?,card_last4=?,payment_type_code=? WHERE id=?')
      .run(late?'revision':'pagado','SK-'+p.id.slice(4,16).toUpperCase(),details.authorization||'',details.card||'',details.type||'',p.id);
    if(!late)db.prepare("UPDATE bookings SET status='pagado',paid_at=? WHERE id=?").run(Date.now(),b.id);
    return late?'review':'success';
  }).immediate();
}
function paymentsRoutes(app) {
  const providers=()=>app.locals.providers||{webpay:require('./webpay'),paypal:require('./paypal')};
  const base=()=>process.env.BASE_URL||'http://localhost:3000';
  function paymentList(req,res){res.json(listBookings(req).flatMap(b=>db.prepare('SELECT * FROM payments WHERE booking_id=? ORDER BY created_at DESC').all(b.id).map(p=>{const v=paymentView(p);if(!b.paid_at&&!['admin','profesional'].includes(req.user?.role)){delete v.professionalName;delete v.professionalId;}return v;})));}
  app.get('/api/payments',wrap(paymentList));app.get('/api/admin/payments',wrap((req,res)=>{S.admin(req);paymentList(req,res);}));
  app.post('/api/payments',wrap((req,res)=>{
    if(process.env.NODE_ENV==='production')S.fail(403,'El pago simulado solo está disponible en pruebas.');
    const {id}=db.transaction(()=>prepare(req,'simulado')).immediate();settle(id,{authorization:'SIMULADO'});res.status(201).json(paymentView(db.prepare('SELECT * FROM payments WHERE id=?').get(id)));
  }));
  app.post('/api/payments/webpay/create',wrap(async(req,res)=>{
    const {b,id}=db.transaction(()=>prepare(req,'webpay')).immediate();
    try {
      const r=await providers().webpay.createTransaction({bookingId:id,amount:b.amount,returnUrl:base()+'/api/payments/webpay/commit'});
      db.prepare('UPDATE payments SET provider_token=?,buy_order=?,expected_amount=?,expected_currency=? WHERE id=?').run(r.token,r.buyOrder,b.amount,'CLP',id);
      res.json({url:r.url,token:r.token});
    }catch(err){db.prepare("UPDATE payments SET status='revision' WHERE id=?").run(id);S.fail(502,'No se pudo verificar la creación del pago. Skilly debe revisar el intento antes de repetirlo.');}
  }));
  app.all('/api/payments/webpay/commit',wrap(async(req,res)=>{
    const q=req.method==='GET'?req.query:req.body;const token=q.token_ws||q.TBK_TOKEN;
    const p=token&&db.prepare("SELECT * FROM payments WHERE provider_token=? AND provider='webpay'").get(token);
    const redirect=status=>res.redirect(base()+'/?payment='+status+(p?'&bookingId='+encodeURIComponent(p.booking_id):''));
    if(!p)return redirect('error');
    if(['pagado','liberado','reembolsado'].includes(p.status))return redirect('success');
    if(!q.token_ws){db.prepare("UPDATE payments SET status='rechazado' WHERE id=? AND status='iniciado'").run(p.id);return redirect('cancelled');}
    const lock=db.prepare("UPDATE payments SET status='procesando' WHERE id=? AND status IN ('iniciado','revision')").run(p.id);
    if(!lock.changes)return redirect('review');
    try {
      const r=await providers().webpay.commitTransaction(token);
      if(r.status!=='AUTHORIZED'||r.response_code!==0){db.prepare("UPDATE payments SET status='rechazado' WHERE id=?").run(p.id);return redirect('failed');}
      if(Number(r.amount)!==p.amount||r.buy_order!==p.buy_order){db.prepare("UPDATE payments SET status='revision' WHERE id=?").run(p.id);return redirect('review');}
      return redirect(settle(p.id,{authorization:r.authorization_code,card:r.card_detail?.card_number?.slice(-4),type:r.payment_type_code}));
    } catch {db.prepare("UPDATE payments SET status='revision' WHERE id=?").run(p.id);return redirect('review');}
  }));
  app.post('/api/payments/paypal/create-order',wrap(async(req,res)=>{
    if(!providers().paypal.isConfigured())S.fail(400,'PayPal no está configurado.');
    const {b,id}=db.transaction(()=>prepare(req,'paypal')).immediate();
    try {
      const r=await providers().paypal.createOrder({bookingId:b.id,amountClp:b.amount,returnUrl:base()+'/api/payments/paypal/capture',cancelUrl:base()+'/?payment=cancelled'});
      db.prepare("UPDATE payments SET provider_token=?,expected_amount=?,expected_currency='USD',currency='USD' WHERE id=?").run(r.orderId,r.usdAmount,id);
      res.json(r);
    }catch{db.prepare("UPDATE payments SET status='revision' WHERE id=?").run(id);S.fail(502,'No se pudo verificar la orden. Skilly debe revisar el intento antes de repetirlo.');}
  }));
  app.get('/api/payments/paypal/capture',wrap(async(req,res)=>{
    const token=String(req.query.token||''),p=db.prepare("SELECT * FROM payments WHERE provider_token=? AND provider='paypal'").get(token);
    const redirect=status=>res.redirect(base()+'/?payment='+status+(p?'&bookingId='+encodeURIComponent(p.booking_id):''));
    if(!p)return redirect('error');if(['pagado','liberado','reembolsado'].includes(p.status))return redirect('success');
    const lock=db.prepare("UPDATE payments SET status='procesando' WHERE id=? AND status IN ('iniciado','revision')").run(p.id);if(!lock.changes)return redirect('review');
    try {
      const r=await providers().paypal.captureOrder(token),unit=r.purchase_units?.[0],capture=unit?.payments?.captures?.[0];
      if(r.id!==token||r.status!=='COMPLETED'||capture?.status!=='COMPLETED'||unit.reference_id!==p.booking_id||Number(capture.amount?.value)!==p.expected_amount||capture.amount?.currency_code!==p.expected_currency){db.prepare("UPDATE payments SET status='revision' WHERE id=?").run(p.id);return redirect('review');}
      return redirect(settle(p.id,{authorization:capture.id}));
    }catch{db.prepare("UPDATE payments SET status='revision' WHERE id=?").run(p.id);return redirect('review');}
  }));
  app.post('/api/admin/payments/:id/reconcile',wrap(async(req,res)=>{
    S.admin(req);const p=db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);if(!p||!['iniciado','procesando','revision'].includes(p.status))S.fail(409,'Pago no pendiente.');
    if(p.provider==='webpay'&&p.provider_token){
      const result=await providers().webpay.statusTransaction(p.provider_token);
      if(result.status==='AUTHORIZED'&&result.response_code===0&&Number(result.amount)===p.amount&&result.buy_order===p.buy_order){res.json({status:settle(p.id,{authorization:result.authorization_code})});return;}
      if(['FAILED','REVERSED','NULLIFIED'].includes(result.status))db.prepare("UPDATE payments SET status='rechazado' WHERE id=?").run(p.id);
      else S.fail(409,'El proveedor todavía no confirma un resultado definitivo.');
    }else if(p.provider==='paypal'&&p.provider_token){
      const result=await providers().paypal.getOrder(p.provider_token),unit=result.purchase_units?.[0],capture=unit?.payments?.captures?.[0];
      if(result.id===p.provider_token&&result.status==='COMPLETED'&&capture?.status==='COMPLETED'&&unit.reference_id===p.booking_id&&Number(capture.amount?.value)===p.expected_amount&&capture.amount?.currency_code===p.expected_currency){res.json({status:settle(p.id,{authorization:capture.id})});return;}
      if(result.status==='VOIDED')db.prepare("UPDATE payments SET status='rechazado' WHERE id=?").run(p.id);else S.fail(409,'La orden sigue pendiente en PayPal.');
    }else S.fail(409,'No hay identificador del proveedor. Requiere conciliación externa antes de repetir el cobro.');
    S.audit(req,'payment_reconcile',p.id);res.json({ok:true});
  }));
  app.post('/api/admin/payments/:id/refund-late',wrap(async(req,res)=>{
    S.admin(req);const p=db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
    if(!p||p.status!=='revision'||!p.invoice_number||!p.authorization_code)S.fail(409,'Primero debe confirmarse el cobro con el proveedor.');
    const b=access(req,p.booking_id);if(b.paid_at)S.fail(409,'Gestiona la devolución desde la reserva pagada.');
    const lock=db.prepare("UPDATE payments SET status='reembolso_revision' WHERE id=? AND status='revision'").run(p.id);if(!lock.changes)S.fail(409,'Reembolso en proceso.');
    try {
      let result={};
      if(p.provider==='webpay'){result=await providers().webpay.refundTransaction(p.provider_token,p.amount);if(result.response_code!==undefined&&result.response_code!==0)throw new Error('Reembolso rechazado');}
      else if(p.provider==='paypal'){result=await providers().paypal.refundCapture(p.authorization_code,p.expected_amount,'late-'+p.id);if(result.status!=='COMPLETED')throw new Error('Reembolso pendiente');}
      else S.fail(400,'Proveedor no disponible.');
      db.prepare("UPDATE payments SET status='reembolsado',refund_amount=?,refund_id=?,refunded_at=? WHERE id=?").run(p.amount,result.id||'late-'+p.id,Date.now(),p.id);
      S.audit(req,'late_payment_refund',p.id,String(p.amount));res.json({ok:true});
    }catch{db.prepare("INSERT INTO refund_operations(id,booking_id,payment_id,amount,percent,reason,status,created_at,kind) VALUES(?,?,?,?,100,'Cobro tardío','revision',?,'tardio')").run(S.id('ref'),b.id,p.id,p.amount,Date.now());S.fail(502,'El reembolso requiere conciliación externa. No se repetirá automáticamente.');}
  }));
  require('./settlements').routes(app);
  app.post('/api/admin/bookings/:id/release',wrap((req,res)=>{
    S.admin(req);db.transaction(()=>{
      const b=access(req,req.params.id);if(b.status!=='confirmado'||b.cancellation_status)S.fail(409,'Falta la conformidad del cliente o hay una cancelación pendiente.');
      if(db.prepare("SELECT 1 FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id))S.fail(409,'Resuelve las incidencias antes de liberar.');
      const payment=db.prepare("SELECT * FROM payments WHERE booking_id=? AND status='pagado'").get(b.id);
      if(!payment||payment.provider!=='simulado'||process.env.NODE_ENV==='production')S.fail(409,'Utiliza la liquidación real con comprobante para este pago.');
      db.prepare("UPDATE payments SET status='liberado',released_at=? WHERE booking_id=? AND status='pagado'").run(Date.now(),b.id);
      db.prepare("UPDATE bookings SET status='completado' WHERE id=?").run(b.id);S.audit(req,'simulated_payout',b.id,String(b.professional_net));
    }).immediate();res.json({ok:true,message:'Liquidación simulada registrada. No se realizó una transferencia bancaria.'});
  }));
}
module.exports={paymentsRoutes,paymentView,settle};
