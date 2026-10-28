-- 0084: employee delegation board — daily task journal + self-service tasks.
--
--  * HumanResourcesTaskLog: append-only journal (one row per status change or
--    remark), tagged with the IST day it was written. Powers the employee
--    "my day" page and HR's per-employee daily activity view.
--  * HumanResourcesTask.origin: 'hr' (delegated by HR/MIS) or 'self' (created
--    by the employee from the Delegation page).
--  * HumanResourcesMember.loginEmail: explicit platform-login link. When empty
--    the resolver falls back to the contact `email` and then the name.
ALTER TABLE "HumanResourcesMember" ADD COLUMN "loginEmail" TEXT;

ALTER TABLE "HumanResourcesTask" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'hr';
ALTER TABLE "HumanResourcesTask" ADD COLUMN "createdByMemberId" TEXT;

CREATE TABLE IF NOT EXISTS "HumanResourcesTaskLog" (
  "id" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL REFERENCES "HumanResourcesTask"("id") ON DELETE CASCADE,
  "memberId" TEXT,
  "logDate" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'remark',
  "status" TEXT,
  "remark" TEXT,
  "authorName" TEXT,
  "authorMemberId" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "HumanResourcesTaskLog_taskId_createdAt_idx"
  ON "HumanResourcesTaskLog" ("taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "HumanResourcesTaskLog_memberId_logDate_idx"
  ON "HumanResourcesTaskLog" ("memberId", "logDate");
CREATE INDEX IF NOT EXISTS "HumanResourcesTaskLog_logDate_idx"
  ON "HumanResourcesTaskLog" ("logDate");
CREATE INDEX IF NOT EXISTS "HumanResourcesTask_origin_idx"
  ON "HumanResourcesTask" ("origin");
