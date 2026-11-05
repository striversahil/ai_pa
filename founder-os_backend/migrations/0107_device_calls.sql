-- 0107_device_calls.sql — Android call-recording devices, call events and consent.
--
-- The phone app logs every attempt locally first, then syncs JSON and audio.
-- A device is bound to one Telecaller roster row by a one-time pairing code;
-- only a SHA-256 token hash is stored. Audio lives in the CALL_RECORDINGS R2
-- bucket under calls/<YYYY-MM>/<telecallerId>/... and expires after 90 days.

CREATE TABLE IF NOT EXISTS DeviceRegistration (
  id           TEXT PRIMARY KEY,
  telecallerId TEXT NOT NULL,
  tokenHash    TEXT NOT NULL,
  deviceId     TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active',
  loggingOnly  INTEGER NOT NULL DEFAULT 0,
  consentAt    TEXT,
  lastSeenAt   TEXT,
  appVersion   TEXT NOT NULL DEFAULT '',
  pairedBy     TEXT NOT NULL DEFAULT '',
  pairedByName TEXT NOT NULL DEFAULT '',
  createdAt    TEXT NOT NULL,
  updatedAt    TEXT NOT NULL DEFAULT '',
  revokedAt    TEXT,
  revokedBy    TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_registration_token ON DeviceRegistration(tokenHash);
CREATE INDEX IF NOT EXISTS idx_device_registration_agent ON DeviceRegistration(telecallerId, status);

CREATE TABLE IF NOT EXISTS DevicePairCode (
  code         TEXT PRIMARY KEY,
  telecallerId TEXT NOT NULL,
  expiresAt    TEXT NOT NULL,
  usedAt       TEXT,
  createdBy    TEXT NOT NULL DEFAULT '',
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_device_pair_code_agent ON DevicePairCode(telecallerId);

CREATE TABLE IF NOT EXISTS DeviceCall (
  id                  TEXT PRIMARY KEY,
  deviceId            TEXT NOT NULL,
  telecallerId        TEXT NOT NULL,
  idempotencyKey      TEXT NOT NULL,
  direction           TEXT NOT NULL DEFAULT 'UNKNOWN',
  numberE164          TEXT NOT NULL DEFAULT '',
  numberHash          TEXT NOT NULL DEFAULT '',
  contactName         TEXT NOT NULL DEFAULT '',
  attemptAt           TEXT NOT NULL,
  ringStartAt         TEXT,
  connectAt           TEXT,
  endAt               TEXT,
  status              TEXT NOT NULL DEFAULT 'FAILED',
  callLogType         INTEGER,
  durationSec         INTEGER NOT NULL DEFAULT 0,
  ringSec             INTEGER NOT NULL DEFAULT 0,
  simSlot             INTEGER,
  day                 TEXT NOT NULL,
  recordingState      TEXT NOT NULL DEFAULT 'none',
  recordingKey        TEXT NOT NULL DEFAULT '',
  recordingBytes      INTEGER NOT NULL DEFAULT 0,
  recordingParts      INTEGER NOT NULL DEFAULT 0,
  recordingUploadedAt TEXT,
  audioSource         TEXT NOT NULL DEFAULT '',
  receivedAt          TEXT NOT NULL,
  createdAt           TEXT NOT NULL,
  updatedAt           TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_call_idem ON DeviceCall(idempotencyKey);
CREATE INDEX IF NOT EXISTS idx_device_call_agent_time ON DeviceCall(telecallerId, attemptAt);
CREATE INDEX IF NOT EXISTS idx_device_call_day ON DeviceCall(day);
CREATE INDEX IF NOT EXISTS idx_device_call_number ON DeviceCall(numberHash);
CREATE INDEX IF NOT EXISTS idx_device_call_device ON DeviceCall(deviceId);

-- Call source for the leaderboard: neodove | manual | device. Seed from the
-- temporary manual switch so current behaviour is preserved.
INSERT OR IGNORE INTO Setting(key, value, updatedAt)
SELECT 'call_source',
       CASE WHEN lower(trim(value)) = 'manual' THEN 'manual' ELSE 'neodove' END,
       datetime('now')
FROM Setting WHERE key = 'manual_calls_mode';
INSERT OR IGNORE INTO Setting(key, value, updatedAt) VALUES ('call_source', 'neodove', datetime('now'));
