-- PostgreSQL. Scripts académicos para una base DESECHABLE; no ejecutar DROP sobre la base de trabajo.
CREATE INDEX bookings_prof_date ON bookings(professional_id,date);
CREATE INDEX messages_booking ON messages(booking_id,created_at);
CREATE UNIQUE INDEX outbox_dedupe ON outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX refund_booking_pending ON refund_operations(booking_id) WHERE status IN ('procesando','revision','completado');
CREATE UNIQUE INDEX users_email_ci ON users (lower(email));
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX payments_booking ON payments(booking_id);
CREATE INDEX bookings_org ON bookings(org_user_id);
CREATE INDEX events_case_sequence ON case_events(case_id,event_sequence);
