-- 0160_product_rate_batch.sql — a trace for every bulk rate paste.
--
-- Founder decision 2026-11-23 (v3): a paste lands many quotes at once, so it
-- must be reviewable as a unit — "delete everything that paste added", "what
-- did we reject", "who imported it, when". `VendorRate.batchId` already exists
-- (legacy column, unused since the 2026-11-22 wipe); this table gives it a
-- record. Single manual creates stay batch-less.
--
-- Re-runnable: IF NOT EXISTS everywhere.
CREATE TABLE IF NOT EXISTS RateBatch (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL DEFAULT 'ai_paste',
  actorId       TEXT,
  actorName     TEXT,
  label         TEXT,
  rowCount      INTEGER NOT NULL DEFAULT 0,
  createdCount  INTEGER NOT NULL DEFAULT 0,
  failedCount   INTEGER NOT NULL DEFAULT 0,
  vendorNames   TEXT,
  failures      TEXT,
  status        TEXT NOT NULL DEFAULT 'done',
  createdAt     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ratebatch_created ON RateBatch (createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_vendorrate_batch ON VendorRate (batchId);
