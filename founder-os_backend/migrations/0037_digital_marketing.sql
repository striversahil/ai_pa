-- Digital Marketing automation: single manager roster + recurring templates + daily log instances.
CREATE TABLE IF NOT EXISTS "DigitalMarketingManager" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "role" TEXT NOT NULL DEFAULT 'manager',
  "order" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "DigitalMarketingManager_deleted_order_idx" ON "DigitalMarketingManager" ("deleted", "order");

CREATE TABLE IF NOT EXISTS "DigitalMarketingTaskTemplate" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "frequency" TEXT NOT NULL DEFAULT 'daily',
  "ownerRole" TEXT NOT NULL DEFAULT 'manager',
  "dueDay" INTEGER,
  "dueMonth" INTEGER,
  "ruleType" TEXT,
  "ruleJson" TEXT,
  "rawText" TEXT,
  "isShared" INTEGER NOT NULL DEFAULT 0,
  "employeeRaw" TEXT,
  "department" TEXT,
  "sheetStatus" TEXT,
  "metricsSchema" TEXT,
  "active" INTEGER NOT NULL DEFAULT 1,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "DigitalMarketingTaskTemplate_active_frequency_idx" ON "DigitalMarketingTaskTemplate" ("active", "frequency");

CREATE TABLE IF NOT EXISTS "DigitalMarketingTaskLog" (
  "id" TEXT PRIMARY KEY,
  "templateId" TEXT NOT NULL REFERENCES "DigitalMarketingTaskTemplate"("id") ON DELETE CASCADE,
  "dueDate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "remark" TEXT,
  "doneBy" TEXT,
  "metricsJson" TEXT,
  "timeSpentMin" INTEGER,
  "accountantId" TEXT REFERENCES "DigitalMarketingManager"("id") ON DELETE SET NULL,
  "updatedBy" TEXT,
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE ("templateId", "dueDate")
);
CREATE INDEX IF NOT EXISTS "DigitalMarketingTaskLog_dueDate_status_idx" ON "DigitalMarketingTaskLog" ("dueDate", "status");
CREATE INDEX IF NOT EXISTS "DigitalMarketingTaskLog_accountantId_idx" ON "DigitalMarketingTaskLog" ("accountantId");

CREATE TABLE IF NOT EXISTS "DigitalMarketingTaskAttachment" (
  "id" TEXT PRIMARY KEY,
  "logId" TEXT NOT NULL REFERENCES "DigitalMarketingTaskLog"("id") ON DELETE CASCADE,
  "fileName" TEXT NOT NULL,
  "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "size" INTEGER NOT NULL DEFAULT 0,
  "kvKey" TEXT NOT NULL UNIQUE,
  "uploadedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "DigitalMarketingTaskAttachment_logId_idx" ON "DigitalMarketingTaskAttachment" ("logId");
