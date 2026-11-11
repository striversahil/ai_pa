-- Phase 0 core foundation (2026-11-12): D1-native source-of-truth skeleton.
-- No behavior change: new core_* + hlp_* tables only, nothing reads/writes them yet.
-- SQLite-compatible (no Postgres schemas/plpgsql). Timestamps are IST strings (YYYY-MM-DD HH:MM:SS).
-- Audit rows are written by the core service layer in the same DB.batch() as the mutation;
-- append-only tables additionally carry BEFORE UPDATE/DELETE ABORT triggers below.

CREATE TABLE IF NOT EXISTS "core_domain_event" (
  "sequence" INTEGER PRIMARY KEY AUTOINCREMENT,
  "eventType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "payload" TEXT,
  "actorType" TEXT,
  "actorId" TEXT,
  "correlationId" TEXT,
  "occurredAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "core_domain_event_type_idx" ON "core_domain_event" ("eventType", "sequence");
CREATE INDEX IF NOT EXISTS "core_domain_event_entity_idx" ON "core_domain_event" ("entityType", "entityId");

CREATE TABLE IF NOT EXISTS "core_row_change" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "occurredAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "schemaName" TEXT NOT NULL DEFAULT 'core',
  "tableName" TEXT NOT NULL,
  "rowId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "changedFields" TEXT NOT NULL DEFAULT '[]',
  "oldData" TEXT,
  "newData" TEXT,
  "actorType" TEXT,
  "actorId" TEXT,
  "requestId" TEXT,
  "dbUser" TEXT NOT NULL DEFAULT 'worker',
  "txId" TEXT
);
CREATE INDEX IF NOT EXISTS "core_row_change_table_idx" ON "core_row_change" ("tableName", "rowId", "occurredAt");
CREATE INDEX IF NOT EXISTS "core_row_change_actor_idx" ON "core_row_change" ("actorId", "occurredAt");

CREATE TABLE IF NOT EXISTS "core_audit_event" (
  "id" TEXT PRIMARY KEY,
  "occurredAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "actorType" TEXT NOT NULL DEFAULT '',
  "actorId" TEXT,
  "sessionId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'dashboard',
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "changes" TEXT,
  "reason" TEXT,
  "approvalRequestId" TEXT,
  "correlationId" TEXT,
  "requestId" TEXT
);
CREATE INDEX IF NOT EXISTS "core_audit_event_entity_idx" ON "core_audit_event" ("entityType", "entityId", "occurredAt");
CREATE INDEX IF NOT EXISTS "core_audit_event_actor_idx" ON "core_audit_event" ("actorId", "occurredAt");

CREATE TABLE IF NOT EXISTS "core_access_log" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "occurredAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "actorType" TEXT NOT NULL DEFAULT '',
  "actorId" TEXT NOT NULL DEFAULT '',
  "sessionId" TEXT,
  "accessType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "recordIds" TEXT NOT NULL DEFAULT '[]',
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "screen" TEXT,
  "filters" TEXT,
  "sensitiveFields" TEXT NOT NULL DEFAULT '[]',
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "requestId" TEXT
);
CREATE INDEX IF NOT EXISTS "core_access_log_actor_idx" ON "core_access_log" ("actorId", "occurredAt");

CREATE TABLE IF NOT EXISTS "core_zoho_link" (
  "id" TEXT PRIMARY KEY,
  "system" TEXT NOT NULL,
  "namespace" TEXT NOT NULL DEFAULT '',
  "externalId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "importedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "metadata" TEXT,
  UNIQUE ("system", "namespace", "externalId", "entityType")
);
CREATE INDEX IF NOT EXISTS "core_zoho_link_entity_idx" ON "core_zoho_link" ("entityType", "entityId");

