-- SQLite: ejercicio de reconstrucción en una base desechable. NO ejecutar sobre datos de trabajo.
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "e3_rebuild_access_tokens" (
        token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, subject TEXT NOT NULL,
        expires_at INTEGER NOT NULL, used_at INTEGER
      );
INSERT INTO "e3_rebuild_access_tokens" ("token_hash","purpose","subject","expires_at","used_at") SELECT "token_hash","purpose","subject","expires_at","used_at" FROM "access_tokens";
DROP TABLE "access_tokens";
ALTER TABLE "e3_rebuild_access_tokens" RENAME TO "access_tokens";

CREATE TABLE "e3_rebuild_attachments" (
        id TEXT PRIMARY KEY, booking_id TEXT NOT NULL,
        name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL
      );
INSERT INTO "e3_rebuild_attachments" ("id","booking_id","name","mime","data","created_by","created_at") SELECT "id","booking_id","name","mime","data","created_by","created_at" FROM "attachments";
DROP TABLE "attachments";
ALTER TABLE "e3_rebuild_attachments" RENAME TO "attachments";

CREATE TABLE "e3_rebuild_audit_log" (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT NOT NULL,
        target TEXT, detail TEXT, created_at INTEGER NOT NULL
      );
INSERT INTO "e3_rebuild_audit_log" ("id","actor","action","target","detail","created_at") SELECT "id","actor","action","target","detail","created_at" FROM "audit_log";
DROP TABLE "audit_log";
ALTER TABLE "e3_rebuild_audit_log" RENAME TO "audit_log";

CREATE TABLE "e3_rebuild_bookings" (
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
  delivered_at INTEGER, refund_amount INTEGER, refund_percent INTEGER, cancelled_at INTEGER, cancelled_by TEXT, cancel_reason TEXT, service_id TEXT, org_user_id TEXT, guest INTEGER NOT NULL DEFAULT 0, service_snapshot TEXT NOT NULL DEFAULT '{}', commission_percent REAL NOT NULL DEFAULT 15, commission_amount INTEGER NOT NULL DEFAULT 0, professional_net INTEGER NOT NULL DEFAULT 0, response_deadline INTEGER, payment_deadline INTEGER, paid_at INTEGER, confirmed_at INTEGER, terms_accepted_at INTEGER, terms_version TEXT, duration_minutes INTEGER NOT NULL DEFAULT 60, prep_minutes INTEGER NOT NULL DEFAULT 0, followup_minutes INTEGER NOT NULL DEFAULT 0, start_at INTEGER, end_at INTEGER, refund_policy_percent REAL NOT NULL DEFAULT 80, cancellation_status TEXT, policy_snapshot TEXT, delivery_evidence TEXT, retained_amount INTEGER NOT NULL DEFAULT 0, retention_destination TEXT
);
INSERT INTO "e3_rebuild_bookings" ("id","professional_id","professional_name","professional_email","org_name","org_email","date","time","service","notes","amount","status","created_at","delivered_at","refund_amount","refund_percent","cancelled_at","cancelled_by","cancel_reason","service_id","org_user_id","guest","service_snapshot","commission_percent","commission_amount","professional_net","response_deadline","payment_deadline","paid_at","confirmed_at","terms_accepted_at","terms_version","duration_minutes","prep_minutes","followup_minutes","start_at","end_at","refund_policy_percent","cancellation_status","policy_snapshot","delivery_evidence","retained_amount","retention_destination") SELECT "id","professional_id","professional_name","professional_email","org_name","org_email","date","time","service","notes","amount","status","created_at","delivered_at","refund_amount","refund_percent","cancelled_at","cancelled_by","cancel_reason","service_id","org_user_id","guest","service_snapshot","commission_percent","commission_amount","professional_net","response_deadline","payment_deadline","paid_at","confirmed_at","terms_accepted_at","terms_version","duration_minutes","prep_minutes","followup_minutes","start_at","end_at","refund_policy_percent","cancellation_status","policy_snapshot","delivery_evidence","retained_amount","retention_destination" FROM "bookings";
DROP TABLE "bookings";
ALTER TABLE "e3_rebuild_bookings" RENAME TO "bookings";

