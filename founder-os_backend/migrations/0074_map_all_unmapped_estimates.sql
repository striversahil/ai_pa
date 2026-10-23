-- Region ownership: map EVERY unmapped estimate to a region using, in order:
--   1. the estimate's creator (Estimate.createdBy) and their roster region;
--   2. the mapping enquiry's assigned agent (the B2B creator) when createdBy is
--      blank — the estimate inherits both createdBy and region;
--   3. the legacy assigned telecaller's roster region as a last resort
--      (region only; createdBy is never invented from old individual assignment).
-- Estimates with none of these signals stay in the privileged Unmapped bucket.
-- Idempotent; safe to re-run.

-- 1. Creator's roster region.
UPDATE Estimate
SET region = (
  SELECT t.region
  FROM Telecaller t
  WHERE t.id = Estimate.createdBy
)
WHERE (region IS NULL OR trim(region) = '')
  AND createdBy IS NOT NULL
  AND trim(createdBy) <> ''
  AND EXISTS (
    SELECT 1 FROM Telecaller t
    WHERE t.id = Estimate.createdBy
      AND t.region IS NOT NULL
      AND trim(t.region) <> ''
  );

-- 2. Mapping enquiry's agent (true creator for B2B-linked estimates).
UPDATE Estimate
SET createdBy = (
      SELECT q.assignedAgentId
      FROM Enquiry q
      JOIN Telecaller t ON t.id = q.assignedAgentId
      WHERE trim(COALESCE(q.estNumber, '')) = trim(COALESCE(Estimate.estimateNumber, ''))
        AND trim(COALESCE(q.assignedAgentId, '')) <> ''
        AND trim(COALESCE(t.region, '')) <> ''
      ORDER BY CASE WHEN COALESCE(q.organizationId, '') = COALESCE(Estimate.organizationId, '') THEN 0 ELSE 1 END
      LIMIT 1
    ),
    region = (
      SELECT t.region
      FROM Enquiry q
      JOIN Telecaller t ON t.id = q.assignedAgentId
      WHERE trim(COALESCE(q.estNumber, '')) = trim(COALESCE(Estimate.estimateNumber, ''))
        AND trim(COALESCE(q.assignedAgentId, '')) <> ''
        AND trim(COALESCE(t.region, '')) <> ''
      ORDER BY CASE WHEN COALESCE(q.organizationId, '') = COALESCE(Estimate.organizationId, '') THEN 0 ELSE 1 END
      LIMIT 1
    )
WHERE (region IS NULL OR trim(region) = '')
  AND COALESCE(trim(createdBy), '') = ''
  AND EXISTS (
    SELECT 1
    FROM Enquiry q
    JOIN Telecaller t ON t.id = q.assignedAgentId
    WHERE trim(COALESCE(q.estNumber, '')) = trim(COALESCE(Estimate.estimateNumber, ''))
      AND trim(COALESCE(q.assignedAgentId, '')) <> ''
      AND trim(COALESCE(t.region, '')) <> ''
  );

-- 3. Legacy individual assignment: use its roster region, region only.
UPDATE Estimate
SET region = (
  SELECT t.region
  FROM Telecaller t
  WHERE t.id = Estimate.assignedTelecallerId
)
WHERE (region IS NULL OR trim(region) = '')
  AND assignedTelecallerId IS NOT NULL
  AND trim(assignedTelecallerId) <> ''
  AND EXISTS (
    SELECT 1 FROM Telecaller t
    WHERE t.id = Estimate.assignedTelecallerId
      AND t.region IS NOT NULL
      AND trim(t.region) <> ''
  );
