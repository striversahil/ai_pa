-- 0134_core_promise.sql — Phase 5b: promise ledger (dated commitments).
--
-- Founder votes 2026-11-12: dated commitments only (structured promisedDate
-- + parsed remark dates); status DERIVED on read (kept/broken/open from
-- collections — never stored); backfill open-dated only (pay-by >= today).
-- Free-text parsing is deterministic (finance-parse.ts) — unparseable remarks
-- stay out, never guessed. Remark-parsed rows converge via the finance shadow
-- (first read after deploy backfills; single-id mirrors on remark writes).
--
-- core_promise.id: `prom-cust:<customerKey>` (structured, one per customer —
-- a newer promise replaces it) or `prom:<remarkId>` (parsed, one per remark).

CREATE TABLE IF NOT EXISTS "core_promise" (
  "id" TEXT PRIMARY KEY,
  "origin" TEXT NOT NULL DEFAULT 'situation',
  "customerKey" TEXT NOT NULL DEFAULT '',
  "customerName" TEXT NOT NULL DEFAULT '',
  "masterCustomerId" TEXT NOT NULL DEFAULT '',
  "promisedDate" TEXT NOT NULL DEFAULT '',
  "startDay" TEXT NOT NULL DEFAULT '',
  "amount" REAL,
  "remarkId" TEXT,
  "promisedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_promise_customer_idx" ON "core_promise" ("customerKey");
CREATE INDEX IF NOT EXISTS "core_promise_date_idx" ON "core_promise" ("promisedDate");

-- Backfill: structured promises with pay-by >= today.
INSERT OR IGNORE INTO "core_promise" (
  "id", "origin", "customerKey", "customerName", "masterCustomerId",
  "promisedDate", "startDay", "amount", "remarkId", "promisedBy",
  "createdAt", "updatedAt"
)
SELECT
  'prom-cust:' || "customerKey", 'situation', "customerKey", "customerName",
  CASE WHEN (
    SELECT COUNT(*) FROM "MasterCustomer" "m"
    WHERE "m"."displayName" = "PaymentCustomer"."customerName"
       OR "m"."companyName" = "PaymentCustomer"."customerName"
  ) = 1 THEN (
    SELECT "m"."id" FROM "MasterCustomer" "m"
    WHERE "m"."displayName" = "PaymentCustomer"."customerName"
       OR "m"."companyName" = "PaymentCustomer"."customerName"
    LIMIT 1
  ) ELSE '' END,
  "promisedDate",
  COALESCE("promisedAt", "situationUpdatedAt", "updatedAt", (datetime('now'))),
  NULL, NULL, COALESCE("promisedBy", "situationUpdatedBy", ''),
  "createdAt", "updatedAt"
FROM "PaymentCustomer"
WHERE "promisedDate" IS NOT NULL AND "promisedDate" <> ''
  AND substr("promisedDate", 1, 10) >= date('now', '+5 hours', '+30 minutes');
