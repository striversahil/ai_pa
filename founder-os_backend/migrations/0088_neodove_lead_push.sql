-- 0088_neodove_lead_push.sql — NeoDove campaign lead pushes.
--
-- The Customer Master (migration 0087) is the source of truth for who to call.
-- This migration adds the outbound ledger: one batch per "push this region +
-- state" action, one row per lead attempt. Rows are APPEND-ONLY on purpose —
-- the founder's decision is "resend everything", so a repeat push must create
-- fresh attempt rows rather than upsert over history.
--
-- MasterCustomer is never mutated by a push; it only records that a batch ran.

CREATE TABLE IF NOT EXISTS NeoDovePushBatch (
  id               TEXT PRIMARY KEY,
  region           TEXT NOT NULL DEFAULT '',
  state            TEXT NOT NULL DEFAULT '',
  -- dry-run | live — a dry-run validates the whole list but makes no network call.
  mode             TEXT NOT NULL DEFAULT 'dry-run',
  -- queued | running | done | failed
  status           TEXT NOT NULL DEFAULT 'queued',
  total            INTEGER NOT NULL DEFAULT 0,
  -- Pushable leads resolved at creation (what a live run would send).
  planned          INTEGER NOT NULL DEFAULT 0,
  sent             INTEGER NOT NULL DEFAULT 0,
  failed           INTEGER NOT NULL DEFAULT 0,
  skipped          INTEGER NOT NULL DEFAULT 0,
  pending          INTEGER NOT NULL DEFAULT 0,
  requestedBy      TEXT NOT NULL DEFAULT '',
  requestedByName  TEXT NOT NULL DEFAULT '',
  -- host only (never the integration path/UUID) so the ledger cannot leak the secret.
  campaignHost     TEXT NOT NULL DEFAULT '',
  detail1          TEXT NOT NULL DEFAULT '',
  error            TEXT,
  createdAt        TEXT NOT NULL,
  updatedAt        TEXT NOT NULL,
  finishedAt       TEXT
);

CREATE TABLE IF NOT EXISTS NeoDoveLeadPush (
  id               TEXT PRIMARY KEY,
  batchId          TEXT NOT NULL,
  customerId       TEXT NOT NULL,
  zohoCustomerId   TEXT NOT NULL DEFAULT '',
  region           TEXT NOT NULL DEFAULT '',
  state            TEXT NOT NULL DEFAULT '',
  mobile           TEXT NOT NULL DEFAULT '',
  name             TEXT NOT NULL DEFAULT '',
  email            TEXT NOT NULL DEFAULT '',
  -- pending | sent | failed | skipped
  status           TEXT NOT NULL DEFAULT 'pending',
  skipReason       TEXT,
  httpStatus       INTEGER,
  responseText     TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0,
  -- Set when a runner claims the row ('sending'); a stale claim is recycled.
  claimedAt        TEXT,
  pushedAt         TEXT,
  createdAt        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_neodove_lead_batch ON NeoDoveLeadPush(batchId, status);
CREATE INDEX IF NOT EXISTS idx_neodove_batch_state ON NeoDovePushBatch(region, state, createdAt);
CREATE INDEX IF NOT EXISTS idx_neodove_batch_status ON NeoDovePushBatch(status, createdAt);
