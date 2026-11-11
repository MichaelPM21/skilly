-- SQLite: ejercicio de reconstrucción en una base desechable. NO ejecutar sobre datos de trabajo.
CREATE INDEX bookings_prof_date ON bookings(professional_id,date);
CREATE INDEX messages_booking ON messages(booking_id,created_at);
CREATE UNIQUE INDEX outbox_dedupe ON outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE UNIQUE INDEX refund_booking_pending ON refund_operations(booking_id) WHERE status IN ('procesando','revision','completado');
