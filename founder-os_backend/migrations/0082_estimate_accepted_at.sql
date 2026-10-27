-- 0082_estimate_accepted_at.sql
-- acceptedAt = the IST day an estimate BECAME accepted/confirmed.
--
-- Why: the sales leaderboard counted close-ledger events instead of accepted
-- estimates (October 2026 under-reported by 22 deals / ₹10.9L), and it filtered
-- periods on Estimate.date — the day the estimate was RAISED, not the day it
-- was WON. Both made month/week totals wrong and mixed cohorts across months.
--
-- Backfill rule: the first close-credit day when the estimate has one, else the
-- estimate date. This deliberately keeps the 39 July estimates that were
-- bulk-marked accepted on 8 Oct 2026 (₹20.99L) inside JULY — they were raised
-- and won as July business, and dumping them into October would fake ₹21L of
-- October sales.
--
-- From here on, modules/estimates/status-sync.ts stamps this column on every
-- accepting transition and clears it when an estimate leaves a close status.

ALTER TABLE "Estimate" ADD COLUMN "acceptedAt" TEXT;

UPDATE "Estimate"
SET "acceptedAt" = COALESCE(
  (
    SELECT MIN(ev."day")
    FROM "TelecallerScoreEvent" ev
    WHERE ev."estimateId" = "Estimate"."estimateId"
      AND (
        ev."kind" IN ('generator', 'closer')
        OR (ev."kind" = '' AND ev."delta" > 0)
      )
  ),
  "date"
)
WHERE "status" IN ('accepted', 'confirmed');

CREATE INDEX IF NOT EXISTS "Estimate_acceptedAt_idx" ON "Estimate" ("acceptedAt");
