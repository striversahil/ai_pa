-- 0135_core_lead.sql — Phase 7a: lead intake ledger (additive, nothing reads it).
--
-- Founder decision 2026-11-12 (§13.15, §15): common `core_lead` with
-- status (unqualified|qualified) + outcome (open|won|lost|dropped).
-- Every telecaller-logged + digitally captured lead enters unqualified;
-- only TL (own regions) / sales-head / MIS / root may qualify.
-- Declined quotes are qualified/lost — never relabelled unqualified.
-- Rates: expectedRate* (client will pay, AI-extracted, 7b+) + quotedRate*
-- (what we quoted, per line from 7b+, header total in backfill).
-- Source: sourceName enum + sourceRaw verbatim (never overwritten).
--
-- D1 rule (§13.14): INSERT OR IGNORE … SELECT only, no INSERT…SELECT…ON CONFLICT.
-- Backfill is honest: all Estimates → qualified (+outcome from status);
-- orphan Enquiries (no matching Estimate) → unqualified/open.
-- Draft quotes count as qualified in 7a (a quote was built); revisit in 7c.
-- Expected rowcount: 1,975 estimates + 4 orphan enquiries = 1,979.

CREATE TABLE IF NOT EXISTS "core_lead" (
  "id" TEXT PRIMARY KEY,
  "dedupKey" TEXT NOT NULL UNIQUE,
  "leadNo" TEXT NOT NULL DEFAULT '',
  "captureKind" TEXT NOT NULL DEFAULT 'sync',
  "customerName" TEXT NOT NULL DEFAULT '',
  "clientCompany" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "contactPhone" TEXT NOT NULL DEFAULT '',
  "contactEmail" TEXT NOT NULL DEFAULT '',
  "location" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "assignedAgentId" TEXT NOT NULL DEFAULT '',
  "sourceName" TEXT NOT NULL DEFAULT 'Unmapped',
  "sourceRaw" TEXT NOT NULL DEFAULT '',
  "sourceRef" TEXT NOT NULL DEFAULT '',
  "productText" TEXT NOT NULL DEFAULT '',
  "productId" TEXT NOT NULL DEFAULT '',
  "qtyText" TEXT NOT NULL DEFAULT '',
  "specText" TEXT NOT NULL DEFAULT '',
  "expectedRateAmount" REAL,
  "expectedRateUnit" TEXT NOT NULL DEFAULT '',
  "quotedRateAmount" REAL,
  "quotedRateUnit" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'unqualified',
  "outcome" TEXT NOT NULL DEFAULT 'open',
  "qualifiedBy" TEXT NOT NULL DEFAULT '',
  "qualifiedByRole" TEXT NOT NULL DEFAULT '',
  "qualifiedAt" TEXT NOT NULL DEFAULT '',
  "qualifyNote" TEXT NOT NULL DEFAULT '',
  "disqualifyReason" TEXT NOT NULL DEFAULT 'other',
  "reasonDetail" TEXT NOT NULL DEFAULT '',
  "lostAt" TEXT NOT NULL DEFAULT '',
  "wonAt" TEXT NOT NULL DEFAULT '',
  "enquiryId" TEXT NOT NULL DEFAULT '',
  "estimateId" TEXT NOT NULL DEFAULT '',
  "estNumber" TEXT NOT NULL DEFAULT '',
  "occurredAt" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_lead_status_idx" ON "core_lead" ("status");
CREATE INDEX IF NOT EXISTS "core_lead_outcome_idx" ON "core_lead" ("outcome");
CREATE INDEX IF NOT EXISTS "core_lead_source_idx" ON "core_lead" ("sourceName");
CREATE INDEX IF NOT EXISTS "core_lead_occurred_idx" ON "core_lead" ("occurredAt");
CREATE INDEX IF NOT EXISTS "core_lead_estimate_idx" ON "core_lead" ("estimateId");
CREATE INDEX IF NOT EXISTS "core_lead_enquiry_idx" ON "core_lead" ("enquiryId");

-- Part 1: every Estimate → qualified (+outcome from live status).
-- Enquiry join is deterministic: lowest Enquiry.id per estNumber wins.
INSERT OR IGNORE INTO "core_lead" (
  "id", "dedupKey", "leadNo", "captureKind",
  "customerName", "clientCompany", "contactName", "contactPhone", "contactEmail",
  "location", "region", "assignedAgentId",
  "sourceName", "sourceRaw", "sourceRef",
  "productText", "productId", "qtyText", "specText",
  "expectedRateAmount", "expectedRateUnit", "quotedRateAmount", "quotedRateUnit",
  "status", "outcome",
  "qualifiedBy", "qualifiedByRole", "qualifiedAt", "qualifyNote",
  "disqualifyReason", "reasonDetail", "lostAt", "wonAt",
  "enquiryId", "estimateId", "estNumber",
  "occurredAt", "createdAt", "updatedAt"
)
SELECT
  'lead-est:' || s."estimateId", 'est:' || s."estimateId", '', 'sync',
  COALESCE(s."customerName", ''),
  COALESCE(e."clientCompany", ''),
  COALESCE(NULLIF(TRIM(e."contactName"), ''), NULLIF(TRIM(s."contactName"), ''), ''),
  COALESCE(NULLIF(TRIM(e."contactPhone"), ''), NULLIF(TRIM(s."contactPhone"), ''), ''),
  COALESCE(NULLIF(TRIM(e."contactEmail"), ''), NULLIF(TRIM(s."contactEmail"), ''), ''),
  COALESCE(NULLIF(TRIM(e."location"), ''), NULLIF(TRIM(s."location"), ''), ''),
  COALESCE(s."region", ''),
  COALESCE(NULLIF(TRIM(s."assignedTelecallerId"), ''), NULLIF(TRIM(e."assignedAgentId"), ''), ''),
  CASE LOWER(TRIM(COALESCE(e."source", '')))
    WHEN 'ai' THEN 'AI' WHEN 'tl' THEN 'TL' WHEN 'b2b' THEN 'B2B'
    WHEN 'incoming' THEN 'Incoming' WHEN 'field staff' THEN 'FieldStaff'
    ELSE CASE
      WHEN LOWER(TRIM(COALESCE(s."sourceLead", ''))) LIKE 'comapny%' THEN 'CompanyData'
      WHEN LOWER(TRIM(COALESCE(s."sourceLead", ''))) LIKE 'company%' THEN 'CompanyData'
      WHEN LOWER(TRIM(COALESCE(s."sourceLead", ''))) LIKE 'ai%' THEN 'AI'
      WHEN LOWER(TRIM(COALESCE(s."sourceLead", ''))) LIKE 'indiamart%' THEN 'IndiaMART'
      WHEN LOWER(TRIM(COALESCE(s."sourceLead", ''))) LIKE 'refer%' THEN 'Referral'
      WHEN TRIM(COALESCE(s."sourceLead", '')) = '' THEN 'Unmapped'
      ELSE 'Other' END
  END,
  COALESCE(NULLIF(TRIM(s."sourceLead"), ''), NULLIF(TRIM(e."source"), ''), ''),
  COALESCE(e."enquiryNumber", ''),
  COALESCE(e."title", ''),
  '', '', '',
  NULL, '', s."total", '',
  'qualified',
  CASE
    WHEN LOWER(TRIM(s."status")) = 'declined' THEN 'lost'
    WHEN LOWER(TRIM(s."status")) IN ('accepted', 'confirmed', 'invoiced') THEN 'won'
    ELSE 'open'
  END,
  COALESCE(s."createdBy", ''), '', COALESCE(s."date", ''), '',
  'other', '',
  CASE WHEN LOWER(TRIM(s."status")) = 'declined' THEN COALESCE(s."declinedAt", '') ELSE '' END,
  CASE WHEN LOWER(TRIM(s."status")) IN ('accepted', 'confirmed', 'invoiced') THEN COALESCE(s."acceptedAt", '') ELSE '' END,
  COALESCE(e."id", ''), s."estimateId", s."estimateNumber",
  COALESCE(NULLIF(TRIM(s."declinedAt"), ''), NULLIF(TRIM(s."acceptedAt"), ''), NULLIF(TRIM(s."date"), ''), datetime('now')),
  datetime('now'), datetime('now')
FROM "Estimate" s
LEFT JOIN "Enquiry" e ON e."id" = (
  SELECT MIN(e2."id") FROM "Enquiry" e2 WHERE e2."estNumber" = s."estimateNumber"
);

-- Part 2: orphan Enquiries (no matching Estimate) → unqualified/open.
INSERT OR IGNORE INTO "core_lead" (
  "id", "dedupKey", "leadNo", "captureKind",
  "customerName", "clientCompany", "contactName", "contactPhone", "contactEmail",
  "location", "region", "assignedAgentId",
  "sourceName", "sourceRaw", "sourceRef",
  "productText", "productId", "qtyText", "specText",
  "expectedRateAmount", "expectedRateUnit", "quotedRateAmount", "quotedRateUnit",
  "status", "outcome",
  "qualifiedBy", "qualifiedByRole", "qualifiedAt", "qualifyNote",
  "disqualifyReason", "reasonDetail", "lostAt", "wonAt",
  "enquiryId", "estimateId", "estNumber",
  "occurredAt", "createdAt", "updatedAt"
)
SELECT
  'lead-enq:' || e."id", 'enq:' || e."id", '', 'sync',
  COALESCE(e."contactName", e."clientCompany", ''),
  COALESCE(e."clientCompany", ''),
  COALESCE(e."contactName", ''),
  COALESCE(e."contactPhone", ''),
  COALESCE(e."contactEmail", ''),
  COALESCE(e."location", ''),
  '', COALESCE(e."assignedAgentId", ''),
  CASE LOWER(TRIM(COALESCE(e."source", '')))
    WHEN 'ai' THEN 'AI' WHEN 'tl' THEN 'TL' WHEN 'b2b' THEN 'B2B'
    WHEN 'incoming' THEN 'Incoming' WHEN 'field staff' THEN 'FieldStaff'
    ELSE 'Unmapped'
  END,
  COALESCE(e."source", ''),
  COALESCE(e."enquiryNumber", ''),
  COALESCE(e."title", ''),
  '', '', '',
  NULL, '', NULL, '',
  'unqualified', 'open',
  '', '', '', '',
  'other', '', '', '',
  e."id", '', COALESCE(e."estNumber", ''),
  COALESCE(NULLIF(TRIM(e."createdAt"), ''), datetime('now')),
  datetime('now'), datetime('now')
FROM "Enquiry" e
WHERE NOT EXISTS (
  SELECT 1 FROM "Estimate" s WHERE s."estimateNumber" = e."estNumber"
);
