-- Accounts automation: roster + recurring templates + daily log instances.
CREATE TABLE IF NOT EXISTS "Accountant" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "role" TEXT NOT NULL DEFAULT 'junior',
  "order" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "Accountant_deleted_order_idx" ON "Accountant" ("deleted", "order");

CREATE TABLE IF NOT EXISTS "AccountsTaskTemplate" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "frequency" TEXT NOT NULL DEFAULT 'daily',
  "ownerRole" TEXT NOT NULL DEFAULT 'either',
  "dueDay" INTEGER,
  "dueMonth" INTEGER,
  "active" INTEGER NOT NULL DEFAULT 1,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "AccountsTaskTemplate_active_frequency_idx" ON "AccountsTaskTemplate" ("active", "frequency");

CREATE TABLE IF NOT EXISTS "AccountsTaskLog" (
  "id" TEXT PRIMARY KEY,
  "templateId" TEXT NOT NULL REFERENCES "AccountsTaskTemplate"("id") ON DELETE CASCADE,
  "dueDate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "remark" TEXT,
  "doneBy" TEXT,
  "accountantId" TEXT REFERENCES "Accountant"("id") ON DELETE SET NULL,
  "updatedBy" TEXT,
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE ("templateId", "dueDate")
);
CREATE INDEX IF NOT EXISTS "AccountsTaskLog_dueDate_status_idx" ON "AccountsTaskLog" ("dueDate", "status");
CREATE INDEX IF NOT EXISTS "AccountsTaskLog_accountantId_idx" ON "AccountsTaskLog" ("accountantId");
