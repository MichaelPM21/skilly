-- SQLite: ejercicio de reconstrucción en una base desechable. NO ejecutar sobre datos de trabajo.
PRAGMA foreign_keys=ON;
BEGIN;
CREATE TABLE access_tokens (
        token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, subject TEXT NOT NULL,
        expires_at INTEGER NOT NULL, used_at INTEGER
      );

CREATE TABLE attachments (
        id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
        name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL
      );

CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT NOT NULL,
        target TEXT, detail TEXT, created_at INTEGER NOT NULL
      );

CREATE TABLE bookings (
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
  delivered_at INTEGER, refund_amount INTEGER, refund_percent INTEGER, cancelled_at INTEGER, cancelled_by TEXT, cancel_reason TEXT, service_id TEXT, org_user_id TEXT, guest INTEGER NOT NULL DEFAULT 0, service_snapshot TEXT NOT NULL DEFAULT '{}', commission_percent REAL NOT NULL DEFAULT 15, commission_amount INTEGER NOT NULL DEFAULT 0, professional_net INTEGER NOT NULL DEFAULT 0, response_deadline INTEGER, payment_deadline INTEGER, paid_at INTEGER, confirmed_at INTEGER, terms_accepted_at INTEGER, terms_version TEXT, duration_minutes INTEGER NOT NULL DEFAULT 60, prep_minutes INTEGER NOT NULL DEFAULT 0, followup_minutes INTEGER NOT NULL DEFAULT 0, start_at INTEGER, end_at INTEGER, refund_policy_percent REAL NOT NULL DEFAULT 80, cancellation_status TEXT, policy_snapshot TEXT, delivery_evidence TEXT, retained_amount INTEGER NOT NULL DEFAULT 0, retention_destination TEXT,
  FOREIGN KEY(professional_id) REFERENCES professionals(id)
);

CREATE TABLE case_events(id TEXT PRIMARY KEY, case_id TEXT NOT NULL, actor TEXT, kind TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE evaluations (
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

CREATE TABLE guest_requests (
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
  handled_at INTEGER, assigned_to TEXT DEFAULT '', service_id TEXT,
  FOREIGN KEY(professional_id) REFERENCES professionals(id)
);

CREATE TABLE incidents (
        id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
        author_id TEXT, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'abierta',
        resolution TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER
      , category TEXT NOT NULL DEFAULT 'otro', requested_remedy TEXT NOT NULL DEFAULT 'revision', assigned_to TEXT, response_due INTEGER, resolution_due INTEGER, outcome TEXT, evidence TEXT, appeals INTEGER NOT NULL DEFAULT 0);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  sender_role TEXT NOT NULL,   -- organizacion | profesional | admin
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(booking_id) REFERENCES bookings(id)
);

CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, subject TEXT NOT NULL,
        body TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      , attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT, dedupe_key TEXT);

CREATE TABLE payments (
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
  currency TEXT DEFAULT 'CLP', refund_amount INTEGER, refund_id TEXT, refunded_at INTEGER, expected_currency TEXT, expected_amount REAL, operation_key TEXT,
  FOREIGN KEY(booking_id) REFERENCES bookings(id)
);

CREATE TABLE payouts(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL UNIQUE,amount INTEGER NOT NULL,status TEXT NOT NULL,reference TEXT UNIQUE,evidence_id TEXT,created_at INTEGER NOT NULL,confirmed_at INTEGER);

CREATE TABLE professionals (
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
, max_per_day INTEGER, max_per_week INTEGER, max_per_month INTEGER, duration_minutes INTEGER DEFAULT 60, prep_minutes INTEGER DEFAULT 0, followup_minutes INTEGER DEFAULT 0, assigned_to TEXT DEFAULT '', blocked_dates TEXT NOT NULL DEFAULT '[]', work_start TEXT NOT NULL DEFAULT '08:00', work_end TEXT NOT NULL DEFAULT '19:00', booking_suspended INTEGER NOT NULL DEFAULT 0, suspension_reason TEXT NOT NULL DEFAULT '');

CREATE TABLE refund_operations(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL,payment_id TEXT NOT NULL,amount INTEGER NOT NULL,percent REAL NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,reference TEXT,evidence TEXT,created_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'cancelacion');

CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);

CREATE TABLE service_appeals(id TEXT PRIMARY KEY,service_id TEXT NOT NULL REFERENCES services(id),revision TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'abierta',body TEXT NOT NULL,contact TEXT NOT NULL,due_at INTEGER NOT NULL,assigned_to TEXT,resolution TEXT,created_at INTEGER NOT NULL);

CREATE TABLE services (
        id TEXT PRIMARY KEY, professional_id TEXT NOT NULL REFERENCES professionals(id),
        published TEXT, draft TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente',
        admin_notes TEXT NOT NULL DEFAULT '', commission_percent REAL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );

CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT, guest_booking_id TEXT,
        audience TEXT NOT NULL, expires_at INTEGER NOT NULL
      );

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  admin_weekly_review_capacity INTEGER NOT NULL DEFAULT 3,
  default_cancellation_refund_percent INTEGER NOT NULL DEFAULT 80
, commission_percent REAL NOT NULL DEFAULT 15, response_hours INTEGER NOT NULL DEFAULT 24, payment_hours INTEGER NOT NULL DEFAULT 24);

CREATE TABLE users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','profesional','organizacion')),
        professional_id TEXT, active INTEGER NOT NULL DEFAULT 1, verified INTEGER NOT NULL DEFAULT 0,
        profile TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
      );
CREATE INDEX bookings_prof_date ON bookings(professional_id,date);
CREATE INDEX messages_booking ON messages(booking_id,created_at);
CREATE UNIQUE INDEX outbox_dedupe ON outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX refund_booking_pending ON refund_operations(booking_id) WHERE status IN ('procesando','revision','completado');
INSERT INTO settings(id,admin_weekly_review_capacity,default_cancellation_refund_percent) VALUES(1,3,80);
COMMIT;
