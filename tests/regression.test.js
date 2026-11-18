// Each execution owns an isolated PostgreSQL schema; all people and payments are synthetic.
const {test,before,after}=require('node:test');
const a=require('node:assert/strict');
const {setup,db,client,password,future,S}=require('./http-fixture');
let f,other,pro2,offset=100;
const ok=async(p,status=200)=>{const r=await p;a.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const row=id=>db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
const serviceRow=()=>db.prepare('SELECT * FROM services WHERE id=?').get(f.svc.id);
const counts=async()=>{const r={};for(const t of ['users','professionals','services','evaluations'])r[t]=(await db.prepare('SELECT count(*) n FROM '+t).get()).n;return r;};
before(async()=>{
  f=await setup();
  const hash=await S.passwordHash(password);
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,verified,created_at) VALUES('other','other@example.test','Otra organización',?,'organizacion',1,?)").run(hash,Date.now());
  other=client(f.base);await ok(other.call('auth/login','POST',{email:'other@example.test',password}));
  pro2=client(f.base);await ok(pro2.call('auth/register','POST',{name:'Segundo profesional',email:'pro2@example.test',password,role:'profesional',title:'Otro servicio',description:'Datos sintéticos',price:1000,validation:{linkedin:'https://www.linkedin.com/in/prueba2',cv:'Prueba',yearsExperience:'2'}}),201);
});
after(async()=>{if(f)await f.close();});

test('R00 CP-062 empty reporting dataset returns empty history and zero financial totals',async()=>{
  a.deepEqual(await ok(f.admin.call('admin/organizations')),[]);
  const d=await ok(f.admin.call('admin/dashboard'));a.equal(d.bookings.total,0);a.equal(d.payments.totalPagado,0);a.equal(d.payments.retenido,0);
});

test('R01 CP-018 rejects invalid prices in create and edit without changing drafts or publications',async()=>{
  const initial=await serviceRow(),n=await counts();
  for(const price of [-1,'-1','$-1','−1','-35.000',0,'0',1.5,'1.5','35.00','abc123',true,null,[1],100000001]){
    await ok(f.pro.call('services','POST',{title:'Borde',description:'Prueba',price}),400);
    await ok(f.pro.call('services/'+f.svc.id,'PATCH',{title:'No guardar',price}),400);
    a.deepEqual(await serviceRow(),initial);
    a.deepEqual(await counts(),n);
  }
  for(const body of [{durationMinutes:14},{durationMinutes:721},{durationMinutes:15.5},{prepMinutes:-1},{durationMinutes:720,prepMinutes:720,followupMinutes:1}]){
    await ok(f.pro.call('services/'+f.svc.id,'PATCH',body),400);a.deepEqual(await serviceRow(),initial);
  }
  await ok(pro2.call('services/'+f.svc.id,'PATCH',{price:1}),404);
  a.deepEqual(await serviceRow(),initial);
});

test('R02 CP-003 CP-004 CP-018 invalid registration rolls back and corrected price registers once',async()=>{
  const c=client(f.base),n=await counts();
  const body={name:'Registro de borde',email:'borde@example.test',role:'profesional',password,title:'Servicio',description:'Prueba',price:'-1',validation:{linkedin:'https://www.linkedin.com/in/prueba',cv:'Sintético',yearsExperience:'2'}};
  await ok(c.call('auth/register','POST',body),400);a.deepEqual(await counts(),n);
  body.price='$35.000';const u=await ok(c.call('auth/register','POST',body),201);
  const sv=await ok(c.call('services'));a.equal(sv.length,1);a.equal(sv[0].price,35000);a.equal(sv[0].status,'pendiente');
  a.equal((await db.prepare('SELECT price FROM professionals WHERE id=?').get(u.professionalId)).price,'35000');
  await ok(c.call('auth/register','POST',body),409);
  a.equal((await counts()).users,n.users+1);
});

