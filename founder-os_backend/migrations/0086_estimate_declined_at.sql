-- 0086_estimate_declined_at.sql
-- declinedAt = the IST day an estimate BECAME declined.
--
-- Why: the sales leaderboard now shows declines next to wins on every region
-- row. Declines had no timestamp at all — filtering them by Estimate.date
-- would report "quotes raised this month that are declined" instead of "quotes
-- declined this month". acceptedAt solved the same problem for wins (0082);
-- this is its mirror.
--
-- Backfill rule: the estimate date. There is no status-history table, and
-- lastSyncTime is a sync watermark (it moves for metadata/AI/lead-details
-- updates), so it cannot stand in for the decline day. Pre-tracking declines
-- therefore land in the period of the estimate they belong to.
--
-- From here on, modules/estimates/status-sync.ts stamps this column on entry
-- into `declined` and clears it when the estimate leaves that status.

ALTER TABLE "Estimate" ADD COLUMN "declinedAt" TEXT;

UPDATE "Estimate"
SET "declinedAt" = "date"
WHERE "status" = 'declined' AND "declinedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Estimate_declinedAt_idx" ON "Estimate" ("declinedAt");
CREATE INDEX IF NOT EXISTS "Estimate_status_declinedAt_idx" ON "Estimate" ("status", "declinedAt");
