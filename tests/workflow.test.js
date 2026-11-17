/**
 * Flujo del módulo. Pruebas HTTP de flujo con aplicaciones locales, clientes de cookies
 * separadas y esquema PostgreSQL temporal. Los casos comparten datos creados en secuencia y
 * sustituyen pasarelas/SMTP por dobles controlados; no ejecutan cobros ni correos reales.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  test,
  after,
  before
} = require('node:test');
const assert = require('node:assert/strict');
const pgTest=require('./postgres-helper');
const {
  createApp
} = require('../server/index');
const {
  db
} = require('../server/db');
const S = require('../server/security');
const schedule = require('../server/scheduling');
let publicApp, adminApp, publicServer, adminServer, base, adminBase, admin, pro, org, other, service, proId, booking, guestId, guest;
/**
 * Construye un cliente HTTP de pruebas con cookie independiente para simular un usuario.
 * Devuelve call y un lector de cookie, sin utilizar el navegador ni una cuenta de producción.
 */
function client(url) {
  let cookie = '';
  return {
    /**
     * Envía una solicitud local con JSON, cabecera CSRF y cookie del cliente. Captura Set-Cookie y
     * devuelve estado, cuerpo y cabeceras sin seguir redirecciones, para comprobar retornos de pago.
     */
    async call(route, method = 'GET', body) {
      const r = await fetch(url + '/api/' + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Skilly-Request': '1',
          ...(cookie ? {
            Cookie: cookie
          } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
      });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      let data;
      try {
        data = await r.json();
      } catch {
        data = null;
      }
      return {
        status: r.status,
        data,
        headers: r.headers
      };
    },
    /**
     * Devuelve la cookie capturada por este cliente de pruebas para comprobar el aislamiento de
     * sesiones.
     */
    get cookie() {
      return cookie;
    }
  };
}
/**
 * Espera una respuesta del cliente, exige el estado HTTP indicado y devuelve su cuerpo. La
 * aserción incluye el JSON recibido para diagnosticar fallos.
 */
const success = async (p, status = 200) => {
  const r = await p;
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
/**
 * Construye una fecha AAAA-MM-DD desplazando días UTC respecto de hoy. Se usa para reservar
 * horarios relativos sin depender de una fecha fija ya vencida.
 */
function futureDate(offset = 5) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const password = 'Skilly-pruebas-2026!';
let policyOffset = 35;
/**
 * Crea una reserva de prueba en una fecha nueva, la acepta como profesional y la paga de forma
 * simulada. Devuelve la respuesta inicial para los escenarios de políticas.
 */
async function policyBooking() {
  const b = await success(org.call('bookings', 'POST', {
    serviceId: service.id,
    date: futureDate(policyOffset++),
    time: '10:00'
  }), 201);
  await success(pro.call('bookings/' + b.id, 'PATCH', {
    status: 'aceptado'
  }));
  await success(org.call('payments', 'POST', {
    bookingId: b.id,
    acceptTerms: true
  }), 201);
  return b;
}
/**
 * Prepara el esquema y los datos de prueba antes de ejecutar los casos; las aplicaciones HTTP
 * usan puertos locales y las credenciales de la suite.
 */
before(async () => {
  await pgTest.setup();
  const hash = await S.passwordHash(password);
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,verified,created_at) VALUES('admin','admin@test.cl','Admin',?,'admin',1,?)").run(hash, Date.now());
  publicApp = createApp('public');
  adminApp = createApp('admin');
  publicServer = publicApp.listen(0, '127.0.0.1');
  adminServer = adminApp.listen(0, '127.0.0.1');
  await Promise.all([new Promise(/* Resuelve cuando el servidor de prueba emite listening, antes de enviar solicitudes HTTP. */ r => publicServer.once('listening', r)), new Promise(/* Resuelve cuando el servidor de prueba emite listening, antes de enviar solicitudes HTTP. */ r => adminServer.once('listening', r))]);
  base = 'http://127.0.0.1:' + publicServer.address().port;
  adminBase = 'http://127.0.0.1:' + adminServer.address().port;
  admin = client(adminBase);
  pro = client(base);
  org = client(base);
  other = client(base);
  guest = client(base);
});
/**
 * Libera servidores, conexiones y recursos temporales al finalizar la suite, incluso si una
 * aserción falló.
 */
after(async () => {
  await Promise.all([publicServer,adminServer].filter(Boolean).map(/* Convierte cada operación asíncrona en una promesa para esperar conjuntamente su finalización. */ server=>new Promise(/* Resuelve cuando termina el cierre del servidor para poder eliminar después el esquema de pruebas. */ r=>server.close(r))));
  await pgTest.cleanup();
});
/**
 * Verifica separación de aplicaciones, contraseña real y rechazo de solicitudes sin cabecera
 * CSRF o con origen ajeno. También comprueba cookie administrativa y ausencia de catálogo en su
 * HTML.
 */
test('Separate applications, CSRF and real password authentication', async () => {
  assert.equal((await client(base).call('auth/login', 'POST', {
    email: 'admin@test.cl',
    password
  })).status, 401);
  assert.equal((await client(base).call('admin/settings')).status, 404);
  assert.equal((await client(adminBase).call('services')).status, 401);
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'admin@test.cl',
      password
    })
  });
  assert.equal(r.status, 403);
  const badOrigin = await fetch(adminBase + '/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Skilly-Request': '1',
      Origin: 'https://evil.example'
    },
    body: JSON.stringify({
      email: 'admin@test.cl',
      password
    })
  });
  assert.equal(badOrigin.status, 403);
  await success(admin.call('auth/login', 'POST', {
    email: 'admin@test.cl',
    password
  }));
  assert.match(admin.cookie, /skilly_admin_session/);
  const doc = await (await fetch(adminBase)).text();
  assert.ok(!doc.includes('<section id="market"'));
  assert.ok(!doc.includes('<section id="home"'));
});
/**
 * Registra usuarios y verifica que aprobar antecedentes no publique automáticamente el servicio.
 * Comprueba catálogo sin identidad privada y rechazo de modificaciones de perfiles ajenos.
 */