test('R03 CP-047 CP-048 invalid stars leave delivery and money unchanged; limits and privacy hold',async()=>{
  const b=await f.paid(offset++);await db.prepare("UPDATE bookings SET status='entregado',delivery_evidence='Entrega sintética' WHERE id=?").run(b.id);
  const initial=await row(b.id),money=await db.prepare('SELECT * FROM payments WHERE booking_id=?').get(b.id);
  for(const stars of [0,'0',-1,6,1.5,null,true,false,[],[1],{},undefined,'']){
    await ok(f.org.call('evaluations','POST',{bookingId:b.id,stars,comment:'Opinión privada'}),400);
    a.deepEqual(await row(b.id),initial);a.equal((await db.prepare('SELECT count(*) n FROM evaluations WHERE booking_id=?').get(b.id)).n,0);
    a.deepEqual(await db.prepare('SELECT * FROM payments WHERE booking_id=?').get(b.id),money);
  }
  await ok(f.org.call('evaluations','POST',{bookingId:b.id,stars:4,comment:'   '}),400);
  await ok(other.call('evaluations','POST',{bookingId:b.id,stars:4,comment:'Ajena'}),403);
  await ok(f.org.call('evaluations','POST',{bookingId:b.id,stars:1,comment:'PRIVADA-LIMITE-UNO'}));
  await ok(f.org.call('evaluations','POST',{bookingId:b.id,stars:5,comment:'Duplicada'}),409);
  a.equal((await db.prepare('SELECT stars FROM evaluations WHERE booking_id=?').get(b.id)).stars,1);
  a.equal((await row(b.id)).status,'confirmado');
  const b2=await f.paid(offset++);await db.prepare("UPDATE bookings SET status='entregado' WHERE id=?").run(b2.id);
  await ok(f.org.call('evaluations','POST',{bookingId:b2.id,stars:5,comment:'PRIVADA-LIMITE-CINCO'}));
  a.equal((await db.prepare('SELECT stars FROM evaluations WHERE booking_id=?').get(b2.id)).stars,5);
  const ev=await ok(f.admin.call('admin/evaluations'));a.ok(JSON.stringify(ev).includes('PRIVADA-LIMITE-UNO'));
  for(const c of [f.org,f.pro,other,client(f.base)]){
    await ok(c.call('admin/evaluations'),404);
    a.ok(!JSON.stringify(await ok(c.call('services'))).includes('PRIVADA-LIMITE'));
  }
});

test('R04 CP-035 valid reschedule keeps financial snapshots and records audit and notification',async()=>{
  const b=await f.paid(offset++),initial=await row(b.id),date=future(offset++);
  await ok(f.admin.call('bookings/'+b.id,'PATCH',{date,time:'15:00'}));const changed=await row(b.id);
  a.equal(changed.date,date);a.equal(changed.time,'15:00');a.notEqual(changed.start_at,initial.start_at);
  for(const field of ['amount','commission_percent','commission_amount','professional_net','policy_snapshot','status','paid_at'])a.equal(changed[field],initial[field],field);
  a.ok((await ok(f.admin.call('admin/audit'))).some(x=>JSON.stringify(x).includes(b.id)&&JSON.stringify(x).includes('reschedule')));
  a.ok(JSON.stringify(await ok(f.admin.call('admin/outbox'))).includes(date));
});

test('R05 CP-036 forbidden reschedules preserve dates for collision, terminal state, pending payments and roles',async()=>{
  const b=await f.paid(offset++),occupied=await ok(f.book(offset++),201);let initial=await row(b.id);
  await ok(f.admin.call('bookings/'+b.id,'PATCH',{date:occupied.date,time:occupied.time}),409);a.deepEqual(await row(b.id),initial);
  for(const c of [f.pro,f.org,other]){await ok(c.call('bookings/'+b.id,'PATCH',{date:future(offset+1),time:'15:00'}),403);a.deepEqual(await row(b.id),initial);}
  await db.prepare("UPDATE bookings SET status='completado' WHERE id=?").run(b.id);initial=await row(b.id);
  await ok(f.admin.call('bookings/'+b.id,'PATCH',{date:future(offset+1),time:'15:00'}),409);a.deepEqual(await row(b.id),initial);
  await db.prepare("UPDATE bookings SET status='pagado' WHERE id=?").run(b.id);initial=await row(b.id);
  for(const status of ['iniciado','procesando','revision']){
    await db.prepare('UPDATE payments SET status=? WHERE booking_id=?').run(status,b.id);
    await ok(f.admin.call('bookings/'+b.id,'PATCH',{date:future(offset+1),time:'15:00'}),409);a.deepEqual(await row(b.id),initial);
  }
  await db.prepare("UPDATE payments SET status='pagado' WHERE booking_id=?").run(b.id);
});

