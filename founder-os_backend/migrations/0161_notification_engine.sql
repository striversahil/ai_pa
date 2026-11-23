-- 0161_notification_engine.sql — rule-driven, position-wise notifications.
--
-- The founder authors ONE rule per audience/metric in the Settings → Notifications
-- console: audience (chart position / department / region / roster type / role),
-- cadence, a read-only metric SQL, a mustache template and the escalation level
-- source. The `* * * * *` cron router evaluates due rules, parses each returned
-- row (one row = one person = one notification) and dispatches through the
-- EXISTING core notification writer (`modules/core/notify.ts#notifyUsers`).
--
-- Reuse, not replacement:
--   core_notification      = the canonical in-app inbox + audit (written only by
--                            modules/core/notify.ts — never by this feature)
--   hlp_notification_rule  = authored rules (helpers layer, free to change)
--   hlp_notification_delivery = escalation level/colour/metric sidecar per
--                            notification (UNIQUE window → no double dispatch)
--   hlp_notification_state = per rule+person streaks (escalation memory)
--
-- Levels/colours and caps are Settings (`notifications:levels`,
-- `notifications:settings`) so the console can edit them without a migration.

CREATE TABLE IF NOT EXISTS "hlp_notification_rule" (
  "id"          TEXT PRIMARY KEY,
  "key"         TEXT NOT NULL UNIQUE,
  "name"        TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "enabled"     INTEGER NOT NULL DEFAULT 1,
  "audienceJson"   TEXT NOT NULL DEFAULT '{}',
  "sqlText"        TEXT NOT NULL DEFAULT '',
  "titleTpl"       TEXT NOT NULL DEFAULT '',
  "bodyTpl"        TEXT NOT NULL DEFAULT '',
  "cadenceJson"    TEXT NOT NULL DEFAULT '{"kind":"hourly"}',
  "thresholdsJson" TEXT NOT NULL DEFAULT '[]',
  "escalationJson" TEXT NOT NULL DEFAULT '{}',
  "nextDueAt"   TEXT,
  "lastRunAt"   TEXT,
  "lastStatus"  TEXT,
  "createdBy"   TEXT,
  "createdAt"   TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt"   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "hlp_notification_rule_due_idx" ON "hlp_notification_rule" ("enabled", "nextDueAt");

CREATE TABLE IF NOT EXISTS "hlp_notification_delivery" (
  "id"             TEXT PRIMARY KEY,
  "notificationId" TEXT NOT NULL DEFAULT '',
  "ruleKey"        TEXT NOT NULL,
  "employeeKey"    TEXT NOT NULL,
  "windowKey"      TEXT NOT NULL,
  "level"          INTEGER NOT NULL DEFAULT 2,
  "colorHex"       TEXT NOT NULL DEFAULT '',
  "value"          REAL,
  "metricsJson"    TEXT NOT NULL DEFAULT '{}',
  "title"          TEXT NOT NULL DEFAULT '',
  "body"           TEXT NOT NULL DEFAULT '',
  "createdAt"      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE ("ruleKey", "employeeKey", "windowKey")
);
CREATE INDEX IF NOT EXISTS "hlp_notification_delivery_employee_idx" ON "hlp_notification_delivery" ("employeeKey", "createdAt");
CREATE INDEX IF NOT EXISTS "hlp_notification_delivery_rule_idx" ON "hlp_notification_delivery" ("ruleKey", "createdAt");

CREATE TABLE IF NOT EXISTS "hlp_notification_state" (
  "ruleKey"     TEXT NOT NULL,
  "employeeKey" TEXT NOT NULL,
  "streak"      INTEGER NOT NULL DEFAULT 0,
  "lastLevel"   INTEGER NOT NULL DEFAULT 0,
  "lastWindow"  TEXT,
  "lastValue"   REAL,
  "updatedAt"   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY ("ruleKey", "employeeKey")
);

-- Level palette (founder-authored JSON, editable in the console).
INSERT OR IGNORE INTO "Setting" ("key", "value", "updatedAt") VALUES (
  'notifications:levels',
  '[{"level":1,"colorName":"Green","hexColor":"#2E7D32","label":"Normal / Resolved","description":"Everything is operating normally, or a previous issue has been fixed."},{"level":2,"colorName":"Light Green","hexColor":"#689F38","label":"Info / Low","description":"A minor update or routine event occurred."},{"level":3,"colorName":"Yellow","hexColor":"#FBC02D","label":"Warning / Moderate","description":"An unusual spike or minor issue is detected."},{"level":4,"colorName":"Orange","hexColor":"#F57C00","label":"High / Major","description":"A significant problem is affecting users or operations."},{"level":5,"colorName":"Dark Red","hexColor":"#B71C1C","label":"Critical / Severe","description":"Total outage, security breach, or emergency."}]',
  datetime('now')
);
INSERT OR IGNORE INTO "Setting" ("key", "value", "updatedAt") VALUES (
  'notifications:settings',
  '{"maxPerEmployeePerHour":6,"sweepRulesPerTick":25}',
  datetime('now')
);
