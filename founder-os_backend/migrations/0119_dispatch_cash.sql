-- 0119_dispatch_cash.sql — dispatch floor cash ledger (simple in/out).
--
-- One row per cash movement. The running balance is derived server-side
-- ordered by (day, createdAt): opening = kind 'opening' rows, credits /
-- top-ups = direction 'in' with kind 'credit', spends = direction 'out'.

CREATE TABLE IF NOT EXISTS "DispatchCashEntry" (
  "id" TEXT PRIMARY KEY,
  "day" TEXT NOT NULL,
  "direction" TEXT NOT NULL DEFAULT 'out',
  "kind" TEXT DEFAULT 'expense',
  "amount" REAL DEFAULT 0,
  "party" TEXT DEFAULT '',
  "purpose" TEXT DEFAULT '',
  "mode" TEXT DEFAULT '',
  "ref" TEXT DEFAULT '',
  "note" TEXT DEFAULT '',
  "enteredBy" TEXT DEFAULT '',
  "deleted" BOOLEAN DEFAULT 0,
  "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "DispatchCashEntry_day_idx" ON "DispatchCashEntry" ("day");
CREATE INDEX IF NOT EXISTS "DispatchCashEntry_deleted_idx" ON "DispatchCashEntry" ("deleted");