test('Registration, independent service review and no public identity leak', async () => {
  const u = await success(pro.call('auth/register', 'POST', {
    name: 'Profesional Secreto',
    email: 'pro@test.cl',
    password,
    role: 'profesional',
    title: 'Servicio Uno',
    description: 'Consultoría especializada',
    category: 'Consultoría',
    price: 100000,
    validation: {
      linkedin: 'https://www.linkedin.com/in/test',
      cv: 'CV privado',
      yearsExperience: '8'
    },
    availability: {
      days: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
      hours: ['09:00', '10:00', '11:00', '12:00', '15:00']
    }
  }), 201);
  proId = u.professionalId;
  await success(org.call('auth/register', 'POST', {
    name: 'Empresa Uno',
    email: 'org@test.cl',
    password,
    role: 'organizacion'
  }), 201);
  await success(other.call('auth/register', 'POST', {
    name: 'Empresa Dos',
    email: 'other@test.cl',
    password,
    role: 'organizacion'
  }), 201);
  service = (await success(pro.call('services')))[0];
  assert.equal((await success(client(base).call('services'))).length, 0);
  await success(admin.call('professionals/' + proId, 'PATCH', {
    status: 'validado'
  }));
  assert.equal((await success(client(base).call('services'))).length, 0, 'Profile validation must not publish the service');
  await success(admin.call('admin/services/' + service.id, 'PATCH', {
    status: 'validado',
    revision: service.revision
  }));
  const catalog = await success(client(base).call('services'));
  const raw = JSON.stringify(catalog);
  assert.ok(!raw.includes('Secreto'));
  assert.ok(!raw.includes('linkedin'));
  assert.ok(!raw.includes('CV privado'));
  assert.equal(catalog[0].price, 100000);
  assert.deepEqual(await success(client(base).call('professionals')), []);
  assert.deepEqual(await success(client(base).call('bookings')), []);
  assert.equal((await client(base).call('professionals/' + proId + '/self', 'PATCH', {
    availability: {
      days: [],
      hours: []
    }
  })).status, 401);
  assert.equal((await other.call('professionals/' + proId + '/self', 'PATCH', {})).status, 403);
});
/**
 * Verifica precio autoritativo, solapamiento entre servicios, revisión nueva al editar y rechazo
 * de aprobación obsoleta. Comprueba que comisión y monto de reservas anteriores no cambien.
 */
test('Reserve, overlap across services, reapproval and immutable financial snapshot', async () => {
  const b = await success(org.call('bookings', 'POST', {
    serviceId: service.id,
    date: futureDate(),
    time: '10:00',
    amount: 1,
    professionalName: 'falso'
  }), 201);
  booking = b.id;
  assert.equal(b.status, 'solicitado');
  assert.equal(b.amount, 100000);
  assert.equal(b.professionalName, undefined);
  assert.equal((await db.prepare('SELECT commission_percent FROM bookings WHERE id=?').get(booking)).commission_percent, 15);
  assert.equal((await org.call('payments', 'POST', {
    bookingId: booking,
    acceptTerms: true
  })).status, 409);
  const second = await success(pro.call('services', 'POST', {
    title: 'Servicio Dos',
    description: 'Otro servicio',
    price: 200000,
    durationMinutes: 120,
    prepMinutes: 60
  }), 201);
  await success(admin.call('admin/services/' + second.id, 'PATCH', {
    status: 'validado',
    revision: second.revision,
    commissionPercent: 20
  }));
  assert.equal((await org.call('bookings', 'POST', {
    serviceId: second.id,
    date: futureDate(),
    time: '11:00'
  })).status, 409);
  const edited = await success(pro.call('services/' + service.id, 'PATCH', {
    title: 'Servicio actualizado',
    price: 150000
  }));
  assert.equal((await success(client(base).call('services'))).find(/* Busca el primer elemento según la condición s.id === service.id. Se evalúan los datos ya cargados. */ s => s.id === service.id).price, 100000);
  assert.equal((await admin.call('admin/services/' + service.id, 'PATCH', {
    status: 'validado',
    revision: service.revision,
    commissionPercent: 25
  })).status, 409, 'Cannot approve an unseen revision');
  await success(admin.call('admin/services/' + service.id, 'PATCH', {
    status: 'validado',
    revision: edited.revision,
    commissionPercent: 25
  }));
  await success(admin.call('admin/settings', 'PATCH', {
    commissionPercent: 30
  }));
  const saved = await db.prepare('SELECT * FROM bookings WHERE id=?').get(booking);
  assert.equal(saved.amount, 100000);
  assert.equal(saved.commission_percent, 15);
  assert.equal(saved.professional_net, 85000);
  const future = await success(org.call('bookings', 'POST', {
    serviceId: second.id,
    date: futureDate(6),
    time: '11:00'
  }), 201);
  assert.equal((await db.prepare('SELECT commission_percent FROM bookings WHERE id=?').get(future.id)).commission_percent, 20);
});
/**
 * Recorre acceso, aceptación, consentimiento, pago, identidad, chat, entrega, evaluación y
 * liberación simulada. Comprueba que un reclamo pendiente bloquee liquidar y que las
 * evaluaciones sigan privadas.
 */
