const railMin = 56;
const railMax = 240;
const railMobileQuery = matchMedia('(max-width: 760px)');
let railWidth = railMax;
let railDrawerOpen = false;

function renderRail() {
  const rail = $('sideRail');
  const mobile = railMobileQuery.matches;
  const expanded = mobile ? railDrawerOpen : railWidth > railMin;
  rail.classList.toggle('compact', !mobile && !expanded);
  rail.classList.toggle('drawerOpen', mobile && railDrawerOpen);
  rail.inert = mobile && !railDrawerOpen;
  document.body.style.setProperty('--rail-width', railWidth + 'px');
  $('railBackdrop').hidden = rail.hidden || !mobile || !railDrawerOpen;
  $('railMobile').hidden = rail.hidden || !mobile;
  $('railMobile').setAttribute('aria-expanded', String(railDrawerOpen));
  $('railToggle').setAttribute('aria-expanded', String(expanded));
  $('railToggle').setAttribute('aria-label', expanded ? 'Contraer menú' : 'Expandir menú');
  $('railToggle').textContent = mobile ? '×' : expanded ? '‹' : '›';
  $('railGrip').setAttribute('aria-valuenow', String(railWidth));
  $('railTip').hidden = true;
}

function updateRailSession(signedIn) {
  $('sideRail').hidden = !signedIn;
  document.body.classList.toggle('hasAdminRail', signedIn);
  if (!signedIn) railDrawerOpen = false;
  renderRail();
}

function toggleRail() {
  if (railMobileQuery.matches) {
    railDrawerOpen = !railDrawerOpen;
    renderRail();
    (railDrawerOpen ? $('railToggle') : $('railMobile')).focus();
  } else {
    railWidth = railWidth === railMin ? railMax : railMin;
    renderRail();
  }
}

function adminNavigate(section) {
  adminSection = section;
  adminTab = section;
  if (railDrawerOpen) toggleRail();
  page(section === 'dashboard' ? 'bigDashboard' : 'admin');
  for (const button of $('sideNav').querySelectorAll('button')) {
    const selected = button.dataset.section === section;
    button.classList.toggle('on', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function buildSidebar() {
  const rail = $('sideRail');
  const nav = $('sideNav');
  const grip = $('railGrip');
  for (const [id, icon, label] of adminItems) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.section = id;
    button.setAttribute('aria-label', label);
    button.innerHTML = '<i aria-hidden="true">' + esc(icon) + '</i><span>' + esc(label) + '</span>';
    if (id === adminSection) {
      button.classList.add('on');
      button.setAttribute('aria-current', 'page');
    }
    button.addEventListener('click', () => adminNavigate(id));
    nav.append(button);
  }
  function showTip(event) {
    const button = event.target.closest('button');
    if (!button || !rail.classList.contains('compact')) return;
    const tip = $('railTip');
    tip.textContent = button.getAttribute('aria-label');
    tip.style.top = button.getBoundingClientRect().top + 'px';
    tip.hidden = false;
  }
  nav.addEventListener('pointerover', showTip);
  nav.addEventListener('focusin', showTip);
  for (const name of ['pointerleave', 'focusout', 'scroll']) {
    nav.addEventListener(name, () => { $('railTip').hidden = true; });
  }
  function resizeRail(width) {
    railWidth = Math.round(Math.max(railMin, Math.min(railMax, width)));
    renderRail();
  }
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    grip.setPointerCapture(event.pointerId);
    document.body.classList.add('resizingRail');
  });
  grip.addEventListener('pointermove', event => {
    if (grip.hasPointerCapture(event.pointerId)) resizeRail(event.clientX - rail.getBoundingClientRect().left);
  });
  grip.addEventListener('lostpointercapture', () => document.body.classList.remove('resizingRail'));
  grip.addEventListener('dblclick', toggleRail);
  grip.addEventListener('keydown', event => {
    const widths = {Home: railMin, End: railMax, ArrowLeft: railWidth - 16, ArrowRight: railWidth + 16};
    if (!(event.key in widths)) return;
    event.preventDefault();
    resizeRail(widths[event.key]);
  });
  railMobileQuery.addEventListener('change', () => { railDrawerOpen = false; renderRail(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && railDrawerOpen) toggleRail();
  });
  document.addEventListener('focusin', event => {
    if (railDrawerOpen && !rail.contains(event.target) && event.target !== $('railMobile')) {
      railDrawerOpen = false;
      renderRail();
    }
  });
  const header = document.querySelector('header.nav');
  new ResizeObserver(() => document.body.style.setProperty('--header-height', header.offsetHeight + 'px')).observe(header);
  renderRail();
}
