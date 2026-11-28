-- 0189_customer_push_ledger.sql — the push ledger gets its own name.
--
-- The Controller's "Customer push" keeps exactly ONE destination: the Founder
-- OS auto dialer (modules/dialer). NeoDove is retired, so the ledger tables
-- stop carrying the vendor's name — the rows (95 batches / 10,191 lead rows on
-- 2026-11-28, 30 of them dialer pushes) move with the rename, because the dialer
-- queue's batchId points at them and the Controller's push history reads them.
--
-- NeoDoveAgent was the campaign-URL registry; it has no reader left, so it is
-- copied aside and dropped. The copy is never referenced by code.
--
-- Reversible: rename both tables back and re-run 0088/0089 index statements.

CREATE TABLE IF NOT EXISTS _backup_neodove_agent_20261128 AS SELECT * FROM NeoDoveAgent;

-- Indexes follow a renamed table under their old names in SQLite; recreate
-- them neutrally instead of leaving the vendor prefix behind.
DROP INDEX IF EXISTS idx_neodove_lead_batch;
DROP INDEX IF EXISTS idx_neodove_lead_agent;
DROP INDEX IF EXISTS idx_neodove_batch_state;
DROP INDEX IF EXISTS idx_neodove_batch_status;
DROP INDEX IF EXISTS idx_neodove_batch_state_district;
DROP INDEX IF EXISTS idx_neodove_agent_region;

ALTER TABLE NeoDovePushBatch RENAME TO CustomerPushBatch;
ALTER TABLE NeoDoveLeadPush RENAME TO CustomerPushLead;
DROP TABLE IF EXISTS NeoDoveAgent;

CREATE INDEX IF NOT EXISTS idx_customer_push_lead_batch ON CustomerPushLead(batchId, status);
CREATE INDEX IF NOT EXISTS idx_customer_push_lead_agent ON CustomerPushLead(batchId, agentKey, status);
CREATE INDEX IF NOT EXISTS idx_customer_push_batch_state ON CustomerPushBatch(region, state, createdAt);
CREATE INDEX IF NOT EXISTS idx_customer_push_batch_status ON CustomerPushBatch(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_customer_push_batch_district ON CustomerPushBatch(region, state, district, createdAt);
