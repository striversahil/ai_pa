-- 0107_crm_dispatch_proof_items.sql — each dispatch proof remembers its batch.
--
-- Proofs only stored file IDs, so the panel could never say which items and
-- how much quantity a batch covered. `items` is a JSON snapshot written at
-- dispatch time: [{ itemId, name, qty, unit }]. Old rows keep '[]' and the
-- API backfills them from the dispatch audit events on the same day.

ALTER TABLE CrmDispatchProof ADD COLUMN items TEXT NOT NULL DEFAULT '[]';