test('R06 CP-062 organization reports match persisted totals and isolate histories including an empty organization',async()=>{
  a.deepEqual(await ok(other.call('bookings')),[]);a.deepEqual(await ok(other.call('payments')),[]);
  const b=await ok(other.call('bookings','POST',{serviceId:f.svc.id,date:future(offset++),time:'10:00'}),201);
  await ok(f.pro.call('bookings/'+b.id,'PATCH',{status:'aceptado'}));await ok(other.call('payments','POST',{bookingId:b.id,acceptTerms:true}),201);
  const report=await ok(f.admin.call('admin/organizations'));a.equal(report.length,2);
  for(const email of ['org@example.test','other@example.test']){
    const r=report.find(x=>x.orgEmail===email),rows=await db.prepare('SELECT * FROM bookings WHERE org_email=?').all(email);
    const paid=await db.prepare("SELECT COALESCE(sum(amount),0) n FROM payments WHERE org_email=? AND status IN ('pagado','liberado')").get(email);
    a.equal(r.totalReservas,rows.length);a.equal(r.totalPagado,Number(paid.n));a.equal(r.historial.length,rows.length);
    a.equal(r.reservasEsteMes,rows.filter(x=>x.date.startsWith(new Date().toISOString().slice(0,7))).length);
    a.equal(r.reservasCanceladas,rows.filter(x=>x.status==='cancelado').length);a.equal(r.reservasCompletadas,rows.filter(x=>x.status==='completado').length);
    a.deepEqual(r.historial.map(x=>x.id).sort(),rows.map(x=>x.id).sort());
  }
  const own=await ok(other.call('bookings'));a.deepEqual(own.map(x=>x.id),[b.id]);a.ok(!(await ok(f.org.call('bookings'))).some(x=>x.id===b.id));
  for(const c of [other,f.org,f.pro,client(f.base)])await ok(c.call('admin/organizations'),404);
  await ok(client(f.adminBase).call('admin/organizations'),401);
  const dash=await ok(f.admin.call('admin/dashboard'));a.equal(dash.bookings.total,(await db.prepare('SELECT count(*) n FROM bookings').get()).n);
  a.equal(dash.payments.totalPagado,Number((await db.prepare("SELECT COALESCE(sum(amount),0) n FROM payments WHERE status IN ('pagado','liberado')").get()).n));
});

test('R07 CP-012 CP-016 CP-026 invalid profile and calendar changes are atomic',async()=>{
  const person=await db.prepare('SELECT * FROM professionals WHERE id=?').get(f.proId);
  for(const body of [{maxPerDay:-1},{maxPerWeek:10001},{maxPerMonth:1.5},{workStart:'18:00',workEnd:'08:00'},{workStart:'25:00'},{availability:{days:['Never'],hours:['10:00']}},{availability:{days:['Lunes'],hours:['24:00']}},{blockedDates:['2026-02-30']}]){
    await ok(f.pro.call('professionals/'+f.proId+'/self','PATCH',body),400);
    a.deepEqual(await db.prepare('SELECT * FROM professionals WHERE id=?').get(f.proId),person);
  }
  await ok(pro2.call('professionals/'+f.proId+'/self','PATCH',{maxPerDay:0}),403);
  const original=await ok(f.org.call('auth/me'));
  for(const body of [{phone:'abc'},{rut:'12345678-9'}]){
    await ok(f.org.call('auth/profile','PATCH',{name:'No guardar',...body}),400);
    a.deepEqual(await ok(f.org.call('auth/me')),original);
  }
  await ok(f.pro.call('professionals/'+f.proId+'/self','PATCH',{maxPerDay:0}));
  await ok(f.book(offset),409);
  await ok(f.pro.call('professionals/'+f.proId+'/self','PATCH',{maxPerDay:null}));
  await ok(f.book(offset++),201);
});

