/**
 * @file Control del menú de la aplicación administrativa. Se carga después de
 * workspace.js y usa sus utilidades y adminItems. Combina botones, arrastre y teclado en
 * escritorio con un cajón accesible en móvil.
 */

const railMin = 56;
const railMax = 240;
const railMobileQuery = matchMedia('(max-width: 760px)');
let railWidth = railMax;
let railDrawerOpen = false;

/**
 * Sincroniza ancho, modo compacto o cajón móvil, fondo y atributos ARIA con el estado del menú.
 * En móvil cerrado aplica inert para evitar foco en controles ocultos.
 *
 * @returns {void} Sincroniza DOM y atributos ARIA con el estado actual.
 * @example
 * // En la aplicación administrativa, con los elementos del menú disponibles:
 * renderRail();
 */
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

/**
 * Muestra u oculta la barra según la sesión administrativa, limpia el cajón al salir y actualiza
 * el diseño.
 *
 * @param {boolean} signedIn - Indica si existe una sesión administrativa visible en la interfaz.
 * @returns {void} Actualiza visibilidad del menú y su estado; no autentica al usuario.
 * @example
 * updateRailSession(true);
 */
function updateRailSession(signedIn) {
  $('sideRail').hidden = !signedIn;
  document.body.classList.toggle('hasAdminRail', signedIn);
  if (!signedIn) railDrawerOpen = false;
  renderRail();
}

/**
 * Alterna entre 56 y 240 píxeles en escritorio o abre/cierra el cajón móvil. En móvil mueve el
 * foco al botón visible apropiado.
 *
 * @returns {void} Alterna el panel y ajusta el foco cuando corresponde.
 * @example
 * // En la aplicación administrativa, con los elementos del menú disponibles:
 * toggleRail();
 */
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

/**
 * Selecciona la sección administrativa, cierra el cajón móvil y actualiza la página y
 * aria-current de los botones.
 *
 * @param {string} section - Clave de adminItems; dashboard abre bigDashboard.
 * @returns {void} Selecciona sección, actualiza página y aria-current.
 * @example
 * adminNavigate("servicios");
 */
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

/**
 * Construye los botones de adminItems y conecta navegación, ayudas, arrastre, teclado y cambios
 * de tamaño. El menú actual se contrae con botón/arrastre; pointerover muestra ayudas en modo
 * compacto, no abre automáticamente todo el panel.
 *
 * @returns {void} Crea botones y registra manejadores; requiere el DOM administrativo cargado.
 * @example
 * // En la aplicación administrativa, con los elementos del menú disponibles:
 * buildSidebar();
 */
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
    button.addEventListener('click', /* Abre la sección asociada al botón del menú administrativo. */ () => adminNavigate(id));
    nav.append(button);
  }
  /**
   * Muestra la etiqueta del botón bajo el puntero o foco cuando el menú está compacto,
   * posicionándola junto al botón.
   *
   * @param {PointerEvent|FocusEvent} event - Evento delegado cuyo target permite localizar el botón del menú.
   * @returns {void} Muestra ayuda solo en modo compacto y sobre un botón.
   * @example
   * nav.addEventListener("focusin", showTip);
   */
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
    nav.addEventListener(name, () => {
      // Oculta la ayuda flotante al abandonar el menú, perder foco o desplazar su contenido.
       $('railTip').hidden = true; });
  }
  /**
   * Limita el ancho solicitado al intervalo 56–240 píxeles, lo redondea y actualiza el menú.
   *
   * @param {number} width - Ancho propuesto en píxeles.
   * @returns {void} Actualiza railWidth limitado a 56–240 píxeles y redibuja.
   * @example
   * resizeRail(160);
   */
  function resizeRail(width) {
    railWidth = Math.round(Math.max(railMin, Math.min(railMax, width)));
    renderRail();
  }
  grip.addEventListener('pointerdown', event => {
    // Captura el puntero principal para arrastrar el borde del menú y activa el estado visual de redimensionamiento.
    
    if (event.button !== 0) return;
    grip.setPointerCapture(event.pointerId);
    document.body.classList.add('resizingRail');
  });
  grip.addEventListener('pointermove', event => {
    // Ajusta el ancho mientras el control conserva la captura del puntero.
    
    if (grip.hasPointerCapture(event.pointerId)) resizeRail(event.clientX - rail.getBoundingClientRect().left);
  });
  grip.addEventListener('lostpointercapture', /* Limpia el estado de redimensionamiento cuando termina la captura del puntero. */ () => document.body.classList.remove('resizingRail'));
  grip.addEventListener('dblclick', toggleRail);
  grip.addEventListener('keydown', event => {
    // Permite redimensionar con flechas, Home y End, evitando el comportamiento predeterminado de esas teclas.
    
    const widths = {Home: railMin, End: railMax, ArrowLeft: railWidth - 16, ArrowRight: railWidth + 16};
    if (!(event.key in widths)) return;
    event.preventDefault();
    resizeRail(widths[event.key]);
  });
  railMobileQuery.addEventListener('change', () => {
    // Reinicia el cajón móvil y recalcula el menú al cambiar el tamaño de pantalla.
     railDrawerOpen = false; renderRail(); });
  document.addEventListener('keydown', event => {
    // Cierra el cajón móvil con Escape cuando está abierto.
    
    if (event.key === 'Escape' && railDrawerOpen) toggleRail();
  });
  document.addEventListener('focusin', event => {
    // Cierra el cajón cuando el foco pasa fuera del menú y del botón móvil.
    
    if (railDrawerOpen && !rail.contains(event.target) && event.target !== $('railMobile')) {
      railDrawerOpen = false;
      renderRail();
    }
  });
  const header = document.querySelector('header.nav');
  new ResizeObserver(/* Actualiza la altura CSS del encabezado cuando cambia su tamaño, manteniendo alineado el menú lateral. */ () => document.body.style.setProperty('--header-height', header.offsetHeight + 'px')).observe(header);
  renderRail();
}
