// ============================================================
// Capa de base de datos — SQLite (archivo local skilly.db)
// ------------------------------------------------------------
// Usa better-sqlite3: una base de datos SQL real que persiste en
// disco (server/skilly.db). No requiere instalar un servidor de
// base de datos aparte — ideal para desarrollo y para un primer
// despliegue simple. Para producción con más carga concurrente,
// se puede migrar a Postgres/MySQL manteniendo las mismas
// consultas (con adaptaciones menores de sintaxis).
// ============================================================

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'skilly.db');
const db = new Database(DB_PATH);
// Concurrent public/admin startup can return SQLITE_BUSY immediately while
// switching journal mode, even with SQLite's default busy timeout.
const journalDeadline = performance.now() + 5000;
const journalWait = new Int32Array(new SharedArrayBuffer(4));
try {
  for (;;) {
    try {
      db.pragma('journal_mode = WAL');
      break;
    } catch (error) {
      const remaining = journalDeadline - performance.now();
      if (error.code !== 'SQLITE_BUSY' || remaining <= 0) throw error;
      Atomics.wait(journalWait, 0, 0, Math.min(50, remaining));
    }
  }
} catch (error) {
  db.close();
  throw error;
}

db.exec(`
CREATE TABLE IF NOT EXISTS professionals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT,
  title TEXT,
  description TEXT,
  tags TEXT,              -- JSON array
  price TEXT,
  modality TEXT,
  status TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | validado | rechazado
  recommended INTEGER NOT NULL DEFAULT 0,      -- 0/1 — decidido por el admin, reemplaza ranking público
  admin_notes TEXT DEFAULT '',
  validation TEXT,        -- JSON: {linkedin, yearsExperience, certifications, cv, references, portfolio, motivation}
  availability TEXT,      -- JSON: {days:[...], hours:[...]}
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  professional_id TEXT NOT NULL,
  professional_name TEXT,
  professional_email TEXT,
  org_name TEXT,
  org_email TEXT,
  date TEXT,
  time TEXT,
  service TEXT,
  notes TEXT,
  amount INTEGER,
  status TEXT NOT NULL DEFAULT 'reservado', -- reservado | pagado | entregado | completado | cancelado
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  FOREIGN KEY(professional_id) REFERENCES professionals(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  professional_id TEXT,
  professional_name TEXT,
  org_name TEXT,
  org_email TEXT,
  amount INTEGER,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'pagado', -- iniciado | pagado (retenido) | liberado | rechazado
  invoice_number TEXT,
  created_at INTEGER NOT NULL,
  released_at INTEGER,
  provider TEXT DEFAULT 'simulado',      -- simulado | webpay | paypal
  provider_token TEXT,                   -- token_ws (Webpay) u order id (PayPal)
  buy_order TEXT,                        -- buyOrder enviado a Webpay
  authorization_code TEXT,               -- código de autorización real del emisor
  card_last4 TEXT,
  payment_type_code TEXT,
  currency TEXT DEFAULT 'CLP',
  FOREIGN KEY(booking_id) REFERENCES bookings(id)
);

-- Reservas solicitadas por organizaciones que NO se registran en la
-- plataforma: quedan aquí hasta que un administrador de Skilly las
-- contacta y gestiona el pago manualmente (o las convierte en una
-- reserva formal una vez coordinado el método de pago).
CREATE TABLE IF NOT EXISTS guest_requests (
  id TEXT PRIMARY KEY,
  professional_id TEXT NOT NULL,
  professional_name TEXT,
  contact_name TEXT NOT NULL,
  org_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  date TEXT,
  time TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'nueva', -- nueva | contactada | convertida | descartada
  admin_notes TEXT DEFAULT '',
  booking_id TEXT,                       -- se llena si se convierte en reserva formal
  email_sent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  handled_at INTEGER,
  FOREIGN KEY(professional_id) REFERENCES professionals(id)
);

-- Evaluaciones: SOLO se exponen por la API de administración (ver server/index.js).
-- Esta es la barrera real de privacidad: el backend nunca las incluye en
-- ninguna respuesta pública, a diferencia de una app 100% en el navegador.
CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  professional_id TEXT NOT NULL,
  professional_name TEXT,
  booking_id TEXT,
  org_name TEXT,
  org_email TEXT,
  stars INTEGER NOT NULL,
  comment TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(professional_id) REFERENCES professionals(id)
);
-- Chat entre la organización y el profesional de una reserva. Permite
-- coordinar detalles sin intercambiar datos de contacto personales
-- directamente; el admin también puede leerlo si necesita mediar.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  sender_role TEXT NOT NULL,   -- organizacion | profesional | admin
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(booking_id) REFERENCES bookings(id)
);

-- Configuración global de la plataforma (fila única, id=1).
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  admin_weekly_review_capacity INTEGER NOT NULL DEFAULT 3,
  default_cancellation_refund_percent INTEGER NOT NULL DEFAULT 80
);
INSERT OR IGNORE INTO settings (id, admin_weekly_review_capacity, default_cancellation_refund_percent) VALUES (1, 3, 80);
`);

