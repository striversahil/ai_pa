-- 0145_neodove_batch_district.sql — district-scoped campaign pushes.
--
-- A push can now target one district inside a region+state. NeoDovePushBatch
-- records the selected district ('' = whole state, as before); the lead rows
-- stay region+state (lean ledger — the batch carries the district scope).
-- detail1 folds to "State · District" when a district is selected.

ALTER TABLE NeoDovePushBatch ADD COLUMN district TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_neodove_batch_state_district ON NeoDovePushBatch(region, state, district, createdAt);
