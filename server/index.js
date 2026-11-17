/**
 * Flujo del módulo. Entrada HTTP compartida. createApp configura seguridad y rutas; start migra
 * PostgreSQL, abre el puerto y, en la aplicación pública, inicia el seguimiento. Flujo de
 * petición: cuerpo → sesión → origen/rol → módulo de negocio → respuesta o error.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const {
  db,
  getSettings
} = require('./db');
const {
  migrate
} = require('./schema');
const S = require('./security');
const {
  wrap,
  authRoutes
} = require('./accounts');
const {
  servicesRoutes
} = require('./services');
const {
  bookingsRoutes
} = require('./bookings');
const {
  paymentsRoutes
} = require('./payments');
const {
  reports
} = require('./reports');
/**
 * Construye una aplicación Express pública o administrativa sin abrir un puerto. Instala
 * cabeceras, lectura de cuerpos, autenticación, protección de origen, rutas de negocio, archivos
 * estáticos y manejo de errores; ambas variantes comparten PostgreSQL.
 */
function createApp(kind = 'public') {
  const app = express();
  app.locals.kind = kind;
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    // Añade cabeceras contra interpretación de tipos, inclusión en marcos y permisos del navegador; desactiva caché para respuestas de la API y continúa la petición.
    
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({
    limit: '8mb'
  }));
  app.use(express.urlencoded({
    extended: false,
    limit: '20kb'
  }));
  app.use(/* Carga la sesión antes de las rutas y pasa a next cualquier fallo asíncrono de autenticación. */ (req, res, next) => S.auth(req, res, next).catch(next));
  app.use('/api', (req, res, next) => {
    // Exige origen permitido y X-Skilly-Request para escrituras, salvo retornos verificados de pasarelas. Separa rutas administrativas del sitio público y exige rol admin en la API de administración.
    
    try {
      const callback = /^\/payments\/(webpay\/commit|paypal\/capture)$/.test(req.path);
      const expected = kind === 'admin' ? process.env.ADMIN_URL || 'http://localhost:3001' : process.env.BASE_URL || 'http://localhost:3000';
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !callback) {
        if (req.get('Origin') && req.get('Origin') !== new URL(expected).origin) S.fail(403, 'Origen no autorizado.');
        if (req.get('X-Skilly-Request') !== '1') S.fail(403, 'Solicitud no autorizada. Actualiza la página.');
      }
      if (kind === 'public' && req.path.startsWith('/admin')) S.fail(404, 'Utiliza la aplicación administrativa.');
      if (kind === 'admin' && !req.path.startsWith('/auth/') && req.path !== '/config') S.admin(req);
      if (kind === 'admin' && callback) S.fail(404, 'Ruta no disponible.');
      next();
    } catch (e) {
      next(e);
    }
  });
  authRoutes(app);
  servicesRoutes(app);
  bookingsRoutes(app);
  paymentsRoutes(app);
  require('./governance').routes(app);
  reports(app);
  /**
   * GET /api/config. Devuelve configuración pública de disponibilidad de proveedores, entorno,
   * cancelación, zona horaria y aplicación. No expone credenciales de Gmail ni de pasarelas.
   */
  app.get('/api/config', wrap(async (req, res) => res.json({
    mailerConfigured: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    paypalConfigured: require('./paypal').isConfigured(),
    webpayEnv: process.env.WEBPAY_ENV || 'integration',
    cancellationRefundPercent: (await getSettings()).default_cancellation_refund_percent,
    simulatedEnabled: process.env.NODE_ENV !== 'production',
    adminUrl: process.env.ADMIN_URL || 'http://localhost:3001',
    timeZone: 'America/Santiago',
    appKind: kind
  })));
  /**
   * GET /api/admin/evaluations. Exige administración y devuelve las evaluaciones privadas con sus
   * campos de presentación.
   */
  app.get('/api/admin/evaluations', wrap(async (req, res) => {
    S.admin(req);
    res.json((await db.prepare('SELECT * FROM evaluations ORDER BY created_at DESC').all()).map(/* Transforma cada registro en la estructura requerida por GET /api/admin/evaluations, conservando su posición en el arreglo resultante. */ e => ({
      id: e.id,
      professionalId: e.professional_id,
      professionalName: e.professional_name,
      orgName: e.org_name,
      stars: e.stars,
      comment: e.comment,
      createdAt: e.created_at
    })));
  }));
  app.use('/api', /* Devuelve un error JSON 404 cuando ninguna ruta de la API atendió la petición. */ (req, res) => res.status(404).json({
    error: 'Ruta no encontrada.'
  }));
  const root = path.join(__dirname, '..');
  // Each app serves a separate HTML entry point; shared assets preserve the design.
  /**
   * GET /. Sirve el HTML público o administrativo según kind, manteniendo entradas separadas con
   * recursos visuales compartidos.
   */
  app.get('/', (req, res) => res.sendFile(path.join(root, kind === 'admin' ? 'admin/index.html' : 'public/index.html')));
  app.use('/js', express.static(path.join(root, 'public/js')));
  /**
   * GET /styles.css. Entrega la hoja de estilos base compartida por ambas aplicaciones.
   */
  app.get('/styles.css', (req, res) => res.sendFile(path.join(root, 'public/styles.css')));
  /**
   * GET /workspace.css. Entrega la hoja de estilos de paneles, tema y componentes compartidos.
   */
  app.get('/workspace.css', (req, res) => res.sendFile(path.join(root, 'public/workspace.css')));
  /**
   * GET /favicon.ico. Responde sin contenido para la solicitud de icono del navegador.
   */
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.use((err, req, res, next) => {
    // Convierte errores a JSON: publica el mensaje de errores controlados y oculta detalles internos de los demás. Si ya se enviaron cabeceras, delega el manejo a Express.
    
    if (res.headersSent) return next(err);
    const status = err.status || 400;
    if (!err.status) console.error('[Skilly]', err.message);
    res.status(status).json({
      error: err.status ? err.message : 'No se pudo procesar la solicitud. Revisa los datos e inténtalo otra vez.'
    });
  });
  return app;
}
/**
 * Aplica la migración, inicia el puerto correspondiente y registra el cierre ordenado. Solo el
 * proceso público arranca el seguimiento de reclamos y la cola de correo; devuelve el servidor
 * HTTP.
 */
