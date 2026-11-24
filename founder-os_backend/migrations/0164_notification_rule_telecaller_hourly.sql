-- 0164_notification_rule_telecaller_hourly.sql — the first REAL rule, ready to use.
--
-- "Telecaller Hourly Connected Call": reads the Auto-Dialer / phone call log for
-- the previous full IST hour and grades each Telecaller by connected calls.
-- Seeded PAUSED (enabled = 0): press "Test" to see the real headers + rows, then
-- "Run now" to notify immediately, then flip Live for the hourly cron.
--
-- Why HAVING COUNT(*) >= 5: an agent on a break, on leave, or just logged in has
-- too little activity to grade — the rule only speaks about people who actually
-- dialed. Zero-attempt agents produce no row at all (no DeviceCall to group).
--
-- Columns: DeviceCall.attemptAt is ISO-8601 UTC text, status 'CONNECTED' on
-- answer (migrations/0107_device_calls.sql).

INSERT OR IGNORE INTO "hlp_notification_rule" (
  "id", "key", "name", "description", "enabled",
  "audienceJson", "sqlText", "titleTpl", "bodyTpl",
  "cadenceJson", "thresholdsJson", "escalationJson", "createdBy"
) VALUES (
  'nr_telecaller_hourly',
  'telecaller-hourly-connected-call',
  'Telecaller Hourly Connected Call',
  'Grades every Telecaller by connected calls in the previous full IST hour. Fires hourly; level 5 = zero connects, level 1 = 4 or more. Seeded paused — Test, then Run now, then go Live.',
  0,
  '{"positions":["Telecaller"]}',
  'SELECT d.telecallerId AS telecaller_id,
       SUM(CASE WHEN UPPER(d.status) = ''CONNECTED'' THEN 1 ELSE 0 END) AS hourly_connected_call,
       COUNT(*) AS attempted_calls,
       SUM(CASE WHEN UPPER(d.status) = ''CONNECTED'' THEN d.durationSec ELSE 0 END) AS talk_seconds,
       SUM(CASE WHEN UPPER(d.status) = ''CONNECTED'' THEN 1 ELSE 0 END) AS value,
       CASE
         WHEN SUM(CASE WHEN UPPER(d.status) = ''CONNECTED'' THEN 1 ELSE 0 END) = 0 THEN 5
         WHEN SUM(CASE WHEN UPPER(d.status) = ''CONNECTED'' THEN 1 ELSE 0 END) < 2 THEN 4
         WHEN SUM(CASE WHEN UPPER(d.status) = ''CONNECTED'' THEN 1 ELSE 0 END) < 4 THEN 3
         ELSE 1
       END AS level
  FROM DeviceCall d
 WHERE d.attemptAt >= ?1
   AND d.attemptAt < ?2
 GROUP BY d.telecallerId
HAVING COUNT(*) >= 5',
  'Calling activity — {WINDOW}',
  '{AGENT_NAME} heads up you only have {HOURLY_CONNECTED_CALL} connected calls in last hour please improve your calling activity in the next hours',
  '{"kind":"hourly"}',
  '[]',
  '{"bumpEvery":0,"maxLevel":5,"notifyOnRecovery":true}',
  'migration:0164'
);
