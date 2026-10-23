-- Payment Tracker: customer contact master, reminder log, and an optional
-- receipt reference on collections.
--
-- Customer identity = normalized customer name (customerKey), because that is
-- the only stable customer identifier the accounts sheets carry. Invoice no
-- remains the matching key for receivables (within a customer).
CREATE TABLE IF NOT EXISTS "PaymentCustomer" (
  "id" TEXT PRIMARY KEY,
  -- lower(trim(normalizeCustomerName(customerName))) — see customers.ts
  "customerKey" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  -- Opt-in is required before any business-initiated WhatsApp template send.
  "whatsappOptIn" INTEGER NOT NULL DEFAULT 0,
  "optInAt" TEXT,
  "notes" TEXT NOT NULL DEFAULT '',
  "updatedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentCustomer_customerKey_key" ON "PaymentCustomer" ("customerKey");
CREATE INDEX IF NOT EXISTS "PaymentCustomer_customerName_idx" ON "PaymentCustomer" ("customerName");

-- Optional receipt/transaction reference from the accounting export. When
-- present it is the strongest dedupe key; otherwise imports fall back to
-- invoiceNo + date + amount + mode.
ALTER TABLE "PaymentCollection" ADD COLUMN "receiptNo" TEXT DEFAULT '';

-- Every reminder attempt (dry-run now, live later). One row per customer per
-- run day per channel (dedupKey), so a cron retry cannot double-log.
CREATE TABLE IF NOT EXISTS "PaymentReminder" (
  "id" TEXT PRIMARY KEY,
  "customerKey" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "phone" TEXT DEFAULT '',
  "channel" TEXT NOT NULL DEFAULT 'whatsapp',
  "kind" TEXT NOT NULL DEFAULT 'due',
  -- 'dry_run' | 'sent' | 'failed' | 'skipped'
  "status" TEXT NOT NULL DEFAULT 'dry_run',
  "amount" REAL NOT NULL DEFAULT 0,
  "invoiceCount" INTEGER NOT NULL DEFAULT 0,
  "invoiceNos" TEXT DEFAULT '',
  "oldestDueDate" TEXT,
  "message" TEXT DEFAULT '',
  "providerMessageId" TEXT DEFAULT '',
  "error" TEXT DEFAULT '',
  -- IST date YYYY-MM-DD
  "runDay" TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'cron',
  "dedupKey" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReminder_dedupKey_key" ON "PaymentReminder" ("dedupKey");
CREATE INDEX IF NOT EXISTS "PaymentReminder_customer_idx" ON "PaymentReminder" ("customerKey");
CREATE INDEX IF NOT EXISTS "PaymentReminder_runDay_idx" ON "PaymentReminder" ("runDay");
CREATE INDEX IF NOT EXISTS "PaymentReminder_createdAt_idx" ON "PaymentReminder" ("createdAt");

-- Backfill one contact row per existing customer (invoice ledger ∪ receipts).
INSERT OR IGNORE INTO "PaymentCustomer"
  ("id", "customerKey", "customerName", "createdAt", "updatedAt")
SELECT
  lower(hex(randomblob(16))),
  lower(trim(n."customerName")),
  MIN(n."customerName"),
  datetime('now'),
  datetime('now')
FROM (
  SELECT "customerName" FROM "DebtorInvoice" WHERE "deleted" = 0
  UNION ALL
  SELECT "customerName" FROM "PaymentCollection" WHERE "deleted" = 0
) AS n
WHERE trim(n."customerName") <> ''
GROUP BY lower(trim(n."customerName"));