test('R08 CP-060 configuration rejects invalid mixed patches without changing prior settings',async()=>{
  const original=await ok(f.admin.call('admin/settings'));
  for(const field of ['commissionPercent','defaultCancellationRefundPercent','responseHours','paymentHours','adminWeeklyReviewCapacity']){
    for(const value of field.includes('Percent')?[-1,101]:[0,721,1.5]){
      await ok(f.admin.call('admin/settings','PATCH',{commissionPercent:20,[field]:value}),400);
      a.deepEqual(await ok(f.admin.call('admin/settings')),original);
    }
  }
  for(const c of [f.org,f.pro,other])await ok(c.call('admin/settings','PATCH',{commissionPercent:50}),404);
});

test('R09 CP-028 CP-034 CP-038 CP-046 ownership and state guards preserve unpaid and paid bookings',async()=>{
  const b=await ok(f.book(offset++),201),initial=await row(b.id);
  await ok(other.call('payments','POST',{bookingId:b.id,acceptTerms:true}),403);
  await ok(f.org.call('payments','POST',{bookingId:b.id,acceptTerms:true}),409);
  await ok(pro2.call('bookings/'+b.id,'PATCH',{status:'aceptado'}),403);a.deepEqual(await row(b.id),initial);
  await ok(f.pro.call('bookings/'+b.id,'PATCH',{status:'aceptado'}));
  await ok(f.org.call('payments','POST',{bookingId:b.id}),400);
  a.equal((await db.prepare('SELECT count(*) n FROM payments WHERE booking_id=?').get(b.id)).n,0);
  await ok(f.org.call('payments','POST',{bookingId:b.id,acceptTerms:true}),201);
  const paid=await row(b.id);
  await ok(f.pro.call('bookings/'+b.id,'PATCH',{status:'entregado',evidence:'Demasiado pronto'}),409);
  await ok(other.call('bookings/'+b.id+'/confirm','POST',{}),403);
  await ok(f.org.call('bookings/'+b.id+'/confirm','POST',{}),409);a.deepEqual(await row(b.id),paid);
  await db.prepare('UPDATE bookings SET end_at=? WHERE id=?').run(Date.now()-1,b.id);
  await ok(f.pro.call('bookings/'+b.id,'PATCH',{status:'entregado',evidence:' '}),400);
  await db.prepare("UPDATE bookings SET cancellation_status='revision' WHERE id=?").run(b.id);
  await ok(f.pro.call('bookings/'+b.id,'PATCH',{status:'entregado',evidence:'Entrega'}),409);
  a.equal((await row(b.id)).status,'pagado');
});

test('R10 CP-041 CP-042 messages preserve authenticated sender and reject empty or unauthorized access',async()=>{
  const b=await f.paid(offset++);
  await ok(f.org.call('bookings/'+b.id+'/messages','POST',{body:'Hola',senderRole:'admin',senderName:'Administrador'}),201);
  await ok(f.pro.call('bookings/'+b.id+'/messages','POST',{body:'Respuesta'}),201);
  const m=await ok(f.org.call('bookings/'+b.id+'/messages'));a.equal(m.length,2);a.equal(m[0].senderRole,'organizacion');a.equal(m[1].senderRole,'profesional');a.ok(m[0].createdAt<=m[1].createdAt);
  await ok(f.org.call('bookings/'+b.id+'/messages','POST',{body:' '}),400);
  for(const c of [other,pro2]){await ok(c.call('bookings/'+b.id+'/messages'),403);await ok(c.call('bookings/'+b.id+'/messages','POST',{body:'Ajeno'}),403);}
  a.equal((await ok(f.org.call('bookings/'+b.id+'/messages'))).length,2);
  const unpaid=await ok(f.book(offset++),201);await ok(f.org.call('bookings/'+unpaid.id+'/messages'),403);
});

