-- 0042: per-lane instances for shared accounts tasks.
-- A shared template used to get ONE AccountsTaskLog row per (template, date),
-- rendered in both the senior and junior lanes — so one lane's Done flipped
-- the other lane's card. Shared templates now get one row per lane
-- (slot = senior|junior); ordinary tasks keep slot = 'main'.
-- SQLite cannot drop a UNIQUE constraint in place, so rebuild the table.
-- Existing rows keep slot = 'main'; the app backfill (splitSharedMains)
-- splits shared mains into per-lane copies on next rollover/read.

CREATE TABLE IF NOT EXISTS "AccountsTaskLog_new" (
  "id" TEXT PRIMARY KEY,
  "templateId" TEXT NOT NULL REFERENCES "AccountsTaskTemplate"("id") ON DELETE CASCADE,
  "dueDate" TEXT NOT NULL,
  "slot" TEXT NOT NULL DEFAULT 'main',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "remark" TEXT,
  "doneBy" TEXT,
  "timeSpentMin" INTEGER,
  "accountantId" TEXT REFERENCES "Accountant"("id") ON DELETE SET NULL,
  "updatedBy" TEXT,
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE ("templateId", "dueDate", "slot")
);
INSERT OR IGNORE INTO "AccountsTaskLog_new"
  ("id","templateId","dueDate","slot","status","remark","doneBy","timeSpentMin","accountantId","updatedBy","updatedAt","createdAt")
  SELECT "id","templateId","dueDate",'main',"status","remark","doneBy","timeSpentMin","accountantId","updatedBy","updatedAt","createdAt"
  FROM "AccountsTaskLog";
DROP TABLE "AccountsTaskLog";
ALTER TABLE "AccountsTaskLog_new" RENAME TO "AccountsTaskLog";
CREATE INDEX IF NOT EXISTS "AccountsTaskLog_dueDate_status_idx" ON "AccountsTaskLog" ("dueDate", "status");
CREATE INDEX IF NOT EXISTS "AccountsTaskLog_accountantId_idx" ON "AccountsTaskLog" ("accountantId");