CREATE TABLE IF NOT EXISTS "core_action" (
  "id" TEXT PRIMARY KEY,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "entityType" TEXT,
  "entityId" TEXT,
  "assigneeId" TEXT,
  "assignedPositionId" TEXT,
  "assignedTeamId" TEXT,
  "departmentId" TEXT,
  "regionId" TEXT,
  "dueAt" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "escalationPolicyId" TEXT,
  "escalationLevel" INTEGER NOT NULL DEFAULT 0,
  "nextEscalationAt" TEXT,
  "completedAt" TEXT,
  "completedBy" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "core_action_assignee_idx" ON "core_action" ("assigneeId", "status");
CREATE INDEX IF NOT EXISTS "core_action_escalation_idx" ON "core_action" ("status", "nextEscalationAt");

CREATE TABLE IF NOT EXISTS "core_action_event" (
  "id" TEXT PRIMARY KEY,
  "actionId" TEXT NOT NULL REFERENCES "core_action"("id") ON DELETE CASCADE,
  "eventType" TEXT NOT NULL,
  "actorType" TEXT,
  "actorId" TEXT,
  "note" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "core_action_event_action_idx" ON "core_action_event" ("actionId", "createdAt");

CREATE TABLE IF NOT EXISTS "core_notification" (
  "id" TEXT PRIMARY KEY,
  "employeeId" TEXT NOT NULL DEFAULT '',
  "channel" TEXT NOT NULL DEFAULT 'IN_APP',
  "title" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "entityType" TEXT,
  "entityId" TEXT,
  "actionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "sentAt" TEXT
);
CREATE INDEX IF NOT EXISTS "core_notification_employee_idx" ON "core_notification" ("employeeId", "status", "createdAt");

CREATE TABLE IF NOT EXISTS "core_notification_pref" (
  "id" TEXT PRIMARY KEY,
  "employeeId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'IN_APP',
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "quietFromMin" INTEGER,
  "quietToMin" INTEGER,
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE ("employeeId", "channel")
);

CREATE TABLE IF NOT EXISTS "core_notification_template" (
  "key" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "subject" TEXT,
  "body" TEXT NOT NULL DEFAULT '',
  "variables" TEXT NOT NULL DEFAULT '[]',
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY ("key", "channel", "locale")
);

CREATE TABLE IF NOT EXISTS "core_system_job" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "finishedAt" TEXT,
  "detail" TEXT
);
CREATE INDEX IF NOT EXISTS "core_system_job_key_idx" ON "core_system_job" ("key", "startedAt");

CREATE TABLE IF NOT EXISTS "hlp_dashboard" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL DEFAULT '',
  "requiredScreenKey" TEXT NOT NULL DEFAULT '',
  "layout" TEXT,
  "isDefaultFor" TEXT NOT NULL DEFAULT '[]',
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "hlp_widget" (
  "id" TEXT PRIMARY KEY,
  "dashboardId" TEXT NOT NULL REFERENCES "hlp_dashboard"("id") ON DELETE CASCADE,
  "key" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'table',
  "title" TEXT NOT NULL DEFAULT '',
  "dataSource" TEXT NOT NULL DEFAULT '',
  "config" TEXT,
  "position" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  UNIQUE ("dashboardId", "key")
);

CREATE TABLE IF NOT EXISTS "hlp_flag" (
  "key" TEXT PRIMARY KEY,
  "description" TEXT,
  "enabled" INTEGER NOT NULL DEFAULT 0,
  "rules" TEXT,
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "hlp_cursor" (
  "consumerKey" TEXT PRIMARY KEY,
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only guards (D1/SQLite subset: one trigger per operation).
CREATE TRIGGER IF NOT EXISTS "trg_no_update_core_domain_event" BEFORE UPDATE ON "core_domain_event"
BEGIN SELECT RAISE(ABORT, 'core_domain_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_delete_core_domain_event" BEFORE DELETE ON "core_domain_event"
BEGIN SELECT RAISE(ABORT, 'core_domain_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_update_core_row_change" BEFORE UPDATE ON "core_row_change"
BEGIN SELECT RAISE(ABORT, 'core_row_change is append-only'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_delete_core_row_change" BEFORE DELETE ON "core_row_change"
BEGIN SELECT RAISE(ABORT, 'core_row_change is append-only'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_update_core_audit_event" BEFORE UPDATE ON "core_audit_event"
BEGIN SELECT RAISE(ABORT, 'core_audit_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_delete_core_audit_event" BEFORE DELETE ON "core_audit_event"
BEGIN SELECT RAISE(ABORT, 'core_audit_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_update_core_access_log" BEFORE UPDATE ON "core_access_log"
BEGIN SELECT RAISE(ABORT, 'core_access_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_delete_core_access_log" BEFORE DELETE ON "core_access_log"
BEGIN SELECT RAISE(ABORT, 'core_access_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_update_core_action_event" BEFORE UPDATE ON "core_action_event"
BEGIN SELECT RAISE(ABORT, 'core_action_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_delete_core_action_event" BEFORE DELETE ON "core_action_event"
BEGIN SELECT RAISE(ABORT, 'core_action_event is append-only'); END;
-- Business rows are cancelled/completed, never deleted.
CREATE TRIGGER IF NOT EXISTS "trg_no_delete_core_action" BEFORE DELETE ON "core_action"
BEGIN SELECT RAISE(ABORT, 'core_action rows are never deleted — cancel instead'); END;
