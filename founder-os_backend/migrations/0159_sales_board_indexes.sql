-- 0159_sales_board_indexes.sql — read paths behind GET /api/session/workspaces/telecalling/data
--
-- Every index here backs a query the Sales leaderboard runs on its cold path.
-- Before this, several of them were full-table scans with the filter applied in
-- JS (whole Enquiry book, whole Estimate book sorted by lastSyncTime), which is
-- why a cold leaderboard load cost seconds of D1 I/O.
--
-- CREATE INDEX IF NOT EXISTS keeps this idempotent: a database that already has
-- an index (e.g. created by an earlier hand-run) is left alone.
-- Probe with: SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Estimate';

-- Open-pipeline reads: leaderboard `sentOpen` (all regions) and the region drill
-- (`WHERE region=? AND status='sent' ORDER BY total DESC, date`).
CREATE INDEX IF NOT EXISTS idx_estimate_status_region ON "Estimate" (status, region);
CREATE INDEX IF NOT EXISTS idx_estimate_region_status_total ON "Estimate" (region, status, total DESC);

-- `recent` activity feed: ORDER BY lastSyncTime DESC LIMIT 25 over live statuses.
CREATE INDEX IF NOT EXISTS idx_estimate_last_sync ON "Estimate" (lastSyncTime DESC);

-- Accepted-cohort snapshot (wins / ₹ / points, and the since-start target ledger).
CREATE INDEX IF NOT EXISTS idx_estimate_status_accepted_at ON "Estimate" (status, acceptedAt);

-- Lead-generation counts per agent over the leaderboard window (was: read the
-- whole Enquiry table and filter dates in JS).
CREATE INDEX IF NOT EXISTS idx_enquiry_created_at ON "Enquiry" (createdAt);
CREATE INDEX IF NOT EXISTS idx_enquiry_agent_created ON "Enquiry" (assignedAgentId, createdAt);

-- Latest real sales note per open estimate (drill + Lead Conversion rows).
CREATE INDEX IF NOT EXISTS idx_comment_estimate_date ON "Comment" (estimateId, dateFormatted);

-- Region roster rollup (staff → region grouping on every compute).
CREATE INDEX IF NOT EXISTS idx_telecaller_region ON "Telecaller" (region);
