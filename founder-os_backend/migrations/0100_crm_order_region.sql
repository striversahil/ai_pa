-- 0100_crm_order_region.sql
-- Sales-order region ownership for the unified Sales → Dispatch view.
--
-- `CrmSalesOrder` had no region: the Zoho order only carries the EST number in
-- `referenceNumber`. The sales team is region-owned (R1–R4), so dispatch must
-- split by the region of the ESTIMATE the order came from — including the
-- Controller's re-home, which rewrites `Estimate.region`.
--
-- `region` is DERIVED, never hand-edited: every sync tick re-resolves
-- referenceNumber → Estimate.region (org-preferring, BUI/DPG latest-date
-- tiebreak) and self-heals the column, so a re-home lands here within one tick.
-- Empty string = unmapped (no estimate, or the estimate has no region yet).

ALTER TABLE "CrmSalesOrder" ADD COLUMN "region" TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "CrmSalesOrder_region_idx" ON "CrmSalesOrder"("region");
