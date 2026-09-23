-- 0043: multi-org Zoho sync — tag every Estimate with its Zoho Books organization.
-- Until now a single org was synced, so no org column existed. Backfill all
-- existing rows with the BUI (primary) organization_id 676267428 — the first
-- organization_id in zoho_sent/sent_estimates.txt. New rows always carry
-- organizationId from the runner (bulk-upsert); '' is treated as primary.
ALTER TABLE Estimate ADD COLUMN organizationId TEXT NOT NULL DEFAULT '';
UPDATE Estimate SET organizationId = '676267428' WHERE organizationId = '';
CREATE INDEX IF NOT EXISTS idx_estimate_organization ON Estimate(organizationId);
