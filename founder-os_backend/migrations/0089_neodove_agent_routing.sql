-- 0089_neodove_agent_routing.sql — per-agent campaign routing.
--
-- Replaces the one-URL-per-region model with one URL per NeoDove AGENT. Each
-- region has a pair of agents (see MasterRegion.allottedName); a push can go to
-- one named agent or be split across the pair.
--
-- The URLs themselves are NOT stored here — they are Worker secrets, because
-- the custom-integration URL embeds a UUID that grants lead-creation rights.
-- This table only records which secret holds which agent's URL.
--
-- NOTE: the ALTER TABLE statements are not idempotent (SQLite has no
-- ADD COLUMN IF NOT EXISTS). Apply once.

CREATE TABLE IF NOT EXISTS NeoDoveAgent (
  id          TEXT PRIMARY KEY,          -- stable routing key, e.g. R1_NEHA_VERMA
  region      TEXT NOT NULL,             -- R1..R4
  name        TEXT NOT NULL,             -- display name
  -- Name of the Worker secret holding this agent's campaign URL.
  secretName  TEXT NOT NULL,
  -- Deactivating keeps ledgers readable and lets in-flight batches finish.
  active      INTEGER NOT NULL DEFAULT 1,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_neodove_agent_region ON NeoDoveAgent(region, active);

-- Seed: the founder's URL list (2026-10-31). R2/R3 follow the URL list, which
-- is authoritative for campaign ownership — MasterRegion.allottedName had the
-- two regions' pairs swapped and is corrected below.
INSERT OR IGNORE INTO NeoDoveAgent (id, region, name, secretName, active, createdAt, updatedAt) VALUES
  ('R1_ARJUN_SINGH',   'R1', 'Arjun Singh',   'NEODOVE_AGENT_R1_ARJUN_SINGH_URL',   1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('R1_NEHA_VERMA',    'R1', 'Neha Verma',    'NEODOVE_AGENT_R1_NEHA_VERMA_URL',    1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('R2_AMAN_SINHA',    'R2', 'Aman Sinha',    'NEODOVE_AGENT_R2_AMAN_SINHA_URL',    1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('R2_PRIYA_ROY',     'R2', 'Priya Roy',     'NEODOVE_AGENT_R2_PRIYA_ROY_URL',     1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('R3_ANJALI_JOSHI',  'R3', 'Anjali Joshi',  'NEODOVE_AGENT_R3_ANJALI_JOSHI_URL',  1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('R3_VIKRAM_PATEL',  'R3', 'Vikram Patel',  'NEODOVE_AGENT_R3_VIKRAM_PATEL_URL',  1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('R4_DIVYA_NAIR',    'R4', 'Divya Nair',    'NEODOVE_AGENT_R4_DIVYA_NAIR_URL',    1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('R4_KARTHIK_REDDY', 'R4', 'Karthik Reddy', 'NEODOVE_AGENT_R4_KARTHIK_REDDY_URL', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Ledger: which distribution a batch used, and which agent each lead went to.
-- Per-agent totals are derived with GROUP BY agentKey — no counter columns to
-- drift out of sync with the rows.
ALTER TABLE NeoDovePushBatch ADD COLUMN distribution TEXT NOT NULL DEFAULT '';
ALTER TABLE NeoDovePushBatch ADD COLUMN agentKey TEXT NOT NULL DEFAULT '';

ALTER TABLE NeoDoveLeadPush ADD COLUMN agentKey TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_neodove_lead_agent ON NeoDoveLeadPush(batchId, agentKey, status);

-- Data fix: the R2/R3 agent pairs were transposed in the master. The campaign
-- URLs (and therefore campaign ownership) say R2 = Aman Sinha + Priya Roy and
-- R3 = Anjali Joshi + Vikram Patel. Swapped back here; NeoDoveAgent above is
-- authoritative for routing, this field is the human-readable mirror.
UPDATE MasterRegion
   SET allottedName = 'Aman Sinha (M) | Priya Roy (F)',
       updatedAt = strftime('%Y-%m-%d %H:%M:%S','now')
 WHERE region = 'R2';

UPDATE MasterRegion
   SET allottedName = 'Vikram Patel (M) | Anjali Joshi (F)',
       updatedAt = strftime('%Y-%m-%d %H:%M:%S','now')
 WHERE region = 'R3';
