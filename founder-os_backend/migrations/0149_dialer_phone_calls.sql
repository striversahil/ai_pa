-- Auto dialer follow-ups (2026-11-21).
-- origin: '' = placed by the auto dialer / app, 'phone' = made or received in the
-- phone's own dialer and picked up from the Android call log.
ALTER TABLE DeviceCall ADD COLUMN origin TEXT NOT NULL DEFAULT '';
-- DialerQueue.status gains 'unreachable' (retry cap reached); TEXT column, no DDL.
CREATE INDEX IF NOT EXISTS idx_dialer_queue_status ON DialerQueue(status, updatedAt);
