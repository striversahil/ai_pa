-- 0128_core_sales.sql — Phase 3c: sales spine (headers only, no line items).
--
-- Founder votes 2026-11-12: headers first; enquiries linked+active only; Zoho
-- backfill OPEN PIPELINE ONLY (sent + draft — closed history stays in Zoho
-- until the finance cut-over); attribution carried as facts, never recomputed.
-- Live counts at write time: sent 153 + draft 11 = 164 estimates; 602/606
-- enquiries link to an estimate by estNumber.
--
-- core_sale.id REUSES Estimate.estimateId (namespaced <org>:<zohoId> rows kept
-- distinct, same as the live table). converterId = kind='closer' winner, else
-- kind='generator', else Estimate.createdBy (mirrors getConvertersMap).
-- masterCustomerId = the UNIQUE exact name match, else '' (ambiguous/unmatched
-- stay unlinked — never guessed). Dual-write (src/modules/core/sales.ts) keeps
-- rows live after this point, INCLUDING closes (only the backfill is
-- open-only). Estimates are never hard-deleted — no tombstone needed.
-- NOTE: D1 rejects INSERT…SELECT…ON CONFLICT — INSERT OR IGNORE only.

CREATE TABLE IF NOT EXISTS "core_sale" (
  "id" TEXT PRIMARY KEY,
  "estimateNumber" TEXT NOT NULL DEFAULT '',
  "customerName" TEXT NOT NULL DEFAULT '',
  "masterCustomerId" TEXT NOT NULL DEFAULT '',
  "organizationId" TEXT NOT NULL DEFAULT '',
  "total" REAL NOT NULL DEFAULT 0,
  "date" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT,
  "converterId" TEXT NOT NULL DEFAULT '',
  "closeDay" TEXT,
  "closeValue" REAL NOT NULL DEFAULT 0,
  "acceptedAt" TEXT,
  "declinedAt" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_sale_status_idx" ON "core_sale" ("status");
CREATE INDEX IF NOT EXISTS "core_sale_region_idx" ON "core_sale" ("region");
CREATE INDEX IF NOT EXISTS "core_sale_customer_idx" ON "core_sale" ("masterCustomerId");
CREATE INDEX IF NOT EXISTS "core_sale_number_idx" ON "core_sale" ("estimateNumber");

CREATE TABLE IF NOT EXISTS "core_enquiry" (
  "id" TEXT PRIMARY KEY,
  "estNumber" TEXT NOT NULL DEFAULT '',
  "estimateId" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'new',
  "source" TEXT NOT NULL DEFAULT 'TL',
  "assignedAgentId" TEXT NOT NULL DEFAULT '',
  "clientCompany" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "contactPhone" TEXT NOT NULL DEFAULT '',
  "rateStatus" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_enquiry_est_idx" ON "core_enquiry" ("estNumber");
CREATE INDEX IF NOT EXISTS "core_enquiry_sale_idx" ON "core_enquiry" ("estimateId");
CREATE INDEX IF NOT EXISTS "core_enquiry_status_idx" ON "core_enquiry" ("status");

-- Backfill: open-pipeline estimates only (sent + draft).
INSERT OR IGNORE INTO "core_sale" (
  "id", "estimateNumber", "customerName", "masterCustomerId", "organizationId",
  "total", "date", "status", "region", "createdBy", "converterId",
  "closeDay", "closeValue", "acceptedAt", "declinedAt", "createdAt", "updatedAt"
)
SELECT
  "estimateId", "estimateNumber", "customerName",
  CASE WHEN (
    SELECT COUNT(*) FROM "MasterCustomer" "m"
    WHERE "m"."displayName" = "Estimate"."customerName"
       OR "m"."companyName" = "Estimate"."customerName"
  ) = 1 THEN (
    SELECT "m"."id" FROM "MasterCustomer" "m"
    WHERE "m"."displayName" = "Estimate"."customerName"
       OR "m"."companyName" = "Estimate"."customerName"
    LIMIT 1
  ) ELSE '' END,
  "organizationId", "total", "date", "status", "region", "createdBy",
  COALESCE(
    (SELECT "telecallerId" FROM "TelecallerScoreEvent" "s"
     WHERE "s"."estimateId" = "Estimate"."estimateId" AND "s"."kind" = 'closer'
     ORDER BY "s"."day" DESC LIMIT 1),
    (SELECT "telecallerId" FROM "TelecallerScoreEvent" "s"
     WHERE "s"."estimateId" = "Estimate"."estimateId" AND "s"."kind" = 'generator'
     ORDER BY "s"."day" DESC LIMIT 1),
    "createdBy", ''
  ),
  "acceptedAt", "total", "acceptedAt", "declinedAt",
  (datetime('now')), (datetime('now'))
FROM "Estimate"
WHERE lower("status") IN ('sent', 'draft');

-- Backfill: linked enquiries only (estNumber hits an estimate). Live data shows
-- every row is status 'new', so no status filter is needed yet — the mirror
-- keeps unlinked rows out going forward.
INSERT OR IGNORE INTO "core_enquiry" (
  "id", "estNumber", "estimateId", "status", "source", "assignedAgentId",
  "clientCompany", "contactName", "contactPhone", "rateStatus",
  "createdAt", "updatedAt"
)
SELECT
  "Enquiry"."id", "Enquiry"."estNumber",
  COALESCE((
    SELECT "e"."estimateId" FROM "Estimate" "e"
    WHERE "e"."estimateNumber" = "Enquiry"."estNumber"
      AND ("Enquiry"."organizationId" = '' OR "e"."organizationId" = '' OR "e"."organizationId" = "Enquiry"."organizationId")
    ORDER BY CASE WHEN "e"."organizationId" = "Enquiry"."organizationId" THEN 0 ELSE 1 END
    LIMIT 1
  ), ''),
  "Enquiry"."status", "Enquiry"."source", "Enquiry"."assignedAgentId",
  "Enquiry"."clientCompany", "Enquiry"."contactName", "Enquiry"."contactPhone",
  "Enquiry"."rateStatus", "Enquiry"."createdAt", "Enquiry"."updatedAt"
FROM "Enquiry"
WHERE "Enquiry"."estNumber" IN (SELECT "estimateNumber" FROM "Estimate");

-- Zoho links for backfilled sales (open pipeline only; closes link on the
-- finance cut-over with the closed-history import).
INSERT OR IGNORE INTO "core_zoho_link" ("id", "system", "namespace", "externalId", "entityType", "entityId", "metadata")
SELECT
  'zoho-sale-' || "estimateId",
  'zoho', '', "estimateId", 'sale', "estimateId",
  json_object('estimateNumber', "estimateNumber", 'customerName', "customerName", 'status', "status")
FROM "Estimate"
WHERE lower("status") IN ('sent', 'draft');
