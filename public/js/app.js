/* ============================================================
   SKILLY — Cliente (frontend)
   ------------------------------------------------------------
   Todo el estado se guarda en tu servidor Express + SQLite
   (ver server/index.js y server/db.js). Este archivo solo llama
   a la API vía fetch() — no depende de Claude en absoluto.
   ============================================================ */

/* ---------------- Cliente de la API ---------------- */
const Api = {
  async list(resource, query = '') {
    const r = await fetch(`/api/${resource}${query}`);
    if (!r.ok) throw new Error('Error al listar ' + resource);
    return r.json();
  },
  async create(resource, data) {
    const r = await fetch(`/api/${resource}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || 'Error al crear en ' + resource);
    return body;
  },
  async update(resource, id, data, admin = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (admin && SESSION?.adminPasscode) headers['x-admin-passcode'] = SESSION.adminPasscode;
    const r = await fetch(`/api/${resource}/${id}`, { method: 'PATCH', headers, body: JSON.stringify(data) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || 'Error al actualizar ' + resource);
    return body;
  },
  async adminGet(resource) {
    const r = await fetch(`/api/admin/${resource}`, { headers: { 'x-admin-passcode': SESSION?.adminPasscode || '' } });
    if (!r.ok) return [];
    return r.json();
  },
  async adminLogin(passcode) {
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) });
    return (await r.json()).ok;
  },
};

/* ---------------- Estado ---------------- */
let SESSION = null;
let PROFESSIONALS = [];
let BOOKINGS = [];
let PAYMENTS = [];
let EVALUATIONS = []; // solo se llena cuando hay sesión de admin

function loadSession() {
  try { const raw = localStorage.getItem('skilly_session'); SESSION = raw ? JSON.parse(raw) : null; } catch (e) { SESSION = null; }
}
function saveSession(s) {
  SESSION = s;
  try { s ? localStorage.setItem('skilly_session', JSON.stringify(s)) : localStorage.removeItem('skilly_session'); } catch (e) {}
  renderSession();
}
function logout() { saveSession(null); toast('Sesión cerrada'); page('home'); }

async function refreshAll() {
  const query = SESSION?.role === 'organizacion' ? '' : '';
  const [profs, bookings, payments] = await Promise.all([
    Api.list('professionals'), Api.list('bookings'), Api.list('payments'),
  ]);
  PROFESSIONALS = profs; BOOKINGS = bookings; PAYMENTS = payments;
  if (SESSION?.role === 'admin') {
    EVALUATIONS = await Api.adminGet('evaluations');
  } else {
    EVALUATIONS = [];
  }
  updateStats();
  if (document.getElementById('market').classList.contains('active')) renderMarket();
  if (document.getElementById('dashboard').classList.contains('active')) renderDashboard();
  if (document.getElementById('admin').classList.contains('active')) renderAdmin();
}

/* ---------------- Utilidades ---------------- */
function toast(msg, ms = 3200) {
  let t = document.getElementById('toastEl');
  if (!t) { t = document.createElement('div'); t.id = 'toastEl'; t.className = 'toast'; document.body.appendChild(t); }
  const host = document.querySelector('#authDialog[open]') || document.body;
  if (t.parentElement !== host) host.append(t);
  t.setAttribute('role', 'status');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, ms);
}
function fmtMoney(n) { const num = typeof n === 'number' ? n : parseInt(String(n).replace(/[^0-9]/g, ''), 10) || 0; return '$' + num.toLocaleString('es-CL'); }
function parsePrice(p) { return parseInt(String(p).replace(/[^0-9]/g, ''), 10) || 0; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name) { return (name || '').split(' ').map(a => a[0]).join('').slice(0, 2).toUpperCase(); }

/* ---------------- Navegación ---------------- */
function page(id) {
  if (typeof chatPollTimer !== 'undefined' && chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('active');
  document.querySelectorAll('.links a').forEach(a => a.classList.remove('active'));
  const navLink = document.querySelector(`.links a[data-page="${id}"]`);
  if (navLink) navLink.classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'market') renderMarket();
  if (id === 'dashboard') renderDashboard();
  if (id === 'admin') { if (SESSION?.role === 'admin') refreshAll().then(renderAdmin); else renderAdmin(); }
  if (id === 'bigDashboard') { if (SESSION?.role === 'admin') renderBigDashboard(); else { document.getElementById('bigDashboardContent').innerHTML = '<div class="dashCard"><h3>Acceso restringido</h3><p class="hint">Esta sección es solo para administradores de Skilly.</p></div>'; } }
}
function openM(id) {
  const dialog = document.getElementById('authDialog');
  if (dialog && (id === 'login' || id === 'register')) {
    dialog.dataset.mode = id;
    dialog.setAttribute('aria-labelledby', id === 'login' ? 'authLoginTitle' : 'authRegisterTitle');
    for (const mode of ['login', 'register']) {
      document.getElementById(mode).hidden = mode !== id;
      dialog.querySelector('[data-invite="' + mode + '"]').hidden = mode !== id;
    }
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    document.getElementById(id === 'login' ? 'loginEmail' : 'authRegisterTitle').focus({preventScroll:true});
    return;
  }
  document.getElementById(id).classList.add('show');
}
function closeM(id) {
  const dialog = document.getElementById('authDialog');
  if (dialog && ['authDialog', 'login', 'register'].includes(id)) dialog.close();
  else document.getElementById(id).classList.remove('show');
}

function renderSession() {
  const box = document.getElementById('sessionBox');
  const guestBox = document.getElementById('guestBox');
  const dashLink = document.querySelector('.links a[data-page="dashboard"]');
  const adminLink = document.querySelector('.links a[data-page="admin"]');
  const bigDashLink = document.querySelector('.links a[data-page="bigDashboard"]');
  if (SESSION) {
    box.style.display = 'flex'; guestBox.style.display = 'none';
    const roleLabel = SESSION.role === 'admin' ? 'Administrador' : SESSION.role === 'profesional' ? 'Profesional' : 'Organización';
    document.getElementById('sessionName').textContent = SESSION.name || SESSION.email;
    document.getElementById('sessionRole').textContent = roleLabel;
    if (dashLink) dashLink.style.display = SESSION.role === 'admin' ? 'none' : 'inline';
    if (adminLink) adminLink.style.display = SESSION.role === 'admin' ? 'inline' : 'none';
    if (bigDashLink) bigDashLink.style.display = SESSION.role === 'admin' ? 'inline' : 'none';
  } else {
    box.style.display = 'none'; guestBox.style.display = 'flex';
    if (dashLink) dashLink.style.display = 'none';
    if (adminLink) adminLink.style.display = 'none';
    if (bigDashLink) bigDashLink.style.display = 'none';
  }
}

function updateStats() {
  const p = document.getElementById('statProf'); const b = document.getElementById('statBookings');
  if (p) p.textContent = '+' + PROFESSIONALS.filter(x => x.status === 'validado').length;
  if (b) b.textContent = String(BOOKINGS.length);
}

/* ---------------- Home / búsqueda rápida ---------------- */
function quick(q) { page('market'); document.getElementById('q').value = q; renderMarket(); }
function search() { quick(document.getElementById('heroInput').value); }

/* ---------------- Marketplace — SOLO servicios, identidad oculta ----------------
   Definición acordada con Skilly: la plataforma solo permite explorar
   SERVICIOS. La identidad del profesional (nombre, LinkedIn, avatar) NO se
   muestra en la navegación pública ni en la ficha del servicio — recién se
   revela a la organización una vez que paga la reserva (para coordinar) y
   de forma completa cuando el servicio queda marcado como completado. */
function renderMarket() {
  const q = (document.getElementById('q')?.value || '').toLowerCase();
  const cat = document.getElementById('cat')?.value || '';
  const onlyValidated = document.getElementById('onlyValidated')?.checked ?? true;
  let arr = PROFESSIONALS.filter(x => {
    if (onlyValidated && x.status !== 'validado') return false;
    if (cat && x.category !== cat) return false;
    if (q) { const hay = [x.title, x.category, ...(x.tags || [])].join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
    return true;
  });
  arr = arr.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
  const el = document.getElementById('results');
  if (!arr.length) { el.innerHTML = '<div class="empty">No encontramos servicios con esos criterios. Prueba otra búsqueda o categoría.</div>'; return; }
  el.innerHTML = arr.map(x => `
    <article class="card">
      <div class="cardhead" style="align-items:flex-start">
        <b style="font-size:16px">${escapeHtml(x.title)}</b>
        <div class="badgeRow">
          ${x.status === 'validado' ? '<span class="verified">✓ Servicio validado</span>' : ''}
          ${x.recommended ? '<span class="recommended">★ Recomendado por Skilly</span>' : ''}
        </div>
      </div>
      <p>${escapeHtml(x.description || '')}</p>
      <div class="chips">${(x.tags || []).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="cardbottom"><span>${escapeHtml(x.modality || '')}</span><b>Desde ${fmtMoney(x.price)}</b></div>
      <button class="btn primary full" onclick="openProfile('${x.id}')">Ver servicio y disponibilidad</button>
    </article>`).join('');
}

function openProfile(id) {
  const x = PROFESSIONALS.find(p => p.id === id);
  if (!x) return;
  const box = document.getElementById('profileBox');
  const totalMin = (x.durationMinutes || 60) + (x.prepMinutes || 0) + (x.followupMinutes || 0);
  box.innerHTML = `
    <button class="close" onclick="closeM('profile')">×</button>
    <div class="cardhead" style="align-items:flex-start">
      <b style="font-size:18px">${escapeHtml(x.title)}</b>
      <div class="badgeRow">
        ${x.status === 'validado' ? '<span class="verified">✓ Servicio validado</span>' : '<span class="pill pend">En validación</span>'}
        ${x.recommended ? '<span class="recommended">★ Recomendado</span>' : ''}
      </div>
    </div>
    <p>${escapeHtml(x.description || '')}</p>
    <div class="chips">${(x.tags || []).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>
    <div class="row">Modalidad <b>${escapeHtml(x.modality || '—')}</b></div>
    <div class="row">Tarifa referencial <b>${fmtMoney(x.price)}</b></div>
    <div class="row">Días disponibles <b>${(x.availability?.days || []).join(', ') || 'Por coordinar'}</b></div>
    <div class="row">Dedicación total estimada <b>${totalMin} min</b></div>
    <p class="hint">Incluye ${x.durationMinutes || 60} min de atención${x.prepMinutes ? ` + ${x.prepMinutes} min de preparación` : ''}${x.followupMinutes ? ` + ${x.followupMinutes} min de seguimiento` : ''}.</p>
    <p class="hint">Quién presta el servicio se revela una vez que reservas y pagas, para coordinar directamente por el chat de la reserva.</p>
    ${x.status === 'validado'
      ? `<button class="btn primary full" onclick="closeM('profile');startBooking('${x.id}')">Reservar horario</button>`
      : `<p class="hint">Este servicio aún está en proceso de validación por el equipo de Skilly y todavía no puede recibir reservas.</p>`}`;
  openM('profile');
}

/* ---------------- Login ---------------- */
let loginRole = 'organizacion';
function setLoginRole(role) {
  loginRole = role;
  document.querySelectorAll('#login .rolesel button').forEach(b => b.classList.toggle('on', b.dataset.role === role));
  document.getElementById('loginFieldsOrgPro').style.display = role === 'admin' ? 'none' : 'block';
  document.getElementById('loginFieldsAdmin').style.display = role === 'admin' ? 'block' : 'none';
}
async function doLogin() {
  if (loginRole === 'admin') {
    const pass = document.getElementById('loginPass').value;
    const ok = await Api.adminLogin(pass);
    if (!ok) { toast('Clave de administrador incorrecta'); return; }
    saveSession({ role: 'admin', name: 'Administrador Skilly', email: 'admin@skilly.cl', adminPasscode: pass });
    closeM('login'); toast('Bienvenido, administrador');
    await refreshAll(); page('admin');
    return;
  }
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  if (!email) { toast('Ingresa tu correo'); return; }
  if (loginRole === 'profesional') {
    const prof = PROFESSIONALS.find(p => (p.email || '').toLowerCase() === email);
    if (!prof) { toast('No encontramos una cuenta profesional con ese correo. ¿Quieres crear una?'); return; }
    saveSession({ role: 'profesional', name: prof.name, email: prof.email, professionalId: prof.id });
    closeM('login'); toast('Bienvenido/a, ' + prof.name); page('dashboard');
  } else {
    saveSession({ role: 'organizacion', name: email.split('@')[0], email });
    closeM('login'); toast('Sesión iniciada como organización'); page('market');
  }
}

/* ---------------- Registro ---------------- */
let regRole = null, regStep = 1, regProDraft = {};
function openRegister() {
  regRole = null; regStep = 1; regProDraft = {};
  document.querySelectorAll('#register .rolesel button').forEach(b => b.classList.remove('on'));
  showRegStep(); openM('register');
}
function chooseRegRole(role) {
  regRole = role;
  document.querySelectorAll('#register .rolesel button').forEach(b => b.classList.toggle('on', b.dataset.role === role));
  regStep = 2; showRegStep();
}
function showRegStep() {
  document.getElementById('regStepRole').style.display = regStep === 1 ? 'block' : 'none';
  document.getElementById('regStepOrg').style.display = (regStep === 2 && regRole === 'organizacion') ? 'block' : 'none';
  document.getElementById('regStepProBasic').style.display = (regStep === 2 && regRole === 'profesional') ? 'block' : 'none';
  document.getElementById('regStepProValidation').style.display = (regStep === 3 && regRole === 'profesional') ? 'block' : 'none';
  document.getElementById('regStepDone').style.display = regStep === 9 ? 'block' : 'none';
  const bar = document.getElementById('regStepbar');
  const total = regRole === 'profesional' ? 3 : 2;
  const current = regStep === 9 ? total : regStep;
  bar.innerHTML = Array.from({ length: total }).map((_, i) => `<div class="${i < current ? 'on' : ''}"></div>`).join('');
}
function regBack() { if (regStep > 1) { regStep = regStep === 3 ? 2 : 1; showRegStep(); } }

async function submitOrgRegister() {
  const name = document.getElementById('orgName').value.trim();
  const email = document.getElementById('orgEmail').value.trim().toLowerCase();
  if (!name || !email) { toast('Completa nombre y correo'); return; }
  saveSession({ role: 'organizacion', name, email });
  closeM('register'); toast('Cuenta de organización creada'); page('market');
}

function regProNext() {
  const name = document.getElementById('proName').value.trim();
  const email = document.getElementById('proEmail').value.trim().toLowerCase();
  const category = document.getElementById('proCategory').value;
  const title = document.getElementById('proTitle').value.trim();
  const price = document.getElementById('proPrice').value.trim();
  const modality = document.getElementById('proModality').value;
  const description = document.getElementById('proDesc').value.trim();
  const tags = document.getElementById('proTags').value.trim();
  if (!name || !email || !title || !price) { toast('Completa los campos obligatorios'); return; }
  const days = Array.from(document.querySelectorAll('.proDay:checked')).map(c => c.value);
  regProDraft = {
    name, email, category, title, price, modality, description,
    tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    availability: { days: days.length ? days : ['Lunes', 'Miércoles', 'Viernes'], hours: ['09:00', '11:00', '15:00'] },
  };
  regStep = 3; showRegStep();
}

async function submitProValidation() {
  const linkedin = document.getElementById('valLinkedin').value.trim();
  const yearsExperience = document.getElementById('valYears').value.trim();
  const certifications = document.getElementById('valCerts').value.trim();
  const cv = document.getElementById('valCv').value.trim();
  const references = document.getElementById('valRefs').value.trim();
  const portfolio = document.getElementById('valPortfolio').value.trim();
  const motivation = document.getElementById('valMotivation').value.trim();
  if (!linkedin || !yearsExperience || !cv) { toast('Completa al menos LinkedIn, años de experiencia y CV/antecedentes'); return; }
  const doc = { ...regProDraft, validation: { linkedin, yearsExperience, certifications, cv, references, portfolio, motivation } };
  try {
    const created = await Api.create('professionals', doc);
    await refreshAll();
    saveSession({ role: 'profesional', name: created.name, email: created.email, professionalId: created.id });
    regStep = 9; showRegStep();
  } catch (e) { console.error(e); toast(e.message || 'No se pudo enviar tu solicitud.'); }
}
function finishRegister() { closeM('register'); page('dashboard'); }

/* ---------------- Agendamiento ---------------- */
const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
let bookingCtx = { professionalId: null, date: null, time: null };

function startBooking(professionalId) {
  const prof = PROFESSIONALS.find(p => p.id === professionalId);
  if (!prof || prof.status !== 'validado') { toast('Este profesional aún no está validado'); return; }
  if (!SESSION || SESSION.role !== 'organizacion') {
    // Sin cuenta: ofrecemos iniciar sesión/registrarse, o pedir el horario
    // sin registrarse (Skilly gestiona el resto manualmente por correo).
    openGuestChoice(professionalId);
    return;
  }
  bookingCtx = { professionalId, date: null, time: null };
  renderBookingModal(prof); openM('booking');
}

function openGuestChoice(professionalId) {
  const prof = PROFESSIONALS.find(p => p.id === professionalId);
  const box = document.getElementById('guestBookingBox');
  box.innerHTML = `
    <button class="close" onclick="closeM('guestBooking')">×</button>
    <small>AGENDAR SERVICIO</small>
    <h2>¿Cómo quieres continuar?</h2>
    <p class="hint">${escapeHtml(prof.name)} · ${escapeHtml(prof.title)}</p>
    <div class="dashCard" style="margin-top:14px">
      <h3>Crear una cuenta (recomendado)</h3>
      <p class="hint">Podrás ver tus reservas, pagar en línea y descargar comprobantes desde tu panel.</p>
      <button class="btn primary full" onclick="closeM('guestBooking');openM('login');setLoginRole('organizacion')">Iniciar sesión</button>
      <button class="btn outline full" onclick="closeM('guestBooking');openRegister();chooseRegRole('organizacion')">Crear cuenta</button>
    </div>
    <div class="dashCard">
      <h3>Reservar sin registrarme</h3>
      <p class="hint">Nos dejas tus datos de contacto y un administrador de Skilly te escribe para coordinar el horario y el pago.</p>
      <button class="btn dark full" onclick="closeM('guestBooking');renderGuestForm('${professionalId}')">Continuar sin registrarme</button>
    </div>`;
  openM('guestBooking');
}

function renderGuestForm(professionalId) {
  const prof = PROFESSIONALS.find(p => p.id === professionalId);
  const dayOpts = nextAvailableDays(prof);
  const box = document.getElementById('guestBookingBox');
  const dayOptionsHtml = dayOpts.map(d => `<option value="${d.key}">${d.date.getDate()} ${d.label} (${d.key})</option>`).join('');
  box.innerHTML = `
    <button class="close" onclick="closeM('guestBooking')">×</button>
    <small>RESERVAR SIN REGISTRO</small>
    <h2>Tus datos de contacto</h2>
    <p class="hint">${escapeHtml(prof.name)} · ${escapeHtml(prof.title)} · ${escapeHtml(prof.price)}</p>
    <label>Nombre de contacto<input id="gName" placeholder="Tu nombre"></label>
    <label>Organización / empresa<input id="gOrg" placeholder="Nombre de tu organización"></label>
    <div class="formgrid2">
      <label>Correo<input type="email" id="gEmail" placeholder="tu@correo.cl"></label>
      <label>Teléfono<input id="gPhone" placeholder="+56 9 1234 5678"></label>
    </div>
    <div class="formgrid2">
      <label>Día preferido<select id="gDate">${dayOptionsHtml}</select></label>
      <label>Hora preferida<select id="gTime">${(prof.availability?.hours || []).map(h => `<option>${h}</option>`).join('')}</select></label>
    </div>
    <label>Notas para Skilly (opcional)<textarea id="gNotes" placeholder="Contexto del servicio que necesitas"></textarea></label>
    <p class="hint">Un administrador de Skilly recibirá esta solicitud por correo y te contactará para coordinar el pago (Webpay, PayPal u otro medio).</p>
    <button class="btn primary full" id="guestSubmitBtn" onclick="submitGuestRequest('${professionalId}')">Enviar solicitud a Skilly</button>`;
}

async function submitGuestRequest(professionalId) {
  const contactName = document.getElementById('gName').value.trim();
  const orgName = document.getElementById('gOrg').value.trim();
  const email = document.getElementById('gEmail').value.trim();
  const phone = document.getElementById('gPhone').value.trim();
  const date = document.getElementById('gDate').value;
  const time = document.getElementById('gTime').value;
  const notes = document.getElementById('gNotes').value.trim();
  if (!contactName || !orgName || !email || !date || !time) { toast('Completa nombre, organización, correo, día y hora'); return; }
  const btn = document.getElementById('guestSubmitBtn'); btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const created = await Api.create('guest-requests', { professionalId, contactName, orgName, email, phone, date, time, notes });
    closeM('guestBooking');
    document.getElementById('guestDoneEmailNote').textContent = created.emailSent
      ? 'Le avisamos por correo a Skilly automáticamente.'
      : 'Tu solicitud quedó guardada; el aviso automático por correo no está configurado en este servidor, pero el equipo puede revisarla igual desde el panel de administración.';
    openM('guestDone');
  } catch (e) {
    console.error(e); toast(e.message || 'No se pudo enviar la solicitud'); btn.disabled = false; btn.textContent = 'Enviar solicitud a Skilly';
  }
}
function nextAvailableDays(prof, count = 8) {
  const out = []; const days = prof.availability?.days || []; let d = new Date(); let guard = 0;
  while (out.length < count && guard < 30) {
    const label = WEEKDAYS[d.getDay()];
    if (days.includes(label)) out.push({ date: new Date(d), label, key: d.toISOString().slice(0, 10) });
    d = new Date(d.getTime() + 86400000); guard++;
  }
  return out;
}
function renderBookingModal(prof) {
  const dayOpts = nextAvailableDays(prof);
  const box = document.getElementById('bookingBox');
  const dayTabsHtml = dayOpts.map((d, i) => `<button data-key="${d.key}" onclick="pickBookingDay('${d.key}')" class="${i === 0 ? 'on' : ''}">${d.date.getDate()} ${d.label.slice(0, 3)}</button>`).join('');
  box.innerHTML = `
    <button class="close" onclick="closeM('booking')">×</button>
    <small>AGENDAR SERVICIO</small>
    <h2>${escapeHtml(prof.name)}</h2>
    <p class="hint">${escapeHtml(prof.title)} · ${escapeHtml(prof.price)}</p>
    <label>Elige un día</label>
    <div class="daytabs" id="dayTabs">${dayTabsHtml}</div>
    <label>Horarios disponibles</label>
    <div class="slots" id="slotGrid"><div class="hint">Selecciona un día</div></div>
    <label>Notas para el profesional (opcional)</label>
    <textarea id="bookingNotes" placeholder="Contexto del servicio, entregables esperados, etc."></textarea>
    <button class="btn primary full" id="confirmBookingBtn" onclick="confirmBooking()" disabled>Confirmar y continuar a pago</button>`;
  if (dayOpts.length) pickBookingDay(dayOpts[0].key);
}
async function pickBookingDay(key) {
  bookingCtx.date = key; bookingCtx.time = null;
  document.querySelectorAll('#dayTabs button').forEach(b => b.classList.toggle('on', b.dataset.key === key));
  const prof = PROFESSIONALS.find(p => p.id === bookingCtx.professionalId);
  const hours = prof.availability?.hours || ['09:00', '11:00', '15:00'];
  const taken = BOOKINGS.filter(b => b.professionalId === prof.id && b.date === key && b.status !== 'cancelado').map(b => b.time);
  const free = hours.filter(h => !taken.includes(h));
  const grid = document.getElementById('slotGrid');
  if (!free.length) { grid.innerHTML = '<div class="hint">Sin horarios disponibles este día, prueba otro.</div>'; document.getElementById('confirmBookingBtn').disabled = true; return; }
  grid.innerHTML = free.map(h => `<button onclick="pickBookingTime('${h}')">${h}</button>`).join('');
  document.getElementById('confirmBookingBtn').disabled = true;
}
function pickBookingTime(t) {
  bookingCtx.time = t;
  document.querySelectorAll('#slotGrid button').forEach(b => b.classList.toggle('on', b.textContent === t));
  document.getElementById('confirmBookingBtn').disabled = false;
}
async function confirmBooking() {
  if (!bookingCtx.date || !bookingCtx.time) { toast('Elige un día y horario'); return; }
  const prof = PROFESSIONALS.find(p => p.id === bookingCtx.professionalId);
  const notes = document.getElementById('bookingNotes').value.trim();
  const bookingData = {
    professionalId: prof.id, professionalName: prof.name, professionalEmail: prof.email,
    orgName: SESSION.name, orgEmail: SESSION.email, date: bookingCtx.date, time: bookingCtx.time,
    service: prof.title, notes, amount: parsePrice(prof.price),
  };
  try {
    const created = await Api.create('bookings', bookingData);
    await refreshAll();
    closeM('booking'); openCheckout(created.id);
  } catch (e) {
    console.error(e);
    toast(e.message || 'No se pudo crear la reserva');
    await refreshAll(); pickBookingDay(bookingCtx.date);
  }
}

/* ---------------- Checkout / métodos de pago reales ---------------- */
let SERVER_CONFIG = { mailerConfigured: false, paypalConfigured: false, webpayEnv: 'integration' };
async function loadServerConfig() {
  try { SERVER_CONFIG = await Api.list('config'); } catch (e) { /* usa valores por defecto */ }
}

function openCheckout(bookingId) {
  const b = BOOKINGS.find(x => x.id === bookingId);
  if (!b) return;
  const box = document.getElementById('checkoutBox');
  const webpayIsIntegration = SERVER_CONFIG.webpayEnv !== 'production';
  box.innerHTML = `
    <button class="close" onclick="closeM('checkout')">×</button>
    <small>PAGO SEGURO</small><h2>Confirmar y pagar</h2>
    <div class="row">Servicio <b>${escapeHtml(b.service)}</b></div>
    <div class="row">Fecha <b>${escapeHtml(b.date)} · ${escapeHtml(b.time)}</b></div>
    <div class="row">Monto <b>${fmtMoney(b.amount)}</b></div>
    <p class="hint">Después de la entrega y la conformidad del cliente, Skilly autoriza la liquidación al profesional. En esta versión la liquidación es simulada. Sabrás quién te atiende apenas se confirme el pago.</p>
    <label>Elige un método de pago</label>
    <div class="payMethods">
      <button class="payMethodBtn" onclick="payWithWebpay('${b.id}')">
        <b>Webpay Plus</b><span>Tarjetas chilenas (débito/crédito) vía Transbank${webpayIsIntegration ? ' · ambiente de pruebas' : ''}</span>
      </button>
      <button class="payMethodBtn" onclick="payWithPaypal('${b.id}')" ${SERVER_CONFIG.paypalConfigured ? '' : 'disabled'}>
        <b>PayPal</b><span>${SERVER_CONFIG.paypalConfigured ? 'Paga en USD vía tu cuenta PayPal (sandbox)' : 'No configurado en este servidor (ver README)'}</span>
      </button>
      <button class="payMethodBtn" onclick="payWithSimulated('${b.id}')">
        <b>Pago simulado</b><span>Para probar el flujo completo al instante, sin salir de la app</span>
      </button>
    </div>
    ${webpayIsIntegration ? `
    <div class="testCardBox">
      <b>⚠️ Webpay está en ambiente de pruebas</b>
      <p>Solo funciona con la tarjeta oficial de prueba de Transbank — un número inventado o una tarjeta real serán rechazados:</p>
      <div class="testCardRow"><span>Tarjeta (crédito VISA)</span><code>4051 8856 0044 6623</code></div>
      <div class="testCardRow"><span>Vencimiento</span><code>cualquier fecha futura</code></div>
      <div class="testCardRow"><span>CVV</span><code>123</code></div>
      <div class="testCardRow"><span>RUT</span><code>11.111.111-1</code></div>
      <div class="testCardRow"><span>Clave</span><code>123</code></div>
    </div>` : ''}
    <p class="hint" style="margin-top:14px">Al elegir Webpay o PayPal, te llevaremos a completar el pago de forma segura fuera de esta página.</p>`;
  openM('checkout');
}

async function payWithWebpay(bookingId) {
  try {
    toast('Conectando con Webpay...');
    const { url, token } = await Api.create('payments/webpay/create', { bookingId });
    // Webpay exige llegar a su formulario vía POST con el campo token_ws.
    const form = document.createElement('form');
    form.method = 'POST'; form.action = url;
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = 'token_ws'; input.value = token;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  } catch (e) {
    console.error(e);
    toast((e.message || 'No se pudo iniciar el pago con Webpay') + ' — revisa que el servidor tenga salida a internet hacia transbank.cl, o usa "Pago simulado" para seguir probando.');
  }
}

async function payWithPaypal(bookingId) {
  try {
    toast('Conectando con PayPal...');
    const { approveUrl } = await Api.create('payments/paypal/create-order', { bookingId });
    if (approveUrl) window.location.href = approveUrl;
    else toast('PayPal no devolvió un enlace de pago');
  } catch (e) { console.error(e); toast(e.message || 'No se pudo iniciar el pago con PayPal'); }
}

// Pago simulado: no cobra nada real ni requiere Webpay/PayPal — queda para
// poder probar el resto del flujo (entrega, chat, evaluación, liberación)
// sin depender de la tarjeta de prueba de Transbank o de internet.
async function payWithSimulated(bookingId) {
  try {
    const payment = await Api.create('payments', { bookingId, method: 'Pago simulado' });
    await refreshAll();
    closeM('checkout');
    toast('Pago simulado realizado. El monto queda retenido hasta la entrega del servicio.');
    const booking = BOOKINGS.find(x => x.id === bookingId);
    if (booking) downloadReceipt(payment, booking);
    page('dashboard');
  } catch (e) { console.error(e); toast(e.message || 'No se pudo procesar el pago simulado'); }
}

// Al volver de Webpay/PayPal, el servidor nos redirige a "/?payment=success|failed|cancelled|timeout|error".
function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('payment');
  if (!status) return;
  const bookingId = params.get('bookingId');
  const messages = {
    success: 'Pago realizado con éxito. El monto queda retenido hasta la entrega del servicio.',
    failed: 'El pago fue rechazado. Puedes intentar con otro método o tarjeta.',
    cancelled: 'Cancelaste el pago.',
    timeout: 'El pago expiró por tiempo de espera. Intenta nuevamente.',
    error: 'Ocurrió un error procesando el pago. Intenta nuevamente.',
  };
  toast(messages[status] || 'Pago procesado');
  window.history.replaceState({}, '', window.location.pathname);
  if (status === 'success' && bookingId) {
    refreshAll().then(() => {
      const payment = PAYMENTS.find(p => p.bookingId === bookingId);
      const booking = BOOKINGS.find(b => b.id === bookingId);
      if (payment && booking) downloadReceipt(payment, booking);
      page('dashboard');
    });
  }
}
function downloadReceipt(payment, booking) {
  const providerLabel = { webpay: 'Webpay Plus (Transbank)', paypal: 'PayPal', simulado: 'Simulado' }[payment.provider] || payment.provider;
  const isReal = payment.provider === 'webpay' || payment.provider === 'paypal';
  const transactionLines = isReal ? `
Proveedor de pago: ${providerLabel}
Código de autorización: ${payment.authorizationCode || '—'}${payment.cardLast4 ? `\nTarjeta: **** **** **** ${payment.cardLast4}` : ''}
Moneda: ${payment.currency || 'CLP'}` : `
Proveedor de pago: ${providerLabel} (sin procesamiento real de cargo)`;

  const text = `SKILLY — COMPROBANTE ELECTRÓNICO DE PAGO
========================================
N° comprobante: ${payment.invoiceNumber}
Fecha: ${new Date(payment.createdAt).toLocaleString('es-CL')}

Organización: ${booking.orgName} <${booking.orgEmail}>
Profesional:  ${booking.professionalName}
Servicio:     ${booking.service}
Fecha del servicio: ${booking.date} ${booking.time}

Monto pagado: ${fmtMoney(payment.amount)}
Estado: ${payment.status === 'liberado' ? 'Liberado al profesional' : 'Retenido por Skilly (se libera tras confirmar entrega)'}
${transactionLines}

----------------------------------------
${isReal
    ? `Este comprobante refleja una transacción real procesada por ${providerLabel}${SERVER_CONFIG.webpayEnv === 'integration' && payment.provider === 'webpay' ? ' en su AMBIENTE DE PRUEBAS (no se cobró dinero real)' : ''}. Aun así, NO constituye una boleta ni factura electrónica válida ante el SII: para eso se requiere integrar un proveedor autorizado (ver README.md).`
    : `Este comprobante es una simulación generada por el prototipo y NO constituye una boleta ni factura electrónica válida ante el SII.`}
`;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `comprobante-${payment.invoiceNumber}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------- Ciclo de vida del servicio ---------------- */
async function markDelivered(bookingId) {
  try {
    await Api.update('bookings', bookingId, { status: 'entregado' });
    await refreshAll();
    toast('Marcaste el servicio como entregado. La organización debe confirmar la recepción.');
    renderDashboard();
  } catch (e) { console.error(e); toast('No se pudo actualizar'); }
}

let evalCtx = null;
function openEvaluate(bookingId) {
  evalCtx = bookingId;
  document.querySelectorAll('#starPick span').forEach(s => s.classList.remove('on'));
  document.getElementById('evalStars').value = '0'; document.getElementById('evalComment').value = '';
  openM('evaluate');
}
function pickStar(n) {
  document.getElementById('evalStars').value = String(n);
  document.querySelectorAll('#starPick span').forEach(s => s.classList.toggle('on', Number(s.dataset.n) <= n));
}
async function submitEvaluation() {
  const stars = Number(document.getElementById('evalStars').value);
  const comment = document.getElementById('evalComment').value.trim();
  if (!stars) { toast('Selecciona un puntaje'); return; }
  if (!comment) { toast('Agrega un breve argumento de tu evaluación'); return; }
  const b = BOOKINGS.find(x => x.id === evalCtx);
  if (!b) return;
  try {
    await Api.create('evaluations', { professionalId: b.professionalId, professionalName: b.professionalName, bookingId: b.id, orgName: b.orgName, orgEmail: b.orgEmail, stars, comment });
    await refreshAll();
    closeM('evaluate');
    toast('Gracias. Tu evaluación queda registrada de forma privada para el equipo de Skilly y Skilly revisará la liberación del pago.');
    renderDashboard();
  } catch (e) { console.error(e); toast('No se pudo registrar la evaluación'); }
}

/* ---------------- Dashboard ---------------- */
function renderDashboard() {
  const el = document.getElementById('dashContent');
  if (!SESSION) { el.innerHTML = `<div class="dashCard"><h3>Necesitas iniciar sesión</h3><p class="hint">Ingresa como organización o profesional para ver tu panel.</p><button class="btn primary" onclick="openM('login')">Ingresar</button></div>`; return; }
  if (SESSION.role === 'profesional') renderProDashboard(el);
  else if (SESSION.role === 'organizacion') renderOrgDashboard(el);
  else el.innerHTML = `<div class="dashCard"><p class="hint">Los administradores usan el <a onclick="page('admin')" style="cursor:pointer;text-decoration:underline">panel de administración</a>.</p></div>`;
}
function renderProDashboard(el) {
  const prof = PROFESSIONALS.find(p => p.id === SESSION.professionalId);
  if (!prof) { el.innerHTML = '<div class="dashCard">No encontramos tu perfil.</div>'; return; }
  const statusPill = prof.status === 'validado' ? '<span class="pill ok">✓ Validado</span>'
    : prof.status === 'rechazado' ? '<span class="pill no">No validado</span>'
    : prof.status === 'info_solicitada' ? '<span class="pill pend">Falta información</span>'
    : '<span class="pill pend">En revisión</span>';
  let statusMsg = '';
  if (prof.status === 'pendiente') statusMsg = 'Tu solicitud está siendo revisada por el equipo de Skilly. Te avisaremos cuando esté validada.';
  if (prof.status === 'rechazado') statusMsg = 'Tu solicitud no fue validada esta vez.' + (prof.adminNotes ? ' Comentario del equipo: "' + escapeHtml(prof.adminNotes) + '"' : '') + ' Puedes corregir tus antecedentes abajo y volver a enviarlos.';
  if (prof.status === 'info_solicitada') statusMsg = 'Skilly necesita más información de tu parte.' + (prof.adminNotes ? ' Detalle: "' + escapeHtml(prof.adminNotes) + '"' : '') + ' Completa lo que falta abajo y vuelve a enviarlo.';
  if (prof.status === 'validado') statusMsg = 'Tu perfil es visible en el marketplace y ya puedes recibir reservas.';
  const myBookings = BOOKINGS.filter(b => b.professionalId === prof.id).sort((a, b) => b.createdAt - a.createdAt);
  const canResubmit = prof.status === 'rechazado' || prof.status === 'info_solicitada';

  el.innerHTML = `
    <div class="dashCard">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h3>${escapeHtml(prof.name)}</h3><p class="hint">${escapeHtml(prof.title)}</p></div>${statusPill}
      </div>
      <p class="hint">${statusMsg}</p>
    </div>

    ${canResubmit ? `
    <div class="dashCard">
      <h3>Corregir y reenviar antecedentes</h3>
      <label>LinkedIn<input id="rvLinkedin" value="${escapeHtml(prof.validation?.linkedin || '')}"></label>
      <div class="formgrid2">
        <label>Años de experiencia<input id="rvYears" value="${escapeHtml(prof.validation?.yearsExperience || '')}"></label>
        <label>Certificaciones<input id="rvCerts" value="${escapeHtml(prof.validation?.certifications || '')}"></label>
      </div>
      <label>CV / antecedentes<textarea id="rvCv">${escapeHtml(prof.validation?.cv || '')}</textarea></label>
      <label>Referencias<textarea id="rvRefs">${escapeHtml(prof.validation?.references || '')}</textarea></label>
      <button class="btn primary" onclick="resubmitValidation('${prof.id}')">Reenviar a revisión</button>
    </div>` : ''}

    <div class="dashCard">
      <h3>Mi servicio publicado</h3>
      <p class="hint">Esto es lo que ven las organizaciones en el marketplace (sin tu nombre, hasta que te contraten). Puedes actualizarlo cuando quieras.</p>
      <label>Título del servicio<input id="svcTitle" value="${escapeHtml(prof.title || '')}"></label>
      <label>Descripción<textarea id="svcDesc">${escapeHtml(prof.description || '')}</textarea></label>
      <div class="formgrid2">
        <label>Especialidad<select id="svcCategory">
          ${['Tecnología', 'Marketing', 'Diseño', 'Consultoría'].map(c => `<option ${prof.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select></label>
        <label>Modalidad<select id="svcModality">
          ${['Remoto', 'Híbrido', 'Presencial'].map(m => `<option ${prof.modality === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select></label>
      </div>
      <div class="formgrid2">
        <label>Tarifa referencial<input id="svcPrice" value="${escapeHtml(prof.price || '')}"></label>
        <label>Etiquetas (separadas por coma)<input id="svcTags" value="${escapeHtml((prof.tags || []).join(', '))}"></label>
      </div>
      <button class="btn outline" onclick="saveMyService('${prof.id}')">Guardar servicio</button>
    </div>

    <div class="dashCard">
      <h3>Mi disponibilidad</h3>
      <p class="hint">Días y horarios en que ofreces este servicio. Actualízalo cuando cambie tu agenda.</p>
      <label>Días disponibles</label>
      <div class="checkgrid">
        ${['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map(d =>
          `<label><input type="checkbox" class="svcDay" value="${d}" ${(prof.availability?.days || []).includes(d) ? 'checked' : ''}> ${d}</label>`).join('')}
      </div>
      <label>Horarios del día (separados por coma, formato HH:MM)<input id="svcHours" value="${escapeHtml((prof.availability?.hours || []).join(', '))}" placeholder="09:00, 11:00, 15:00"></label>
      <button class="btn outline" onclick="saveMyAvailability('${prof.id}')">Guardar disponibilidad</button>
    </div>

    <div class="dashCard">
      <h3>Capacidad y duración de servicio</h3>
      <p class="hint">Define cuántas reservas puedes atender como máximo, y cuánto tiempo real te toma cada servicio (incluyendo preparación y seguimiento, no solo la atención visible).</p>
      <div class="formgrid2">
        <label>Máximo de reservas por día<input type="number" min="0" id="myCapDay" value="${prof.maxPerDay ?? ''}" placeholder="Sin límite"></label>
        <label>Máximo de reservas por semana<input type="number" min="0" id="myCapWeek" value="${prof.maxPerWeek ?? ''}" placeholder="Sin límite"></label>
      </div>
      <div class="formgrid2">
        <label>Máximo de reservas por mes<input type="number" min="0" id="myCapMonth" value="${prof.maxPerMonth ?? ''}" placeholder="Sin límite"></label>
        <label>Duración de atención (min)<input type="number" min="15" step="15" id="myDuration" value="${prof.durationMinutes || 60}"></label>
      </div>
      <div class="formgrid2">
        <label>Tiempo de preparación (min)<input type="number" min="0" step="15" id="myPrep" value="${prof.prepMinutes || 0}"></label>
        <label>Tiempo de seguimiento (min)<input type="number" min="0" step="15" id="myFollowup" value="${prof.followupMinutes || 0}"></label>
      </div>
      <button class="btn outline" onclick="saveMyCapacity('${prof.id}')">Guardar capacidad</button>
    </div>

    <div class="dashCard"><h3>Mis reservas</h3>
      ${myBookings.length ? myBookings.map(b => {
        const payment = PAYMENTS.find(p => p.bookingId === b.id);
        return `<div class="miniRow">
          <div><b>${escapeHtml(b.orgName)}</b><br><span class="hint">${escapeHtml(b.date)} · ${escapeHtml(b.time)} — ${escapeHtml(bookingStatusLabel(b.status))}</span></div>
          <div>
          ${b.status === 'pagado' ? `<button class="btn small primary" onclick="markDelivered('${b.id}')">Marcar como entregado</button>` : ''}
          ${b.status !== 'reservado' && b.status !== 'cancelado' ? `<button class="btn small outline" onclick="openChat('${b.id}')">Chat</button>` : ''}
          ${payment && payment.status === 'liberado' ? `<button class="btn small outline" onclick="downloadReceiptFor('${payment.id}','${b.id}')">Mi boleta / comprobante</button>` : ''}
          </div>
        </div>`;
      }).join('') : '<p class="hint">Aún no tienes reservas.</p>'}
    </div>`;
}
async function saveMyService(id) {
  const tags = document.getElementById('svcTags').value.trim();
  try {
    await fetch(`/api/professionals/${id}/self`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('svcTitle').value.trim(),
        description: document.getElementById('svcDesc').value.trim(),
        category: document.getElementById('svcCategory').value,
        modality: document.getElementById('svcModality').value,
        price: document.getElementById('svcPrice').value.trim(),
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      }),
    });
    await refreshAll(); toast('Servicio actualizado'); renderDashboard();
  } catch (e) { console.error(e); toast('No se pudo guardar'); }
}
async function saveMyAvailability(id) {
  const days = Array.from(document.querySelectorAll('.svcDay:checked')).map(c => c.value);
  const hoursRaw = document.getElementById('svcHours').value.trim();
  const hours = hoursRaw ? hoursRaw.split(',').map(h => h.trim()).filter(Boolean) : [];
  if (!days.length || !hours.length) { toast('Elige al menos un día y un horario'); return; }
  try {
    await fetch(`/api/professionals/${id}/self`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ availability: { days, hours } }),
    });
    await refreshAll(); toast('Disponibilidad actualizada'); renderDashboard();
  } catch (e) { console.error(e); toast('No se pudo guardar'); }
}
async function saveMyCapacity(id) {
  const val = (elId) => { const v = document.getElementById(elId).value; return v === '' ? null : Number(v); };
  try {
    await fetch(`/api/professionals/${id}/self`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxPerDay: val('myCapDay'), maxPerWeek: val('myCapWeek'), maxPerMonth: val('myCapMonth'),
        durationMinutes: val('myDuration'), prepMinutes: val('myPrep'), followupMinutes: val('myFollowup'),
      }),
    });
    await refreshAll(); toast('Capacidad y duración actualizadas'); renderDashboard();
  } catch (e) { console.error(e); toast('No se pudo guardar'); }
}
async function resubmitValidation(id) {
  const validation = {
    linkedin: document.getElementById('rvLinkedin').value.trim(),
    yearsExperience: document.getElementById('rvYears').value.trim(),
    certifications: document.getElementById('rvCerts').value.trim(),
    cv: document.getElementById('rvCv').value.trim(),
    references: document.getElementById('rvRefs').value.trim(),
  };
  if (!validation.linkedin || !validation.yearsExperience || !validation.cv) { toast('Completa al menos LinkedIn, experiencia y CV'); return; }
  try {
    await fetch(`/api/professionals/${id}/self`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ validation }),
    });
    await refreshAll(); toast('Tus antecedentes fueron reenviados a Skilly para revisión'); renderDashboard();
  } catch (e) { console.error(e); toast('No se pudo reenviar'); }
}
function renderOrgDashboard(el) {
  const myBookings = BOOKINGS.filter(b => b.orgEmail === SESSION.email).sort((a, b) => b.createdAt - a.createdAt);
  // La identidad del profesional se revela recién cuando el pago ya se hizo
  // (no mientras la reserva está solo "reservada" y sin pagar).
  const identityRevealed = (status) => !['reservado'].includes(status);
  el.innerHTML = `
    <div class="dashCard"><h3>${escapeHtml(SESSION.name)}</h3><p class="hint">${escapeHtml(SESSION.email)} · Organización</p></div>
    <div class="dashCard"><h3>Mis reservas</h3>
      ${myBookings.length ? myBookings.map(b => {
        const payment = PAYMENTS.find(p => p.bookingId === b.id);
        const canCancel = ['reservado', 'pagado', 'entregado'].includes(b.status);
        const revealed = identityRevealed(b.status);
        const prof = PROFESSIONALS.find(p => p.id === b.professionalId);
        return `<div class="miniRow">
          <div><b>${revealed ? escapeHtml(b.professionalName) : 'Profesional asignado (se revela al pagar)'}</b> — ${escapeHtml(b.service)}<br>
          <span class="hint">${escapeHtml(b.date)} · ${escapeHtml(b.time)} — ${escapeHtml(bookingStatusLabel(b.status))}${payment ? ` · ${fmtMoney(payment.amount)}` : ''}</span>
          ${b.status === 'cancelado' && b.refundAmount ? `<br><span class="hint">Reembolsado: ${fmtMoney(b.refundAmount)} (${b.refundPercent}%)</span>` : ''}
          ${b.status === 'completado' && prof?.validation?.linkedin ? `<br><a href="${escapeHtml(prof.validation.linkedin)}" target="_blank" rel="noopener" class="hint" style="text-decoration:underline">Ver perfil completo (LinkedIn)</a>` : ''}</div>
          <div>
          ${b.status === 'reservado' ? `<button class="btn small primary" onclick="openCheckout('${b.id}')">Completar pago</button>` : ''}
          ${b.status === 'entregado' ? `<button class="btn small primary" onclick="openEvaluate('${b.id}')">Confirmar y evaluar</button>` : ''}
          ${revealed && b.status !== 'cancelado' ? `<button class="btn small outline" onclick="openChat('${b.id}')">Chat</button>` : ''}
          ${payment ? `<button class="btn small outline" onclick="downloadReceiptFor('${payment.id}','${b.id}')">Comprobante</button>` : ''}
          ${canCancel ? `<button class="btn small danger" onclick="openCancelModal('${b.id}', false)">Cancelar</button>` : ''}
          </div>
        </div>`;
      }).join('') : '<p class="hint">Aún no tienes reservas. <a onclick="page(\'market\')" style="cursor:pointer;text-decoration:underline">Explora servicios</a>.</p>'}
    </div>`;
}
function downloadReceiptFor(paymentId, bookingId) {
  const p = PAYMENTS.find(x => x.id === paymentId); const b = BOOKINGS.find(x => x.id === bookingId);
  if (p && b) downloadReceipt(p, b);
}
function bookingStatusLabel(s) {
  return { reservado: 'Reservado, pendiente de pago', pagado: 'Pagado · servicio en curso', entregado: 'Entregado, esperando confirmación', completado: 'Completado y evaluado', cancelado: 'Cancelado' }[s] || s;
}

