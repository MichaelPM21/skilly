const { db } = require('./db');

function columns(table, definitions) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  for (const [name, type] of Object.entries(definitions)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

function migrate() {
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','profesional','organizacion')),
        professional_id TEXT, active INTEGER NOT NULL DEFAULT 1, verified INTEGER NOT NULL DEFAULT 0,
        profile TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT, guest_booking_id TEXT,
        audience TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS access_tokens (
        token_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, subject TEXT NOT NULL,
        expires_at INTEGER NOT NULL, used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY, professional_id TEXT NOT NULL REFERENCES professionals(id),
        published TEXT, draft TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente',
        admin_notes TEXT NOT NULL DEFAULT '', commission_percent REAL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
        author_id TEXT, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'abierta',
        resolution TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
        name TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT NOT NULL,
        target TEXT, detail TEXT, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL, subject TEXT NOT NULL,
        body TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS bookings_prof_date ON bookings(professional_id,date);
      CREATE INDEX IF NOT EXISTS messages_booking ON messages(booking_id,created_at);
    `);
    columns('professionals', { blocked_dates: "TEXT NOT NULL DEFAULT '[]'", work_start: "TEXT NOT NULL DEFAULT '08:00'", work_end: "TEXT NOT NULL DEFAULT '19:00'" });
    columns('settings', { commission_percent: 'REAL NOT NULL DEFAULT 15', response_hours: 'INTEGER NOT NULL DEFAULT 24', payment_hours: 'INTEGER NOT NULL DEFAULT 24' });
    columns('bookings', {
      service_id: 'TEXT', org_user_id: 'TEXT', guest: 'INTEGER NOT NULL DEFAULT 0',
      service_snapshot: "TEXT NOT NULL DEFAULT '{}'", commission_percent: 'REAL NOT NULL DEFAULT 15',
      commission_amount: 'INTEGER NOT NULL DEFAULT 0', professional_net: 'INTEGER NOT NULL DEFAULT 0',
      response_deadline: 'INTEGER', payment_deadline: 'INTEGER', paid_at: 'INTEGER',
      confirmed_at: 'INTEGER', terms_accepted_at: 'INTEGER', terms_version: 'TEXT',
      duration_minutes: 'INTEGER NOT NULL DEFAULT 60', prep_minutes: 'INTEGER NOT NULL DEFAULT 0',
      followup_minutes: 'INTEGER NOT NULL DEFAULT 0', start_at: 'INTEGER', end_at: 'INTEGER',
      refund_policy_percent: 'REAL NOT NULL DEFAULT 80', cancellation_status: 'TEXT'
    });
    columns('payments', { expected_currency: 'TEXT', expected_amount: 'REAL', operation_key: 'TEXT' });
    columns('guest_requests', { service_id: 'TEXT' });
    columns('bookings', {policy_snapshot:'TEXT',delivery_evidence:'TEXT',retained_amount:'INTEGER NOT NULL DEFAULT 0',retention_destination:'TEXT'});
    columns('professionals', {booking_suspended:'INTEGER NOT NULL DEFAULT 0',suspension_reason:"TEXT NOT NULL DEFAULT ''"});
    columns('incidents', {category:"TEXT NOT NULL DEFAULT 'otro'",requested_remedy:"TEXT NOT NULL DEFAULT 'revision'",assigned_to:'TEXT',response_due:'INTEGER',resolution_due:'INTEGER',outcome:'TEXT',evidence:'TEXT',appeals:'INTEGER NOT NULL DEFAULT 0'});
    columns('outbox', {attempts:'INTEGER NOT NULL DEFAULT 0',next_attempt_at:'INTEGER NOT NULL DEFAULT 0',lease_until:'INTEGER NOT NULL DEFAULT 0',last_error:'TEXT',dedupe_key:'TEXT'});
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe ON outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS case_events(id TEXT PRIMARY KEY, case_id TEXT NOT NULL, actor TEXT, kind TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS service_appeals(id TEXT PRIMARY KEY,service_id TEXT NOT NULL REFERENCES services(id),revision TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'abierta',body TEXT NOT NULL,contact TEXT NOT NULL,due_at INTEGER NOT NULL,assigned_to TEXT,resolution TEXT,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS refund_operations(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL,payment_id TEXT NOT NULL,amount INTEGER NOT NULL,percent REAL NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,reference TEXT,evidence TEXT,created_at INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS refund_booking_pending ON refund_operations(booking_id) WHERE status IN ('procesando','revision','completado');
      CREATE TABLE IF NOT EXISTS payouts(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL UNIQUE,amount INTEGER NOT NULL,status TEXT NOT NULL,reference TEXT UNIQUE,evidence_id TEXT,created_at INTEGER NOT NULL,confirmed_at INTEGER);
    `);
    columns('refund_operations', {kind:"TEXT NOT NULL DEFAULT 'cancelacion'"});
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get('roles-services-v2')) {
      for (const p of db.prepare('SELECT * FROM professionals').all()) {
        const service = JSON.stringify({ title: p.title, description: p.description, category: p.category,
          price: Number(String(p.price || '').replace(/[^0-9]/g, '')) || 0, modality: p.modality,
          tags: JSON.parse(p.tags || '[]'), durationMinutes: p.duration_minutes || 60,
          prepMinutes: p.prep_minutes || 0, followupMinutes: p.followup_minutes || 0 });
        db.prepare('INSERT INTO services(id,professional_id,published,draft,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
          .run('svc_' + p.id, p.id, p.status === 'validado' ? service : null, service, p.status, p.created_at, Date.now());
        db.prepare(`UPDATE bookings SET service_id=?, duration_minutes=?, prep_minutes=?, followup_minutes=?,
          service_snapshot=?, commission_amount=ROUND(amount*0.15), professional_net=amount-ROUND(amount*0.15),
          paid_at=CASE WHEN EXISTS(SELECT 1 FROM payments WHERE booking_id=bookings.id AND status IN ('pagado','liberado','reembolsado')) THEN created_at ELSE NULL END
          WHERE professional_id=?`).run('svc_' + p.id, p.duration_minutes || 60, p.prep_minutes || 0, p.followup_minutes || 0, service, p.id);
      }
      const {timestamp}=require('./scheduling');
      const settings=db.prepare('SELECT * FROM settings WHERE id=1').get();
      for(const b of db.prepare('SELECT * FROM bookings').all()) {
        try {
          const start=timestamp(b.date,b.time)-(b.prep_minutes||0)*60000;
          const end=timestamp(b.date,b.time)+((b.duration_minutes||60)+(b.followup_minutes||0))*60000;
          const deadline=Math.min(Date.now()+settings.response_hours*3600000,start);
          db.prepare("UPDATE bookings SET start_at=?,end_at=?,refund_policy_percent=?,response_deadline=?,status=CASE WHEN status='reservado' THEN 'solicitado' ELSE status END WHERE id=?").run(start,end,settings.default_cancellation_refund_percent,b.status==='reservado'?deadline:null,b.id);
        } catch { /* Keep malformed historical dates visible for manual review. */ }
      }
      db.prepare('UPDATE bookings SET guest=1 WHERE id IN (SELECT booking_id FROM guest_requests WHERE booking_id IS NOT NULL)').run();
      // Historical rows remain intact; ownership is linked only after email verification.
      db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('roles-services-v2', Date.now());
    }
  }).immediate();
}
module.exports = { migrate };
