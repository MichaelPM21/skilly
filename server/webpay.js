/**
 * @file Adaptador del SDK Transbank para crear, confirmar, consultar y devolver
 * transacciones. WEBPAY_ENV selecciona integración o producción; payments.js y settlements.js
 * controlan estado local, autorización y conciliación.
 */

/**
 * Configuración del adaptador Webpay Plus.
 *
 * WEBPAY_ENV=production selecciona buildForProduction y exige
 * WEBPAY_COMMERCE_CODE y WEBPAY_API_KEY. Cualquier otro valor utiliza
 * buildForIntegration con las credenciales de integración del SDK.
 * Las operaciones de integración son simuladas y no cobran dinero real.
 *
 * @see https://www.transbankdevelopers.cl/documentacion/webpay-plus
 */

const { WebpayPlus, IntegrationCommerceCodes, IntegrationApiKeys } = require('transbank-sdk');

/**
 * Construye el cliente del SDK para integración o producción según WEBPAY_ENV. Producción exige
 * credenciales propias; integración usa las constantes de prueba del SDK.
 *
 * @returns {Object} Cliente Transaction del SDK Transbank para el entorno seleccionado.
 * @throws {Error} Si producción no tiene código de comercio o API key.
 */
function buildTransaction() {
  const isProd = process.env.WEBPAY_ENV === 'production';
  if (isProd) {
    if (!process.env.WEBPAY_COMMERCE_CODE || !process.env.WEBPAY_API_KEY) {
      throw new Error('WEBPAY_ENV=production requiere WEBPAY_COMMERCE_CODE y WEBPAY_API_KEY en .env');
    }
    return WebpayPlus.Transaction.buildForProduction(process.env.WEBPAY_COMMERCE_CODE, process.env.WEBPAY_API_KEY);
  }
  // Ambiente de integración (pruebas) — credenciales públicas de Transbank.
  return WebpayPlus.Transaction.buildForIntegration(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY);
}

// Webpay exige un buyOrder de máximo 26 caracteres.
/**
 * Genera una orden alfanumérica prefijada con SK y limitada a 26 caracteres. La usa
 * createTransaction para asociar el intento enviado a Webpay.
 *
 * @param {string} bookingId - ID interno de reserva; se eliminan caracteres no alfanuméricos.
 * @returns {string} Orden con prefijo SK y máximo 26 caracteres.
 * @example
 * toBuyOrder("bkg_demo"); // SKbkgdemo
 */
function toBuyOrder(bookingId) {
  return ('SK' + bookingId.replace(/[^a-zA-Z0-9]/g, '')).slice(0, 26);
}

/**
 * Inicia una transacción Webpay por importe CLP y URL de retorno. Devuelve token, URL, orden y
 * sesión; todavía no confirma el cobro.
 *
 * @param {Object} options - Datos del intento antes de confirmar el pago.
 * @param {string} options.bookingId - Reserva interna asociada.
 * @param {number} options.amount - Importe entero CLP calculado por el servidor.
 * @param {string} options.returnUrl - URL autorizada para el retorno del proveedor.
 * @returns {Promise<{token: string, url: string, buyOrder: string, sessionId: string}>} Datos para redirigir al proveedor; todavía no acredita un cobro.
 * @throws {Error} Propaga errores de configuración, red y SDK.
 * @example
 * const tx = await createTransaction({bookingId, amount:85000, returnUrl});
 */
async function createTransaction({ bookingId, amount, returnUrl }) {
  const tx = buildTransaction();
  const buyOrder = toBuyOrder(bookingId);
  const sessionId = 'sess_' + Date.now().toString(36);
  const response = await tx.create(buyOrder, sessionId, amount, returnUrl);
  // response: { token, url }
  return { token: response.token, url: response.url, buyOrder, sessionId };
}

/**
 * Confirma el token ante Webpay y devuelve la respuesta del SDK. payments.js comprueba
 * autorización, código, monto y orden antes de modificar la reserva.
 *
 * @param {string} token - Token Webpay recibido en el retorno.
 * @returns {Promise<Object>} Respuesta de confirmación del SDK; el llamador debe validar monto, orden y autorización.
 * @throws {Error} Propaga errores de configuración, red y proveedor.
 * @example
 * // Usar una transacción de integración controlada:
 * const response = await commitTransaction(token);
 */
async function commitTransaction(token) {
  const tx = buildTransaction();
  // response incluye: status ('AUTHORIZED', 'FAILED', etc.), response_code (0 = aprobado),
  // authorization_code, amount, buy_order, card_detail: { card_number: '**** **** **** 1234' },
  // payment_type_code, vci, accounting_date, transaction_date, etc.
  return tx.commit(token);
}

/**
 * Solicita al SDK la devolución del importe indicado para un token. Devuelve la respuesta de
 * Webpay; el llamador valida el resultado y gestiona respuestas inciertas.
 *
 * @param {string} token - Token de la transacción pagada.
 * @param {number} amount - Monto CLP de la devolución.
 * @returns {Promise<Object>} Resultado del SDK de devolución; puede requerir conciliación.
 * @throws {Error} Propaga errores de configuración, red y proveedor.
 * @example
 * // Usar una transacción de integración controlada:
 * const response = await refundTransaction(token, amount);
 */
async function refundTransaction(token, amount) {
  const tx = buildTransaction();
  // response incluye: type ('REVERSED' si se anula completa dentro de ventana, 'NULLIFIED'/'VOID'
  // si es parcial), response_code, balance.
  return tx.refund(token, amount);
}

/**
 * Consulta el estado del token ante Webpay sin iniciar un pago nuevo. Se utiliza en conciliación
 * administrativa.
 *
 * @param {string} token - Token de la transacción que se conciliará.
 * @returns {Promise<Object>} Estado retornado por el SDK sin iniciar un cobro nuevo.
 * @throws {Error} Propaga errores de configuración, red y proveedor.
 * @example
 * // Usar una transacción de integración controlada:
 * const response = await statusTransaction(token);
 */
async function statusTransaction(token) { return buildTransaction().status(token); }

module.exports = { statusTransaction, createTransaction, commitTransaction, refundTransaction, toBuyOrder };