test('Ownership, acceptance, terms, paid identity, chat and admin-mediated release', async () => {
  assert.equal((await other.call('bookings/' + booking + '/messages')).status, 403);
  assert.equal((await other.call('bookings/' + booking, 'PATCH', {
    status: 'aceptado'
  })).status, 403);
  assert.equal((await pro.call('bookings/' + booking + '/messages')).status, 403);
  await success(pro.call('bookings/' + booking, 'PATCH', {
    status: 'aceptado'
  }));
  assert.equal((await org.call('payments', 'POST', {
    bookingId: booking
  })).status, 400);
  const p = await success(org.call('payments', 'POST', {
    bookingId: booking,
    acceptTerms: true
  }), 201);
  assert.equal(p.amount, 100000);
  const paid = (await success(org.call('bookings'))).find(/* Busca el primer elemento según la condición b.id === booking. Se evalúan los datos ya cargados. */ b => b.id === booking);
  assert.equal(paid.professionalName, 'Profesional Secreto');
  assert.equal(paid.linkedin, 'https://www.linkedin.com/in/test');
  assert.equal((await org.call('payments', 'POST', {
    bookingId: booking,
    acceptTerms: true
  })).status, 409);
  await success(org.call('bookings/' + booking + '/messages', 'POST', {
    body: 'Hola',
    senderRole: 'admin',
    senderName: 'Impostor'
  }), 201);
  const messages = await success(pro.call('bookings/' + booking + '/messages'));
  assert.equal(messages[0].senderRole, 'organizacion');
  assert.equal(messages[0].senderName, 'Empresa Uno');
  assert.equal((await pro.call('bookings/' + booking, 'PATCH', {
    status: 'entregado',
    evidence: 'Sesión realizada'
  })).status, 409);
  await db.prepare('UPDATE bookings SET end_at=? WHERE id=?').run(Date.now() - 1, booking);
  await success(pro.call('bookings/' + booking, 'PATCH', {
    status: 'entregado',
    evidence: 'Sesión realizada y entregables adjuntos'
  }));
  await success(org.call('evaluations', 'POST', {
    bookingId: booking,
    stars: 5,
    comment: 'Bien realizado'
  }));
  const evaluations = await success(admin.call('admin/evaluations'));
  assert.equal(evaluations.find(/* Busca el primer elemento según la condición e.stars === 5. Se evalúan los datos ya cargados. */ e => e.stars === 5).comment, 'Bien realizado');
  for (const viewer of [pro, org, other, client(base)]) assert.equal((await viewer.call('admin/evaluations')).status, 404, 'Private evaluations stay outside the public application');
  assert.ok(!JSON.stringify(await success(pro.call('bookings'))).includes('Bien realizado'));
  assert.equal((await db.prepare('SELECT status FROM payments WHERE id=?').get(p.id)).status, 'pagado');
  await success(org.call('bookings/' + booking + '/incidents', 'POST', {
    body: 'Revisar un entregable'
  }), 201);
  assert.equal((await admin.call('admin/bookings/' + booking + '/release', 'POST', {})).status, 409);
  const incidents = await success(admin.call('admin/incidents'));
  await success(admin.call('admin/incidents/' + incidents[0].id, 'PATCH', {
    resolution: 'Entregable corregido y confirmado'
  }));
  await success(admin.call('admin/bookings/' + booking + '/release', 'POST', {}));
  assert.equal((await db.prepare('SELECT status FROM payments WHERE id=?').get(p.id)).status, 'liberado');
});
/**
 * Comprueba que los adjuntos pertenezcan a una reserva autorizada y que formatos peligrosos se
 * rechacen. Usa un PDF de prueba y verifica que un tercero no pueda descargarlo.
 */
test('Documents are scoped and dangerous formats rejected', async () => {
  assert.equal((await other.call('bookings/' + booking + '/attachments')).status, 403);
  assert.equal((await org.call('bookings/' + booking + '/attachments', 'POST', {
    name: 'a.html',
    mime: 'text/html',
    data: Buffer.from('<script>x</script>').toString('base64')
  })).status, 400);
  await success(org.call('bookings/' + booking + '/attachments', 'POST', {
    name: 'boleta.pdf',
    mime: 'application/pdf',
    data: Buffer.from('%PDF-1.4\n test').toString('base64')
  }), 201);
  const docs = await success(org.call('bookings/' + booking + '/attachments'));
  assert.equal(docs.length, 1);
  assert.equal((await other.call('attachments/' + docs[0].id)).status, 403);
});
/**
 * Verifica que datos de contacto inválidos no guarden parcialmente el nombre y que teléfono y
 * RUT válidos queden normalizados.
 */
test('Invalid profile contact data is rejected without partial updates', async () => {
  const before = await success(org.call('auth/me'));
  assert.equal((await org.call('auth/profile', 'PATCH', {
    name: 'Changed',
    phone: 'abc',
    rut: ''
  })).status, 400);
  assert.equal((await success(org.call('auth/me'))).name, before.name);
  assert.equal((await org.call('auth/profile', 'PATCH', {
    name: before.name,
    rut: '12345678-9'
  })).status, 400);
  const updated = await success(org.call('auth/profile', 'PATCH', {
    name: before.name,
    phone: '+56 9 1234 5678',
    rut: '12.345.678-5'
  }));
  assert.equal(updated.profile.rut, '12345678-5');
  assert.equal(updated.profile.phone, '+56912345678');
});
/**
 * Prueba reserva invitada gestionada por Skilly, token de un uso y acceso limitado. Exige
 * tramitación y aceptación profesional antes de pagar y revelar identidad.
 */