test('R11 CP-051 CP-052 exact no-show tolerance and released claim deadline are enforced',async()=>{
  const schedule=require('../server/scheduling'),now=Date.now(),originalNow=Date.now;
  const b=await f.paid(offset++),local=schedule.localParts(now),appointment=schedule.timestamp(local.date,local.time);
  await db.prepare('UPDATE bookings SET date=?,time=? WHERE id=?').run(local.date,local.time,b.id);
  try{
    Date.now=()=>appointment+15*60000-1;
    await ok(f.org.call('bookings/'+b.id+'/incidents','POST',{category:'inasistencia_profesional',body:'Esperando'}),409);
    Date.now=()=>appointment+15*60000;
    const inc=await ok(f.org.call('bookings/'+b.id+'/incidents','POST',{category:'inasistencia_profesional',body:'Sin asistencia'}),201);
    a.ok(inc.id);await ok(f.org.call('bookings/'+b.id+'/incidents','POST',{body:'Duplicado'}),409);
    await ok(other.call('incidents/'+inc.id+'/reply','POST',{body:'Ajeno'}),403);
  }finally{Date.now=originalNow;}
  for(const delta of [0,1]){
    const paid=await f.paid(offset++);const fixed=Date.now();
    await db.prepare("UPDATE payments SET status='liberado',released_at=? WHERE booking_id=?").run(fixed-30*86400000-delta,paid.id);
    try{Date.now=()=>fixed;await ok(f.org.call('bookings/'+paid.id+'/incidents','POST',{category:'calidad',body:'Revisión del servicio'}),delta?409:201);}finally{Date.now=originalNow;}
  }
});

test('R12 CP-054 appeals allow seven days exactly, reject late and second appeals',async()=>{
  const originalNow=Date.now;
  for(const delta of [0,1]){
    const b=await f.paid(offset++),i=await ok(f.org.call('bookings/'+b.id+'/incidents','POST',{body:'Prueba de apelación'}),201);
    await ok(f.admin.call('admin/incidents/'+i.id,'PATCH',{outcome:'sin_compensacion',resolution:'Decisión sintética',close:true}));
    const fixed=Date.now();await db.prepare('UPDATE incidents SET resolved_at=? WHERE id=?').run(fixed-7*86400000-delta,i.id);
    try{Date.now=()=>fixed;await ok(f.org.call('incidents/'+i.id+'/appeal','POST',{body:'Fundamento de apelación'}),delta?409:200);}finally{Date.now=originalNow;}
    if(!delta){await ok(f.admin.call('admin/incidents/'+i.id,'PATCH',{outcome:'sin_compensacion',resolution:'Segunda decisión',close:true}));await ok(f.org.call('incidents/'+i.id+'/appeal','POST',{body:'Segunda apelación'}),409);}
  }
});

test('R13 CP-005 CP-006 verification claims only matching non-guest history and tokens cannot be reused',async()=>{
  const rows=[];for(let i=0;i<3;i++)rows.push(await ok(f.book(offset++),201));
  for(const b of rows)await db.prepare('UPDATE bookings SET org_user_id=NULL WHERE id=?').run(b.id);
  await db.prepare("UPDATE bookings SET org_email='other@example.test' WHERE id=?").run(rows[1].id);
  await db.prepare('UPDATE bookings SET guest=1 WHERE id=?').run(rows[2].id);
  const token=await S.issueToken('verify',f.orgId,60000);
  await ok(client(f.base).call('auth/verify','POST',{token}));
  a.equal((await row(rows[0].id)).org_user_id,f.orgId);a.equal((await row(rows[1].id)).org_user_id,null);a.equal((await row(rows[2].id)).org_user_id,null);
  const snapshot=await Promise.all(rows.map(b=>row(b.id)));
  await ok(client(f.base).call('auth/verify','POST',{token}),400);
  await ok(client(f.base).call('auth/verify','POST',{token:await S.issueToken('verify',f.orgId,-1)}),400);
  a.deepEqual(await Promise.all(rows.map(b=>row(b.id))),snapshot);
});

