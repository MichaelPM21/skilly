/* Role workspaces layered on the existing Skilly visual components. */
const ADMIN_APP=document.documentElement.dataset.app==='admin';
const nativeFetch=window.fetch.bind(window);
window.fetch=(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(url.origin===location.origin&&url.pathname.startsWith('/api/')){
    const headers=new Headers(options.headers||{});headers.set('X-Skilly-Request','1');options={...options,headers,credentials:'same-origin'};
  }
  return nativeFetch(input,options);
};
async function request(path,body,method='POST') {
  const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||'No se pudo completar la operación.');return data;
}
Api.list=(path,q='')=>request(path+q,undefined,'GET');
Api.create=(path,data)=>request(path,data);
Api.update=(path,id,data)=>request(path+'/'+id,data,'PATCH');
Api.adminGet=path=>Api.list('admin/'+path);
let SERVICES=[],panelTab='inicio',adminSection='inicio',selectedService=null;
const $=id=>document.getElementById(id);
const esc=escapeHtml;
const action=(label,code,style='outline')=>`<button class="btn ${style}" onclick="${code}">${label}</button>`;
const empty=message=>`<div class="empty">${message}</div>`;
const badge=s=>`<span class="statusBadge status-${s}">${esc(bookingStatusLabel(s))}</span>`;
const prettyDate=value=>new Date(value).toLocaleString('es-CL',{timeZone:'America/Santiago',dateStyle:'medium',timeStyle:'short'});
const kpi=(label,value,sub='')=>`<div class="kpiCard"><span class="kpiLabel">${label}</span><b class="kpiValue">${value}</b><span class="kpiSub">${sub}</span></div>`;
function modal(title,body){$('workspaceBox').innerHTML=`<button class="close" aria-label="Cerrar" onclick="closeM('workspaceModal')">×</button><h2>${esc(title)}</h2>${body}`;openM('workspaceModal');}
async function perform(fn){try{await fn();}catch(e){toast(e.message,6500);}}
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:'';}catch{return '';}}
loadSession=()=>{};
saveSession=s=>{SESSION=s;localStorage.removeItem('skilly_session');renderSession();};
logout=async()=>perform(async()=>{await request('auth/logout',{});SESSION=null;panelTab='inicio';closeChat();if(ADMIN_APP){PROFESSIONALS=[];SERVICES=[];BOOKINGS=[];PAYMENTS=[];EVALUATIONS=[];}else await refreshAll();renderSession();page(ADMIN_APP?'admin':'home');});
renderSession=()=>{
  $('sessionBox').style.display=SESSION?'flex':'none';$('guestBox').style.display=SESSION?'none':'flex';
  if(SESSION){$('sessionName').textContent=SESSION.name||SESSION.email;$('sessionRole').textContent={admin:'Administrador',profesional:'Profesional',organizacion:'Organización',invitado:'Acceso a tu reserva'}[SESSION.role];}
  const professional=SESSION?.role==='profesional';document.body.classList.toggle('professionalApp',professional);
  document.querySelectorAll('.links a').forEach(a=>{a.style.display=professional?(a.dataset.page==='dashboard'?'inline':'none'):(a.dataset.page==='dashboard'?(SESSION?'inline':'none'):'inline');});
  if(ADMIN_APP) updateRailSession(SESSION?.role === 'admin');
  if($('adminAccess'))$('adminAccess').href=SERVER_CONFIG.adminUrl||'http://localhost:3001';
  document.querySelectorAll('footer .fLinks a').forEach(a=>{a.style.display=professional?'none':'';});
};
page=id=>{
  if(ADMIN_APP)id=['admin','bigDashboard'].includes(id)?id:'admin';
  else if(SESSION?.role==='profesional')id='dashboard';
  else if(['admin','bigDashboard'].includes(id))return;
  if(chatPollTimer){clearInterval(chatPollTimer);chatPollTimer=null;}
  document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===id));
  document.querySelectorAll('.links a').forEach(a=>a.classList.toggle('active',a.dataset.page===id));
  if(id==='market')renderMarket();if(id==='dashboard')renderDashboard();if(id==='admin')renderAdmin();if(id==='bigDashboard')renderBigDashboard();
  window.scrollTo({top:0,behavior:'instant'});
};
refreshAll=async()=>{
  const [services,profs,bookings,payments]=await Promise.all([Api.list('services'),Api.list('professionals'),Api.list('bookings'),Api.list('payments')]);
  SERVICES=services;PROFESSIONALS=['admin','profesional'].includes(SESSION?.role)?profs:services;BOOKINGS=bookings;PAYMENTS=payments;
  EVALUATIONS=SESSION?.role==='admin'?await Api.adminGet('evaluations'):[];
  updateStats();
  if($('market')?.classList.contains('active'))renderMarket();
  if($('dashboard')?.classList.contains('active'))renderDashboard();
  if($('admin')?.classList.contains('active'))renderAdmin();
};
setLoginRole=role=>{
  loginRole=ADMIN_APP?'admin':role;
  document.querySelectorAll('#login .rolesel button').forEach(b=>b.classList.toggle('on',b.dataset.role===loginRole));
  $('loginFieldsOrgPro').style.display='block';
  if ($('loginFieldsAdmin')) $('loginFieldsAdmin').style.display='none';
};
doLogin=()=>perform(async()=>{
  const user=await request('auth/login',{email:$('loginEmail').value,password:$('accountPassword').value});
  $('accountPassword').value='';saveSession(user);closeM('login');panelTab='inicio';await refreshAll();page(ADMIN_APP?'admin':user.role==='profesional'?'dashboard':'market');toast('Bienvenido/a, '+user.name);
});
submitOrgRegister=()=>perform(async()=>{
  const user=await request('auth/register',{name:$('orgName').value,email:$('orgEmail').value,password:$('orgPassword').value,role:'organizacion'});
  $('orgPassword').value='';saveSession(user);closeM('register');await refreshAll();page('dashboard');toast('Cuenta creada. Revisa tu correo para verificarla.');
});
const oldProNext=regProNext;
function clearRegistrationError(){
  $('registrationError')?.remove();
  document.querySelectorAll('#register [aria-invalid]').forEach(el=>{el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby');});
}
const previousOpenRegister=openRegister;
openRegister=()=>{clearRegistrationError();previousOpenRegister();};
function registrationError(message,field){
  clearRegistrationError();
  const input=field?$(field):null;
  if(input?.closest('#regStepProBasic'))regStep=2;
  if(input?.closest('#regStepProValidation'))regStep=3;
  showRegStep();
  const notice=document.createElement('p');notice.id='registrationError';notice.className='registrationError';notice.setAttribute('role','alert');notice.textContent=message;
  const step=$(regStep===3?'regStepProValidation':'regStepProBasic');
  if(input){input.closest('label').insertAdjacentElement('afterend',notice);input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',notice.id);input.focus();}
  else step.prepend(notice);
  notice.scrollIntoView({block:'nearest'});
}
regProNext=()=>{
  clearRegistrationError();
  for(const [id,label] of [['proName','tu nombre'],['proEmail','tu correo'],['proTitle','el título del servicio'],['proDesc','la descripción del servicio']])if(!$(id).value.trim())return registrationError('Completa '+label+'.',id);
  if(!$('proEmail').checkValidity())return registrationError('Ingresa un correo válido.','proEmail');
  if($('proPassword').value.length<12||$('proPassword').value.length>128)return registrationError('Usa una contraseña de entre 12 y 128 caracteres.','proPassword');
  const price=Number($('proPrice').value.replace(/[^0-9]/g,''));
  if(!Number.isInteger(price)||price<1||price>100000000)return registrationError('Ingresa un precio válido en pesos, por ejemplo $35.000.','proPrice');
  oldProNext();
};
let professionalRegistrationPending=false;
submitProValidation=async()=>{
  if(professionalRegistrationPending)return;
  clearRegistrationError();
  for(const [id,message] of [['valLinkedin','Completa el enlace de tu perfil de LinkedIn.'],['valYears','Indica tus años de experiencia.'],['valCv','Agrega un enlace a tu CV o un resumen de tus antecedentes.']])if(!$(id).value.trim())return registrationError(message,id);
  const validation={linkedin:$('valLinkedin').value.trim(),yearsExperience:$('valYears').value.trim(),certifications:$('valCerts').value.trim(),cv:$('valCv').value.trim(),references:$('valRefs').value.trim(),portfolio:$('valPortfolio').value.trim(),motivation:$('valMotivation').value.trim()};
  try{
    const url=new URL(/^(?:[a-z0-9-]+\.)*linkedin\.com\//i.test(validation.linkedin)?'https://'+validation.linkedin:validation.linkedin);
    if(url.protocol!=='https:'||!/(^|\.)linkedin\.com$/.test(url.hostname)||url.username||url.password)throw new Error();
    validation.linkedin=url.href;
  }catch{return registrationError('Revisa el enlace de LinkedIn. Ejemplo: https://www.linkedin.com/in/tu-usuario','valLinkedin');}
  const button=$('regStepProValidation').querySelector('button.primary');
  professionalRegistrationPending=true;button.disabled=true;button.textContent='Creando tu cuenta…';
  try{
    const user=await request('auth/register',{...regProDraft,password:$('proPassword').value,role:'profesional',validation});
    $('proPassword').value='';saveSession(user);regStep=9;showRegStep();
    // Creation already succeeded: a later refresh failure must not invite a duplicate signup.
    try{await refreshAll();page('dashboard');}catch{toast('Tu cuenta ya fue creada. Recarga la página para abrir tu panel.',8000);}
  }catch(e){
    const field=/correo/i.test(e.message)?'proEmail':/contraseña/i.test(e.message)?'proPassword':/LinkedIn/i.test(e.message)?'valLinkedin':null;
    registrationError(e.message==='Failed to fetch'?'No se pudo conectar con Skilly. Comprueba que el servidor esté iniciado y vuelve a intentar.':e.message,field);
  }finally{professionalRegistrationPending=false;button.disabled=false;button.textContent='Enviar a validación';}
};
function openRecovery(){modal('Recuperar acceso',`<p class="hint">Enviaremos un enlace de recuperación al correo de tu cuenta.</p><label>Correo<input id="recoverEmail" type="email" autocomplete="email"></label>${action('Enviar enlace','sendRecovery()','primary')}`);}
function sendRecovery(){perform(async()=>{const r=await request('auth/forgot',{email:$('recoverEmail').value});toast(r.message);closeM('workspaceModal');});}
function openGuestRecovery(){modal('Consultar reserva de invitado',`<label>Número de reserva<input id="recoverBooking"></label><label>Correo<input id="recoverEmail" type="email"></label>${action('Enviar enlace seguro','recoverGuest()','primary')}`);}
function recoverGuest(){perform(async()=>{const r=await request('guest/recover',{email:$('recoverEmail').value,bookingId:$('recoverBooking').value});toast(r.message);closeM('workspaceModal');});}
function resetPassword(token){perform(async()=>{await request('auth/reset',{token,password:$('resetPassword').value});closeM('workspaceModal');toast('Contraseña guardada. Inicia sesión.');openM('login');});}
async function skillyInit(){
  try{
    localStorage.removeItem('skilly_session');
    const savedTheme=localStorage.getItem('skilly_theme');document.documentElement.dataset.theme=savedTheme||((matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light');
    document.querySelector('.navRight').insertAdjacentHTML('afterbegin','<button class="btn ghost themeSwitch" aria-label="Cambiar modo claro u oscuro" onclick="toggleTheme()">◐</button>');
    if(ADMIN_APP){$('login').querySelector('.rolesel').hidden=true;$('login').querySelector('h2').textContent='Administración Skilly';buildSidebar();}
    setLoginRole(ADMIN_APP?'admin':'organizacion');await loadServerConfig();
    const fragment=new URLSearchParams(location.hash.slice(1));history.replaceState({},'',location.pathname+location.search);
    if(fragment.has('guest'))await request('guest/access',{token:fragment.get('guest')});
    if(fragment.has('verify')){await request('auth/verify',{token:fragment.get('verify')});toast('Correo verificado.');}
    SESSION=await Api.list('auth/me');renderSession();
    if(!ADMIN_APP||SESSION){await refreshAll();}else{SERVICES=[];PROFESSIONALS=[];BOOKINGS=[];PAYMENTS=[];}
    page(ADMIN_APP?'admin':SESSION?.role==='profesional'||SESSION?.role==='invitado'?'dashboard':'home');
    if(fragment.has('reset')){const token=fragment.get('reset');modal('Crear nueva contraseña',`<label>Contraseña (12 caracteres o más)<input id="resetPassword" type="password" autocomplete="new-password"></label>${action('Guardar contraseña',`resetPassword('${/^[a-f0-9]{64}$/.test(token)?token:''}')`,'primary')}`);}
    const p=new URLSearchParams(location.search);if(p.has('payment')){toast({success:'Pago confirmado. Ya puedes ver nombre y LinkedIn.',review:'El pago requiere revisión de Skilly.',failed:'El pago fue rechazado.',cancelled:'Pago cancelado.',error:'No se pudo confirmar el pago.'}[p.get('payment')]||'Revisa el estado de tu reserva.',6500);history.replaceState({},'',location.pathname);if(SESSION)page('dashboard');}
    document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeM(m.id);}));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelectorAll('.modal.show').forEach(m=>closeM(m.id));}});
  }catch(e){toast(e.message,8000);if(ADMIN_APP)page('admin');}
}
function toggleTheme(){const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('skilly_theme',theme);}
bookingStatusLabel=s=>({gestion_skilly:'En revisión de Skilly',solicitado:'Pendiente de aceptación',aceptado:'Aceptada · pendiente de pago',reservado:'Reserva anterior · revisar con Skilly',pagado:'Pagada · servicio en curso',entregado:'Entregado · por confirmar',confirmado:'Entrega confirmada · por liquidar',completado:'Completado',cancelado:'Cancelado',rechazado:'Rechazado',expirado:'Plazo vencido',pendiente:'En revisión',validado:'Aprobado',info_solicitada:'Información solicitada',liberado:'Liquidación simulada',reembolsado:'Reembolso registrado',revision:'Requiere conciliación',reembolso_revision:'Reembolso en conciliación',iniciado:'Pago iniciado',procesando:'Procesando pago'}[s]||s);
const oldRenderMarket=renderMarket;
renderMarket=()=>{if(SESSION?.role==='profesional'||ADMIN_APP)return;oldRenderMarket();};
const oldOpenProfile=openProfile;
openProfile=id=>{if(SESSION?.role==='profesional'||ADMIN_APP)return;oldOpenProfile(id);};
nextAvailableDays=(prof,count=12)=>{
  const out=[],today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let d=new Date(today+'T12:00:00');for(let i=0;i<60&&out.length<count;i++,d.setDate(d.getDate()+1))if(prof.availability?.days?.includes(WEEKDAYS[d.getDay()]))out.push({date:new Date(d),label:WEEKDAYS[d.getDay()],key:dateKey(d)});return out;
};
startBooking=id=>{if(SESSION?.role==='profesional'||ADMIN_APP)return;if(!SESSION||SESSION.role==='invitado'){renderGuestForm(id);openM('guestBooking');return;}bookingCtx={professionalId:id,date:null,time:null};renderBookingModal(SERVICES.find(s=>s.id===id));openM('booking');};
const oldBookingModal=renderBookingModal;
renderBookingModal=s=>{oldBookingModal(s);$('bookingBox').querySelector('h2').textContent=s.title;$('bookingBox').querySelector('p.hint').textContent=s.title+' · '+fmtMoney(s.price);$('confirmBookingBtn').textContent='Solicitar reserva';};
pickBookingDay=async key=>{
  bookingCtx.date=key;bookingCtx.time=null;$('confirmBookingBtn').disabled=true;
  document.querySelectorAll('#dayTabs button').forEach(b=>b.classList.toggle('on',b.dataset.key===key));$('slotGrid').innerHTML='<p class="hint">Consultando disponibilidad…</p>';
  try{const result=await Api.list(`services/${bookingCtx.professionalId}/availability?date=${key}`);if(bookingCtx.date!==key)return;$('slotGrid').innerHTML=result.slots.length?result.slots.map(h=>action(h,`pickBookingTime('${h}')`)).join(''):empty('Sin horarios disponibles. Elige otro día.');}catch(e){toast(e.message);}
};
confirmBooking=()=>perform(async()=>{
  if(!bookingCtx.date||!bookingCtx.time)return toast('Elige un horario.');
  await request('bookings',{serviceId:bookingCtx.professionalId,date:bookingCtx.date,time:bookingCtx.time,notes:$('bookingNotes').value});
  closeM('booking');panelTab='reservas';await refreshAll();page('dashboard');toast('Solicitud enviada al profesional. Podrás pagar cuando acepte.');
});
renderGuestForm=id=>{
  const s=SERVICES.find(x=>x.id===id);if(!s)return;
  const days=nextAvailableDays(s);
  $('guestBookingBox').innerHTML=`<button class="close" onclick="closeM('guestBooking')">×</button><small>SOLICITUD SIN REGISTRO</small><h2>${esc(s.title)}</h2><p class="hint">Skilly revisará tu solicitud. El profesional debe aceptarla antes del pago.</p><label>Nombre de contacto<input id="gName"></label><label>Organización<input id="gOrg"></label><div class="formgrid2"><label>Correo<input id="gEmail" type="email"></label><label>Teléfono<input id="gPhone" type="tel"></label></div><div class="formgrid2"><label>Fecha<select id="gDate" onchange="guestSlots('${id}')">${days.map(d=>`<option value="${d.key}">${d.label} ${d.key}</option>`).join('')}</select></label><label>Horario<select id="gTime"></select></label></div><label>Notas<textarea id="gNotes"></textarea></label>${action('Enviar solicitud a Skilly',`submitGuestRequest('${id}')`,'primary full')}<p class="hint">También puedes ${action('Crear cuenta',"closeM('guestBooking');openRegister();chooseRegRole('organizacion')",'ghost')}.</p>`;
  guestSlots(id);
};
async function guestSlots(id){try{const date=$('gDate').value;if(!date)return;const r=await Api.list(`services/${id}/availability?date=${date}`);$('gTime').innerHTML=r.slots.map(h=>`<option>${h}</option>`).join('')||'<option value="">Sin disponibilidad</option>';}catch(e){toast(e.message);}}
submitGuestRequest=id=>perform(async()=>{
  const r=await request('guest-requests',{serviceId:id,contactName:$('gName').value,orgName:$('gOrg').value,email:$('gEmail').value,phone:$('gPhone').value,date:$('gDate').value,time:$('gTime').value,notes:$('gNotes').value});
  closeM('guestBooking');modal('Solicitud recibida',`<p>Tu número de reserva es <b>${esc(r.bookingId)}</b>.</p><p>${r.emailSent?'Enviamos a tu correo el enlace seguro para consultar tu reserva.':'Tu solicitud quedó guardada. Skilly gestionará el envío de tu enlace de acceso.'}</p><p class="hint">Consulta el plazo de respuesta desde tu enlace de acceso. La solicitud siempre vence antes del inicio del servicio.</p>`);
});
const originalCheckout=openCheckout;
openCheckout=id=>{
  const b=BOOKINGS.find(x=>x.id===id);if(!b||b.status!=='aceptado')return toast('El profesional debe aceptar primero.');
  originalCheckout(id);
  $('checkoutBox').querySelector('.payMethods').insertAdjacentHTML('beforebegin',`<div class="termsBox"><p>Precio final: <b>${fmtMoney(b.amount)}</b>. Cancelación voluntaria: ${b.policy?`100 % con al menos 48 h de anticipación al inicio de la dedicación; ${b.policy.lateRefund} % después. Incumplimiento profesional confirmado: 100 %. Reclamos: 30 días tras liquidación. Tolerancia: 15 minutos.`:`${b.refundPolicyPercent} % según condiciones originales.`} La identidad se revela después del pago. Skilly autoriza la liquidación tras la entrega confirmada.</p><label class="inlineCheck"><input id="acceptTerms" type="checkbox"> Acepto las condiciones de contratación y cancelación.</label></div>`);
  if(!SERVER_CONFIG.simulatedEnabled)$('checkoutBox').querySelector('[onclick^="payWithSimulated"]').hidden=true;
};
const oldCreate=Api.create;
Api.create=(path,data)=>{if(['payments','payments/webpay/create','payments/paypal/create-order'].includes(path))data={...data,acceptTerms:!!$('acceptTerms')?.checked};return oldCreate(path,data);};
function panelTabs(items){return `<div class="workspaceTabs" role="navigation" aria-label="Secciones de mi panel">${items.map(([id,label])=>`<button class="${panelTab===id?'on':''}" onclick="switchPanel('${id}')">${label}</button>`).join('')}</div>`;}
function switchPanel(tab){panelTab=tab;renderDashboard();}
renderDashboard=()=>{
  const el=$('dashContent');if(!el)return;
  if(!SESSION){el.innerHTML=empty('Inicia sesión para ver tus reservas.');return;}
  if(SESSION.role==='profesional')renderProDashboard(el);else renderOrgDashboard(el);
};
function summary(pro=false){
  const totals=SkillyView.metrics(BOOKINGS);
  return `<div class="kpiGrid">${kpi('Solicitudes pendientes',totals.pending)}${kpi('Próximas reservas',totals.upcoming)}${kpi(pro?'Neto pendiente de liquidar':'Pagado menos devoluciones',fmtMoney(pro?totals.pendingNet:totals.paidNet),pro?'Sujeto a entrega, reclamos y autorización de Skilly':'Incluye retenciones de cancelación')}${kpi('Servicios completados',totals.completed)}</div>`;
}
function financialBreakdown(b){return `<div class="moneyBreakdown">${SkillyView.financialLines(b).map(([label,value])=>`<span>${esc(label)}${value===null?'':': '+fmtMoney(value)}</span>`).join('')}</div>`;}
function bookingCards(rows){return rows.length?rows.map(b=>{
  const pro=SESSION.role==='profesional',admin=SESSION.role==='admin',client=!pro&&!admin;
  const paid=PAYMENTS.find(p=>p.bookingId===b.id&&['pagado','liberado','reembolsado'].includes(p.status));
  let buttons='';
  if(pro&&b.status==='solicitado')buttons+=action('Aceptar',`bookingAction('${b.id}','aceptado')`,'primary')+action('Rechazar',`bookingAction('${b.id}','rechazado')`,'danger');
  if(client&&b.status==='aceptado')buttons+=action('Aceptar condiciones y pagar',`openCheckout('${b.id}')`,'primary');
  if(pro&&b.status==='pagado')buttons+=action('Marcar entregado',`markDelivered('${b.id}')`,'primary');
  if(client&&b.status==='entregado')buttons+=action('Confirmar entrega',`confirmDelivery('${b.id}')`,'primary');
  if(client&&['entregado','confirmado'].includes(b.status))buttons+=action('Evaluar',`openEvaluate('${b.id}')`);
  if(b.paidAt)buttons+=action('Chat',`openChat('${b.id}')`)+action('Documentos',`openDocuments('${b.id}')`);
  if(paid)buttons+=action('Comprobante',`downloadReceiptFor('${paid.id}','${b.id}')`);
  if(b.paidAt||(pro&&b.status==='aceptado'))buttons+=action('Incidencias',`openIncident('${b.id}')`);
  if((client&&['solicitado','gestion_skilly','aceptado','pagado'].includes(b.status))||(admin&&!['cancelado','rechazado','expirado'].includes(b.status)))buttons+=action('Cancelar',`openCancelModal('${b.id}',${admin})`,'danger');
  if(admin&&['gestion_skilly','solicitado','aceptado','pagado'].includes(b.status))buttons+=action('Reprogramar',`rescheduleBooking('${b.id}')`);
  if(admin&&b.status==='confirmado')buttons+=paid?.provider==='simulado'?action('Autorizar liquidación simulada',`releaseBooking('${b.id}')`,'primary'):action('Preparar transferencia externa',`preparePayout('${b.id}')`,'primary');
  const deadline=b.status==='aceptado'?b.paymentDeadline:['solicitado','gestion_skilly'].includes(b.status)?b.responseDeadline:null;
  const link=safeUrl(b.linkedin);
  return `<article class="dashCard bookingCard"><div class="cardhead"><div><small>${esc(b.id)}</small><h3>${esc(b.service)}</h3></div>${badge(b.status)}</div><div class="bookingMeta"><span>◷ ${esc(b.date)} · ${esc(b.time)} <small>(Chile)</small></span><b>${fmtMoney(b.amount)}</b></div><p class="hint">${pro?esc(b.orgName):b.professionalName?esc(b.professionalName):'Nombre y LinkedIn disponibles después del pago'}${link&&!pro?` · <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver LinkedIn ↗</a>`:''}</p>${deadline?`<p class="hint">Plazo: ${prettyDate(deadline)}</p>`:''}${b.notes?`<p>${esc(b.notes)}</p>`:''}${(pro||admin)?financialBreakdown(b):''}${b.refundAmount!=null&&(!(pro||admin)||b.status!=='cancelado')?`<p>Reembolso registrado: ${fmtMoney(b.refundAmount)}</p>`:''}${b.cancellationStatus?'<p class="statusBadge status-revision">Cancelación en conciliación con Skilly</p>':''}<div class="actionRow">${buttons}</div></article>`;
}).join(''):empty('Aún no hay reservas en esta sección.');}
function bookingAction(id,status){perform(async()=>{await Api.update('bookings',id,{status});await refreshAll();toast(status==='aceptado'?'Solicitud aceptada. El cliente ya puede pagar.':'Solicitud rechazada.');});}
renderProDashboard=el=>{
  const p=PROFESSIONALS.find(x=>x.id===SESSION.professionalId);if(!p){el.innerHTML=empty('No se encontró el perfil.');return;}
  el.innerHTML=`<div class="workspaceHeading"><div><small>MI ESPACIO PROFESIONAL</small><h2>Hola, ${esc(p.name)}</h2><p class="hint">Tus servicios, tu agenda y tus contrataciones.</p></div>${badge(p.status)}</div>${panelTabs([['inicio','Dashboard'],['servicios','Mis servicios'],['calendario','Calendario'],['disponibilidad','Disponibilidad'],['reservas','Solicitudes y reservas'],['historial','Historial'],['perfil','Perfil y antecedentes']])}<div id="panelBody"></div>`;
  const body=$('panelBody');
  if(panelTab==='inicio')body.innerHTML=summary(true)+`<div class="sectionTitle"><h3>Solicitudes por responder</h3>${action('Ver agenda',"switchPanel('calendario')")}</div>`+bookingCards(BOOKINGS.filter(b=>b.status==='solicitado'));
  if(panelTab==='reservas')body.innerHTML=bookingCards(BOOKINGS.filter(b=>!['completado','cancelado','rechazado','expirado'].includes(b.status)));
  if(panelTab==='historial')body.innerHTML=bookingCards(BOOKINGS.filter(SkillyView.isTerminal));
  if(panelTab==='servicios')renderMyServices(body);
  if(panelTab==='calendario')renderCalendar(body,false);
  if(panelTab==='disponibilidad')renderAvailability(body,p);
  if(panelTab==='perfil')renderProfessionalProfile(body,p);
};
renderOrgDashboard=el=>{
  const guest=SESSION.role==='invitado';
  const tabs=guest?[['reservas','Mi reserva'],['pagos','Pagos'],['comprobantes','Comprobantes'],['chat','Chat']]:[['inicio','Resumen'],['reservas','Reservas'],['historial','Historial'],['pagos','Pagos'],['comprobantes','Comprobantes'],['chat','Chat'],['perfil','Perfil']];
  if(guest&&panelTab==='inicio')panelTab='reservas';
  el.innerHTML=`<div class="workspaceHeading"><div><small>${guest?'CONSULTA SEGURA':'MI ORGANIZACIÓN'}</small><h2>${esc(SESSION.name)}</h2><p class="hint">Todas tus contrataciones en un solo lugar.</p></div>${guest?'':action('Explorar servicios',"page('market')",'primary')}</div>${panelTabs(tabs)}<div id="panelBody"></div>`;
  const body=$('panelBody');
  if(panelTab==='inicio')body.innerHTML=summary()+`<h3>Últimas reservas</h3>`+bookingCards(BOOKINGS.slice(0,4));
  if(panelTab==='reservas')body.innerHTML=bookingCards(guest?BOOKINGS:BOOKINGS.filter(b=>!['completado','cancelado','rechazado','expirado'].includes(b.status)));
  if(panelTab==='historial')body.innerHTML=bookingCards(BOOKINGS.filter(SkillyView.isTerminal));
  if(['pagos','comprobantes'].includes(panelTab))body.innerHTML=paymentCards(PAYMENTS);
  if(panelTab==='chat')body.innerHTML=bookingCards(BOOKINGS.filter(b=>b.paidAt));
  if(panelTab==='perfil')renderProfile(body);
};
function paymentCards(payments){return payments.length?payments.map(p=>{
  const b=BOOKINGS.find(b=>b.id===p.bookingId);return `<div class="dashCard"><div class="cardhead"><div><h3>${esc(b?.service||'Pago')}</h3><p class="hint">${esc(p.method)} · ${prettyDate(p.createdAt)}</p></div><span class="statusBadge">${esc(SkillyView.paymentLabel(p.status))}</span></div>${b?`<p>Reserva: ${esc(bookingStatusLabel(b.status))}</p>`:''}${p.refundAmount!=null?`<p>Devolución: ${fmtMoney(p.refundAmount)}</p>`:''}<div class="row"><span>Total del servicio</span><b>${fmtMoney(p.amount)}</b></div>${SESSION.role==='admin'&&b?financialBreakdown(b):''}<div class="actionRow">${p.invoiceNumber?action('Descargar comprobante',`downloadReceiptFor('${p.id}','${p.bookingId}')`):''}${b?.paidAt?action('Boletas y facturas adjuntas',`openDocuments('${b.id}')`):''}${SESSION.role==='admin'&&['iniciado','procesando','revision'].includes(p.status)?action('Consultar estado al proveedor',`reconcilePayment('${p.id}')`):''}${SESSION.role==='admin'&&p.status==='revision'&&p.invoiceNumber&&!b?.paidAt?action('Reembolsar cobro fuera de plazo',`refundLate('${p.id}')`,'danger'):''}</div></div>`;
}).join(''):empty('Aún no hay pagos.');}
function reconcilePayment(id){perform(async()=>{const r=await request('admin/payments/'+id+'/reconcile',{});await refreshAll();toast(r.status==='review'?'El cobro se confirmó fuera del plazo. Requiere gestionar su devolución.':'Estado consultado.');});}
function renderMyServices(el){el.innerHTML=`<div class="sectionTitle"><div><h3>Mis servicios</h3><p class="hint">Los cambios se revisan antes de publicarse. La versión aprobada sigue disponible.</p></div>${action('＋ Nuevo servicio',"editService()",'primary')}</div><div class="serviceGrid">${SERVICES.map(s=>`<article class="dashCard"><div class="cardhead"><h3>${esc(s.title)}</h3>${badge(s.status)}</div><p>${esc(s.description)}</p><div class="row"><span>Precio</span><b>${fmtMoney(s.price)}</b></div><div class="row"><span>Atención + preparación + seguimiento</span><b>${s.durationMinutes+s.prepMinutes+s.followupMinutes} min</b></div><p class="hint">Comisión aplicada: ${s.effectiveCommission} %. Neto estimado: ${fmtMoney(s.price-Math.round(s.price*s.effectiveCommission/100))}.</p>${s.adminNotes?`<p class="reviewNote">Skilly: ${esc(s.adminNotes)}</p>`:''}${s.published?`<p class="hint">Versión publicada: ${esc(s.published.title)} · ${fmtMoney(s.published.price)}</p>`:'<p class="hint">Aún no publicado.</p>'}${action('Editar servicio',`editService('${s.id}')`)}</article>`).join('')||empty('Crea tu primer servicio.')}</div>`;}
function editService(id){selectedService=id||null;const s=SERVICES.find(s=>s.id===id)||{};modal(id?'Editar servicio':'Nuevo servicio',`<label>Título<input id="editTitle" value="${esc(s.title||'')}"></label><label>Descripción<textarea id="editDesc">${esc(s.description||'')}</textarea></label><div class="formgrid2"><label>Categoría<select id="editCategory">${['Tecnología','Marketing','Diseño','Consultoría'].map(v=>`<option ${v===s.category?'selected':''}>${v}</option>`).join('')}</select></label><label>Modalidad<select id="editModality">${['Remoto','Híbrido','Presencial'].map(v=>`<option ${v===s.modality?'selected':''}>${v}</option>`).join('')}</select></label></div><label>Precio total en CLP<input id="editPrice" type="number" min="1" value="${s.price||''}"></label><label>Etiquetas separadas por coma<input id="editTags" value="${esc((s.tags||[]).join(', '))}"></label><div class="formgrid3"><label>Atención (min)<input id="editDuration" type="number" min="15" value="${s.durationMinutes||60}"></label><label>Preparación (min)<input id="editPrep" type="number" min="0" value="${s.prepMinutes||0}"></label><label>Seguimiento (min)<input id="editFollow" type="number" min="0" value="${s.followupMinutes||0}"></label></div><p class="hint">Describe el servicio sin nombre, enlaces de contacto ni LinkedIn. Skilly revisará la publicación.</p>${action('Enviar a revisión','saveService()','primary')}`);}
function saveService(){perform(async()=>{const body={title:$('editTitle').value,description:$('editDesc').value,category:$('editCategory').value,modality:$('editModality').value,price:Number($('editPrice').value),tags:$('editTags').value.split(',').map(s=>s.trim()).filter(Boolean),durationMinutes:Number($('editDuration').value),prepMinutes:Number($('editPrep').value),followupMinutes:Number($('editFollow').value)};await request('services'+(selectedService?'/'+selectedService:''),body,selectedService?'PATCH':'POST');closeM('workspaceModal');await refreshAll();toast('Servicio enviado a revisión.');});}
function renderAvailability(el,p){el.innerHTML=`<div class="dashCard"><h3>Mi jornada laboral</h3><p class="hint">Todos tus servicios comparten esta agenda. Los horarios usan la zona de Chile continental.</p><div class="checkgrid">${WEEKDAYS.map(d=>`<label><input class="availabilityDay" type="checkbox" value="${d}" ${p.availability.days?.includes(d)?'checked':''}> ${d}</label>`).join('')}</div><div class="formgrid2"><label>Inicio de jornada<input id="workStart" type="time" value="${p.workStart}"></label><label>Fin de jornada<input id="workEnd" type="time" value="${p.workEnd}"></label></div><label>Horas de inicio ofrecidas (separadas por coma)<input id="workHours" value="${esc((p.availability.hours||[]).join(', '))}" placeholder="09:00, 10:30, 15:00"></label><label>Fechas bloqueadas (una por línea, AAAA-MM-DD)<textarea id="blockedDates" placeholder="2026-12-25">${esc(p.blockedDates.join('\n'))}</textarea></label><p class="hint">Los bloqueos afectan nuevas solicitudes; las reservas ya aceptadas se mantienen y deben gestionarse individualmente.</p><div class="formgrid3"><label>Máximo diario<input type="number" min="0" id="limitDay" value="${p.maxPerDay??''}" placeholder="Sin límite"></label><label>Máximo semanal<input type="number" min="0" id="limitWeek" value="${p.maxPerWeek??''}" placeholder="Sin límite"></label><label>Máximo mensual<input type="number" min="0" id="limitMonth" value="${p.maxPerMonth??''}" placeholder="Sin límite"></label></div>${action('Guardar disponibilidad',`saveAvailability('${p.id}')`,'primary')}</div>`;}
function saveAvailability(id){perform(async()=>{const num=id=>$(id).value===''?null:Number($(id).value);await request(`professionals/${id}/self`,{availability:{days:[...document.querySelectorAll('.availabilityDay:checked')].map(c=>c.value),hours:$('workHours').value.split(',').map(s=>s.trim()).filter(Boolean)},workStart:$('workStart').value,workEnd:$('workEnd').value,blockedDates:$('blockedDates').value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean),maxPerDay:num('limitDay'),maxPerWeek:num('limitWeek'),maxPerMonth:num('limitMonth')},'PATCH');await refreshAll();toast('Agenda actualizada.');});}
function renderProfile(el){const p=SESSION.profile||{};el.innerHTML=`<div class="dashCard"><h3>Datos de mi cuenta</h3><label>Nombre<input id="profileName" value="${esc(SESSION.name)}"></label><label>Correo<input value="${esc(SESSION.email)}" disabled></label><div class="formgrid2"><label>Teléfono<input type="tel" autocomplete="tel" placeholder="+56 9 1234 5678" id="profilePhone" value="${esc(p.phone||'')}"></label><label>RUT<input placeholder="12345678-5" id="profileRut" value="${esc(p.rut||'')}"></label></div><label>Dirección<input id="profileAddress" value="${esc(p.address||'')}"></label><p class="hint">Correo ${SESSION.verified?'verificado':'pendiente de verificación'}.</p>${action('Guardar perfil','saveProfile()','primary')}${action('Cambiar contraseña','openRecovery()')}</div>`;}
function saveProfile(){perform(async()=>{saveSession(await request('auth/profile',{name:$('profileName').value,phone:$('profilePhone').value,rut:$('profileRut').value,address:$('profileAddress').value},'PATCH'));await refreshAll();toast('Perfil actualizado.');});}
function renderProfessionalProfile(el,p){renderProfile(el);el.insertAdjacentHTML('beforeend',`<div class="dashCard"><h3>Antecedentes profesionales</h3>${badge(p.status)}<p class="reviewNote">${esc(p.adminNotes||'Skilly revisará tu información y los servicios por separado.')}</p><label>LinkedIn<input id="rvLinkedin" value="${esc(p.validation.linkedin||'')}"></label><div class="formgrid2"><label>Años de experiencia<input id="rvYears" value="${esc(p.validation.yearsExperience||'')}"></label><label>Certificaciones<input id="rvCerts" value="${esc(p.validation.certifications||'')}"></label></div><label>CV / antecedentes<textarea id="rvCv">${esc(p.validation.cv||'')}</textarea></label><label>Referencias<textarea id="rvRefs">${esc(p.validation.references||'')}</textarea></label><label>Portafolio<input id="rvPortfolio" value="${esc(p.validation.portfolio||'')}"></label><label>Motivación<textarea id="rvMotivation">${esc(p.validation.motivation||'')}</textarea></label>${action('Enviar antecedentes a revisión',`resubmitValidation('${p.id}')`,'outline')}</div>`);}
resubmitValidation=id=>perform(async()=>{const validation={linkedin:$('rvLinkedin').value,yearsExperience:$('rvYears').value,certifications:$('rvCerts').value,cv:$('rvCv').value,references:$('rvRefs').value,portfolio:$('rvPortfolio').value,motivation:$('rvMotivation').value};await request(`professionals/${id}/self`,{validation},'PATCH');await refreshAll();toast('Antecedentes reenviados a revisión.');});
let calMode='month',calDate=new Date(),calStatus='',calProfessional='',calService='',calAdmin=false;
function dateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function calendarMove(n){if(calMode==='month')calDate=new Date(calDate.getFullYear(),calDate.getMonth()+n,1);else calDate.setDate(calDate.getDate()+n*(calMode==='week'?7:1));redrawCalendar();}
function redrawCalendar(){renderCalendar(calAdmin?$('adminContent'):$('panelBody'),calAdmin);}
function calendarMode(mode){calMode=mode;redrawCalendar();}
function renderCalendar(el,admin){
  if(!el)return;calAdmin=admin;
  const rows=BOOKINGS.filter(b=>(!calStatus||b.status===calStatus)&&(!calProfessional||b.professionalId===calProfessional)&&(!calService||b.serviceId===calService));
  const title=calDate.toLocaleDateString('es-CL',{month:'long',year:'numeric',...(calMode==='day'?{day:'numeric'}:{})});
  el.innerHTML=`<div class="calendarShell"><div class="calendarToolbar"><div><small>AGENDA ${admin?'SKILLY':'PROFESIONAL'}</small><h2>${title}</h2><p class="hint">Hora de Chile · incluye el tiempo de preparación y seguimiento</p></div><div class="actionRow">${action('‹',"calendarMove(-1)")}${action('Hoy',"calDate=new Date();redrawCalendar()")}${action('›',"calendarMove(1)")}</div></div><div class="calendarToolbar"><div class="segmented">${[['month','Mes'],['week','Semana'],['day','Día']].map(([v,l])=>`<button class="${calMode===v?'on':''}" onclick="calendarMode('${v}')">${l}</button>`).join('')}</div><div class="calendarFilters">${admin?`<label>Profesional<select onchange="calProfessional=this.value;redrawCalendar()"><option value="">Todos</option>${PROFESSIONALS.map(p=>`<option value="${p.id}" ${calProfessional===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`:''}<label>Servicio<select onchange="calService=this.value;redrawCalendar()"><option value="">Todos</option>${SERVICES.map(s=>`<option value="${s.id}" ${calService===s.id?'selected':''}>${esc(s.title)}</option>`).join('')}</select></label><label>Estado<select onchange="calStatus=this.value;redrawCalendar()"><option value="">Todos</option>${['gestion_skilly','solicitado','aceptado','pagado','entregado','confirmado','completado','cancelado','rechazado','expirado'].map(s=>`<option value="${s}" ${calStatus===s?'selected':''}>${bookingStatusLabel(s)}</option>`).join('')}</select></label></div></div><div class="calendarLegend">${['solicitado','aceptado','pagado','entregado','completado','cancelado'].map(badge).join('')}</div><div id="calendarGrid"></div></div>`;
  const grid=$('calendarGrid'),today=dateKey(new Date());
  const event=b=>`<button class="calEvent status-${b.status}" onclick="showBooking('${b.id}')"><b>${esc(b.time)} · ${esc(b.service)}</b><span>${admin?esc(b.professionalName):esc(b.orgName)}</span><small>${bookingStatusLabel(b.status)}</small></button>`;
  if(calMode==='month'){
    const start=new Date(calDate.getFullYear(),calDate.getMonth(),1);start.setDate(start.getDate()-((start.getDay()+6)%7));
    const cells=[];for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const key=dateKey(d),events=rows.filter(b=>b.date===key).sort((a,b)=>a.time.localeCompare(b.time));const p=PROFESSIONALS.find(p=>p.id===SESSION.professionalId);const blocked=!admin&&p?.blockedDates.includes(key);
      cells.push(`<div class="calendarDay ${d.getMonth()!==calDate.getMonth()?'outside':''} ${key===today?'today':''} ${blocked?'blocked':''}"><button class="dayNumber" aria-label="Ver ${key}" onclick="calDate=new Date('${key}T12:00:00');calendarMode('day')">${d.getDate()}</button>${blocked?'<small>Bloqueado</small>':''}${events.slice(0,3).map(event).join('')}${events.length>3?action('+'+(events.length-3)+' reservas',`calDate=new Date('${key}T12:00:00');calendarMode('day')`,'ghost small'):''}</div>`);}
    grid.innerHTML=`<div class="monthScroll"><div class="calendarWeekdays">${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d=>`<b>${d}</b>`).join('')}</div><div class="monthGrid">${cells.join('')}</div></div>`;
  }else{
    const start=new Date(calDate);if(calMode==='week')start.setDate(start.getDate()-((start.getDay()+6)%7));
    const n=calMode==='week'?7:1,days=Array.from({length:n},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d;});
    grid.innerHTML=`<div class="agendaScroll"><div class="agendaGrid ${calMode}">${days.map(d=>{const key=dateKey(d),events=rows.filter(b=>b.date===key).sort((a,b)=>a.time.localeCompare(b.time));return `<div class="agendaDay ${key===today?'today':''}"><h3>${d.toLocaleDateString('es-CL',{weekday:'short',day:'numeric',month:'short'})}</h3>${events.length?events.map(b=>`<div class="agendaEntry">${event(b)}<p class="hint">${b.prepMinutes} min preparación · ${b.durationMinutes} min atención · ${b.followupMinutes} min seguimiento</p></div>`).join(''):'<p class="hint">Sin reservas</p>'}</div>`;}).join('')}</div></div>`;
  }
}
function showBooking(id){const b=BOOKINGS.find(b=>b.id===id);if(b)modal('Detalle de reserva',bookingCards([b]));}
function rescheduleBooking(id){const b=BOOKINGS.find(b=>b.id===id);modal('Reprogramar reserva',`<p>${esc(b.service)} · ${esc(b.orgName)}</p><div class="formgrid2"><label>Fecha<input id="newDate" type="date" value="${b.date}"></label><label>Hora<input id="newTime" type="time" value="${b.time}"></label></div><p class="hint">Se verificará la disponibilidad real y se notificará al cliente.</p>${action('Guardar cambio',`saveReschedule('${id}')`,'primary')}`);}
function saveReschedule(id){perform(async()=>{await Api.update('bookings',id,{date:$('newDate').value,time:$('newTime').value});closeM('workspaceModal');await refreshAll();toast('Reserva reprogramada.');});}
function releaseBooking(id){perform(async()=>{const r=await request(`admin/bookings/${id}/release`,{});closeM('workspaceModal');await refreshAll();toast(r.message,6500);});}
renderAdminCalendar=el=>renderCalendar(el,true);
const adminItems=[['inicio','⌂','Inicio'],['dashboard','▦','Dashboard'],['calendario','▣','Calendario'],['reservas','◷','Reservas'],['validaciones','✓','Validaciones'],['servicios','◇','Servicios y comisiones'],['profesionales','♙','Profesionales'],['organizaciones','▤','Organizaciones'],['guest','✉','Solicitudes sin registro'],['evaluaciones','☆','Evaluaciones privadas'],['incidencias','!','Incidencias'],['pagos','$','Pagos y liquidaciones'],['ajustes','⚙','Configuración'],['usuarios','♧','Administradores'],['auditoria','≡','Actividad']];
setAdminTab=section=>adminNavigate(section);
const previousAdminRender=renderAdmin;
renderAdmin=()=>{
  const el=$('adminContent');if(!el)return;
  if(!SESSION||SESSION.role!=='admin'){el.innerHTML=`<div class="adminWelcome"><small>ACCESO PRIVADO</small><h2>El espacio de gestión de Skilly</h2><p>Ingresa con tu cuenta para gestionar profesionales, reservas y pagos.</p>${action('Ingresar',"openM('login')",'primary')}</div>`;return;}
  $('adminTabsBar').hidden=true;
  if(adminSection==='inicio'){el.innerHTML=`<div class="workspaceHeading"><div><small>OPERACIÓN SKILLY</small><h2>Hola, ${esc(SESSION.name)}</h2><p class="hint">Gestiona las solicitudes y acompaña cada contratación.</p></div>${action('Ver calendario',"adminNavigate('calendario')",'primary')}</div><div class="kpiGrid">${kpi('Por validar',PROFESSIONALS.filter(p=>p.status==='pendiente').length)}${kpi('Servicios por revisar',SERVICES.filter(s=>s.status==='pendiente').length)}${kpi('Solicitudes de invitados',BOOKINGS.filter(b=>b.status==='gestion_skilly').length)}${kpi('Por liquidar',BOOKINGS.filter(b=>b.status==='confirmado').length)}</div><h3>Reservas recientes</h3>`+bookingCards(BOOKINGS.slice(0,5));return;}
  if(adminSection==='reservas'){el.innerHTML=bookingCards(BOOKINGS);return;}
  if(adminSection==='servicios'){renderAdminServices(el);return;}
  if(adminSection==='incidencias'){renderIncidents(el);return;}
  if(adminSection==='usuarios'){renderUsers(el);return;}
  if(adminSection==='auditoria'){renderAudit(el);return;}
  if(adminSection==='pagos'){el.innerHTML=action('Operaciones, devoluciones y avisos pendientes','showOperations()','primary')+paymentCards(PAYMENTS);return;}
  previousAdminRender();
};
function renderAdminServices(el){el.innerHTML=`<p class="hint">Revisa el contenido y verifica que no incluya identidad ni datos de contacto. Las modificaciones no cambian las reservas existentes.</p>`+SERVICES.map(s=>`<div class="dashCard"><div class="cardhead"><div><h3>${esc(s.title)}</h3><p class="hint">${esc(s.professionalName)} · profesional ${esc(s.professionalStatus)}</p></div>${badge(s.status)}</div><p>${esc(s.description)}</p><div class="row"><span>Precio propuesto</span><b>${fmtMoney(s.price)}</b></div><div class="row"><span>Atención / preparación / seguimiento</span><b>${s.durationMinutes} / ${s.prepMinutes} / ${s.followupMinutes} min</b></div>${s.published?`<details><summary>Ver versión publicada</summary><p>${esc(s.published.title)} · ${fmtMoney(s.published.price)}</p><p>${esc(s.published.description)}</p></details>`:'<p class="hint">Sin versión publicada.</p>'}<label>Observaciones<textarea id="serviceNotes-${s.id}">${esc(s.adminNotes||'')}</textarea></label><div class="actionRow">${action('Aprobar',`reviewService('${s.id}','validado')`,'primary')}${action('Solicitar información',`reviewService('${s.id}','info_solicitada')`)}${action('Rechazar',`reviewService('${s.id}','rechazado')`,'danger')}</div><div class="commissionSetting"><label>Comisión de este servicio (%)<input type="number" min="0" max="100" step="0.1" id="commission-${s.id}" value="${s.commissionPercent??''}" placeholder="General: ${s.effectiveCommission}%"></label>${action('Guardar comisión',`saveServiceCommission('${s.id}')`)}<p class="hint">Deja el campo vacío para usar la comisión general. Se descuenta del precio del profesional.</p></div></div>`).join('');}
function reviewService(id,status){perform(async()=>{await request('admin/services/'+id,{status,revision:SERVICES.find(s=>s.id===id)?.revision,adminNotes:$('serviceNotes-'+id).value},'PATCH');await refreshAll();toast('Revisión guardada.');});}
function saveServiceCommission(id){perform(async()=>{const value=$('commission-'+id).value;await request('admin/services/'+id,{commissionPercent:value===''?null:Number(value)},'PATCH');await refreshAll();toast('Comisión actualizada para nuevas solicitudes.');});}
renderAdminSettings=async el=>{
  try{const s=await Api.adminGet('settings');el.innerHTML=`<div class="dashCard"><h3>Comisión general de Skilly</h3><p class="hint">Se descuenta del precio del profesional. Cada servicio puede tener una comisión diferente en “Servicios y comisiones”. Las reservas existentes conservan su porcentaje.</p><label>Comisión general (%)<input id="setCommission" type="number" min="0" max="100" step="0.1" value="${s.commission_percent}"></label></div><div class="dashCard"><h3>Plazos de reservas</h3><div class="formgrid2"><label>Horas para aceptar una solicitud<input id="setResponse" type="number" min="1" value="${s.response_hours}"></label><label>Horas para pagar tras la aceptación<input id="setPayment" type="number" min="1" value="${s.payment_hours}"></label></div><p class="hint">Siempre vencen antes del inicio de la dedicación reservada.</p></div><div class="dashCard"><h3>Capacidad de revisión semanal</h3><label>Revisiones por semana<input id="setWeeklyCap" type="number" min="1" value="${s.admin_weekly_review_capacity}"></label></div><div class="dashCard"><h3>Política de cancelación</h3><label>Porcentaje a reembolsar<input id="setRefundPct" type="number" min="0" max="100" value="${s.default_cancellation_refund_percent}"></label><p class="hint">Valor heredado de la versión anterior. Se informa antes del pago y se guarda en cada solicitud.</p></div>${action('Guardar configuración','saveSettings()','primary')}${action('Perfil de mi cuenta','adminProfile()')}${action('Correos de prueba','showOutbox()')}`;}catch(e){toast(e.message);}
};
saveSettings=()=>perform(async()=>{await request('admin/settings',{commissionPercent:Number($('setCommission').value),responseHours:Number($('setResponse').value),paymentHours:Number($('setPayment').value),adminWeeklyReviewCapacity:Number($('setWeeklyCap').value),defaultCancellationRefundPercent:Number($('setRefundPct').value)},'PATCH');await loadServerConfig();toast('Configuración guardada.');});
function adminProfile(){modal('Mi cuenta','<div id="adminProfileForm"></div>');renderProfile($('adminProfileForm'));}
async function renderUsers(el){try{const users=await Api.adminGet('users');el.innerHTML=`<div class="sectionTitle"><h3>Administradores y accesos</h3>${action('Invitar administrador',"inviteUser('admin')",'primary')}${action('Habilitar perfil anterior',"inviteUser('profesional')")}</div><p class="hint">Todos los administradores tienen los mismos permisos. Las contraseñas se crean desde un enlace enviado por correo.</p>`+users.map(u=>`<div class="dashCard"><b>${esc(u.name)}</b><p class="hint">${esc(u.email)} · ${esc(u.role)}</p></div>`).join('');}catch(e){toast(e.message);}}
function inviteUser(role){modal(role==='admin'?'Invitar administrador':'Habilitar cuenta de un profesional existente',`<label>Nombre<input id="inviteName"></label><label>Correo<input id="inviteEmail" type="email"></label>${action('Enviar invitación',`sendInvite('${role}')`,'primary')}`);}
function sendInvite(role){perform(async()=>{const r=await request('admin/users',{name:$('inviteName').value,email:$('inviteEmail').value,role});closeM('workspaceModal');renderUsers($('adminContent'));toast(r.emailSent?'Invitación enviada.':'Cuenta creada. Revisa Correos de prueba si Gmail no está configurado.');});}
async function renderAudit(el){try{const rows=await Api.adminGet('audit');el.innerHTML='<h3>Actividad administrativa y accesos</h3>'+rows.map(r=>`<div class="dashCard"><b>${esc(r.action)}</b><p class="hint">${prettyDate(r.created_at)} · ${esc(r.actor)}</p><p>${esc(r.target)} ${esc(r.detail||'')}</p></div>`).join('');}catch(e){toast(e.message);}}
function showOutbox(){perform(async()=>{const rows=await Api.adminGet('outbox');modal('Correos de prueba',`<p class="hint">Bandeja local de desarrollo. Permite probar enlaces si Gmail no está configurado. No está disponible en producción.</p>`+rows.map(r=>`<div class="dashCard"><b>${esc(r.subject)}</b><p>${esc(r.recipient)} · ${r.sent?'Enviado':'Pendiente de envío'}</p><pre class="mailBody">${esc(r.body)}</pre></div>`).join(''));});}
const oldGuestAdmin=renderAdminGuestRequests;
renderAdminGuestRequests=async el=>{await oldGuestAdmin(el);for(const g of GUEST_REQUESTS){const card=$('gnotes-'+g.id)?.closest('.dashCard');const b=BOOKINGS.find(b=>b.id===g.bookingId);if(card&&b?.status==='gestion_skilly')card.insertAdjacentHTML('beforeend',action('Enviar al profesional',`convertGuestRequest('${g.id}')`,'primary'));}};
convertGuestRequest=id=>perform(async()=>{await request('admin/guest-requests/'+id+'/convert',{});await refreshAll();toast('Solicitud enviada al profesional para su aceptación.');});
async function openDocuments(id){try{const rows=await Api.list('bookings/'+id+'/attachments');modal('Comprobantes, boletas y facturas',`<p class="hint">Puedes adjuntar documentos emitidos por fuera de Skilly. El comprobante de pago de la plataforma no reemplaza una boleta o factura tributaria.</p>${rows.map(d=>`<div class="miniRow"><b>${esc(d.name)}</b><a class="btn outline" href="/api/attachments/${d.id}" download>Descargar</a></div>`).join('')||empty('No hay documentos adjuntos.')}<label>Adjuntar PDF, PNG o JPG (hasta 5 MB)<input id="attachmentFile" type="file" accept="application/pdf,image/png,image/jpeg"></label>${action('Subir documento',`uploadDocument('${id}')`,'primary')}`);}catch(e){toast(e.message);}}
function uploadDocument(id){perform(async()=>{const file=$('attachmentFile').files[0];if(!file)throw new Error('Selecciona un archivo.');if(file.size>5*1024*1024)throw new Error('Máximo 5 MB.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});await request('bookings/'+id+'/attachments',{name:file.name,mime:file.type,data});await openDocuments(id);toast('Documento adjuntado.');});}
async function openIncident(id){try{const rows=await Api.list('bookings/'+id+'/incidents');modal('Incidencias de la reserva',rows.map(i=>`<div class="dashCard"><b>${esc(i.status)}</b><p>${esc(i.body)}</p>${i.resolution?`<p>Resolución: ${esc(i.resolution)}</p>`:''}</div>`).join('')+`<label>Describe lo ocurrido<textarea id="incidentBody"></textarea></label>${action('Enviar a Skilly',`submitIncident('${id}')`,'primary')}`);}catch(e){toast(e.message);}}
function submitIncident(id){perform(async()=>{await request('bookings/'+id+'/incidents',{body:$('incidentBody').value});await openIncident(id);toast('Incidencia registrada. La liquidación queda bloqueada hasta resolverla.');});}
async function renderIncidents(el){try{const rows=await Api.adminGet('incidents');el.innerHTML=rows.length?rows.map(i=>`<div class="dashCard"><h3>${esc(i.service)}</h3><p class="hint">${esc(i.org_name)} · ${esc(i.status)}</p><p>${esc(i.body)}</p>${i.status==='abierta'?`<label>Resolución<textarea id="resolution-${i.id}"></textarea></label>${action('Guardar resolución',`resolveIncident('${i.id}')`,'primary')}`:`<p>${esc(i.resolution||'')}</p>`}${action('Ver reserva',`showBooking('${i.booking_id}')`)}</div>`).join(''):empty('No hay incidencias.');}catch(e){toast(e.message);}}
function resolveIncident(id){perform(async()=>{await request('admin/incidents/'+id,{resolution:$('resolution-'+id).value},'PATCH');renderIncidents($('adminContent'));toast('Incidencia resuelta.');});}
openChat=id=>{chatBookingId=id;$('chatBox').innerHTML=`<button class="close" onclick="closeChat()">×</button><small>CHAT DE LA RESERVA</small><h2>Coordina tu servicio</h2><div class="chatMessages" id="chatMessages" aria-live="polite"></div><label>Mensaje<input id="chatInput" maxlength="4000" onkeydown="if(event.key==='Enter')sendChatMessage()"></label>${action('Enviar','sendChatMessage()','primary')}`;openM('chat');renderChat();clearInterval(chatPollTimer);chatPollTimer=setInterval(renderChat,4000);};
renderChat=async()=>{if(!chatBookingId||!$('chat').classList.contains('show'))return;try{const rows=await Api.list('bookings/'+chatBookingId+'/messages');const el=$('chatMessages');if(!el)return;const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<80;el.innerHTML=rows.map(m=>`<div class="chatMsg ${m.senderRole===(SESSION.role==='invitado'?'organizacion':SESSION.role)?'chatMsg-mine':''}"><span class="chatMsgMeta">${esc(m.senderName)} · ${prettyDate(m.createdAt)}</span><div class="chatMsgBody">${esc(m.body)}</div></div>`).join('')||'<p class="hint">Aún no hay mensajes.</p>';if(nearBottom)el.scrollTop=el.scrollHeight;}catch(e){clearInterval(chatPollTimer);toast(e.message);}};
sendChatMessage=()=>perform(async()=>{const input=$('chatInput'),body=input.value.trim();if(!body)return;await request('bookings/'+chatBookingId+'/messages',{body});input.value='';await renderChat();});
openCancelModal=(id,fromAdmin=false)=>{const b=BOOKINGS.find(x=>x.id===id),p=PAYMENTS.find(p=>p.bookingId===id&&p.status==='pagado');if(!b)return;
  $('cancelBookingBox').innerHTML=`<button class="close" onclick="closeM('cancelBooking')">×</button><h2>Cancelar reserva</h2><p>${esc(b.service)} · ${esc(b.date)} ${esc(b.time)}</p>${p?`<p>Reembolso según las condiciones aceptadas: ${b.refundPolicyPercent}% (${fmtMoney(Math.round(p.amount*b.refundPolicyPercent/100))}).</p>`:'<p>No se ha confirmado un pago.</p>'}<label>Motivo<textarea id="cancelReason"></textarea></label>${action('Confirmar cancelación',`confirmCancelBooking('${id}',${fromAdmin})`,'danger full')}`;openM('cancelBooking');};
confirmCancelBooking=(id,admin)=>perform(async()=>{const r=await request('bookings/'+id+'/cancel',{reason:$('cancelReason').value});closeM('cancelBooking');closeM('workspaceModal');await refreshAll();toast('Reserva cancelada.'+(r.refundAmount?' Reembolso: '+fmtMoney(r.refundAmount):''));});
const previousDownloadReceipt=downloadReceipt;
downloadReceipt=(p,b)=>{
  const content=`SKILLY — COMPROBANTE DE PAGO\nNo constituye boleta ni factura tributaria.\n\nNúmero: ${p.invoiceNumber||p.id}\nReserva: ${b.id}\nServicio: ${b.service}\nOrganización: ${b.orgName}\nProfesional: ${b.professionalName||'Identidad disponible después del pago'}\nFecha del servicio: ${b.date} ${b.time} (America/Santiago)\nTotal: ${fmtMoney(p.amount)} CLP\nMedio de pago: ${p.method}\nReferencia del proveedor: ${p.authorizationCode||'—'}\nEstado del pago: ${SkillyView.paymentLabel(p.status)}\nEstado de la reserva: ${bookingStatusLabel(b.status)}\n${p.provider==='simulado'?'PAGO SIMULADO — SIN COBRO REAL\n':''}${p.status==='liberado'?'Liquidación simulada; no constituye una transferencia bancaria.\n':''}${p.refundAmount!=null?'Reembolso: '+fmtMoney(p.refundAmount)+'\n':''}${['admin','profesional'].includes(SESSION.role)?`${SkillyView.financialLines(b).map(([label,value])=>label+(value===null?'':': '+fmtMoney(value))).join('\n')}\n`:''}`;
  const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='comprobante-'+(p.invoiceNumber||p.id)+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

function refundLate(id){perform(async()=>{await request('admin/payments/'+id+'/refund-late',{});await refreshAll();toast('Devolución del cobro fuera de plazo registrada.');});}

