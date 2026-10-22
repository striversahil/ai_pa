-- Human Resources automation: delegated tasks + fixed/variable expense ledger.
CREATE TABLE IF NOT EXISTS "HumanResourcesMember" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "designation" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesMember_deleted_order_idx" ON "HumanResourcesMember" ("deleted", "order");

CREATE TABLE IF NOT EXISTS "HumanResourcesTask" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assignedToId" TEXT REFERENCES "HumanResourcesMember"("id") ON DELETE SET NULL,
  "dueDate" TEXT NOT NULL,
  "dueTime" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "remark" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesTask_deleted_status_dueDate_idx" ON "HumanResourcesTask" ("deleted", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "HumanResourcesTask_assignedToId_dueDate_idx" ON "HumanResourcesTask" ("assignedToId", "dueDate");

CREATE TABLE IF NOT EXISTS "HumanResourcesExpense" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "expenseType" TEXT NOT NULL,
  "category" TEXT,
  "amount" REAL NOT NULL DEFAULT 0,
  "expenseDate" TEXT NOT NULL,
  "expenseMonth" TEXT NOT NULL,
  "paymentMode" TEXT,
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesExpense_deleted_expenseMonth_expenseType_idx" ON "HumanResourcesExpense" ("deleted", "expenseMonth", "expenseType");
CREATE INDEX IF NOT EXISTS "HumanResourcesExpense_expenseDate_idx" ON "HumanResourcesExpense" ("expenseDate");
