-- 0095_hr_fund_ledger.sql
-- HR office fund ledger: funding HR receives from time to time.
--
-- Why: HR holds a cash balance. Money comes in as funding (top-ups) and goes
-- out as office expenses (the existing HumanResourcesExpense rows). Balance is
-- DERIVED, never stored: lifetime funding minus lifetime fixed+variable
-- expenses (field_staff is tracked separately and never touches the balance).
-- Same soft-delete + createdBy ownership pattern as the expense ledger.

CREATE TABLE IF NOT EXISTS "HumanResourcesFundTxn" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "amount" REAL NOT NULL,
  "txnDate" TEXT NOT NULL,
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "HumanResourcesFundTxn_deleted_txnDate_idx"
  ON "HumanResourcesFundTxn" ("deleted", "txnDate");