/* ---------------- Panel de administración ---------------- */
let adminTab = 'validaciones';
let GUEST_REQUESTS = [];
let ORGANIZATIONS = [];
function setAdminTab(tab) { adminTab = tab; document.querySelectorAll('.adminTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); renderAdmin(); }
function renderAdmin() {
  const el = document.getElementById('adminContent');
  if (!SESSION || SESSION.role !== 'admin') { el.innerHTML = `<div class="dashCard"><h3>Acceso restringido</h3><p class="hint">Esta sección es solo para administradores de Skilly.</p><button class="btn primary" onclick="openM('login');setLoginRole('admin')">Ingresar como administrador</button></div>`; return; }
  if (adminTab === 'validaciones') return renderAdminValidations(el);
  if (adminTab === 'profesionales') return renderAdminProfessionals(el);
  if (adminTab === 'calendario') return renderAdminCalendar(el);
  if (adminTab === 'organizaciones') return renderAdminOrganizations(el);
  if (adminTab === 'guest') return renderAdminGuestRequests(el);
  if (adminTab === 'evaluaciones') return renderAdminEvaluations(el);
  if (adminTab === 'pagos') return renderAdminPayments(el);
  if (adminTab === 'ajustes') return renderAdminSettings(el);
}

async function fetchDashboardData() {
  const r = await fetch('/api/admin/dashboard', { headers: { 'x-admin-passcode': SESSION.adminPasscode || '' } });
  return r.json();
}

async function renderBigDashboard() {
  const el = document.getElementById('bigDashboardContent');
  el.innerHTML = '<div class="loading">Cargando resumen...</div>';
  let d;
  try { d = await fetchDashboardData(); } catch (e) { el.innerHTML = '<div class="empty">No se pudo cargar el resumen.</div>'; return; }

  const kpi = (label, value, sub = '') => `<div class="kpiCard"><span class="kpiLabel">${label}</span><b class="kpiValue">${value}</b>${sub ? `<span class="kpiSub">${sub}</span>` : ''}</div>`;
  const bar = (label, value, total, color) => `<div class="barRow"><span>${label}</span><div class="barTrack"><div class="barFill" style="width:${total ? (value / total * 100) : 0}%;background:${color}"></div></div><b>${value}</b></div>`;

  const bTotal = d.bookings.total || 1;
  const provTotal = Math.max(1, d.payments.porProveedor.webpay + d.payments.porProveedor.paypal + d.payments.porProveedor.simulado);
  el.innerHTML = `
    <div class="kpiGrid" style="grid-template-columns:repeat(4,1fr)">
      ${kpi('Profesionales validados', d.professionals.validados, `${d.professionals.pendientes} pendientes · ${d.professionals.infoSolicitada} con info solicitada`)}
      ${kpi('Reservas totales', d.bookings.total, `${d.bookings.completado} completadas · ${d.bookings.cancelado} canceladas`)}
      ${kpi('Monto retenido', fmtMoney(d.payments.retenido), 'Pagado, esperando entrega')}
      ${kpi('Monto liberado', fmtMoney(d.payments.liberado), 'Liquidación simulada autorizada')}
      ${kpi('Monto reembolsado', fmtMoney(d.payments.totalReembolsado), 'Devuelto por cancelaciones')}
      ${kpi('Solicitudes sin registro', d.guestRequests.total, `${d.guestRequests.nuevas} nuevas por gestionar`)}
      ${kpi('Recomendados por Skilly', d.professionals.recomendados, '')}
      ${kpi('Revisiones esta semana', `${d.revisionSemanal.realizadas} / ${d.revisionSemanal.capacidad}`, d.revisionSemanal.sobrecargado ? '⚠️ Sobre la capacidad del equipo' : 'Dentro de la capacidad del equipo')}
    </div>
    ${d.revisionSemanal.sobrecargado ? `<div class="dashCard" style="border-color:#c0392b"><h3>⚠️ Capacidad de revisión superada</h3><p class="hint">El equipo de Skilly definió una capacidad de ${d.revisionSemanal.capacidad} revisiones semanales (Ajustes) y ya se hicieron ${d.revisionSemanal.realizadas} esta semana. Considera priorizar las solicitudes más antiguas en "Solicitudes de validación".</p></div>` : ''}
    <div class="dashCard">
      <h3>Reservas por estado</h3>
      ${bar('Solicitudes y reservas sin pagar', d.bookings.reservado, bTotal, '#b8860b')}
      ${bar('Pagado (retenido)', d.bookings.pagado, bTotal, '#159c5d')}
      ${bar('Entregadas · pendientes de liquidación', d.bookings.entregado, bTotal, '#28d17c')}
      ${bar('Completado', d.bookings.completado, bTotal, '#17202a')}
      ${bar('Cancelado', d.bookings.cancelado, bTotal, '#c0392b')}
    </div>
    <div class="dashCard">
      <h3>Pagos por medio de pago</h3>
      ${bar('Webpay Plus', d.payments.porProveedor.webpay, provTotal, '#159c5d')}
      ${bar('PayPal', d.payments.porProveedor.paypal, provTotal, '#0070ba')}
      ${bar('Simulado', d.payments.porProveedor.simulado, provTotal, '#65717b')}
    </div>
    <div class="dashCard" style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn outline" onclick="page('admin');setAdminTab('calendario')">Ver calendario →</button>
      <button class="btn outline" onclick="page('admin');setAdminTab('organizaciones')">Ver organizaciones →</button>
      <button class="btn outline" onclick="page('admin');setAdminTab('validaciones')">Ver validaciones pendientes →</button>
    </div>
    ${!SERVER_CONFIG.mailerConfigured ? '<div class="dashCard" style="border-color:#b8860b"><h3>⚠️ Aviso por Gmail no configurado</h3><p class="hint">Las solicitudes sin registro se siguen guardando, pero no se envía el correo automático a Skilly. Configura GMAIL_USER y GMAIL_APP_PASSWORD en tu archivo .env (ver README).</p></div>' : ''}
  `;
}

async function renderAdminGuestRequests(el) {
  el.innerHTML = '<div class="loading">Cargando solicitudes...</div>';
  try { GUEST_REQUESTS = await Api.adminGet('guest-requests'); } catch (e) { GUEST_REQUESTS = []; }
  const arr = [...GUEST_REQUESTS].sort((a, b) => b.createdAt - a.createdAt);
  if (!arr.length) { el.innerHTML = '<div class="empty">No hay solicitudes de organizaciones sin registro.</div>'; return; }
  el.innerHTML = arr.map(g => `
    <div class="dashCard">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div><h3>${escapeHtml(g.orgName)}</h3><p class="hint">Contacto: ${escapeHtml(g.contactName)} · ${escapeHtml(g.email)} ${g.phone ? '· ' + escapeHtml(g.phone) : ''}</p></div>
        <span class="pill ${g.status === 'convertida' ? 'ok' : g.status === 'descartada' ? 'no' : 'pend'}">${g.status}</span>
      </div>
      <div class="detailGrid">
        <div><b>Profesional solicitado</b><span>${escapeHtml(g.professionalName)}</span></div>
        <div><b>Día / hora pedida</b><span>${escapeHtml(g.date)} · ${escapeHtml(g.time)}</span></div>
        <div><b>Correo enviado a Skilly</b><span>${g.emailSent ? 'Sí' : 'No (revisar configuración de Gmail)'}</span></div>
        <div><b>Reserva vinculada</b><span>${g.bookingId ? g.bookingId : '—'}</span></div>
        <div style="grid-column:1/-1"><b>Notas del solicitante</b><span>${escapeHtml(g.notes || '—')}</span></div>
      </div>
      <div class="formgrid2">
        <label>Notas del administrador (contacto, método de pago acordado, etc.)<textarea id="gnotes-${g.id}">${escapeHtml(g.adminNotes || '')}</textarea></label>
        <label>Asignado a (integrante de Skilly)<input id="gassigned-${g.id}" value="${escapeHtml(g.assignedTo || '')}" placeholder="Nombre de quien la está gestionando"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn outline" onclick="updateGuestRequest('${g.id}','contactada')">Marcar contactada</button>
        ${!g.bookingId ? `<button class="btn primary" onclick="convertGuestRequest('${g.id}')">Convertir en reserva formal</button>` : ''}
        <button class="btn danger" onclick="updateGuestRequest('${g.id}','descartada')">Descartar</button>
      </div>
    </div>`).join('');
}
async function updateGuestRequest(id, status) {
  const notesEl = document.getElementById('gnotes-' + id);
  const assignedEl = document.getElementById('gassigned-' + id);
  const adminNotes = notesEl ? notesEl.value.trim() : undefined;
  const assignedTo = assignedEl ? assignedEl.value.trim() : undefined;
  try {
    const r = await fetch('/api/admin/guest-requests/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-passcode': SESSION.adminPasscode || '' },
      body: JSON.stringify({ status, adminNotes, assignedTo }),
    });
    if (!r.ok) throw new Error((await r.json()).error);
    toast('Solicitud actualizada'); renderAdminGuestRequests(document.getElementById('adminContent'));
  } catch (e) { console.error(e); toast(e.message || 'No se pudo actualizar'); }
}
async function convertGuestRequest(id) {
  try {
    const r = await fetch(`/api/admin/guest-requests/${id}/convert`, { method: 'POST', headers: { 'x-admin-passcode': SESSION.adminPasscode || '' } });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    toast('Solicitud convertida en reserva formal. Ahora puedes coordinar el pago con la organización (Webpay/PayPal) o registrarlo manualmente.');
    await refreshAll();
    renderAdminGuestRequests(document.getElementById('adminContent'));
  } catch (e) { console.error(e); toast(e.message || 'No se pudo convertir la solicitud'); }
}
function renderAdminValidations(el) {
  const pending = PROFESSIONALS.filter(p => p.status === 'pendiente' || p.status === 'info_solicitada').sort((a, b) => a.createdAt - b.createdAt);
  if (!pending.length) { el.innerHTML = '<div class="empty">No hay solicitudes de validación pendientes.</div>'; return; }
  el.innerHTML = pending.map(p => `
    <div class="dashCard">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div><h3>${escapeHtml(p.name)}</h3><p class="hint">${escapeHtml(p.title)} · ${escapeHtml(p.category)} · ${escapeHtml(p.email)}</p></div>
        <span class="pill pend">${p.status === 'info_solicitada' ? 'Info. solicitada — esperando respuesta' : 'Pendiente'}</span>
      </div>
      <div class="detailGrid">
        <div><b>LinkedIn</b><span>${escapeHtml(p.validation?.linkedin || '—')}</span></div>
        <div><b>Años de experiencia</b><span>${escapeHtml(p.validation?.yearsExperience || '—')}</span></div>
        <div><b>Certificaciones</b><span>${escapeHtml(p.validation?.certifications || '—')}</span></div>
        <div><b>Portafolio</b><span>${escapeHtml(p.validation?.portfolio || '—')}</span></div>
        <div><b>CV / antecedentes</b><span>${escapeHtml(p.validation?.cv || '—')}</span></div>
        <div><b>Referencias</b><span>${escapeHtml(p.validation?.references || '—')}</span></div>
        <div style="grid-column:1/-1"><b>Motivación</b><span>${escapeHtml(p.validation?.motivation || '—')}</span></div>
      </div>
      <div class="formgrid2">
        <label>Notas / observaciones (se notifican al profesional por correo)<textarea id="notes-${p.id}" placeholder="Ej: falta acreditar certificación X">${escapeHtml(p.adminNotes || '')}</textarea></label>
        <label>Asignado a (integrante de Skilly)<input id="assigned-${p.id}" value="${escapeHtml(p.assignedTo || '')}" placeholder="Nombre de quien está revisando"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn primary" onclick="reviewProfessional('${p.id}','validado')">Aprobar</button>
        <button class="btn outline" onclick="reviewProfessional('${p.id}','info_solicitada')">Solicitar información adicional</button>
        <button class="btn danger" onclick="reviewProfessional('${p.id}','rechazado')">Rechazar</button>
      </div>
    </div>`).join('');
}
async function reviewProfessional(id, status) {
  const notesEl = document.getElementById('notes-' + id);
  const assignedEl = document.getElementById('assigned-' + id);
  const adminNotes = notesEl ? notesEl.value.trim() : '';
  const assignedTo = assignedEl ? assignedEl.value.trim() : undefined;
  if ((status === 'rechazado' || status === 'info_solicitada') && !adminNotes) { toast('Agrega una nota explicando qué falta o por qué se rechaza'); return; }
  const labels = { validado: 'Profesional validado', rechazado: 'Solicitud rechazada', info_solicitada: 'Se solicitó información adicional' };
  try {
    const updated = await Api.update('professionals', id, { status, adminNotes, assignedTo }, true);
    await refreshAll();
    toast(labels[status] + (updated.notificationEmailSent ? ' · se notificó por correo al profesional' : ' · no se notificó por correo (Gmail no configurado)'));
    renderAdmin();
  } catch (e) { console.error(e); toast('No se pudo actualizar'); }
}
function renderAdminProfessionals(el) {
  const arr = [...PROFESSIONALS].sort((a, b) => b.createdAt - a.createdAt);
  el.innerHTML = `<div class="adminList">` + arr.map(p => {
    const evals = EVALUATIONS.filter(e => e.professionalId === p.id);
    const avg = evals.length ? (evals.reduce((s, e) => s + e.stars, 0) / evals.length).toFixed(1) : '—';
    return `<div class="dashCard">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div><h3>${escapeHtml(p.name)}</h3><p class="hint">${escapeHtml(p.title)} · ${escapeHtml(p.category)} · prom. interno ${avg} (${evals.length} eval.)</p></div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="pill ${p.status === 'validado' ? 'ok' : p.status === 'rechazado' ? 'no' : 'pend'}">${p.status}</span>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;margin:0">
            <input type="checkbox" ${p.recommended ? 'checked' : ''} onchange="toggleRecommended('${p.id}', this.checked)" style="width:auto"> Recomendado
          </label>
        </div>
      </div>
      <div class="formgrid2">
        <label>Capacidad máxima por día<input type="number" min="0" id="capday-${p.id}" value="${p.maxPerDay ?? ''}" placeholder="Sin límite"></label>
        <label>Capacidad máxima por semana<input type="number" min="0" id="capweek-${p.id}" value="${p.maxPerWeek ?? ''}" placeholder="Sin límite"></label>
      </div>
      <div class="formgrid2">
        <label>Capacidad máxima por mes<input type="number" min="0" id="capmonth-${p.id}" value="${p.maxPerMonth ?? ''}" placeholder="Sin límite"></label>
        <label>Asignado a (integrante de Skilly)<input id="assignedp-${p.id}" value="${escapeHtml(p.assignedTo || '')}" placeholder="Nombre de quien lo gestiona"></label>
      </div>
      <button class="btn small outline" onclick="saveProfessionalCapacity('${p.id}')">Guardar capacidad / asignación</button>
    </div>`;
  }).join('') + `</div>`;
}
async function saveProfessionalCapacity(id) {
  const val = (elId) => { const v = document.getElementById(elId).value; return v === '' ? null : Number(v); };
  try {
    await Api.update('professionals', id, {
      maxPerDay: val('capday-' + id), maxPerWeek: val('capweek-' + id), maxPerMonth: val('capmonth-' + id),
      assignedTo: document.getElementById('assignedp-' + id).value.trim(),
    }, true);
    await refreshAll(); toast('Capacidad actualizada'); renderAdmin();
  } catch (e) { console.error(e); toast('No se pudo actualizar'); }
}
async function toggleRecommended(id, val) {
  try { await Api.update('professionals', id, { recommended: val }, true); await refreshAll(); renderAdmin(); }
  catch (e) { console.error(e); toast('No se pudo actualizar'); }
}
function renderAdminEvaluations(el) {
  const arr = [...EVALUATIONS].sort((a, b) => b.createdAt - a.createdAt);
  if (!arr.length) { el.innerHTML = '<div class="empty">Aún no hay evaluaciones registradas.</div>'; return; }
  el.innerHTML = `<p class="hint" style="margin-bottom:14px">Estas evaluaciones son privadas: el servidor solo las entrega a peticiones autenticadas de administrador. Sirven como argumento interno para decidir qué profesionales destacar (campo "Recomendado"), sin exponer un ranking público de estrellas.</p>` +
    `<div class="adminList">` + arr.map(e => `
    <div class="adminRow" style="grid-template-columns:1.4fr 2fr .6fr 1fr">
      <div><b>${escapeHtml(e.professionalName)}</b><small>Evaluado por ${escapeHtml(e.orgName)}</small></div>
      <div><small>${escapeHtml(e.comment)}</small></div>
      <div>${'★'.repeat(e.stars)}${'☆'.repeat(5 - e.stars)}</div>
      <div><small>${new Date(e.createdAt).toLocaleDateString('es-CL')}</small></div>
    </div>`).join('') + `</div>`;
}
function renderAdminPayments(el) {
  const arr = [...PAYMENTS].sort((a, b) => b.createdAt - a.createdAt);
  if (!arr.length) { el.innerHTML = '<div class="empty">Aún no hay pagos registrados.</div>'; return; }
  el.innerHTML = `<div class="adminList">` + arr.map(p => {
    const b = BOOKINGS.find(x => x.id === p.bookingId);
    return `<div class="adminRow">
      <div><b>${escapeHtml(p.professionalName)}</b><small>${escapeHtml(p.orgName)} · N° ${escapeHtml(p.invoiceNumber)}</small></div>
      <div><small>${b ? escapeHtml(b.date) + ' · ' + escapeHtml(b.time) : ''}</small></div>
      <div><b>${fmtMoney(p.amount)}</b></div>
      <div><span class="pill ${p.status === 'liberado' ? 'ok' : p.status === 'reembolsado' || p.status === 'rechazado' ? 'no' : 'pend'}">${p.status}</span>
        ${p.status === 'reembolsado' ? `<small style="display:block">Reembolsado: ${fmtMoney(p.refundAmount)}</small>` : ''}
        ${b ? `<button class="btn small outline" onclick="downloadReceiptFor('${p.id}','${b.id}')">Comprobante</button>` : ''}
      </div>
    </div>`;
  }).join('') + `</div>`;
}

