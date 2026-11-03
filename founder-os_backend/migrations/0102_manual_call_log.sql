-- 0102_manual_call_log.sql — TEMPORARY manual connected-call log.
--
-- Backfill while NeoDove is unreliable: one row per (agent, IST day) with the
-- hand-counted connected calls + screenshot proof (bytes in CHAT_FILES KV,
-- `manualcalls/<id>/...`; this row holds metadata only). The leaderboard reads
-- these rows INSTEAD of NeoDove while Setting `manual_calls_mode` = 'manual'.
-- Delete this table + the Setting row when NeoDove is trusted again.

CREATE TABLE IF NOT EXISTS ManualCallLog (
  id              TEXT PRIMARY KEY,
  telecallerId    TEXT NOT NULL,
  day             TEXT NOT NULL, -- YYYY-MM-DD IST
  connectedCalls  INTEGER NOT NULL DEFAULT 0,
  note            TEXT NOT NULL DEFAULT '',
  screenshotKvKey TEXT NOT NULL DEFAULT '',
  screenshotName  TEXT NOT NULL DEFAULT '',
  screenshotMime  TEXT NOT NULL DEFAULT '',
  screenshotSize  INTEGER NOT NULL DEFAULT 0,
  createdBy       TEXT NOT NULL DEFAULT '',
  createdByName   TEXT NOT NULL DEFAULT '',
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL DEFAULT '',
  UNIQUE (telecallerId, day)
);

CREATE INDEX IF NOT EXISTS idx_manual_call_log_day ON ManualCallLog(day);
CREATE INDEX IF NOT EXISTS idx_manual_call_log_agent ON ManualCallLog(telecallerId);
