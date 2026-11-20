/**
 * @file Adaptador PayPal: autenticación OAuth, orden, captura, consulta y
 * devolución. Convierte CLP a USD con una tasa de configuración fija. payments.js valida la
 * respuesta y decide cuándo acreditar la reserva.
 */

/**
 * Configuración del adaptador PayPal Orders API v2.
 *
 * PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET se obtienen de la aplicación del
 * proveedor. PAYPAL_ENV=live selecciona producción; los demás valores usan sandbox.
 * CLP se convierte a USD con PAYPAL_CLP_USD_RATE, cuyo valor por defecto es 950.
 * El adaptador no consulta una cotización externa: la tasa configurada es fija.
 *
 * @see https://developer.paypal.com/dashboard/applications/sandbox
 */

const PAYPAL_ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
const BASE_URL = PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const CLP_USD_RATE = Number(process.env.PAYPAL_CLP_USD_RATE || 950); // referencial: 1 USD ≈ 950 CLP

/**
 * Comprueba que existan Client ID y secreto de PayPal en el entorno. No realiza autenticación ni
 * valida que las credenciales funcionen.
 *
 * @returns {boolean} true si existen Client ID y secreto; no verifica credenciales.
 * @example
 * const configured = isConfigured();
 */
function isConfigured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/**
 * Convierte CLP a USD con la tasa fija configurada, redondea a dos decimales y aplica un mínimo
 * de 1 USD. No obtiene una cotización en tiempo real.
 *
 * @param {number} clp - Importe CLP que se convierte con PAYPAL_CLP_USD_RATE.
 * @returns {number} Importe USD con dos decimales y mínimo de 1; no valida por sí solo la entrada.
 * @example
 * clpToUsd(9500); // 10 con la tasa predeterminada de 950 CLP/USD
 */
function clpToUsd(clp) {
  return Math.max(1, Math.round((clp / CLP_USD_RATE) * 100) / 100);
}

/**
 * Solicita un token OAuth a PayPal con las credenciales del entorno. Resuelve access_token o
 * lanza un error si falta configuración o el proveedor rechaza la autenticación.
 *
 * @returns {Promise<string>} access_token de la respuesta OAuth esperada de PayPal.
 * @throws {Error} Error si falta configuración, falla la red/JSON o PayPal rechaza la autenticación.
 * @example
 * const token = await getAccessToken(); // No registrar el secreto.
 */
async function getAccessToken() {
  if (!isConfigured()) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET no configurados en .env');
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('No se pudo autenticar con PayPal: ' + (await res.text()));
  const data = await res.json();
  return data.access_token;
}

/**
 * Crea una orden CAPTURE en USD con la reserva como reference_id y las URLs de retorno. Devuelve
 * id, enlace de aprobación e importe esperado para verificarlos al confirmar.
 *
 * @param {Object} options - Datos de la reserva utilizados para solicitar una orden.
 * @param {string} options.bookingId - ID que se envía como reference_id.
 * @param {number} options.amountClp - Importe CLP del contrato.
 * @param {string} options.returnUrl - URL de retorno tras aprobar.
 * @param {string} options.cancelUrl - URL para cancelar en el proveedor.
 * @returns {Promise<{orderId: string, approveUrl: (string|null), usdAmount: number}>} Orden y monto esperado; approveUrl es null si no se recibió el enlace approve.
 * @throws {Error} Propaga errores OAuth, red y JSON; lanza Error si el proveedor rechaza la creación.
 * @example
 * const order = await createOrder({bookingId, amountClp:85000, returnUrl, cancelUrl});
 */
async function createOrder({ bookingId, amountClp, returnUrl, cancelUrl }) {
  const token = await getAccessToken();
  const usd = clpToUsd(amountClp);
  const res = await fetch(`${BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: bookingId,
        description: `Skilly — Reserva ${bookingId}`,
        amount: { currency_code: 'USD', value: usd.toFixed(2) },
      }],
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
        user_action: 'PAY_NOW',
        brand_name: 'Skilly',
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Error creando la orden de PayPal: ' + JSON.stringify(data));
  const approveLink = (data.links || []).find(/* Busca el primer elemento según la condición l.rel === 'approve'. Se evalúan los datos ya cargados. */ l => l.rel === 'approve');
  return { orderId: data.id, approveUrl: approveLink ? approveLink.href : null, usdAmount: usd };
}

/**
 * Solicita la captura de una orden aprobada y devuelve la respuesta de PayPal. payments.js
 * verifica después identificadores, estado, importe y moneda antes de acreditar la reserva.
 *
 * @param {string} orderId - ID de la orden previamente aprobada en PayPal.
 * @returns {Promise<Object>} JSON del proveedor; no confirma por sí mismo la reserva local.
 * @throws {Error} Propaga errores OAuth/red/JSON y rechazos HTTP del proveedor.
 * @example
 * const capture = await captureOrder(orderId);
 */
async function captureOrder(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Error capturando la orden de PayPal: ' + JSON.stringify(data));
  return data;
}

/**
 * Solicita devolución total o de un importe USD y envía PayPal-Request-Id para identificar el
 * intento. Devuelve la respuesta; el llamador decide si está completada o requiere conciliación.
 *
 * @param {string} captureId - ID de la captura que se devolverá.
 * @param {number|null} [amountUsd] - Importe USD; null o undefined solicita devolución total.
 * @param {string} [requestId] - Clave de idempotencia externa; usa captureId si se omite.
 * @returns {Promise<Object>} JSON de devolución; el llamador debe comprobar su estado.
 * @throws {Error} Propaga errores OAuth/red/JSON, tipo de importe no compatible y rechazos HTTP.
 * @example
 * const result = await refundCapture(captureId, 10, operationId);
 */
async function refundCapture(captureId, amountUsd, requestId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': requestId || captureId },
    body: JSON.stringify(amountUsd != null ? { amount: { currency_code: 'USD', value: amountUsd.toFixed(2) } } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Error reembolsando en PayPal: ' + JSON.stringify(data));
  return data;
}

/**
 * Consulta una orden por id con un token OAuth y resuelve su JSON. Se utiliza para conciliar
 * pagos cuyo retorno no dejó un resultado definitivo.
 *
 * @param {string} id - ID de la orden a consultar, codificado para la URL.
 * @returns {Promise<Object>} JSON de la orden retornada por PayPal.
 * @throws {Error} Error si la consulta HTTP no es satisfactoria; propaga fallos OAuth/red/JSON.
 * @example
 * const order = await getOrder(orderId);
 */
async function getOrder(id) {
 const token=await getAccessToken();
 const r=await fetch(BASE_URL+'/v2/checkout/orders/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+token}});
 if(!r.ok)throw new Error('No se pudo consultar PayPal');return r.json();
}
module.exports = { getOrder, isConfigured, createOrder, captureOrder, refundCapture, clpToUsd };