async function start(kind = process.env.APP_KIND === 'admin' ? 'admin' : 'public') {
  await migrate();
  const port = kind === 'admin' ? process.env.ADMIN_PORT || 3001 : process.env.PORT || 3000;
  const server = createApp(kind).listen(port, process.env.HOST || '127.0.0.1', /* Informa la dirección local cuando el servidor terminó de abrir su puerto. */ () => console.log(`Skilly ${kind} · PostgreSQL: http://localhost:${port}`));
  server.on('error', error => {
    // Registra el error del recurso y aplica el cierre o código de salida indicado por este manejador.
    
    console.error('No se pudo iniciar:', error.code);
    process.exitCode = 1;
    db.close();
  });
  if (kind === 'public') await require('./governance').startWorker();
  /**
   * Deja de aceptar conexiones HTTP y cierra el pool cuando termina el servidor. Atiende SIGINT y
   * SIGTERM del proceso.
   */
  const stop = () => server.close(/* Continúa el cierre del proceso o pool después de que el servidor deje de atender conexiones. */ () => db.close().catch(() => {
    // Ignora el error durante la limpieza final para no sustituir el resultado principal de la operación.
    }));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return server;
}
if (require.main === module) start().catch(error => {
  // Informa el fallo de arranque y cierra la conexión antes de terminar con código de error.
  
  console.error('No se pudo iniciar Skilly:', error.message);
  db.close().finally(() => {
    // Ejecuta la limpieza o salida final después del resultado, tanto si la promesa resolvió como si rechazó.
    
    process.exitCode = 1;
  });
});
module.exports = {
  createApp,
  initialize: migrate,
  start
};
