-- Human Resources: daily-item inventory/stock ledger.
CREATE TABLE IF NOT EXISTS "HumanResourcesInventoryItem" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'pcs',
  "reorderLevel" REAL NOT NULL DEFAULT 0,
  "unitCost" REAL,
  "notes" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesInventoryItem_deleted_order_idx" ON "HumanResourcesInventoryItem" ("deleted", "order");

CREATE TABLE IF NOT EXISTS "HumanResourcesInventoryTxn" (
  "id" TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL REFERENCES "HumanResourcesInventoryItem"("id") ON DELETE CASCADE,
  "txnType" TEXT NOT NULL,
  "quantity" REAL NOT NULL,
  "txnDate" TEXT NOT NULL,
  "txnMonth" TEXT NOT NULL,
  "notes" TEXT,
  "expenseId" TEXT,
  "createdBy" TEXT,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesInventoryTxn_itemId_txnDate_idx" ON "HumanResourcesInventoryTxn" ("itemId", "txnDate");
CREATE INDEX IF NOT EXISTS "HumanResourcesInventoryTxn_txnMonth_txnType_idx" ON "HumanResourcesInventoryTxn" ("txnMonth", "txnType");
CREATE INDEX IF NOT EXISTS "HumanResourcesInventoryTxn_expenseId_idx" ON "HumanResourcesInventoryTxn" ("expenseId");
