-- 0127_core_customer.sql — Phase 3a: customer spine (mirror of MasterCustomer).
--
-- Founder votes 2026-11-12: customers first; mirror 1:1 now, merge duplicates
-- later via the existing duplicate-review UI; hard-delete → DELETED tombstone
-- in core (downstream reads skip it, audits keep the trail).
--
-- core_customer.id REUSES MasterCustomer.id (Zoho customer id, or synthetic
-- CB-… ids for the conveyor book) — same PK-reuse rule as the roster
-- dual-write (Phase 1). Backfill is INSERT OR IGNORE (D1 rejects
-- INSERT…SELECT…ON CONFLICT); re-runs add new rows only, tombstones survive
-- (their MasterCustomer row is gone → no source row), and a re-imported
-- customer correctly resurrects with live values on its next dual-write.
-- Zoho links land in the existing core_zoho_link table (system='zoho').

CREATE TABLE IF NOT EXISTS "core_customer" (
  "id" TEXT PRIMARY KEY,
  "zohoCustomerId" TEXT NOT NULL UNIQUE,
  "region" TEXT NOT NULL DEFAULT '',
  "zone" TEXT NOT NULL DEFAULT '',
  "subArea" TEXT NOT NULL DEFAULT '',
  "state" TEXT NOT NULL DEFAULT '',
  "pincode" TEXT,
  "displayName" TEXT NOT NULL DEFAULT '',
  "companyName" TEXT NOT NULL DEFAULT '',
  "customerType" TEXT NOT NULL DEFAULT '',
  "customerTypeBase" TEXT NOT NULL DEFAULT '',
  "customerTypeTag" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'Active',
  "contactPerson" TEXT,
  "designation" TEXT,
  "phonesJson" TEXT NOT NULL DEFAULT '[]',
  "emailsJson" TEXT NOT NULL DEFAULT '[]',
  "billingAddress" TEXT,
  "gstin" TEXT,
  "owner" TEXT,
  "pipelineStage" TEXT NOT NULL DEFAULT '',
  "estimateCount" INTEGER NOT NULL DEFAULT 0,
  "lastEstimateDate" TEXT,
  "salesOrderCount" INTEGER NOT NULL DEFAULT 0,
  "lastSalesOrderDate" TEXT,
  "cityZoho" TEXT,
  "cityVerified" TEXT,
  "citySource" TEXT,
  "locationBasis" TEXT,
  "duplicateGroup" TEXT,
  "duplicateConfidence" TEXT,
  "suggestedAction" TEXT,
  "duplicateReview" TEXT NOT NULL DEFAULT 'open',
  "reviewedBy" TEXT NOT NULL DEFAULT '',
  "reviewedAt" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_customer_region_idx" ON "core_customer" ("region");
CREATE INDEX IF NOT EXISTS "core_customer_state_idx" ON "core_customer" ("state");
CREATE INDEX IF NOT EXISTS "core_customer_status_idx" ON "core_customer" ("status");
CREATE INDEX IF NOT EXISTS "core_customer_dup_idx" ON "core_customer" ("duplicateGroup");

-- Backfill: pure projection of the live book.
-- NOTE: D1 rejects INSERT…SELECT…ON CONFLICT, so this is INSERT OR IGNORE
-- (new rows only — the table is brand new at first apply). Convergence after
-- this point is the dual-write's job (src/modules/core/customers.ts, which
-- pairs every INSERT OR IGNORE with an UPDATE…FROM refresh).
INSERT OR IGNORE INTO "core_customer" (
  "id", "zohoCustomerId", "region", "zone", "subArea", "state", "pincode",
  "displayName", "companyName", "customerType", "customerTypeBase", "customerTypeTag",
  "status", "contactPerson", "designation", "phonesJson", "emailsJson",
  "billingAddress", "gstin", "owner", "pipelineStage", "estimateCount",
  "lastEstimateDate", "salesOrderCount", "lastSalesOrderDate", "cityZoho",
  "cityVerified", "citySource", "locationBasis", "duplicateGroup",
  "duplicateConfidence", "suggestedAction", "duplicateReview", "reviewedBy",
  "reviewedAt", "notes", "createdAt", "updatedAt"
)
SELECT
  "id", "zohoCustomerId", "region", "zone", "subArea", "state", "pincode",
  "displayName", "companyName", "customerType", "customerTypeBase", "customerTypeTag",
  "status", "contactPerson", "designation", "phonesJson", "emailsJson",
  "billingAddress", "gstin", "owner", "pipelineStage", "estimateCount",
  "lastEstimateDate", "salesOrderCount", "lastSalesOrderDate", "cityZoho",
  "cityVerified", "citySource", "locationBasis", "duplicateGroup",
  "duplicateConfidence", "suggestedAction", "duplicateReview", "reviewedBy",
  "reviewedAt", "notes", "createdAt", "updatedAt"
FROM "MasterCustomer"
;

-- Zoho links for every customer with a Zoho id (idempotent).
INSERT OR IGNORE INTO "core_zoho_link" ("id", "system", "namespace", "externalId", "entityType", "entityId", "metadata")
SELECT
  'zoho-customer-' || "zohoCustomerId",
  'zoho', '', "zohoCustomerId", 'customer', "id",
  json_object('displayName', "displayName", 'region', "region")
FROM "MasterCustomer"
WHERE "zohoCustomerId" IS NOT NULL AND "zohoCustomerId" <> '';
