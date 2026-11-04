// ============================================================
// Integración de pago real — Webpay Plus (Transbank)
// ------------------------------------------------------------
// Usa el SDK oficial de Transbank para Node.js, en el AMBIENTE DE
// INTEGRACIÓN (pruebas). Transbank publica oficialmente un código
// de comercio y un API key de prueba para que cualquier
// desarrollador pueda integrar y probar transacciones reales de
// principio a fin sin tener un contrato comercial vigente.
// Fuente: https://www.transbankdevelopers.cl/documentacion/webpay-plus
//
// Para tarjetas de prueba (Webpay simula bancos emisores):
//   https://www.transbankdevelopers.cl/documentacion/como_empezar#ambiente-de-integracion
//
// IMPORTANTE — paso a producción:
// Estas credenciales de integración NUNCA cobran dinero real y no
// deben usarse en producción. Para producción, Transbank entrega un
// código de comercio y un API key propios de Skilly tras el proceso
// de afiliación comercial; ese código se coloca en las variables de
// entorno WEBPAY_COMMERCE_CODE y WEBPAY_API_KEY, y se cambia
// buildForIntegration(...) por buildForProduction(...).
// ============================================================

const { WebpayPlus, IntegrationCommerceCodes, IntegrationApiKeys } = require('transbank-sdk');

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
function toBuyOrder(bookingId) {
  return ('SK' + bookingId.replace(/[^a-zA-Z0-9]/g, '')).slice(0, 26);
}

async function createTransaction({ bookingId, amount, returnUrl }) {
  const tx = buildTransaction();
  const buyOrder = toBuyOrder(bookingId);
  const sessionId = 'sess_' + Date.now().toString(36);
  const response = await tx.create(buyOrder, sessionId, amount, returnUrl);
  // response: { token, url }
  return { token: response.token, url: response.url, buyOrder, sessionId };
}

async function commitTransaction(token) {
  const tx = buildTransaction();
  // response incluye: status ('AUTHORIZED', 'FAILED', etc.), response_code (0 = aprobado),
  // authorization_code, amount, buy_order, card_detail: { card_number: '**** **** **** 1234' },
  // payment_type_code, vci, accounting_date, transaction_date, etc.
  return tx.commit(token);
}

async function refundTransaction(token, amount) {
  const tx = buildTransaction();
  // response incluye: type ('REVERSED' si se anula completa dentro de ventana, 'NULLIFIED'/'VOID'
  // si es parcial), response_code, balance.
  return tx.refund(token, amount);
}

async function statusTransaction(token) { return buildTransaction().status(token); }

module.exports = { statusTransaction, createTransaction, commitTransaction, refundTransaction, toBuyOrder };
