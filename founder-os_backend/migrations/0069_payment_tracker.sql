-- Payment Tracker: imported debtor invoice ledger + collections ledger.
-- Import source = Excel clipboard paste from the accounts ageing sheet.
CREATE TABLE IF NOT EXISTS "DebtorInvoice" (
  "id" TEXT PRIMARY KEY,
  "customerName" TEXT NOT NULL,
  "invoiceNo" TEXT NOT NULL,
  "invoiceDate" TEXT,
  "creditPeriodDays" INTEGER,
  "dueDate" TEXT,
  "invoiceAmount" REAL NOT NULL DEFAULT 0,
  -- `baseReceived` = the pasted "Amount Received" column at the time of the
  -- LAST debtor import for this invoice; `collectedAtImport` = total of the
  -- collections ledger resolved to this invoice at that same moment. Live
  -- received = baseReceived + (sum(collections) - collectedAtImport), so
  -- re-pasting refreshed sheets never double-counts already-ledgered money.
  "baseReceived" REAL NOT NULL DEFAULT 0,
  "collectedAtImport" REAL NOT NULL DEFAULT 0,
  -- raw columns preserved verbatim from the paste
  "contactName" TEXT DEFAULT '',
  "contactPhone" TEXT DEFAULT '',
  "contactMail" TEXT DEFAULT '',
  "lastCallDate" TEXT,
  "callStatus" TEXT DEFAULT '',
  "paymentStatus" TEXT DEFAULT '',
  "remarks" TEXT DEFAULT '',
  "accountStatus" TEXT DEFAULT '',
  "mis" TEXT DEFAULT '',
  "accountsRemarks" TEXT DEFAULT '',
  "employee" TEXT DEFAULT '',
  "state" TEXT DEFAULT '',
  "region" TEXT DEFAULT '',
  "ledgerLink" TEXT DEFAULT '',
  "importedBy" TEXT DEFAULT '',
  "lastImportAt" TEXT,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "DebtorInvoice_invoiceNo_customer_key" ON "DebtorInvoice" ("invoiceNo", "customerName");
CREATE INDEX IF NOT EXISTS "DebtorInvoice_customer_idx" ON "DebtorInvoice" ("customerName");
CREATE INDEX IF NOT EXISTS "DebtorInvoice_dueDate_idx" ON "DebtorInvoice" ("dueDate");

CREATE TABLE IF NOT EXISTS "PaymentCollection" (
  "id" TEXT PRIMARY KEY,
  "customerName" TEXT NOT NULL,
  "invoiceNo" TEXT DEFAULT '',
  "collectionDate" TEXT,
  "amount" REAL NOT NULL DEFAULT 0,
  "mode" TEXT DEFAULT '',
  "remarks" TEXT DEFAULT '',
  "weekStart" TEXT DEFAULT '',
  -- 'invoice' = matched by invoice no; 'customer' = customer fallback,
  -- applied to the customer's oldest open invoice; 'none' = unmatched.
  "matchStatus" TEXT DEFAULT 'none',
  "resolvedInvoiceId" TEXT,
  "dedupKey" TEXT,
  "importedBy" TEXT DEFAULT '',
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentCollection_dedupKey_key" ON "PaymentCollection" ("dedupKey");
CREATE INDEX IF NOT EXISTS "PaymentCollection_customer_idx" ON "PaymentCollection" ("customerName");
CREATE INDEX IF NOT EXISTS "PaymentCollection_collectionDate_idx" ON "PaymentCollection" ("collectionDate");
CREATE INDEX IF NOT EXISTS "PaymentCollection_resolvedInvoiceId_idx" ON "PaymentCollection" ("resolvedInvoiceId");
