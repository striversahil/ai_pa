-- 0053_email.sql — modular email service (send now, drafts, scheduled).
-- Accounts hold identity only; OAuth tokens live in CACHE_KV
-- (email:oauth:<accountId>) — never in D1, never in responses.
-- Outbox rows are claimed CAS (status queued->sending) by the per-minute
-- worker cron tick; daily repeats reschedule themselves after send.

CREATE TABLE IF NOT EXISTS EmailAccount (
  id        TEXT PRIMARY KEY,
  label     TEXT NOT NULL,
  email     TEXT NOT NULL,
  provider  TEXT NOT NULL DEFAULT 'gmail',
  status    TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS EmailOutbox (
  id            TEXT PRIMARY KEY,
  accountId     TEXT NOT NULL REFERENCES EmailAccount(id),
  toAddrs       TEXT NOT NULL,
  cc            TEXT NOT NULL DEFAULT '[]',
  bcc           TEXT NOT NULL DEFAULT '[]',
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  isHtml        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'queued',
  dueAt         INTEGER NOT NULL,
  repeatDailyAt TEXT NOT NULL DEFAULT '',
  attempts      INTEGER NOT NULL DEFAULT 0,
  lastError     TEXT NOT NULL DEFAULT '',
  createdAt     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_emailoutbox_due ON EmailOutbox(status, dueAt);

CREATE TABLE IF NOT EXISTS EmailLog (
  id        TEXT PRIMARY KEY,
  accountId TEXT NOT NULL DEFAULT '',
  action    TEXT NOT NULL,
  toAddrs   TEXT NOT NULL DEFAULT '[]',
  subject   TEXT NOT NULL DEFAULT '',
  gmailId   TEXT NOT NULL DEFAULT '',
  ok        INTEGER NOT NULL DEFAULT 1,
  error     TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_emaillog_created ON EmailLog(createdAt);