CREATE TABLE "e3_rebuild_case_events"(id TEXT PRIMARY KEY, case_id TEXT NOT NULL, actor TEXT, kind TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
INSERT INTO "e3_rebuild_case_events" ("id","case_id","actor","kind","body","created_at") SELECT "id","case_id","actor","kind","body","created_at" FROM "case_events";
DROP TABLE "case_events";
ALTER TABLE "e3_rebuild_case_events" RENAME TO "case_events";

CREATE TABLE "e3_rebuild_evaluations" (
  id TEXT PRIMARY KEY,
  professional_id TEXT NOT NULL,
  professional_name TEXT,
  booking_id TEXT,
  org_name TEXT,
  org_email TEXT,
  stars INTEGER NOT NULL,
  comment TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO "e3_rebuild_evaluations" ("id","professional_id","professional_name","booking_id","org_name","org_email","stars","comment","created_at") SELECT "id","professional_id","professional_name","booking_id","org_name","org_email","stars","comment","created_at" FROM "evaluations";
DROP TABLE "evaluations";
ALTER TABLE "e3_rebuild_evaluations" RENAME TO "evaluations";

CREATE TABLE "e3_rebuild_guest_requests" (
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
  handled_at INTEGER, assigned_to TEXT DEFAULT '', service_id TEXT
);
INSERT INTO "e3_rebuild_guest_requests" ("id","professional_id","professional_name","contact_name","org_name","email","phone","date","time","notes","status","admin_notes","booking_id","email_sent","created_at","handled_at","assigned_to","service_id") SELECT "id","professional_id","professional_name","contact_name","org_name","email","phone","date","time","notes","status","admin_notes","booking_id","email_sent","created_at","handled_at","assigned_to","service_id" FROM "guest_requests";
DROP TABLE "guest_requests";
ALTER TABLE "e3_rebuild_guest_requests" RENAME TO "guest_requests";

CREATE TABLE "e3_rebuild_incidents" (
        id TEXT PRIMARY KEY, booking_id TEXT NOT NULL,
        author_id TEXT, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'abierta',
        resolution TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER
      , category TEXT NOT NULL DEFAULT 'otro', requested_remedy TEXT NOT NULL DEFAULT 'revision', assigned_to TEXT, response_due INTEGER, resolution_due INTEGER, outcome TEXT, evidence TEXT, appeals INTEGER NOT NULL DEFAULT 0);
INSERT INTO "e3_rebuild_incidents" ("id","booking_id","author_id","body","status","resolution","created_at","resolved_at","category","requested_remedy","assigned_to","response_due","resolution_due","outcome","evidence","appeals") SELECT "id","booking_id","author_id","body","status","resolution","created_at","resolved_at","category","requested_remedy","assigned_to","response_due","resolution_due","outcome","evidence","appeals" FROM "incidents";
DROP TABLE "incidents";
ALTER TABLE "e3_rebuild_incidents" RENAME TO "incidents";

CREATE TABLE "e3_rebuild_messages" (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  sender_role TEXT NOT NULL,   -- organizacion | profesional | admin
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO "e3_rebuild_messages" ("id","booking_id","sender_role","sender_name","body","created_at") SELECT "id","booking_id","sender_role","sender_name","body","created_at" FROM "messages";
DROP TABLE "messages";
ALTER TABLE "e3_rebuild_messages" RENAME TO "messages";

CREATE TABLE "e3_rebuild_outbox" (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, subject TEXT NOT NULL,
        body TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      , attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT, dedupe_key TEXT);
INSERT INTO "e3_rebuild_outbox" ("id","recipient","subject","body","sent","created_at","attempts","next_attempt_at","lease_until","last_error","dedupe_key") SELECT "id","recipient","subject","body","sent","created_at","attempts","next_attempt_at","lease_until","last_error","dedupe_key" FROM "outbox";
DROP TABLE "outbox";
ALTER TABLE "e3_rebuild_outbox" RENAME TO "outbox";

CREATE TABLE "e3_rebuild_payments" (
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
  currency TEXT DEFAULT 'CLP', refund_amount INTEGER, refund_id TEXT, refunded_at INTEGER, expected_currency TEXT, expected_amount REAL, operation_key TEXT
);
INSERT INTO "e3_rebuild_payments" ("id","booking_id","professional_id","professional_name","org_name","org_email","amount","method","status","invoice_number","created_at","released_at","provider","provider_token","buy_order","authorization_code","card_last4","payment_type_code","currency","refund_amount","refund_id","refunded_at","expected_currency","expected_amount","operation_key") SELECT "id","booking_id","professional_id","professional_name","org_name","org_email","amount","method","status","invoice_number","created_at","released_at","provider","provider_token","buy_order","authorization_code","card_last4","payment_type_code","currency","refund_amount","refund_id","refunded_at","expected_currency","expected_amount","operation_key" FROM "payments";
DROP TABLE "payments";
ALTER TABLE "e3_rebuild_payments" RENAME TO "payments";

CREATE TABLE "e3_rebuild_payouts"(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL UNIQUE,amount INTEGER NOT NULL,status TEXT NOT NULL,reference TEXT UNIQUE,evidence_id TEXT,created_at INTEGER NOT NULL,confirmed_at INTEGER);
INSERT INTO "e3_rebuild_payouts" ("id","booking_id","amount","status","reference","evidence_id","created_at","confirmed_at") SELECT "id","booking_id","amount","status","reference","evidence_id","created_at","confirmed_at" FROM "payouts";
DROP TABLE "payouts";
ALTER TABLE "e3_rebuild_payouts" RENAME TO "payouts";

CREATE TABLE "e3_rebuild_professionals" (
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
INSERT INTO "e3_rebuild_professionals" ("id","name","email","category","title","description","tags","price","modality","status","recommended","admin_notes","validation","availability","created_at","reviewed_at","max_per_day","max_per_week","max_per_month","duration_minutes","prep_minutes","followup_minutes","assigned_to","blocked_dates","work_start","work_end","booking_suspended","suspension_reason") SELECT "id","name","email","category","title","description","tags","price","modality","status","recommended","admin_notes","validation","availability","created_at","reviewed_at","max_per_day","max_per_week","max_per_month","duration_minutes","prep_minutes","followup_minutes","assigned_to","blocked_dates","work_start","work_end","booking_suspended","suspension_reason" FROM "professionals";
DROP TABLE "professionals";
ALTER TABLE "e3_rebuild_professionals" RENAME TO "professionals";

CREATE TABLE "e3_rebuild_refund_operations"(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL,payment_id TEXT NOT NULL,amount INTEGER NOT NULL,percent REAL NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,reference TEXT,evidence TEXT,created_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'cancelacion');
INSERT INTO "e3_rebuild_refund_operations" ("id","booking_id","payment_id","amount","percent","reason","status","reference","evidence","created_at","kind") SELECT "id","booking_id","payment_id","amount","percent","reason","status","reference","evidence","created_at","kind" FROM "refund_operations";
DROP TABLE "refund_operations";
ALTER TABLE "e3_rebuild_refund_operations" RENAME TO "refund_operations";

CREATE TABLE "e3_rebuild_schema_migrations" (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
INSERT INTO "e3_rebuild_schema_migrations" ("version","applied_at") SELECT "version","applied_at" FROM "schema_migrations";
DROP TABLE "schema_migrations";
ALTER TABLE "e3_rebuild_schema_migrations" RENAME TO "schema_migrations";

CREATE TABLE "e3_rebuild_service_appeals"(id TEXT PRIMARY KEY,service_id TEXT NOT NULL,revision TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'abierta',body TEXT NOT NULL,contact TEXT NOT NULL,due_at INTEGER NOT NULL,assigned_to TEXT,resolution TEXT,created_at INTEGER NOT NULL);
INSERT INTO "e3_rebuild_service_appeals" ("id","service_id","revision","status","body","contact","due_at","assigned_to","resolution","created_at") SELECT "id","service_id","revision","status","body","contact","due_at","assigned_to","resolution","created_at" FROM "service_appeals";
DROP TABLE "service_appeals";
ALTER TABLE "e3_rebuild_service_appeals" RENAME TO "service_appeals";

CREATE TABLE "e3_rebuild_services" (
        id TEXT PRIMARY KEY, professional_id TEXT NOT NULL,
        published TEXT, draft TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente',
        admin_notes TEXT NOT NULL DEFAULT '', commission_percent REAL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
INSERT INTO "e3_rebuild_services" ("id","professional_id","published","draft","status","admin_notes","commission_percent","created_at","updated_at") SELECT "id","professional_id","published","draft","status","admin_notes","commission_percent","created_at","updated_at" FROM "services";
DROP TABLE "services";
ALTER TABLE "e3_rebuild_services" RENAME TO "services";

CREATE TABLE "e3_rebuild_sessions" (
        token_hash TEXT PRIMARY KEY, user_id TEXT, guest_booking_id TEXT,
        audience TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
INSERT INTO "e3_rebuild_sessions" ("token_hash","user_id","guest_booking_id","audience","expires_at") SELECT "token_hash","user_id","guest_booking_id","audience","expires_at" FROM "sessions";
DROP TABLE "sessions";
ALTER TABLE "e3_rebuild_sessions" RENAME TO "sessions";

CREATE TABLE "e3_rebuild_settings" (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  admin_weekly_review_capacity INTEGER NOT NULL DEFAULT 3,
  default_cancellation_refund_percent INTEGER NOT NULL DEFAULT 80
, commission_percent REAL NOT NULL DEFAULT 15, response_hours INTEGER NOT NULL DEFAULT 24, payment_hours INTEGER NOT NULL DEFAULT 24);
INSERT INTO "e3_rebuild_settings" ("id","admin_weekly_review_capacity","default_cancellation_refund_percent","commission_percent","response_hours","payment_hours") SELECT "id","admin_weekly_review_capacity","default_cancellation_refund_percent","commission_percent","response_hours","payment_hours" FROM "settings";
DROP TABLE "settings";
ALTER TABLE "e3_rebuild_settings" RENAME TO "settings";

CREATE TABLE "e3_rebuild_users" (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','profesional','organizacion')),
        professional_id TEXT, active INTEGER NOT NULL DEFAULT 1, verified INTEGER NOT NULL DEFAULT 0,
        profile TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
      );
INSERT INTO "e3_rebuild_users" ("id","email","name","password_hash","role","professional_id","active","verified","profile","created_at") SELECT "id","email","name","password_hash","role","professional_id","active","verified","profile","created_at" FROM "users";
DROP TABLE "users";
ALTER TABLE "e3_rebuild_users" RENAME TO "users";
COMMIT;
PRAGMA foreign_keys=ON;
