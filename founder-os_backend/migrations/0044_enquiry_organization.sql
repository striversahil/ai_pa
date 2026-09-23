-- 0044: multi-org enquiries — tag each Enquiry with the Zoho Books organization
-- of its linked estimate (BUI + DPG share EST number series).
-- Backfill ONLY unambiguous rows (number matches exactly one org); ambiguous
-- or unlinked rows stay '' (= primary/BUI) and resolve on next save/claim.
ALTER TABLE Enquiry ADD COLUMN organizationId TEXT NOT NULL DEFAULT '';
UPDATE Enquiry SET organizationId = (
  SELECT organizationId FROM Estimate WHERE Estimate.estimateNumber = Enquiry.estNumber LIMIT 1
) WHERE estNumber IS NOT NULL AND Enquiry.estNumber <> '' AND EXISTS (
  SELECT 1 FROM Estimate WHERE Estimate.estimateNumber = Enquiry.estNumber
) AND (
  SELECT COUNT(DISTINCT organizationId) FROM Estimate WHERE Estimate.estimateNumber = Enquiry.estNumber
) = 1;
CREATE INDEX IF NOT EXISTS idx_enquiry_organization ON Enquiry(organizationId);
