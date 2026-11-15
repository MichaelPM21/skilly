-- PostgreSQL. Scripts académicos para una base DESECHABLE; no ejecutar DROP sobre la base de trabajo.
DROP TABLE access_tokens, attachments, audit_log, bookings, case_events, evaluations, guest_requests, incidents, messages, outbox, payments, payouts, professionals, refund_operations, schema_migrations, service_appeals, services, sessions, settings, users CASCADE;
