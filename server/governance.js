const {db}=require('./db');
const S=require('./security');
const {wrap,text}=require('./accounts');
const {access,customer}=require('./bookings');
const P=require('./policies');
const notify=require('./notifications');
const categories=['inasistencia_profesional','abandono','cancelacion_profesional','inasistencia_cliente','calidad','fuerza_mayor','otro'];
function required(value,label){const result=text(value||'',4000);if(!result)S.fail(400,label);return result;}
function event(id,req,kind,body){db.prepare('INSERT INTO case_events VALUES(?,?,?,?,?,?)').run(S.id('evt'),id,req.user?.id||'system',kind,body,Date.now());}
function incident(req,id){const i=db.prepare('SELECT * FROM incidents WHERE id=?').get(id);if(!i)S.fail(404,'Reclamo no encontrado.');access(req,i.booking_id);return i;}
function createIncident(req,b,category,body,evidence='',remedy='revision') {
  if(db.prepare("SELECT 1 FROM incidents WHERE booking_id=? AND status<>'resuelta'").get(b.id))S.fail(409,'Ya existe un reclamo abierto. Agrega tu respuesta al caso.');
  const id=S.id('inc');
  db.prepare('INSERT INTO incidents(id,booking_id,author_id,body,created_at,category,evidence,requested_remedy,response_due,resolution_due) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id,b.id,req.user?.id||null,body,Date.now(),category,evidence,remedy,P.businessDeadline(1),P.businessDeadline(2));
  event(id,req,'apertura',body);notify.booking(b,'Reclamo abierto en Skilly',`${b.id}: ${body}. Responde desde la reserva. La liquidación queda bloqueada.`,id);
  return id;
}
function serviceAccess(req,id){const s=db.prepare('SELECT * FROM services WHERE id=?').get(id);if(!s)S.fail(404,'Servicio no encontrado.');if(req.user?.role==='admin')S.admin(req);else{S.requireRole(req,'profesional');if(s.professional_id!==req.user.professional_id)S.fail(403,'Servicio ajeno.');}return s;}
function routes(app){
  app.post('/api/bookings/:id/confirm',wrap((req,res)=>{db.transaction(()=>{const b=access(req,req.params.id);customer(req,b);if(b.status!=='entregado'||b.cancellation_status)S.fail(409,'La entrega no está disponible para confirmar.');db.prepare("UPDATE bookings SET status='confirmado',confirmed_at=? WHERE id=?").run(Date.now(),b.id);notify.booking(b,'Entrega confirmada',`La organización confirmó ${b.service}.`);}).immediate();res.json({ok:true});}));
  app.post('/api/bookings/:id/incidents',wrap((req,res)=>{let id;db.transaction(()=>{
    const b=access(req,req.params.id),category=req.body.category||'otro';
    if(!categories.includes(category))S.fail(400,'Motivo inválido.');
    if(!b.paid_at&&!(req.user.role==='profesional'&&b.status==='aceptado'&&category==='cancelacion_profesional'))S.fail(409,'Esta reserva no admite este reclamo.');
    const released=db.prepare('SELECT released_at FROM payments WHERE booking_id=? AND released_at IS NOT NULL').get(b.id);
    if(released&&Date.now()>released.released_at+(P.policy(b)?.claimDays||30)*24*P.HOUR)S.fail(409,'Venció el plazo de 30 días para reclamar tras la liquidación. Contacta a Skilly.');
    if(category==='inasistencia_profesional'){
      if(req.user.role!=='admin')customer(req,b);const appointment=require('./scheduling').timestamp(b.date,b.time);
      if(Date.now()<appointment+(P.policy(b)?.toleranceMinutes||15)*60000)S.fail(409,'Aún no termina la tolerancia de asistencia de 15 minutos.');
    }
    if(['inasistencia_cliente','cancelacion_profesional'].includes(category))S.requireRole(req,'profesional');
    const remedy=req.body.remedy||'revision';if(!['revision','reembolso','reprogramacion','correccion'].includes(remedy))S.fail(400,'Solución inválida.');
    id=createIncident(req,b,category,required(req.body.body,'Describe lo ocurrido.'),text(req.body.evidence||'',4000),remedy);
  }).immediate();res.status(201).json({id});}));
  app.get('/api/bookings/:id/incidents',wrap((req,res)=>{access(req,req.params.id);res.json(db.prepare('SELECT * FROM incidents WHERE booking_id=? ORDER BY created_at').all(req.params.id).map(i=>({...i,events:db.prepare('SELECT * FROM case_events WHERE case_id=? ORDER BY created_at').all(i.id)})));}));
  app.post('/api/incidents/:id/reply',wrap((req,res)=>{const i=incident(req,req.params.id);if(i.status==='resuelta')S.fail(409,'Solicita una apelación para reabrir.');const body=required(req.body.body,'Escribe tu respuesta y evidencia.');event(i.id,req,'respuesta',body);notify.booking(access(req,i.booking_id),'Respuesta a un reclamo',`${i.id}: ${body}`);res.json({ok:true});}));
  app.post('/api/incidents/:id/appeal',wrap((req,res)=>{db.transaction(()=>{const i=incident(req,req.params.id);if(i.status!=='resuelta'||i.appeals>=1)S.fail(409,'Solo se permite una apelación de un caso resuelto.');if(Date.now()-i.resolved_at>7*24*P.HOUR)S.fail(409,'Venció el plazo de apelación de 7 días.');const body=required(req.body.body,'Fundamenta la apelación.');db.prepare("UPDATE incidents SET status='abierta',appeals=appeals+1,resolution_due=? WHERE id=?").run(P.businessDeadline(2),i.id);event(i.id,req,'apelacion',body);notify.booking(access(req,i.booking_id),'Apelación abierta',body);}).immediate();res.json({ok:true});}));
  app.get('/api/admin/incidents',wrap((req,res)=>{S.admin(req);res.json(db.prepare('SELECT i.*,b.service,b.org_name FROM incidents i JOIN bookings b ON b.id=i.booking_id ORDER BY i.created_at DESC').all());}));
  app.patch('/api/admin/incidents/:id',wrap((req,res)=>{S.admin(req);db.transaction(()=>{
    const i=incident(req,req.params.id),b=access(req,i.booking_id);
    if(i.status==='resuelta')S.fail(409,'El caso ya fue resuelto.');
    const resolution=required(req.body.resolution,'Describe la decisión y su evidencia.'),outcome=req.body.outcome||'sin_compensacion';
    if(!['reembolso_total','reembolso_parcial','correccion','reprogramacion','sin_compensacion','incumplimiento_profesional'].includes(outcome))S.fail(400,'Resultado inválido.');
    const close=req.body.close!==false;
    if(close&&b.paid_at&&['reembolso_total','incumplimiento_profesional'].includes(outcome)&&Number(b.refund_amount)<b.amount)S.fail(409,'Ejecuta y concilia el reembolso completo antes de cerrar.');
    if(close&&outcome==='reembolso_parcial'&&!(b.refund_amount>0))S.fail(409,'Falta ejecutar el reembolso acordado.');
    if(close&&['correccion','reprogramacion'].includes(outcome)&&!db.prepare("SELECT 1 FROM case_events e WHERE case_id=? AND kind='conformidad' AND rowid > COALESCE((SELECT MAX(rowid) FROM case_events WHERE case_id=e.case_id AND kind='decision'),0)").get(i.id))S.fail(409,'Falta la conformidad de la organización con la solución.');
    db.prepare('UPDATE incidents SET status=?,outcome=?,resolution=?,assigned_to=?,resolved_at=? WHERE id=?').run(close?'resuelta':'pendiente_accion',outcome,resolution,req.user.id,close?Date.now():null,i.id);
    event(i.id,req,close?'resolucion':'decision',resolution);S.audit(req,'incident_decision',i.id,JSON.stringify({outcome,close}));
    notify.booking(b,close?'Reclamo resuelto':'Acción pendiente en tu reclamo',`${i.id}: ${resolution}`);
  }).immediate();res.json({ok:true});}));
  app.post('/api/incidents/:id/accept',wrap((req,res)=>{const i=incident(req,req.params.id),b=access(req,i.booking_id);customer(req,b);if(i.status!=='pendiente_accion')S.fail(409,'No hay solución pendiente.');event(i.id,req,'conformidad',required(req.body.body,'Confirma qué solución recibiste.'));res.json({ok:true});}));
  app.post('/api/admin/professionals/:id/suspension',wrap((req,res)=>{S.admin(req);const reason=required(req.body.reason,'Indica motivo y condiciones para levantar la suspensión.');if(typeof req.body.suspended!=='boolean')S.fail(400,'Estado inválido.');const p=db.prepare('SELECT * FROM professionals WHERE id=?').get(req.params.id);if(!p)S.fail(404,'Profesional no encontrado.');db.prepare('UPDATE professionals SET booking_suspended=?,suspension_reason=? WHERE id=?').run(req.body.suspended?1:0,reason,p.id);S.audit(req,'professional_suspension',p.id,reason);notify.enqueue(p.email,'Estado de nuevas contrataciones',reason);res.json({ok:true});}));
  app.get('/api/services/:id/appeals',wrap((req,res)=>{serviceAccess(req,req.params.id);res.json(db.prepare('SELECT * FROM service_appeals WHERE service_id=? ORDER BY created_at DESC').all(req.params.id).map(a=>({...a,events:db.prepare('SELECT * FROM case_events WHERE case_id=? ORDER BY created_at').all(a.id)})));}));
  app.post('/api/services/:id/appeals',wrap((req,res)=>{S.requireRole(req,'profesional');let id;db.transaction(()=>{
    const s=serviceAccess(req,req.params.id);if(!['rechazado','info_solicitada'].includes(s.status))S.fail(409,'El servicio no tiene observaciones pendientes.');
    if(db.prepare("SELECT 1 FROM service_appeals WHERE service_id=? AND status IN ('abierta','propuesta')").get(s.id))S.fail(409,'Ya hay una mediación abierta.');
    const body=required(req.body.body,'Justifica tu propuesta.'),contact=text(req.body.contact||'correo',160);if(!contact)S.fail(400,'Indica correo o teléfono de contacto.');id=S.id('apl');
    db.prepare('INSERT INTO service_appeals(id,service_id,revision,body,contact,due_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id,s.id,S.hash(s.draft),body,contact,P.businessDeadline(2),Date.now());event(id,req,'apertura',body);
    const admin=process.env.ADMIN_NOTIFICATION_EMAIL||process.env.GMAIL_USER;if(admin)notify.enqueue(admin,'Mediación de servicio solicitada',`${id}: ${body}. Contacto: ${contact}`);
  }).immediate();res.status(201).json({id});}));
  app.post('/api/service-appeals/:id/events',wrap((req,res)=>{db.transaction(()=>{
    const a=db.prepare('SELECT * FROM service_appeals WHERE id=?').get(req.params.id);if(!a)S.fail(404,'Mediación no encontrada.');const s=serviceAccess(req,a.service_id),kind=req.body.kind;
    if(!['abierta','propuesta'].includes(a.status))S.fail(409,'La mediación está cerrada.');
    const body=required(req.body.body,'Registra el fundamento o acuerdo.');
    if(req.user.role==='admin'){
      if(!['contacto','propuesta','cierre'].includes(kind))S.fail(400,'Acción inválida.');
      db.prepare('UPDATE service_appeals SET status=?,resolution=?,assigned_to=?,due_at=? WHERE id=?').run(kind==='cierre'?'cerrada':kind==='propuesta'?'propuesta':a.status,body,req.user.id,P.businessDeadline(2),a.id);
    }else{
      if(!['respuesta','aceptar','rechazar','retirar'].includes(kind))S.fail(400,'Acción inválida.');
      if(['aceptar','rechazar'].includes(kind)&&a.status!=='propuesta')S.fail(409,'Falta una propuesta concreta de Skilly.');
      if(kind==='aceptar'&&a.revision!==S.hash(s.draft))S.fail(409,'El servicio cambió. Solicita una nueva revisión del acuerdo.');
      db.prepare('UPDATE service_appeals SET status=?,due_at=? WHERE id=?').run(kind==='aceptar'?'acordada':kind==='retirar'?'retirada':kind==='rechazar'?'abierta':a.status,P.businessDeadline(2),a.id);
    }
    event(a.id,req,kind,body);S.audit(req,'service_mediation',a.id,kind);
    const p=db.prepare('SELECT email FROM professionals WHERE id=?').get(s.professional_id);for(const email of new Set([p.email,process.env.ADMIN_NOTIFICATION_EMAIL||process.env.GMAIL_USER].filter(Boolean)))notify.enqueue(email,'Actualización de mediación',`${a.id}: ${kind}. ${body}`);
  }).immediate();res.json({ok:true});}));
  app.get('/api/admin/operations',wrap((req,res)=>{S.admin(req);res.json({refunds:db.prepare("SELECT * FROM refund_operations WHERE status='revision'").all(),payouts:db.prepare('SELECT * FROM payouts ORDER BY created_at DESC').all(),emails:db.prepare('SELECT id,recipient,subject,attempts,next_attempt_at,last_error FROM outbox WHERE sent=0 ORDER BY created_at DESC LIMIT 100').all(),appeals:db.prepare("SELECT * FROM service_appeals WHERE status IN ('abierta','propuesta')").all()});}));
  app.post('/api/admin/outbox/:id/retry',wrap((req,res)=>{S.admin(req);db.prepare('UPDATE outbox SET attempts=0,next_attempt_at=0 WHERE id=? AND sent=0 AND lease_until<=?').run(req.params.id,Date.now());S.audit(req,'email_retry',req.params.id);res.json({ok:true});}));
}
function sweep(now=Date.now()){
  db.transaction(()=>{
    for(const b of db.prepare("SELECT * FROM bookings WHERE status='pagado' AND end_at<? AND cancellation_status IS NULL").all(now-24*P.HOUR)){
      if(!db.prepare('SELECT 1 FROM incidents WHERE booking_id=?').get(b.id))createIncident({},b,'abandono','La reserva lleva más de 24 horas sin entrega después de su término. Skilly debe verificar lo ocurrido.');
    }
    for(const b of db.prepare("SELECT * FROM bookings WHERE status='entregado' AND delivered_at<?").all(now-3*24*P.HOUR))notify.booking(b,'Entrega pendiente de confirmación',`${b.id}: confirma la entrega o informa un problema. Skilly revisará el caso; no se libera el pago automáticamente.`,'confirmation:'+b.id);
    for(const i of db.prepare("SELECT * FROM incidents WHERE status<>'resuelta' AND resolution_due<?").all(now))notify.booking(db.prepare('SELECT * FROM bookings WHERE id=?').get(i.booking_id),'Reclamo fuera de plazo',`${i.id}: requiere atención de Skilly.`,'overdue:'+i.id+':'+i.appeals);
    for(const a of db.prepare("SELECT * FROM service_appeals WHERE status IN ('abierta','propuesta') AND due_at<?").all(now)){
      const email=process.env.ADMIN_NOTIFICATION_EMAIL||process.env.GMAIL_USER;if(email)notify.enqueue(email,'Mediación fuera de plazo',`${a.id}: contacta al profesional y registra la gestión.`,'appeal:'+a.id+':'+a.due_at);
    }
  }).immediate();
}
let worker;
function startWorker(){if(worker)return;let running=false;const run=async()=>{if(running)return;running=true;try{sweep();await notify.flush();}catch(e){console.error('Seguimiento pendiente:',e.message);}finally{running=false;}};worker=setInterval(run,60000);worker.unref();run();}
module.exports={routes,sweep,startWorker,createIncident};
