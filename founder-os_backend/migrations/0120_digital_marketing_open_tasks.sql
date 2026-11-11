-- Digital Marketing Open Tasks: free-form tasks with start/end + per-day progress (migration 0120).
-- Status is manual (open|done tick); dates are display-only. Attachments live at
-- both levels: task-level (entryId NULL) + daily proof (entryId set).
CREATE TABLE IF NOT EXISTS "DigitalMarketingOpenTask" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "doneAt" TEXT,
  "createdBy" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "DigitalMarketingOpenTask_startDate_idx" ON "DigitalMarketingOpenTask" ("startDate");
CREATE INDEX IF NOT EXISTS "DigitalMarketingOpenTask_status_idx" ON "DigitalMarketingOpenTask" ("status");

CREATE TABLE IF NOT EXISTS "DigitalMarketingOpenTaskEntry" (
  "id" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "DigitalMarketingOpenTask"("id") ON DELETE CASCADE,
  "date" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "updatedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE ("taskId", "date")
);
CREATE INDEX IF NOT EXISTS "DigitalMarketingOpenTaskEntry_taskId_idx" ON "DigitalMarketingOpenTaskEntry" ("taskId");

CREATE TABLE IF NOT EXISTS "DigitalMarketingOpenTaskAttachment" (
  "id" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "DigitalMarketingOpenTask"("id") ON DELETE CASCADE,
  "entryId" TEXT REFERENCES "DigitalMarketingOpenTaskEntry"("id") ON DELETE CASCADE,
  "fileName" TEXT NOT NULL,
  "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "size" INTEGER NOT NULL DEFAULT 0,
  "kvKey" TEXT NOT NULL UNIQUE,
  "uploadedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "DigitalMarketingOpenTaskAttachment_taskId_idx" ON "DigitalMarketingOpenTaskAttachment" ("taskId");
CREATE INDEX IF NOT EXISTS "DigitalMarketingOpenTaskAttachment_entryId_idx" ON "DigitalMarketingOpenTaskAttachment" ("entryId");
