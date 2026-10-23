-- Region ownership: an estimate with no region inherits the roster region of
-- the agent who created it (Estimate.createdBy). Rows with no creator, or a
-- creator with no roster region, remain in the privileged Unmapped bucket.
-- Idempotent; safe to re-run.

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
    SELECT 1
    FROM Telecaller t
    WHERE t.id = Estimate.createdBy
      AND t.region IS NOT NULL
      AND trim(t.region) <> ''
  );
