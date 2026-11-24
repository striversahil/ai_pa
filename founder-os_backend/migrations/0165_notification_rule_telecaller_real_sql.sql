-- 0165_notification_rule_telecaller_real_sql.sql — apply the real query to the
-- rule the founder already created ("Telecaller Hourly Connected Call").
--
-- Migration 0164 seeded this rule with INSERT OR IGNORE, which correctly skipped
-- the existing row — the founder had already authored it in the console. This
-- migration upgrades THAT row in place (same key, same audience, same cadence)
-- to the production query:
--   · telecaller_id / value / level contract (one row per person);
--   · hourly_connected_call + attempted_calls + talk_seconds as real columns the
--     template can use (auto-detected as tokens);
--   · HAVING COUNT(*) >= 5 so a break, a late login or a half-hour cannot grade
--     someone who barely dialed;
--   · ?1/?2 window only (metric-sql now binds exactly what the SQL uses).
--
-- Guarded: only rewrites the row while it still carries the console SAMPLE
-- (no HAVING clause), so a hand-edited query is never clobbered. `enabled` is
-- deliberately untouched — the founder's Live/Paused choice is theirs.
UPDATE "hlp_notification_rule"
   SET "sqlText" =
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
       "titleTpl"    = 'Calling activity — {WINDOW}',
       "bodyTpl"     = '{AGENT_NAME} heads up you only have {HOURLY_CONNECTED_CALL} connected calls in last hour please improve your calling activity in the next hours',
       "description" = 'Grades every Telecaller by connected calls in the previous full IST hour (Auto-Dialer / phone call log). level 5 = zero connects, 1 = four or more. Judges only agents with at least 5 attempts in the hour.',
       "thresholdsJson" = '[]',
       "updatedAt"   = datetime('now')
 WHERE "key" = 'telecaller-hourly-connected-call'
   AND instr(upper("sqlText"), 'HAVING') = 0;
