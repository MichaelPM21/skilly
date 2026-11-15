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
function reports(app) {
  const requireAdmin = (req, res, next) => {
    try {
      admin(req);
      next();
    } catch (e) {
      next(e);
    }
  };
  const rowToBooking = async b => await bookingView({
    user: {
      role: 'admin'
    }
  }, b);
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
      const total = o.bookings.length;
      const esteMs = o.bookings.filter(b => b.date && b.date.slice(0, 7) === thisMonth).length;
      const canceladas = o.bookings.filter(b => b.status === 'cancelado').length;
      const completadas = o.bookings.filter(b => b.status === 'completado').length;
      const totalPagado = payments.filter(p => p.org_email === o.orgEmail && (p.status === 'pagado' || p.status === 'liberado')).reduce((s, p) => s + p.amount, 0);
      const ultimaReserva = o.bookings.reduce((max, b) => Math.max(max, b.created_at), 0);
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
    }))).sort((a, b) => b.ultimaReserva - a.ultimaReserva);
    res.json(result);
  }));

  // Resumen para el dashboard del panel de administración.
  app.get('/api/admin/dashboard', requireAdmin, wrap(async (req, res) => {
    const professionals = await db.prepare('SELECT status, recommended, reviewed_at FROM professionals').all();
    const bookings = await db.prepare('SELECT status, refund_amount FROM bookings').all();
    const payments = await db.prepare('SELECT status, amount, provider, refund_amount FROM payments').all();
    const guestRequests = await db.prepare('SELECT status FROM guest_requests').all();
    const settings = await getSettings();
    const count = (arr, pred) => arr.filter(pred).length;
    const sum = (arr, pred, field = 'amount') => arr.filter(pred).reduce((s, p) => s + (p[field] || 0), 0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const reviewsThisWeek = count(professionals, p => p.reviewed_at && p.reviewed_at >= sevenDaysAgo);
    res.json({
      professionals: {
        total: professionals.length,
        validados: count(professionals, p => p.status === 'validado'),
        pendientes: count(professionals, p => p.status === 'pendiente'),
        rechazados: count(professionals, p => p.status === 'rechazado'),
        infoSolicitada: count(professionals, p => p.status === 'info_solicitada'),
        recomendados: count(professionals, p => p.recommended)
      },
      revisionSemanal: {
        capacidad: settings.admin_weekly_review_capacity,
        realizadas: reviewsThisWeek,
        sobrecargado: reviewsThisWeek > settings.admin_weekly_review_capacity
      },
      bookings: {
        total: bookings.length,
        reservado: count(bookings, b => ['reservado', 'gestion_skilly', 'solicitado', 'aceptado'].includes(b.status)),
        pagado: count(bookings, b => b.status === 'pagado'),
        entregado: count(bookings, b => ['entregado', 'confirmado'].includes(b.status)),
        completado: count(bookings, b => b.status === 'completado'),
        cancelado: count(bookings, b => b.status === 'cancelado')
      },
      payments: {
        totalPagado: sum(payments, p => p.status === 'pagado' || p.status === 'liberado'),
        retenido: sum(payments, p => p.status === 'pagado'),
        liberado: sum(payments, p => p.status === 'liberado'),
        totalReembolsado: sum(payments, p => p.status === 'reembolsado', 'refund_amount'),
        porProveedor: {
          webpay: count(payments, p => p.provider === 'webpay' && (p.status === 'pagado' || p.status === 'liberado')),
          paypal: count(payments, p => p.provider === 'paypal' && (p.status === 'pagado' || p.status === 'liberado')),
          simulado: count(payments, p => p.provider === 'simulado' && (p.status === 'pagado' || p.status === 'liberado'))
        }
      },
      guestRequests: {
        total: guestRequests.length,
        nuevas: count(guestRequests, g => g.status === 'nueva'),
        contactadas: count(guestRequests, g => g.status === 'contactada'),
        convertidas: count(guestRequests, g => g.status === 'convertida')
      }
    });
  }));
}
module.exports = {
  reports
};