/* ---------------- Calendario de administración ---------------- */
let calendarMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
let calendarSelectedDay = null;
let calendarProfFilter = '';

function shiftMonth(delta) {
  const [y, m] = calendarMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  calendarMonth = d.toISOString().slice(0, 7);
  calendarSelectedDay = null;
  renderAdminCalendar(document.getElementById('adminContent'));
}
function setCalendarProfFilter(id) { calendarProfFilter = id; renderAdminCalendar(document.getElementById('adminContent')); }

function renderAdminCalendar(el) {
  const [year, month] = calendarMonth.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthLabel = firstDay.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });

  const relevantBookings = BOOKINGS.filter(b => (!calendarProfFilter || b.professionalId === calendarProfFilter) && b.status !== 'cancelado');
  const countsByDay = {};
  relevantBookings.forEach(b => { countsByDay[b.date] = (countsByDay[b.date] || 0) + 1; });

  const profOptions = PROFESSIONALS.map(p => `<option value="${p.id}" ${calendarProfFilter === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');

  let cells = '';
  for (let i = 0; i < startOffset; i++) cells += `<div class="calCell calCell-empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const count = countsByDay[dateStr] || 0;
    const isSelected = calendarSelectedDay === dateStr;
    const isToday = dateStr === new Date().toISOString().slice(0, 10);
    cells += `<div class="calCell ${isSelected ? 'calCell-selected' : ''} ${isToday ? 'calCell-today' : ''}" onclick="selectCalendarDay('${dateStr}')">
      <span class="calDayNum">${day}</span>
      ${count ? `<span class="calCount">${count} reserva${count > 1 ? 's' : ''}</span>` : ''}
    </div>`;
  }

  el.innerHTML = `
    <div class="dashCard">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn small outline" onclick="shiftMonth(-1)">← Mes anterior</button>
          <b style="text-transform:capitalize;font-size:16px">${monthLabel}</b>
          <button class="btn small outline" onclick="shiftMonth(1)">Mes siguiente →</button>
        </div>
        <label style="margin:0">Filtrar por profesional
          <select onchange="setCalendarProfFilter(this.value)" style="margin-left:6px">
            <option value="">Todos</option>${profOptions}
          </select>
        </label>
      </div>
      <div class="calGrid calGridHead">
        <div>Lun</div><div>Mar</div><div>Mié</div><div>Jue</div><div>Vie</div><div>Sáb</div><div>Dom</div>
      </div>
      <div class="calGrid">${cells}</div>
    </div>
    <div id="calDayDetail"></div>
  `;
  if (calendarSelectedDay) renderCalendarDayDetail();
}

