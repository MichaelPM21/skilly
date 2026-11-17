/**
 * Flujo del módulo. Adaptador PayPal: autenticación OAuth, orden, captura, consulta y
 * devolución. Convierte CLP a USD con una tasa de configuración fija. payments.js valida la
 * respuesta y decide cuándo acreditar la reserva.
 */

// ============================================================
// Integración de pago real — PayPal (Orders API v2, sandbox)
// ------------------------------------------------------------
// A diferencia de Webpay, PayPal NO entrega credenciales públicas
// de prueba: cada desarrollador debe crear su propia app gratuita
// en https://developer.paypal.com/dashboard/applications/sandbox
// y copiar su Client ID y Secret al archivo .env:
//
//   PAYPAL_CLIENT_ID=...
//   PAYPAL_CLIENT_SECRET=...
//   PAYPAL_ENV=sandbox            (usa "live" recién en producción)
//
// Nota sobre moneda: PayPal NO admite pesos chilenos (CLP) como
// moneda de pago (ver lista oficial: https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies/).
// Por eso, el monto en CLP se convierte a USD usando una tasa de
// cambio configurable en PAYPAL_CLP_USD_RATE (por defecto, un valor
// de referencia aproximado). En producción conviene reemplazar esto
// por una tasa de cambio obtenida de un servicio real y actualizado.
// ============================================================

const PAYPAL_ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
const BASE_URL = PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const CLP_USD_RATE = Number(process.env.PAYPAL_CLP_USD_RATE || 950); // referencial: 1 USD ≈ 950 CLP

/**
 * Comprueba que existan Client ID y secreto de PayPal en el entorno. No realiza autenticación ni
 * valida que las credenciales funcionen.
 */
function isConfigured() {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/**
 * Convierte CLP a USD con la tasa fija configurada, redondea a dos decimales y aplica un mínimo
 * de 1 USD. No obtiene una cotización en tiempo real.
 */
function clpToUsd(clp) {
  return Math.max(1, Math.round((clp / CLP_USD_RATE) * 100) / 100);
}

/**
 * Solicita un token OAuth a PayPal con las credenciales del entorno. Resuelve access_token o
 * lanza un error si falta configuración o el proveedor rechaza la autenticación.
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
 */
async function getOrder(id) {
 const token=await getAccessToken();
 const r=await fetch(BASE_URL+'/v2/checkout/orders/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+token}});
 if(!r.ok)throw new Error('No se pudo consultar PayPal');return r.json();
}
module.exports = { getOrder, isConfigured, createOrder, captureOrder, refundCapture, clpToUsd };
