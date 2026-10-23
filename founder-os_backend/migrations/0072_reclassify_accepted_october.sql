-- 0072_reclassify_accepted_october.sql
-- One-off October-2026 clean-up: accepted estimates were credited to whichever
-- staff member held the old individual assignment (sometimes a different
-- region, sometimes a since-deleted agent). The region model attributes a
-- close to the LEAD CREATOR's region, so:
--   1. backfill a blank createdBy from the mapping enquiry;
--   2. backfill a blank region from the creator's roster region;
--   3. move every positive legacy close row (kind='') to the creator —
--      a 20/80 pair therefore becomes a full slab for the creator;
--   4. give a full-slab legacy close credit to known-creator accepted deals
--      that never had one (their acceptance predates the region ledger).
-- Negative legacy penalty rows (−10/−15) and new-model generator/closer rows
-- are deliberately untouched. Idempotent: re-running moves nothing and
-- inserts nothing.
--
-- Verify before/after with:
--   SELECT kind, COUNT(*), SUM(delta) FROM TelecallerScoreEvent
--   WHERE estimateId IN (SELECT estimateId FROM Estimate
--     WHERE status IN ('accepted','confirmed') AND date BETWEEN '2026-10-01' AND '2026-10-31')
--   GROUP BY kind;

-- 1. Missing creator → the agent who mapped the enquiry to this estimate.
UPDATE "Estimate"
SET "createdBy" = (
  SELECT q."assignedAgentId"
  FROM "Enquiry" q
  WHERE trim(q."estNumber") = trim("Estimate"."estimateNumber")
    AND trim(q."assignedAgentId") <> ''
  ORDER BY
    CASE WHEN q."organizationId" = "Estimate"."organizationId" THEN 0 ELSE 1 END,
    q."createdAt" ASC
  LIMIT 1
)
WHERE "status" IN ('accepted', 'confirmed')
  AND "date" >= '2026-10-01' AND "date" <= '2026-10-31'
  AND ("createdBy" IS NULL OR trim("createdBy") = '')
  AND EXISTS (
    SELECT 1 FROM "Enquiry" q
    WHERE trim(q."estNumber") = trim("Estimate"."estimateNumber")
      AND trim(q."assignedAgentId") <> ''
  );

-- 2. Missing region → the creator's roster region.
UPDATE "Estimate"
SET "region" = (
  SELECT t."region" FROM "Telecaller" t WHERE t."id" = "Estimate"."createdBy"
)
WHERE "status" IN ('accepted', 'confirmed')
  AND "date" >= '2026-10-01' AND "date" <= '2026-10-31'
  AND ("region" IS NULL OR trim("region") = '')
  AND "createdBy" IS NOT NULL AND trim("createdBy") <> ''
  AND EXISTS (
    SELECT 1 FROM "Telecaller" t
    WHERE t."id" = "Estimate"."createdBy" AND trim(t."region") <> ''
  );

-- 3. Move legacy positive close rows (full slabs and 20/80 halves) to the
--    lead creator. The region dashboard prices the full slab once per
--    estimate, so both halves moving to the creator is intentional.
UPDATE "TelecallerScoreEvent"
SET "telecallerId" = (
  SELECT e."createdBy" FROM "Estimate" e
  WHERE e."estimateId" = "TelecallerScoreEvent"."estimateId"
)
WHERE "kind" = ''
  AND "delta" > 0
  AND EXISTS (
    SELECT 1 FROM "Estimate" e
    WHERE e."estimateId" = "TelecallerScoreEvent"."estimateId"
      AND e."status" IN ('accepted', 'confirmed')
      AND e."date" >= '2026-10-01' AND e."date" <= '2026-10-31'
      AND e."createdBy" IS NOT NULL AND trim(e."createdBy") <> ''
      AND e."createdBy" <> "TelecallerScoreEvent"."telecallerId"
  );

-- 4. Known-creator accepted deals with no positive close credit at all get
--    one full-slab legacy row (day = the Zoho estimate date, always inside
--    this month's range).
INSERT INTO "TelecallerScoreEvent"
  ("id", "telecallerId", "estimateId", "kind", "delta", "day", "reason", "createdAt")
SELECT
  lower(hex(randomblob(16))),
  e."createdBy",
  e."estimateId",
  '',
  CASE
    WHEN COALESCE(e."total", 0) < 100000 THEN 50
    WHEN COALESCE(e."total", 0) < 250000 THEN 75
    WHEN COALESCE(e."total", 0) < 500000 THEN 100
    ELSE 200
  END,
  CASE
    WHEN e."date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN e."date"
    ELSE strftime('%Y-%m-%d', 'now')
  END,
  'Reclassified accepted — full close credit to lead creator',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM "Estimate" e
WHERE e."status" IN ('accepted', 'confirmed')
  AND e."date" >= '2026-10-01' AND e."date" <= '2026-10-31'
  AND e."createdBy" IS NOT NULL AND trim(e."createdBy") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "TelecallerScoreEvent" s
    WHERE s."estimateId" = e."estimateId"
      AND (
        (s."kind" = '' AND s."delta" > 0)
        OR s."kind" IN ('generator', 'closer')
      )
  );