function selectCalendarDay(dateStr) { calendarSelectedDay = dateStr; renderAdminCalendar(document.getElementById('adminContent')); }

function renderCalendarDayDetail() {
  const el = document.getElementById('calDayDetail');
  const dayBookings = BOOKINGS.filter(b => b.date === calendarSelectedDay && (!calendarProfFilter || b.professionalId === calendarProfFilter))
    .sort((a, b) => a.time.localeCompare(b.time));
  const dateLabel = new Date(calendarSelectedDay + 'T00:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });

  if (!dayBookings.length) { el.innerHTML = `<div class="dashCard"><h3 style="text-transform:capitalize">${dateLabel}</h3><p class="hint">No hay reservas este día.</p></div>`; return; }

  el.innerHTML = `
    <div class="dashCard">
      <h3 style="text-transform:capitalize">${dateLabel}</h3>
      ${dayBookings.map(b => {
        const prof = PROFESSIONALS.find(p => p.id === b.professionalId);
        const hours = prof?.availability?.hours || [];
        const taken = BOOKINGS.filter(x => x.professionalId === b.professionalId && x.date === b.date && x.status !== 'cancelado' && x.id !== b.id).map(x => x.time);
        const freeHours = hours.filter(h => !taken.includes(h));
        return `
        <div class="miniRow" style="flex-direction:column;align-items:stretch;gap:8px">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div><b>${escapeHtml(b.time)} · ${escapeHtml(b.professionalName)}</b><br><span class="hint">${escapeHtml(b.orgName)} · ${escapeHtml(bookingStatusLabel(b.status))}</span></div>
            <span class="pill ${b.status === 'cancelado' ? 'no' : b.status === 'completado' ? 'ok' : 'pend'}">${b.status}</span>
          </div>
          ${b.status !== 'cancelado' && b.status !== 'completado' ? `
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select id="resched-${b.id}">
              ${freeHours.map(h => `<option value="${h}" ${h === b.time ? 'selected' : ''}>${h}</option>`).join('')}
            </select>
            <button class="btn small outline" onclick="rescheduleBooking('${b.id}')">Cambiar horario</button>
            <button class="btn small danger" onclick="openCancelModal('${b.id}', true)">Cancelar</button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

async function rescheduleBooking(bookingId) {
  const sel = document.getElementById('resched-' + bookingId);
  const newTime = sel.value;
  try {
    await Api.update('bookings', bookingId, { time: newTime });
    await refreshAll();
    toast('Horario actualizado');
    renderCalendarDayDetail();
  } catch (e) { console.error(e); toast(e.message || 'No se pudo cambiar el horario'); }
}

/* ---------------- Cancelación con devolución (% configurable) ---------------- */
function openCancelModal(bookingId, fromAdmin = false) {
  const b = BOOKINGS.find(x => x.id === bookingId);
  if (!b) return;
  const payment = PAYMENTS.find(p => p.bookingId === bookingId && (p.status === 'pagado' || p.status === 'liberado'));
  const pct = SERVER_CONFIG.cancellationRefundPercent ?? 80;
  const refundPreview = payment ? Math.round(payment.amount * (pct / 100)) : 0;
  const box = document.getElementById('cancelBookingBox');
  box.innerHTML = `
    <button class="close" onclick="closeM('cancelBooking')">×</button>
    <small>CANCELAR RESERVA</small><h2>¿Cancelar este servicio?</h2>
    <div class="row">Profesional <b>${escapeHtml(b.professionalName)}</b></div>
    <div class="row">Fecha <b>${escapeHtml(b.date)} · ${escapeHtml(b.time)}</b></div>
    ${payment ? `
      <div class="row">Monto pagado <b>${fmtMoney(payment.amount)}</b></div>
      <div class="row">Se te devolverá (${pct}%) <b>${fmtMoney(refundPreview)}</b></div>
      <p class="hint">Skilly retiene el ${100 - pct}% restante (${fmtMoney(payment.amount - refundPreview)}) como corresponde a la política de cancelación. El reembolso se procesa por el mismo medio de pago usado.</p>
    ` : `<p class="hint">Esta reserva aún no ha sido pagada, así que no corresponde reembolso.</p>`}
    <label>Motivo de la cancelación<textarea id="cancelReason" placeholder="Cuéntanos brevemente por qué cancelas"></textarea></label>
    <button class="btn danger full" id="cancelConfirmBtn" onclick="confirmCancelBooking('${bookingId}', ${fromAdmin})">Confirmar cancelación</button>`;
  openM('cancelBooking');
}
async function confirmCancelBooking(bookingId, fromAdmin) {
  const reason = document.getElementById('cancelReason').value.trim();
  const btn = document.getElementById('cancelConfirmBtn'); btn.disabled = true; btn.textContent = 'Procesando...';
  try {
    const r = await fetch(`/api/bookings/${bookingId}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, cancelledBy: fromAdmin ? 'admin' : 'organizacion' }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    closeM('cancelBooking');
    toast(body.refunded ? `Reserva cancelada. Se procesó un reembolso de ${fmtMoney(body.refundAmount)}.` : 'Reserva cancelada.');
    await refreshAll();
    if (fromAdmin) renderAdminCalendar(document.getElementById('adminContent'));
    else renderDashboard();
  } catch (e) {
    console.error(e); toast(e.message || 'No se pudo cancelar la reserva');
    btn.disabled = false; btn.textContent = 'Confirmar cancelación';
  }
}

