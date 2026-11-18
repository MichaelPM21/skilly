/* Validadores puros compartidos por los formularios y el servidor. */
(function (root) {
  function clpPrice(value) {
    if (typeof value === 'string') {
      const raw = value.trim();
      // CLP enteros: 35000, 35.000 o $35.000. Nunca eliminar un signo o decimal.
      if (!/^(?:\$\s*)?(?:\d+|[1-9]\d{0,2}(?:\.\d{3})+)$/.test(raw)) return NaN;
      value = Number(raw.replace(/^\$\s*/, '').replace(/\./g, ''));
    }
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100000000
      ? value : NaN;
  }

  const api = { clpPrice };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkillyInput = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
