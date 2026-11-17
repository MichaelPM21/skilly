/**
 * Flujo del módulo. Informes administrativos calculados desde tablas operativas. Los totales se
 * agrupan por estado y correo; no sustituyen conciliación de pasarela, contabilidad de
 * comisiones ni prueba de transferencias externas.
 */

const {
  wrap
} = require('./accounts');
const {
  db,
  getSettings
} = require('./db');
const {
  admin
} = require('./security');
const {
  bookingView
} = require('./bookings');
/**
 * Registra informes administrativos de organizaciones e indicadores operativos. Agrupa reservas
 * por correo y resume estados e importes; los agregados no constituyen un libro contable de
 * comisiones o transferencias.
 */
function reports(app) {
  /**
   * Adapta la comprobación administrativa como middleware de Express, continuando con next o
   * entregándole el error de permisos.
   */
  const requireAdmin = (req, res, next) => {
    try {
      admin(req);
      next();
    } catch (e) {
      next(e);
    }
  };
  /**
   * Transforma una reserva usando la vista administrativa para el historial incluido en el informe
   * de organizaciones. El acceso a la ruta ya fue autorizado por requireAdmin.
   */
  const rowToBooking = async b => await bookingView({
    user: {
      role: 'admin'
    }
  }, b);
  /**
   * GET /api/admin/organizations. Agrupa reservas por correo o nombre y calcula historial e
   * indicadores por organización. Los importes agregan pagos pagados/liberados y no son una
   * conciliación contable completa.
   */
  app.get('/api/admin/organizations', requireAdmin, wrap(async (req, res) => {
    const bookings = await db.prepare('SELECT * FROM bookings ORDER BY created_at DESC').all();
    const payments = await db.prepare('SELECT * FROM payments').all();
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const byOrg = {};
    for (const b of bookings) {
      const key = b.org_email || b.org_name;
      if (!key) continue;
      if (!byOrg[key]) byOrg[key] = {
        orgName: b.org_name,
        orgEmail: b.org_email,
        bookings: []
      };
      byOrg[key].bookings.push(b);
    }
    const result = (await Promise.all(Object.values(byOrg).map(async o => {
      // Obtiene y transforma cada registro de forma asíncrona; el llamador reúne los resultados con Promise.all.
      
      const total = o.bookings.length;
      const esteMs = o.bookings.filter(/* Conserva los elementos según la condición b.date && b.date.slice(0, 7) === thisMonth. Se evalúan los datos ya cargados. */ b => b.date && b.date.slice(0, 7) === thisMonth).length;
      const canceladas = o.bookings.filter(/* Conserva los elementos según la condición b.status === 'cancelado'. Se evalúan los datos ya cargados. */ b => b.status === 'cancelado').length;
      const completadas = o.bookings.filter(/* Conserva los elementos según la condición b.status === 'completado'. Se evalúan los datos ya cargados. */ b => b.status === 'completado').length;
      const totalPagado = payments.filter(/* Conserva los elementos según la condición p.org_email === o.orgEmail && (p.status === 'pagado' || p.status === 'liberado'). Se evalúan los datos ya cargados. */ p => p.org_email === o.orgEmail && (p.status === 'pagado' || p.status === 'liberado')).reduce(/* Acumula s + p.amount sobre la colección seleccionada para calcular su resumen. */ (s, p) => s + p.amount, 0);
      const ultimaReserva = o.bookings.reduce(/* Obtiene la fecha de creación más reciente entre las reservas del grupo. */ (max, b) => Math.max(max, b.created_at), 0);
      return {
        orgName: o.orgName,
        orgEmail: o.orgEmail,
        totalReservas: total,
        reservasEsteMes: esteMs,
        reservasCanceladas: canceladas,
        reservasCompletadas: completadas,
        totalPagado,
        ultimaReserva,
        historial: await Promise.all(o.bookings.map(rowToBooking))
      };
    }))).sort(/* Coloca primero las organizaciones cuya reserva más reciente tiene una fecha mayor. */ (a, b) => b.ultimaReserva - a.ultimaReserva);
    res.json(result);
  }));

  // Resumen para el dashboard del panel de administración.
  /**
   * GET /api/admin/dashboard. Calcula conteos e importes por estado, proveedor y revisión semanal.
   * Usa las tablas operativas para el dashboard administrativo, no un registro de movimientos
   * bancarios.
   */
  app.get('/api/admin/dashboard', requireAdmin, wrap(async (req, res) => {
    const professionals = await db.prepare('SELECT status, recommended, reviewed_at FROM professionals').all();
    const bookings = await db.prepare('SELECT status, refund_amount FROM bookings').all();
    const payments = await db.prepare('SELECT status, amount, provider, refund_amount FROM payments').all();
    const guestRequests = await db.prepare('SELECT status FROM guest_requests').all();
    const settings = await getSettings();
    /**
     * Cuenta los elementos que cumplen el predicado recibido para construir un indicador del
     * dashboard.
     */
    const count = (arr, pred) => arr.filter(pred).length;
    /**
     * Suma el campo indicado de los registros que cumplen el predicado, usando amount por defecto y
     * cero para valores ausentes.
     */
    const sum = (arr, pred, field = 'amount') => arr.filter(pred).reduce(/* Acumula s + (p[field] || 0) sobre la colección seleccionada para calcular su resumen. */ (s, p) => s + (p[field] || 0), 0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const reviewsThisWeek = count(professionals, /* Selecciona los registros que cumplen p.reviewed_at && p.reviewed_at >= sevenDaysAgo para contarlos en el indicador administrativo. */ p => p.reviewed_at && p.reviewed_at >= sevenDaysAgo);
    res.json({
      professionals: {
        total: professionals.length,
        validados: count(professionals, /* Selecciona los registros que cumplen p.status === 'validado' para contarlos en el indicador administrativo. */ p => p.status === 'validado'),
        pendientes: count(professionals, /* Selecciona los registros que cumplen p.status === 'pendiente' para contarlos en el indicador administrativo. */ p => p.status === 'pendiente'),
        rechazados: count(professionals, /* Selecciona los registros que cumplen p.status === 'rechazado' para contarlos en el indicador administrativo. */ p => p.status === 'rechazado'),
        infoSolicitada: count(professionals, /* Selecciona los registros que cumplen p.status === 'info_solicitada' para contarlos en el indicador administrativo. */ p => p.status === 'info_solicitada'),
        recomendados: count(professionals, /* Selecciona los registros que cumplen p.recommended para contarlos en el indicador administrativo. */ p => p.recommended)
      },
      revisionSemanal: {
        capacidad: settings.admin_weekly_review_capacity,
        realizadas: reviewsThisWeek,
        sobrecargado: reviewsThisWeek > settings.admin_weekly_review_capacity
      },
      bookings: {
        total: bookings.length,
        reservado: count(bookings, /* Selecciona los registros que cumplen ['reservado', 'gestion_skilly', 'solicitado', 'aceptado'].includes(b.status) para contarlos en el indicador administrativo. */ b => ['reservado', 'gestion_skilly', 'solicitado', 'aceptado'].includes(b.status)),
        pagado: count(bookings, /* Selecciona los registros que cumplen b.status === 'pagado' para contarlos en el indicador administrativo. */ b => b.status === 'pagado'),
        entregado: count(bookings, /* Selecciona los registros que cumplen ['entregado', 'confirmado'].includes(b.status) para contarlos en el indicador administrativo. */ b => ['entregado', 'confirmado'].includes(b.status)),
        completado: count(bookings, /* Selecciona los registros que cumplen b.status === 'completado' para contarlos en el indicador administrativo. */ b => b.status === 'completado'),
        cancelado: count(bookings, /* Selecciona los registros que cumplen b.status === 'cancelado' para contarlos en el indicador administrativo. */ b => b.status === 'cancelado')
      },
      payments: {
        totalPagado: sum(payments, /* Selecciona los registros que cumplen p.status === 'pagado' || p.status === 'liberado' para sumar sus importes en el indicador administrativo. */ p => p.status === 'pagado' || p.status === 'liberado'),
        retenido: sum(payments, /* Selecciona los registros que cumplen p.status === 'pagado' para sumar sus importes en el indicador administrativo. */ p => p.status === 'pagado'),
        liberado: sum(payments, /* Selecciona los registros que cumplen p.status === 'liberado' para sumar sus importes en el indicador administrativo. */ p => p.status === 'liberado'),
        totalReembolsado: sum(payments, /* Selecciona los registros que cumplen p.status === 'reembolsado' para sumar sus importes en el indicador administrativo. */ p => p.status === 'reembolsado', 'refund_amount'),
        porProveedor: {
          webpay: count(payments, /* Selecciona los registros que cumplen p.provider === 'webpay' && (p.status === 'pagado' || p.status === 'liberado') para contarlos en el indicador administrativo. */ p => p.provider === 'webpay' && (p.status === 'pagado' || p.status === 'liberado')),
          paypal: count(payments, /* Selecciona los registros que cumplen p.provider === 'paypal' && (p.status === 'pagado' || p.status === 'liberado') para contarlos en el indicador administrativo. */ p => p.provider === 'paypal' && (p.status === 'pagado' || p.status === 'liberado')),
          simulado: count(payments, /* Selecciona los registros que cumplen p.provider === 'simulado' && (p.status === 'pagado' || p.status === 'liberado') para contarlos en el indicador administrativo. */ p => p.provider === 'simulado' && (p.status === 'pagado' || p.status === 'liberado'))
        }
      },
      guestRequests: {
        total: guestRequests.length,
        nuevas: count(guestRequests, /* Selecciona los registros que cumplen g.status === 'nueva' para contarlos en el indicador administrativo. */ g => g.status === 'nueva'),
        contactadas: count(guestRequests, /* Selecciona los registros que cumplen g.status === 'contactada' para contarlos en el indicador administrativo. */ g => g.status === 'contactada'),
        convertidas: count(guestRequests, /* Selecciona los registros que cumplen g.status === 'convertida' para contarlos en el indicador administrativo. */ g => g.status === 'convertida')
      }
    });
  }));
}
module.exports = {
  reports
};