/* ---------------- Seguimiento de organizaciones/clientes ---------------- */
async function renderAdminOrganizations(el) {
  el.innerHTML = '<div class="loading">Cargando organizaciones...</div>';
  try { ORGANIZATIONS = await Api.adminGet('organizations'); } catch (e) { ORGANIZATIONS = []; }
  if (!ORGANIZATIONS.length) { el.innerHTML = '<div class="empty">Aún no hay organizaciones con reservas registradas.</div>'; return; }
  el.innerHTML = ORGANIZATIONS.map((o, i) => `
    <div class="dashCard">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:center">
        <div><h3>${escapeHtml(o.orgName)}</h3><p class="hint">${escapeHtml(o.orgEmail)}</p></div>
        <button class="btn small outline" onclick="toggleOrgHistory(${i})">Ver historial</button>
      </div>
      <div class="kpiGrid" style="grid-template-columns:repeat(4,1fr);margin-top:10px">
        <div class="kpiCard"><span class="kpiLabel">Reservas totales</span><b class="kpiValue">${o.totalReservas}</b></div>
        <div class="kpiCard"><span class="kpiLabel">Este mes</span><b class="kpiValue">${o.reservasEsteMes}</b></div>
        <div class="kpiCard"><span class="kpiLabel">Canceladas</span><b class="kpiValue">${o.reservasCanceladas}</b></div>
        <div class="kpiCard"><span class="kpiLabel">Total pagado</span><b class="kpiValue" style="font-size:18px">${fmtMoney(o.totalPagado)}</b></div>
      </div>
      <div id="orgHistory-${i}" style="display:none;margin-top:12px">
        ${o.historial.map(b => `<div class="miniRow"><div><b>${escapeHtml(b.professionalName)}</b> — ${escapeHtml(b.service)}<br><span class="hint">${escapeHtml(b.date)} · ${escapeHtml(b.time)} — ${escapeHtml(bookingStatusLabel(b.status))}</span></div></div>`).join('')}
      </div>
    </div>`).join('');
}
function toggleOrgHistory(i) {
  const el = document.getElementById('orgHistory-' + i);
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

/* ---------------- Ajustes operativos ---------------- */
async function renderAdminSettings(el) {
  el.innerHTML = '<div class="loading">Cargando ajustes...</div>';
  let s;
  try { s = await (await fetch('/api/admin/settings', { headers: { 'x-admin-passcode': SESSION.adminPasscode || '' } })).json(); }
  catch (e) { el.innerHTML = '<div class="empty">No se pudieron cargar los ajustes.</div>'; return; }
  el.innerHTML = `
    <div class="dashCard">
      <h3>Capacidad de revisión semanal del equipo Skilly</h3>
      <p class="hint">Cuántas validaciones de profesionales puede revisar el equipo por semana, en esta etapa de acompañamiento manual. El dashboard avisa cuando se supera.</p>
      <input type="number" min="1" id="setWeeklyCap" value="${s.admin_weekly_review_capacity}" style="max-width:160px">
    </div>
    <div class="dashCard">
      <h3>Política de reembolso por cancelación</h3>
      <p class="hint">Porcentaje del pago que se devuelve a la organización cuando cancela una reserva ya pagada. Skilly retiene el resto.</p>
      <input type="number" min="0" max="100" id="setRefundPct" value="${s.default_cancellation_refund_percent}" style="max-width:160px"> %
    </div>
    <button class="btn primary" onclick="saveSettings()">Guardar ajustes</button>
  `;
}
async function saveSettings() {
  try {
    await fetch('/api/admin/settings', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-passcode': SESSION.adminPasscode || '' },
      body: JSON.stringify({
        adminWeeklyReviewCapacity: Number(document.getElementById('setWeeklyCap').value),
        defaultCancellationRefundPercent: Number(document.getElementById('setRefundPct').value),
      }),
    });
    await loadServerConfig();
    toast('Ajustes guardados');
  } catch (e) { console.error(e); toast('No se pudo guardar'); }
}