// Migración liviana: si el archivo skilly.db ya existía de una versión
// anterior del proyecto (sin las columnas nuevas), las agrega.
// No borra ni toca datos existentes.
function addColumnsIfMissing(table, wanted) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  for (const [name, def] of Object.entries(wanted)) {
    if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}
function migrate() {
  addColumnsIfMissing('payments', {
    provider: "TEXT DEFAULT 'simulado'", provider_token: 'TEXT', buy_order: 'TEXT',
    authorization_code: 'TEXT', card_last4: 'TEXT', payment_type_code: 'TEXT', currency: "TEXT DEFAULT 'CLP'",
    refund_amount: 'INTEGER', refund_id: 'TEXT', refunded_at: 'INTEGER',
  });
  addColumnsIfMissing('professionals', {
    max_per_day: 'INTEGER', max_per_week: 'INTEGER', max_per_month: 'INTEGER',
    duration_minutes: 'INTEGER DEFAULT 60', prep_minutes: 'INTEGER DEFAULT 0', followup_minutes: 'INTEGER DEFAULT 0',
    assigned_to: "TEXT DEFAULT ''",
  });
  addColumnsIfMissing('bookings', {
    refund_amount: 'INTEGER', refund_percent: 'INTEGER', cancelled_at: 'INTEGER',
    cancelled_by: 'TEXT', cancel_reason: 'TEXT',
  });
  addColumnsIfMissing('guest_requests', { assigned_to: "TEXT DEFAULT ''" });
}
db.transaction(migrate).immediate();

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function seedIfEmpty() {
  return db.transaction(() => {
  const count = db.prepare('SELECT COUNT(*) c FROM professionals').get().c;
  if (count > 0) return;

  const now = Date.now();
  const seed = [
    {
      name: 'Camila Morales', email: 'camila@demo.cl', category: 'Diseño', title: 'Diseñadora UX/UI',
      description: 'Diseño de experiencias digitales y prototipado centrado en usuarios.',
      tags: ['UX/UI', 'Figma', 'Investigación'], price: '$35.000', modality: 'Remoto',
      status: 'validado', recommended: 1, adminNotes: 'Validada en reunión demo.',
      validation: { linkedin: 'https://linkedin.com/in/camila-demo', certifications: 'Certificación UX Google', yearsExperience: '6', cv: 'CV adjunto (demo)', references: 'Referencia: Agencia Norte', portfolio: 'https://camila.demo', motivation: 'Quiero ampliar mi cartera de clientes.' },
      availability: { days: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'], hours: ['09:00', '11:00', '15:00'] },
      reviewedAt: now,
    },
    {
      name: 'Matías Rojas', email: 'matias@demo.cl', category: 'Tecnología', title: 'Desarrollador Full Stack',
      description: 'Desarrollo de plataformas web e integraciones con APIs.',
      tags: ['React', 'Node.js', 'APIs'], price: '$45.000', modality: 'Híbrido',
      status: 'validado', recommended: 1, adminNotes: 'Validado en reunión demo.',
      validation: { linkedin: 'https://linkedin.com/in/matias-demo', certifications: 'AWS Developer Associate', yearsExperience: '5', cv: 'CV adjunto (demo)', references: 'Referencia: Startup Fintech', portfolio: 'https://matias.demo', motivation: 'Busco proyectos de mediano plazo.' },
      availability: { days: ['Lunes', 'Miércoles', 'Viernes'], hours: ['09:00', '11:00', '15:00', '17:00'] },
      reviewedAt: now,
    },
    {
      name: 'Sofía Herrera', email: 'sofia@demo.cl', category: 'Marketing', title: 'Especialista Marketing Digital',
      description: 'Estrategias de adquisición, posicionamiento y contenido.',
      tags: ['SEO', 'Ads', 'Contenido'], price: '$30.000', modality: 'Remoto',
      status: 'validado', recommended: 0, adminNotes: '',
      validation: { linkedin: 'https://linkedin.com/in/sofia-demo', certifications: 'Google Ads Certified', yearsExperience: '4', cv: 'CV adjunto (demo)', references: 'Referencia: Retail LATAM', portfolio: 'https://sofia.demo', motivation: 'Quiero diversificar mis clientes.' },
      availability: { days: ['Martes', 'Jueves'], hours: ['10:00', '12:00', '16:00'] },
      reviewedAt: now,
    },
    {
      name: 'Diego Fuentes', email: 'diego@demo.cl', category: 'Consultoría', title: 'Consultor de Negocios',
      description: 'Acompañamiento estratégico para empresas en crecimiento.',
      tags: ['Estrategia', 'BMC', 'Procesos'], price: '$50.000', modality: 'Presencial',
      status: 'pendiente', recommended: 0, adminNotes: '',
      validation: { linkedin: 'https://linkedin.com/in/diego-demo', certifications: 'MBA Universidad Católica', yearsExperience: '8', cv: 'CV adjunto (demo)', references: 'Referencia: Consultora ABC', portfolio: '', motivation: 'Quiero ofrecer consultoría a más organizaciones.' },
      availability: { days: ['Lunes', 'Martes', 'Miércoles'], hours: ['09:00', '11:00'] },
      reviewedAt: null,
    },
  ];

  const stmt = db.prepare(`INSERT INTO professionals
    (id, name, email, category, title, description, tags, price, modality, status, recommended, admin_notes, validation, availability, created_at, reviewed_at)
    VALUES (@id, @name, @email, @category, @title, @description, @tags, @price, @modality, @status, @recommended, @adminNotes, @validation, @availability, @createdAt, @reviewedAt)`);

  for (const p of seed) {
    stmt.run({
      id: uid('prof'),
      name: p.name, email: p.email, category: p.category, title: p.title, description: p.description,
      tags: JSON.stringify(p.tags), price: p.price, modality: p.modality, status: p.status,
      recommended: p.recommended, adminNotes: p.adminNotes,
      validation: JSON.stringify(p.validation), availability: JSON.stringify(p.availability),
      createdAt: now, reviewedAt: p.reviewedAt,
    });
  }
  }).immediate();
}

function getSettings() {
  return db.prepare('SELECT * FROM settings WHERE id=1').get();
}
function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch };
  db.prepare('UPDATE settings SET admin_weekly_review_capacity=?, default_cancellation_refund_percent=? WHERE id=1')
    .run(next.admin_weekly_review_capacity, next.default_cancellation_refund_percent);
  return getSettings();
}

module.exports = { db, uid, seedIfEmpty, getSettings, updateSettings };
