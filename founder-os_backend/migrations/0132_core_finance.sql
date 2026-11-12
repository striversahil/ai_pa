-- 0132_core_finance.sql — Phase 5a: dues + receivables mirror (shadow first).
--
-- Founder votes 2026-11-12: dues projections + opening receivables from
-- debtor open balances; Zoho invoices stay Zoho-side until the cut-over;
-- dues calendar moves via shadow first.
-- Live at write time: 41 payment templates; 525 open debtor invoices
-- (₹1,72,18,970 outstanding); 875 task logs.
--
-- core_receipt holds MONEY-EXPECTED rows from two origins:
--   due         id `due:<templateId>:<dueDate>` — next due per payment template
--               (built by the accounts domain with its own statement logic;
--               core only stores). Refreshed by rollover + template CRUD.
--   receivable  id `recv:<invoiceId>` — open debtor invoices (balance > 0).
--               Refreshed by debtor/collections imports + invoice edits.
-- status stays 'open' until the paid-marking lands (5b). masterCustomerId =
-- UNIQUE exact match or '' (never guessed, same rule as sales/orders).
-- NOTE: D1 rejects INSERT…SELECT…ON CONFLICT — INSERT OR IGNORE only.

CREATE TABLE IF NOT EXISTS "core_receipt" (
  "id" TEXT PRIMARY KEY,
  "origin" TEXT NOT NULL DEFAULT 'due',
  "templateId" TEXT NOT NULL DEFAULT '',
  "biller" TEXT NOT NULL DEFAULT '',
  "category" TEXT NOT NULL DEFAULT '',
  "amount" REAL NOT NULL DEFAULT 0,
  "dueDate" TEXT NOT NULL DEFAULT '',
  "statementDate" TEXT,
  "identifier" TEXT NOT NULL DEFAULT '',
  "customerName" TEXT NOT NULL DEFAULT '',
  "masterCustomerId" TEXT NOT NULL DEFAULT '',
  "invoiceNo" TEXT NOT NULL DEFAULT '',
  "invoiceDate" TEXT,
  "received" REAL NOT NULL DEFAULT 0,
  "balance" REAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_receipt_origin_idx" ON "core_receipt" ("origin");
CREATE INDEX IF NOT EXISTS "core_receipt_due_idx" ON "core_receipt" ("dueDate");
CREATE INDEX IF NOT EXISTS "core_receipt_customer_idx" ON "core_receipt" ("masterCustomerId");

-- Backfill: open receivables only (balance > 0, not deleted).
INSERT OR IGNORE INTO "core_receipt" (
  "id", "origin", "customerName", "masterCustomerId", "invoiceNo",
  "invoiceDate", "amount", "received", "balance", "dueDate", "status",
  "createdAt", "updatedAt"
)
SELECT
  'recv:' || "id", 'receivable', "customerName",
  CASE WHEN (
    SELECT COUNT(*) FROM "MasterCustomer" "m"
    WHERE "m"."displayName" = "DebtorInvoice"."customerName"
       OR "m"."companyName" = "DebtorInvoice"."customerName"
  ) = 1 THEN (
    SELECT "m"."id" FROM "MasterCustomer" "m"
    WHERE "m"."displayName" = "DebtorInvoice"."customerName"
       OR "m"."companyName" = "DebtorInvoice"."customerName"
    LIMIT 1
  ) ELSE '' END,
  "invoiceNo", "invoiceDate", "invoiceAmount",
  ("baseReceived" + "collectedAtImport"),
  ("invoiceAmount" - "baseReceived" - "collectedAtImport"),
  COALESCE("dueDate", ''), 'open', "createdAt", "updatedAt"
FROM "DebtorInvoice"
WHERE "deleted" = 0
  AND ("invoiceAmount" - "baseReceived" - "collectedAtImport") > 0;