/* ---------------- Chat organización ↔ profesional ---------------- */
let chatBookingId = null;
let chatPollTimer = null;

function openChat(bookingId) {
  chatBookingId = bookingId;
  renderChat();
  openM('chat');
  clearInterval(chatPollTimer);
  chatPollTimer = setInterval(renderChat, 4000); // refresco simple cada 4s mientras está abierto
}
function closeChat() {
  closeM('chat');
  clearInterval(chatPollTimer);
  chatPollTimer = null;
}

async function renderChat() {
  if (!chatBookingId || !document.getElementById('chat').classList.contains('show')) return;
  const b = BOOKINGS.find(x => x.id === chatBookingId);
  if (!b) return;
  let messages = [];
  try { messages = await Api.list(`bookings/${chatBookingId}/messages`); } catch (e) { /* silencioso, se reintenta en el próximo poll */ }

  const myRole = SESSION?.role === 'profesional' ? 'profesional' : 'organizacion';
  const otherLabel = myRole === 'profesional' ? b.orgName : b.professionalName;

  const box = document.getElementById('chatBox');
  const wasOpen = box.innerHTML !== '';
  box.innerHTML = `
    <button class="close" onclick="closeChat()">×</button>
    <small>CHAT DE LA RESERVA</small><h2>Conversación con ${escapeHtml(otherLabel)}</h2>
    <p class="hint">${escapeHtml(b.date)} · ${escapeHtml(b.time)} — ${escapeHtml(b.service)}</p>
    <div id="chatMessages" class="chatMessages">
      ${messages.length ? messages.map(m => `
        <div class="chatMsg ${m.senderRole === myRole ? 'chatMsg-mine' : ''}">
          <span class="chatMsgMeta">${m.senderRole === 'admin' ? 'Skilly' : escapeHtml(m.senderName || (m.senderRole === 'organizacion' ? 'Organización' : 'Profesional'))} · ${new Date(m.createdAt).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          <div class="chatMsgBody">${escapeHtml(m.body)}</div>
        </div>`).join('') : '<p class="hint">Aún no hay mensajes. Escribe para coordinar los detalles del servicio.</p>'}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <input id="chatInput" placeholder="Escribe un mensaje..." style="flex:1" onkeydown="if(event.key==='Enter')sendChatMessage()">
      <button class="btn primary" onclick="sendChatMessage()">Enviar</button>
    </div>`;
  const msgsEl = document.getElementById('chatMessages');
  if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const body = input.value.trim();
  if (!body) return;
  const myRole = SESSION?.role === 'profesional' ? 'profesional' : 'organizacion';
  input.value = '';
  try {
    await Api.create(`bookings/${chatBookingId}/messages`, { senderRole: myRole, senderName: SESSION?.name || '', body });
    await renderChat();
  } catch (e) { console.error(e); toast('No se pudo enviar el mensaje'); }
}

document.addEventListener('DOMContentLoaded', () => skillyInit());