test('Guest review, expiring one-use email access and identical payment flow', async () => {
  const g = await success(client(base).call('guest-requests', 'POST', {
    serviceId: service.id,
    date: futureDate(8),
    time: '10:00',
    contactName: 'Invitado',
    orgName: 'Empresa Invitada',
    email: 'guest@test.cl'
  }), 201);
  guestId = g.bookingId;
  const mail = await db.prepare("SELECT body FROM outbox WHERE recipient='guest@test.cl' ORDER BY id DESC").get();
  const token = mail.body.match(/#guest=([a-f0-9]+)/)[1];
  await success(guest.call('guest/access', 'POST', {
    token
  }));
  assert.equal((await client(base).call('guest/access', 'POST', {
    token
  })).status, 400);
  assert.equal((await success(guest.call('bookings'))).length, 1);
  assert.equal((await guest.call('bookings/' + booking + '/messages')).status, 403);
  assert.equal((await pro.call('bookings/' + guestId, 'PATCH', {
    status: 'aceptado'
  })).status, 409);
  await success(admin.call('admin/guest-requests/' + g.id + '/convert', 'POST', {}));
  await success(pro.call('bookings/' + guestId, 'PATCH', {
    status: 'aceptado'
  }));
  await success(guest.call('payments', 'POST', {
    bookingId: guestId,
    acceptTerms: true
  }), 201);
  const b = (await success(guest.call('bookings')))[0];
  assert.equal(b.professionalName, 'Profesional Secreto');
});
/**
 * Comprueba bloqueo de fechas y liberación de cupos al vencer o rechazarse solicitudes,
 * consultando de nuevo la disponibilidad del servicio.
 */
test('Blocked dates, expiration and rejection release capacity', async () => {
  const date = futureDate(10);
  await success(pro.call('professionals/' + proId + '/self', 'PATCH', {
    blockedDates: [date]
  }));
  assert.equal((await success(client(base).call('services/' + service.id + '/availability?date=' + date))).slots.length, 0);
  assert.equal((await org.call('bookings', 'POST', {
    serviceId: service.id,
    date,
    time: '10:00'
  })).status, 409);
  const b = await success(org.call('bookings', 'POST', {
    serviceId: service.id,
    date: futureDate(11),
    time: '10:00'
  }), 201);
  await db.prepare('UPDATE bookings SET response_deadline=? WHERE id=?').run(Date.now() - 1, b.id);
  assert.equal((await pro.call('bookings/' + b.id, 'PATCH', {
    status: 'aceptado'
  })).status, 409);
  const available = await success(client(base).call('services/' + service.id + '/availability?date=' + futureDate(11)));
  assert.ok(available.slots.includes('10:00'));
  const newer = await success(org.call('bookings', 'POST', {
    serviceId: service.id,
    date: futureDate(11),
    time: '10:00'
  }), 201);
  await success(pro.call('bookings/' + newer.id, 'PATCH', {
    status: 'rechazado'
  }));
  assert.ok((await success(client(base).call('services/' + service.id + '/availability?date=' + futureDate(11)))).slots.includes('10:00'));
});
/**
 * Comprueba conversión de horas de Chile en verano e invierno y rechazo de porcentajes, plazos o
 * jornadas inválidos.
 */
test('Calendar timezone and settings validation', async () => {
  const winter = schedule.timestamp('2027-07-15', '10:00'),
    summer = schedule.timestamp('2027-01-15', '10:00');
  assert.equal(new Date(winter).toISOString(), '2027-07-15T14:00:00.000Z');
  assert.equal(new Date(summer).toISOString(), '2027-01-15T13:00:00.000Z');
  assert.equal((await admin.call('admin/settings', 'PATCH', {
    commissionPercent: 101
  })).status, 400);
  assert.equal((await admin.call('admin/settings', 'PATCH', {
    responseHours: 0
  })).status, 400);
  assert.equal((await pro.call('professionals/' + proId + '/self', 'PATCH', {
    workStart: '20:00',
    workEnd: '09:00'
  })).status, 400);
});
/**
 * Usa el correo de prueba para restablecer una contraseña y verifica revocación de sesiones y
 * rechazo de reutilizar el token.
 */
test('Password reset invalidates sessions and cannot be replayed', async () => {
  await success(other.call('auth/forgot', 'POST', {
    email: 'other@test.cl'
  }));
  const mail = await db.prepare("SELECT body FROM outbox WHERE recipient='other@test.cl' AND subject LIKE 'Recuperación%' ORDER BY id DESC").get();
  const token = mail.body.match(/#reset=([a-f0-9]+)/)[1];
  await success(client(base).call('auth/reset', 'POST', {
    token,
    password: 'Nueva-contraseña-123!'
  }));
  assert.equal(await success(other.call('auth/me')), null);
  assert.equal((await client(base).call('auth/reset', 'POST', {
    token,
    password
  })).status, 400);
});
/**
 * Inyecta pasarelas ficticias y verifica intentos concurrentes, retornos repetidos, montos
 * adulterados, cobros tardíos y devoluciones. No valida una operación contra servicios externos.
 */
test('Payment provider confirmation, duplicate callbacks, tampering, late charges and refunds', async () => {
  const orders = new Map();
  let sequence = 0,
    commits = 0,
    captures = 0,
    refunds = 0;
  const fake = {
    webpay: {
      /**
       * Simula la creación Webpay: genera token y orden, guarda una autorización controlada en memoria
       * y devuelve una URL de prueba. No contacta a Transbank.
       */
      async createTransaction({
        bookingId,
        amount
      }) {
        const token = 'webpay-' + ++sequence,
          buyOrder = bookingId.slice(0, 26);
        orders.set(token, {
          amount,
          buy_order: buyOrder,
          status: 'AUTHORIZED',
          response_code: 0,
          authorization_code: 'AUTH-' + sequence,
          card_detail: {
            card_number: '1234'
          }
        });
        return {
          token,
          url: 'https://webpay.test',
          buyOrder
        };
      },
      /**
       * Cuenta confirmaciones Webpay simuladas y devuelve la respuesta guardada para el token. Permite
       * demostrar que un retorno repetido no vuelve a confirmar.
       */
      async commitTransaction(token) {
        commits++;
        return orders.get(token);
      },
      /**
       * Devuelve el estado Webpay preparado en memoria para probar conciliación sin conexión al
       * proveedor.
       */
      async statusTransaction(token) {
        return orders.get(token);
      },
      /**
       * Incrementa el contador de devoluciones simuladas y devuelve un resultado Webpay exitoso.
       * Permite detectar llamadas duplicadas.
       */
      async refundTransaction() {
        refunds++;
        return {
          type: 'REVERSED',
          response_code: 0
        };
      }
    },
    paypal: {
      /**
       * Devuelve true para habilitar el adaptador PayPal simulado del escenario sin credenciales
       * externas.
       */
      isConfigured: () => true,
      /**
       * Crea una orden PayPal ficticia con importe convertido y captura completada en memoria.
       * Devuelve datos controlados para probar verificación de reserva, moneda y monto.
       */
      async createOrder({
        bookingId,
        amountClp
      }) {
        const orderId = 'paypal-' + ++sequence,
          usdAmount = Math.round(amountClp / 950 * 100) / 100;
        orders.set(orderId, {
          id: orderId,
          status: 'COMPLETED',
          purchase_units: [{
            reference_id: bookingId,
            payments: {
              captures: [{
                id: 'CAP-' + sequence,
                status: 'COMPLETED',
                amount: {
                  value: String(usdAmount),
                  currency_code: 'USD'
                }
              }]
            }
          }]
        });
        return {
          orderId,
          approveUrl: 'https://paypal.test',
          usdAmount
        };
      },
      /**
       * Cuenta capturas PayPal simuladas y devuelve la orden guardada, permitiendo verificar
       * idempotencia del retorno.
       */
      async captureOrder(id) {
        captures++;
        return orders.get(id);
      },
      /**
       * Devuelve una orden PayPal de la memoria de pruebas para el flujo de conciliación.
       */
      async getOrder(id) {
        return orders.get(id);
      },
      /**
       * Cuenta devoluciones PayPal simuladas y devuelve un id y estado COMPLETED sin enviar
       * solicitudes externas.
       */
      async refundCapture() {
        refunds++;
        return {
          id: 'refund-' + refunds,
          status: 'COMPLETED'
        };
      }
    }
  };
  publicApp.locals.providers = fake;
  adminApp.locals.providers = fake;
  /**
   * Crea y acepta una reserva de prueba desplazada por offset días. Deja el pago pendiente para
   * probar creación, retornos y reembolsos de pasarelas.
   */
  async function accepted(offset) {
    const b = await success(org.call('bookings', 'POST', {
      serviceId: service.id,
      date: futureDate(offset),
      time: '10:00'
    }), 201);
    await success(pro.call('bookings/' + b.id, 'PATCH', {
      status: 'aceptado'
    }));
    return b;
  }
  const b = await accepted(15);
  const concurrent = await Promise.all([org.call('payments/webpay/create', 'POST', {
    bookingId: b.id,
    acceptTerms: true
  }), org.call('payments/webpay/create', 'POST', {
    bookingId: b.id,
    acceptTerms: true
  })]);
  assert.deepEqual(concurrent.map(/* Extrae r.status de cada elemento para formar la lista que necesita esta operación. */ r => r.status).sort(), [200, 409]);
  const p = concurrent.find(/* Busca el primer elemento según la condición r.status === 200. Se evalúan los datos ya cargados. */ r => r.status === 200).data;
  let result = await client(base).call('payments/webpay/commit?token_ws=' + p.token);
  assert.match(result.headers.get('location'), /payment=success/);
  result = await client(base).call('payments/webpay/commit?token_ws=' + p.token);
  assert.match(result.headers.get('location'), /payment=success/);
  assert.equal(commits, 1);
  await success(org.call('bookings/' + b.id + '/cancel', 'POST', {
    reason: 'Prueba'
  }));
  assert.equal(refunds, 1);
  assert.equal((await org.call('bookings/' + b.id + '/cancel', 'POST', {})).status, 409);
  assert.equal(refunds, 1);
  const tampered = await accepted(16),
    tp = await success(org.call('payments/webpay/create', 'POST', {
      bookingId: tampered.id,
      acceptTerms: true
    }));
  orders.get(tp.token).amount = 1;
  result = await client(base).call('payments/webpay/commit?token_ws=' + tp.token);
  assert.match(result.headers.get('location'), /payment=review/);
  assert.equal((await db.prepare('SELECT paid_at FROM bookings WHERE id=?').get(tampered.id)).paid_at, null);
  const late = await accepted(17),
    lp = await success(org.call('payments/webpay/create', 'POST', {
      bookingId: late.id,
      acceptTerms: true
    }));
  await db.prepare('UPDATE bookings SET payment_deadline=? WHERE id=?').run(Date.now() - 1, late.id);
  await schedule.expire();
  result = await client(base).call('payments/webpay/commit?token_ws=' + lp.token);
  assert.match(result.headers.get('location'), /payment=review/);
  assert.equal((await db.prepare('SELECT status FROM bookings WHERE id=?').get(late.id)).status, 'expirado');
  const latePayment = await db.prepare('SELECT id FROM payments WHERE booking_id=?').get(late.id);
  await success(admin.call('admin/payments/' + latePayment.id + '/refund-late', 'POST', {}));
  assert.equal(refunds, 2);
  const pb = await accepted(18),
    pp = await success(org.call('payments/paypal/create-order', 'POST', {
      bookingId: pb.id,
      acceptTerms: true
    }));
  result = await client(base).call('payments/paypal/capture?token=' + pp.orderId + '&bookingId=' + booking);
  assert.match(result.headers.get('location'), new RegExp(pb.id));
  assert.equal((await db.prepare('SELECT status FROM bookings WHERE id=?').get(pb.id)).status, 'pagado');
  await client(base).call('payments/paypal/capture?token=' + pp.orderId);
  assert.equal(captures, 1);
  await success(org.call('bookings/' + pb.id + '/cancel', 'POST', {
    reason: 'Cancelación de prueba'
  }));
  assert.equal(refunds, 3);
});
/**
 * Prueba enlaces LinkedIn inválidos sin crear cuentas parciales, luego corrige el dato y
 * verifica un único registro pendiente y rechazo de duplicados.
 */
test('Professional registration explains invalid LinkedIn and allows correction without partial accounts', async () => {
  const candidate = client(base),
    body = {
      name: 'Prueba registro',
      email: 'registro@test.cl',
      password,
      role: 'profesional',
      title: 'Servicio de registro',
      description: 'Consultoría de prueba',
      price: '$35.000',
      validation: {
        linkedin: '',
        cv: 'Antecedentes de prueba',
        yearsExperience: '0'
      }
    };
  const count = (await db.prepare('SELECT COUNT(*) n FROM users').get()).n;
  for (const invalid of ['mi perfil', 'https://linkedin.com.evil.test/in/test', 'javascript:alert(1)']) {
    const response = await candidate.call('auth/register', 'POST', {
      ...body,
      validation: {
        ...body.validation,
        linkedin: invalid
      }
    });
    assert.equal(response.status, 400);
    assert.match(response.data.error, /enlace de LinkedIn/);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM users').get()).n, count);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM professionals WHERE email='registro@test.cl'").get()).n, 0);
  const corrected = {
    ...body,
    validation: {
      ...body.validation,
      linkedin: '  www.linkedin.com/in/registro-prueba  '
    }
  };
  const user = await success(candidate.call('auth/register', 'POST', corrected), 201);
  const profile = await success(candidate.call('professionals'));
  assert.equal(profile[0].validation.linkedin, 'https://www.linkedin.com/in/registro-prueba');
  assert.equal(profile[0].status, 'pendiente');
  assert.equal((await success(candidate.call('services'))).length, 1);
  assert.equal((await success(candidate.call('auth/me'))).id, user.id);
  const duplicate = await candidate.call('auth/register', 'POST', corrected);
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.data.error, /correo/);
});
/**
 * Comprueba los tramos temprano y tardío de devolución y la inmutabilidad de políticas
 * congeladas, incluidos contratos anteriores sin policy_snapshot.
 */
test('Policy snapshots, early refund, late refund and immutable legacy terms', async () => {
  const P = require('../server/policies'),
    b = await policyBooking();
  assert.equal(b.policy.version, P.VERSION);
  assert.equal((await success(org.call('bookings/' + b.id + '/cancellation-quote'))).percent, 100);
  await db.prepare('UPDATE bookings SET start_at=? WHERE id=?').run(Date.now() + 3600000, b.id);
  assert.equal((await success(org.call('bookings/' + b.id + '/cancellation-quote'))).percent, 80);
  await success(admin.call('admin/settings', 'PATCH', {
    defaultCancellationRefundPercent: 20
  }));
  assert.equal((await success(org.call('bookings/' + b.id + '/cancellation-quote'))).percent, 80);
  await db.prepare('UPDATE bookings SET policy_snapshot=NULL,refund_policy_percent=75 WHERE id=?').run(b.id);
  assert.equal((await success(org.call('bookings/' + b.id + '/cancellation-quote'))).percent, 75);
  await success(admin.call('admin/settings', 'PATCH', {
    defaultCancellationRefundPercent: 80
  }));
});
/**
 * Recorre inasistencia: tolerancia, reclamo, respuesta, decisión, devolución total, cierre y
 * apelación. Verifica que el incumplimiento confirmado no acepte un porcentaje menor al 100%.
 */
test('No show: tolerance, ownership, decision, full refund, close and appeal', async () => {
  const b = await policyBooking();
  assert.equal((await org.call('bookings/' + b.id + '/incidents', 'POST', {
    category: 'inasistencia_profesional',
    body: 'No vino'
  })).status, 409);
  const yesterday = futureDate(-1);
  await db.prepare('UPDATE bookings SET date=?,start_at=?,end_at=? WHERE id=?').run(yesterday, Date.now() - 7200000, Date.now() - 3600000, b.id);
  const i = await success(org.call('bookings/' + b.id + '/incidents', 'POST', {
    category: 'inasistencia_profesional',
    body: 'Esperé y llamé sin respuesta',
    evidence: 'Mensajes en la reserva',
    remedy: 'reembolso'
  }), 201);
  assert.equal((await pro.call('bookings/' + b.id + '/incidents', 'POST', {
    body: 'Duplicado'
  })).status, 409);
  const stranger = client(base);
  assert.equal((await stranger.call('incidents/' + i.id + '/reply', 'POST', {
    body: 'Ajeno'
  })).status, 401);
  await success(pro.call('incidents/' + i.id + '/reply', 'POST', {
    body: 'No pude asistir'
  }));
  assert.equal((await org.call('bookings/' + b.id + '/cancel', 'POST', {
    reason: 'No vino'
  })).status, 409);
  assert.equal((await admin.call('admin/incidents/' + i.id, 'PATCH', {
    outcome: 'incumplimiento_profesional',
    resolution: 'Confirmado',
    close: true
  })).status, 409);
  await success(admin.call('admin/incidents/' + i.id, 'PATCH', {
    outcome: 'incumplimiento_profesional',
    resolution: 'Confirmado por ambas partes',
    close: false
  }));
  const result = await success(admin.call('bookings/' + b.id + '/cancel', 'POST', {
    reason: 'Incumplimiento confirmado',
    refundPercent: 10
  }));
  assert.equal(result.refundAmount, b.amount);
  assert.equal((await admin.call('bookings/' + b.id + '/cancel', 'POST', {
    reason: 'Duplicado'
  })).status, 409);
  await success(admin.call('admin/incidents/' + i.id, 'PATCH', {
    outcome: 'incumplimiento_profesional',
    resolution: 'Devolución completada',
    close: true
  }));
  await success(pro.call('incidents/' + i.id + '/appeal', 'POST', {
    body: 'Adjunto justificación de fuerza mayor'
  }));
  assert.equal((await db.prepare('SELECT status FROM incidents WHERE id=?').get(i.id)).status, 'abierta');
});
/**
 * Verifica evidencia de entrega, bloqueo de cancelación directa, confirmación sin evaluación y
 * conformidad posterior a una corrección antes de liquidar. Permite reclamar después de
 * liquidación dentro del flujo previsto.
 */
test('Delivered services cannot be cancelled by customer; confirmation is independent from evaluation', async () => {
  const b = await policyBooking();
  await db.prepare('UPDATE bookings SET end_at=? WHERE id=?').run(Date.now() - 1, b.id);
  assert.equal((await pro.call('bookings/' + b.id, 'PATCH', {
    status: 'entregado'
  })).status, 400);
  await success(pro.call('bookings/' + b.id, 'PATCH', {
    status: 'entregado',
    evidence: 'Sesión y reporte entregados'
  }));
  assert.equal((await org.call('bookings/' + b.id + '/cancel', 'POST', {
    reason: 'Ya lo recibí'
  })).status, 409);
  await success(org.call('bookings/' + b.id + '/confirm', 'POST', {}));
  const i = await success(org.call('bookings/' + b.id + '/incidents', 'POST', {
    body: 'Falta corregir el informe',
    category: 'calidad'
  }), 201);
  await success(admin.call('admin/incidents/' + i.id, 'PATCH', {
    resolution: 'Corregir informe',
    outcome: 'correccion',
    close: false
  }));
  assert.equal((await admin.call('admin/bookings/' + b.id + '/release', 'POST', {})).status, 409);
  assert.equal((await admin.call('admin/incidents/' + i.id, 'PATCH', {
    resolution: 'Listo',
    outcome: 'correccion',
    close: true
  })).status, 409);
  await success(org.call('incidents/' + i.id + '/accept', 'POST', {
    body: 'Recibí el informe corregido'
  }));
  await success(admin.call('admin/incidents/' + i.id, 'PATCH', {
    resolution: 'Conformidad verificada',
    outcome: 'correccion',
    close: true
  }));
  await success(admin.call('admin/bookings/' + b.id + '/release', 'POST', {}));
  await success(org.call('bookings/' + b.id + '/incidents', 'POST', {
    body: 'Problema detectado después de liquidación'
  }), 201);
});
/**
 * Recorre observación de servicio, mediación, contacto, propuestas, rechazo y aceptación.
 * Comprueba que editar esté bloqueado durante la mediación y que aceptar no publique
 * automáticamente.
 */
test('Service mediation records disagreement, contact, proposal and explicit consent', async () => {
  const s = await success(pro.call('services', 'POST', {
    title: 'Servicio a negociar',
    description: 'Diagnóstico especializado',
    price: 200000
  }), 201);
  await success(admin.call('admin/services/' + s.id, 'PATCH', {
    status: 'info_solicitada',
    revision: s.revision,
    adminNotes: 'Justificar alcance y precio'
  }));
  const a = await success(pro.call('services/' + s.id + '/appeals', 'POST', {
    body: 'Incluye preparación especializada',
    contact: 'correo de mi perfil'
  }), 201);
  assert.equal((await pro.call('services/' + s.id, 'PATCH', {
    price: 1
  })).status, 409);
  assert.equal((await pro.call('service-appeals/' + a.id + '/events', 'POST', {
    kind: 'aceptar',
    body: 'Sin propuesta'
  })).status, 409);
  await success(admin.call('service-appeals/' + a.id + '/events', 'POST', {
    kind: 'contacto',
    body: 'Conversación registrada; mantener alcance'
  }));
  await success(admin.call('service-appeals/' + a.id + '/events', 'POST', {
    kind: 'propuesta',
    body: 'Mantener precio; aclarar entregables'
  }));
  await success(pro.call('service-appeals/' + a.id + '/events', 'POST', {
    kind: 'rechazar',
    body: 'Solicito otra conversación'
  }));
  await success(admin.call('service-appeals/' + a.id + '/events', 'POST', {
    kind: 'propuesta',
    body: 'Mantener precio y alcance original'
  }));
  await success(pro.call('service-appeals/' + a.id + '/events', 'POST', {
    kind: 'aceptar',
    body: 'Acepto expresamente'
  }));
  assert.equal((await db.prepare('SELECT status FROM service_appeals WHERE id=?').get(a.id)).status, 'acordada');
  assert.equal((await db.prepare('SELECT published FROM services WHERE id=?').get(s.id)).published, null);
});
/**
 * Simula una devolución incierta, comprueba que no se repita y exige evidencia para conciliarla.
 * Rechaza volver a confirmar una operación ya cerrada.
 */
test('Uncertain refunds require evidence and never automatically repeat the provider request', async () => {
  const b = await policyBooking();
  await db.prepare("UPDATE payments SET provider='webpay',provider_token='uncertain' WHERE booking_id=?").run(b.id);
  let calls = 0;
  const prior = publicApp.locals.providers.webpay.refundTransaction;
  /**
   * Simula un timeout de devolución y cuenta cuántas veces se intentó. El escenario verifica que
   * la incertidumbre bloquee un segundo envío al proveedor.
   */
  publicApp.locals.providers.webpay.refundTransaction = async () => {
    calls++;
    throw new Error('timeout');
  };
  try {
    assert.equal((await org.call('bookings/' + b.id + '/cancel', 'POST', {
      reason: 'Cancelación'
    })).status, 502);
    assert.equal((await org.call('bookings/' + b.id + '/cancel', 'POST', {
      reason: 'Repetir'
    })).status, 409);
    assert.equal(calls, 1);
    const op = await db.prepare('SELECT * FROM refund_operations WHERE booking_id=?').get(b.id);
    assert.equal((await admin.call('admin/refunds/' + op.id + '/reconcile', 'POST', {
      result: 'confirmado'
    })).status, 400);
    await success(admin.call('admin/refunds/' + op.id + '/reconcile', 'POST', {
      result: 'confirmado',
      reference: 'BANK-REF-1',
      evidence: 'Proveedor confirmó monto y reserva'
    }));
    assert.equal((await db.prepare('SELECT cancellation_status FROM bookings WHERE id=?').get(b.id)).cancellation_status, null);
    assert.equal((await admin.call('admin/refunds/' + op.id + '/reconcile', 'POST', {
      result: 'confirmado',
      reference: 'again',
      evidence: 'again'
    })).status, 409);
  } finally {
    publicApp.locals.providers.webpay.refundTransaction = prior;
  }
});
/**
 * Verifica que una orden externa exija pago no simulado, confirmación, importe exacto y
 * comprobante de la reserva. El proveedor es controlado por la prueba; no se realiza una
 * transferencia bancaria.
 */
test('External payout requires real payment, exact amount and booking-scoped evidence', async () => {
  const b = await policyBooking();
  await db.prepare("UPDATE bookings SET status='confirmado',confirmed_at=? WHERE id=?").run(Date.now(), b.id);
  assert.equal((await admin.call('admin/bookings/' + b.id + '/payout', 'POST', {})).status, 409);
  await db.prepare("UPDATE payments SET provider='webpay' WHERE booking_id=?").run(b.id);
  assert.equal((await admin.call('admin/bookings/' + b.id + '/release', 'POST', {})).status, 409);
  await success(admin.call('admin/bookings/' + b.id + '/payout', 'POST', {}));
  assert.equal((await admin.call('admin/bookings/' + b.id + '/payout', 'POST', {})).status, 409);
  const p = await db.prepare('SELECT * FROM payouts WHERE booking_id=?').get(b.id);
  assert.equal((await admin.call('admin/payouts/' + p.id + '/confirm', 'POST', {
    reference: 'BANK-1',
    amount: p.amount,
    evidenceId: 'missing'
  })).status, 400);
  await success(admin.call('bookings/' + b.id + '/attachments', 'POST', {
    name: 'transferencia.pdf',
    mime: 'application/pdf',
    data: Buffer.from('%PDF-1.4 test').toString('base64')
  }), 201);
  const doc = (await success(admin.call('bookings/' + b.id + '/attachments')))[0];
  await success(admin.call('admin/payouts/' + p.id + '/confirm', 'POST', {
    reference: 'BANK-1',
    amount: p.amount,
    evidenceId: doc.id
  }));
  assert.equal((await db.prepare('SELECT status FROM bookings WHERE id=?').get(b.id)).status, 'completado');
  assert.equal((await admin.call('admin/payouts/' + p.id + '/confirm', 'POST', {
    reference: 'BANK-1',
    amount: p.amount,
    evidenceId: doc.id
  })).status, 409);
});
/**
 * Comprueba que dos barridos creen un único caso de abandono y que un correo fallido se recupere
 * con reintento, sin duplicar envíos SMTP concurrentes.
 */
test('Follow-up detects abandonment once; SMTP retry recovers without duplicate concurrent delivery', async () => {
  const b = await policyBooking();
  await db.prepare('UPDATE bookings SET end_at=? WHERE id=?').run(Date.now() - 48 * 3600000, b.id);
  const g = require('../server/governance'),
    n = require('../server/notifications');
  await g.sweep();
  await g.sweep();
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM incidents WHERE booking_id=?').get(b.id)).n, 1);
  const id = await n.enqueue('retry@example.test', 'Retry test', 'Body');
  let calls = 0;
  assert.equal(await n.deliver(id, {
    /**
     * Simula un transporte SMTP sin conexión lanzando un error. Permite verificar que deliver
     * conserve el mensaje para reintento.
     */
    sendMail: async () => {
      throw new Error('offline');
    }
  }), false);
  await db.prepare('UPDATE outbox SET next_attempt_at=0 WHERE id=?').run(id);
  const transport = {
    /**
     * Simula un envío SMTP exitoso con una demora breve y cuenta las invocaciones. Dos llamadas
     * concurrentes deben adquirir un único bloqueo de entrega.
     */
    sendMail: async () => {
      calls++;
      await new Promise(/* Introduce una demora controlada en el doble de prueba para ejercitar concurrencia y bloqueo de envío. */ r => setTimeout(r, 20));
    }
  };
  await Promise.all([n.deliver(id, transport), n.deliver(id, transport)]);
  assert.equal(calls, 1);
  assert.equal((await db.prepare('SELECT sent FROM outbox WHERE id=?').get(id)).sent, 1);
});
/**
 * Verifica que una suspensión impida nuevas reservas pero conserve el acceso del profesional a
 * las existentes, y que administración pueda levantarla con fundamento.
 */
test('Suspension blocks new reservations without hiding existing claims', async () => {
  await success(admin.call('admin/professionals/' + proId + '/suspension', 'POST', {
    suspended: true,
    reason: 'Revisión de incumplimiento; se revisará al resolver el caso'
  }));
  assert.equal((await org.call('bookings', 'POST', {
    serviceId: service.id,
    date: futureDate(policyOffset++),
    time: '10:00'
  })).status, 409);
  assert.ok((await success(pro.call('bookings'))).length > 0);
  await success(admin.call('admin/professionals/' + proId + '/suspension', 'POST', {
    suspended: false,
    reason: 'Caso revisado; habilitación aprobada'
  }));
});
/**
 * Recorre cancelación profesional antes de pago y verifica bloqueo del cobro, devolución cero y
 * ausencia de dinero retenido ficticio.
 */
test('Professional cancellation before payment does not invent retained money', async () => {
  const b = await success(org.call('bookings', 'POST', {
    serviceId: service.id,
    date: futureDate(policyOffset++),
    time: '10:00'
  }), 201);
  await success(pro.call('bookings/' + b.id, 'PATCH', {
    status: 'aceptado'
  }));
  const i = await success(pro.call('bookings/' + b.id + '/incidents', 'POST', {
    category: 'cancelacion_profesional',
    body: 'No podré realizar la sesión'
  }), 201);
  assert.equal((await org.call('payments', 'POST', {
    bookingId: b.id,
    acceptTerms: true
  })).status, 409);
  await success(admin.call('admin/incidents/' + i.id, 'PATCH', {
    outcome: 'reembolso_total',
    resolution: 'Cancelar sin cobro',
    close: false
  }));
  const r = await success(admin.call('bookings/' + b.id + '/cancel', 'POST', {
    reason: 'Profesional no disponible'
  }));
  assert.equal(r.refundAmount, 0);
  assert.equal((await db.prepare('SELECT retained_amount FROM bookings WHERE id=?').get(b.id)).retained_amount, 0);
  await success(admin.call('admin/incidents/' + i.id, 'PATCH', {
    outcome: 'reembolso_total',
    resolution: 'Cancelado sin cobro',
    close: true
  }));
});
/**
 * Envía veinte solicitudes simultáneas para un mismo horario y exige una sola reserva creada y
 * diecinueve conflictos. Comprueba el resultado persistido.
 */
test('Concurrent requests for the same slot create exactly one reservation', async () => {
  const date = futureDate(100);
  const responses = await Promise.all(Array.from({
    length: 20
  }, /* Genera otra solicitud simultánea al mismo horario para comprobar exclusión de reservas concurrentes. */ () => org.call('bookings', 'POST', {
    serviceId: service.id,
    date,
    time: '10:00'
  })));
  assert.equal(responses.filter(/* Conserva los elementos según la condición r.status === 201. Se evalúan los datos ya cargados. */ r => r.status === 201).length, 1);
  assert.equal(responses.filter(/* Conserva los elementos según la condición r.status === 409. Se evalúan los datos ya cargados. */ r => r.status === 409).length, 19);
  assert.equal((await db.prepare('SELECT count(*) n FROM bookings WHERE professional_id=? AND date=? AND time=?').get(proId, date, '10:00')).n, 1);
});
/**
 * Simula una devolución tardía incierta y su conciliación administrativa. Verifica que el pago
 * quede reembolsado y la reserva continúe expirada.
 */
test('Late uncertain refunds can be reconciled without reviving an expired booking', async () => {
  const b = await policyBooking();
  const p = await db.prepare('SELECT * FROM payments WHERE booking_id=?').get(b.id);
  await db.prepare("UPDATE bookings SET status='expirado',paid_at=NULL WHERE id=?").run(b.id);
  await db.prepare("UPDATE payments SET status='revision',provider='webpay',authorization_code='LATE-AUTH' WHERE id=?").run(p.id);
  const provider = adminApp.locals.providers.webpay,
    prior = provider.refundTransaction;
  /**
   * Simula una devolución tardía de resultado incierto. La prueba verifica la conciliación externa
   * sin reactivar la reserva expirada.
   */
  provider.refundTransaction = async () => {
    throw new Error('uncertain');
  };
  try {
    assert.equal((await admin.call('admin/payments/' + p.id + '/refund-late', 'POST', {})).status, 502);
    const op = await db.prepare("SELECT * FROM refund_operations WHERE booking_id=? AND kind='tardio'").get(b.id);
    assert.ok(op);
    await success(admin.call('admin/refunds/' + op.id + '/reconcile', 'POST', {
      result: 'confirmado',
      reference: 'LATE-BANK',
      evidence: 'Verificado con proveedor'
    }));
    assert.equal((await db.prepare('SELECT status FROM bookings WHERE id=?').get(b.id)).status, 'expirado');
    assert.equal((await db.prepare('SELECT status FROM payments WHERE id=?').get(p.id)).status, 'reembolsado');
  } finally {
    provider.refundTransaction = prior;
  }
});