test('R14 CP-007 CP-008 logout and inactive accounts invalidate access without creating new sessions',async()=>{
  const c=client(f.base);await ok(c.call('auth/login','POST',{email:'other@example.test',password}));await ok(c.call('auth/logout','POST',{}));
  await ok(c.call('auth/profile','PATCH',{name:'No autorizado'}),401);
  await db.prepare("UPDATE users SET active=0 WHERE id='other'").run();
  await ok(other.call('auth/profile','PATCH',{name:'No autorizado'}),401);
  await ok(c.call('auth/login','POST',{email:'other@example.test',password}),401);
  await ok(c.call('auth/login','POST',{email:'admin@example.test',password}),401);
  await ok(client(f.adminBase).call('auth/login','POST',{email:'org@example.test',password}),401);
  await db.prepare("UPDATE users SET active=1 WHERE id='other'").run();
});

test('R15 CP-013 CP-014 invitations enforce duplicates, legacy profiles and role boundaries',async()=>{
  await ok(f.admin.call('admin/users','POST',{name:'Administrador invitado',email:'invited@example.test',role:'admin'}),201);
  const invited=await db.prepare("SELECT * FROM users WHERE email='invited@example.test'").get();a.equal(invited.role,'admin');a.ok(invited.password_hash);
  await db.prepare("INSERT INTO professionals SELECT (jsonb_populate_record(NULL::professionals,to_jsonb(p)||jsonb_build_object('id','legacy-pro','email','legacy@example.test'))).* FROM professionals p WHERE id=?").run(f.proId);
  await ok(f.admin.call('admin/users','POST',{name:'Perfil heredado',email:'legacy@example.test',role:'profesional'}),201);
  a.equal((await db.prepare("SELECT professional_id FROM users WHERE email='legacy@example.test'").get()).professional_id,'legacy-pro');
  const n=await counts();await ok(f.admin.call('admin/users','POST',{name:'Repetido',email:'invited@example.test'}),409);
  await ok(f.admin.call('admin/users','POST',{name:'Sin perfil',email:'unknown@example.test',role:'profesional'}),400);
  await ok(f.org.call('admin/users','POST',{name:'Intruso',email:'intruso@example.test'}),404);a.deepEqual(await counts(),n);
  a.ok(!JSON.stringify(await ok(f.admin.call('admin/users'))).includes('password_hash'));
  a.ok(JSON.stringify(await ok(f.admin.call('admin/outbox'))).includes('#reset='));
});

test('R16 CP-017 CP-019 CP-020 stale or unfounded decisions keep the last published version',async()=>{
  let s=(await ok(f.pro.call('services'))).find(x=>x.id===f.svc.id);const old=s.revision,initial=await serviceRow();
  s=await ok(f.pro.call('services/'+s.id,'PATCH',{price:120000}));a.equal(s.status,'pendiente');a.equal((await serviceRow()).published,initial.published);
  await ok(f.admin.call('admin/services/'+s.id,'PATCH',{status:'validado',revision:old}),409);
  for(const status of ['rechazado','info_solicitada'])await ok(f.admin.call('admin/services/'+s.id,'PATCH',{status,revision:s.revision,adminNotes:' '}),400);
  a.equal((await serviceRow()).published,initial.published);
  await ok(f.admin.call('admin/services/'+s.id,'PATCH',{status:'info_solicitada',revision:s.revision,adminNotes:'Justifique el precio propuesto'}));
  a.equal((await serviceRow()).published,initial.published);
  await ok(f.admin.call('admin/services/'+s.id,'PATCH',{status:'validado',revision:s.revision}));
  a.equal(JSON.parse((await serviceRow()).published).price,120000);
  a.equal((await ok(client(f.base).call('services'))).find(x=>x.id===s.id).price,120000);
});
