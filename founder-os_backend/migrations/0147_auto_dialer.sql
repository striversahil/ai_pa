-- 0147_auto_dialer.sql — Founder OS auto dialer (Android) on top of 0107 device calls.
--
-- Adds: phone-initiated pairing requests (sales head assigns the agent), the
-- per-agent dialer queue fed by the Controller push, dispositions on device
-- calls, agent breaks, live agent state on the device row, and the push
-- target on the NeoDove push ledger ('neodove' | 'dialer').
--
-- NOTE: ALTER TABLE ... ADD COLUMN is not idempotent in SQLite. Apply once.

CREATE TABLE IF NOT EXISTS DevicePairRequest (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  secretHash    TEXT NOT NULL,
  deviceId      TEXT NOT NULL,
  label         TEXT NOT NULL DEFAULT '',
  agentHint     TEXT NOT NULL DEFAULT '',
  appVersion    TEXT NOT NULL DEFAULT '',
  -- pending | approved | rejected | claimed | expired
  status        TEXT NOT NULL DEFAULT 'pending',
  telecallerId  TEXT,
  -- Plain device token, held only between approval and the phone's claim.
  deliveredToken TEXT,
  decidedBy     TEXT NOT NULL DEFAULT '',
  decidedAt     TEXT,
  expiresAt     TEXT NOT NULL,
  createdAt     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pair_request_status ON DevicePairRequest(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_pair_request_code ON DevicePairRequest(code);

ALTER TABLE DeviceCall ADD COLUMN disposition TEXT NOT NULL DEFAULT '';
ALTER TABLE DeviceCall ADD COLUMN remarks TEXT NOT NULL DEFAULT '';
ALTER TABLE DeviceCall ADD COLUMN callbackAt TEXT;
ALTER TABLE DeviceCall ADD COLUMN queueId TEXT;
ALTER TABLE DeviceCall ADD COLUMN customerId TEXT;
ALTER TABLE DeviceCall ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE DeviceCall ADD COLUMN autoSaved INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_device_call_disposition ON DeviceCall(day, disposition);

CREATE TABLE IF NOT EXISTS DialerQueue (
  id              TEXT PRIMARY KEY,
  telecallerId    TEXT NOT NULL,
  customerId      TEXT NOT NULL DEFAULT '',
  mobile          TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  batchId         TEXT NOT NULL DEFAULT '',
  -- push | retry | callback
  source          TEXT NOT NULL DEFAULT 'push',
  -- pending | done | recalled
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  dueAt           TEXT NOT NULL,
  lastDisposition TEXT NOT NULL DEFAULT '',
  position        INTEGER NOT NULL DEFAULT 0,
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dialer_queue_agent ON DialerQueue(telecallerId, status, dueAt);
CREATE INDEX IF NOT EXISTS idx_dialer_queue_batch ON DialerQueue(batchId);
-- One waiting row per agent + number: a re-push of a waiting lead is skipped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_queue_pending ON DialerQueue(telecallerId, mobile) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS DialerBreak (
  id             TEXT PRIMARY KEY,
  idempotencyKey TEXT NOT NULL,
  deviceId       TEXT NOT NULL,
  telecallerId   TEXT NOT NULL,
  reason         TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  startAt        TEXT NOT NULL,
  endAt          TEXT,
  durationSec    INTEGER NOT NULL DEFAULT 0,
  day            TEXT NOT NULL,
  receivedAt     TEXT NOT NULL,
  updatedAt      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dialer_break_idem ON DialerBreak(idempotencyKey);
CREATE INDEX IF NOT EXISTS idx_dialer_break_agent ON DialerBreak(telecallerId, day);

ALTER TABLE DeviceRegistration ADD COLUMN liveState TEXT NOT NULL DEFAULT '';
ALTER TABLE DeviceRegistration ADD COLUMN liveDetail TEXT NOT NULL DEFAULT '';
ALTER TABLE DeviceRegistration ADD COLUMN liveAt TEXT;
ALTER TABLE DeviceRegistration ADD COLUMN pendingSync INTEGER NOT NULL DEFAULT 0;

ALTER TABLE NeoDovePushBatch ADD COLUMN target TEXT NOT NULL DEFAULT 'neodove';
