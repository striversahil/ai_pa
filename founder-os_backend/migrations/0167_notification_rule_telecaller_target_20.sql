-- 0167_notification_rule_telecaller_target_20.sql — grade EVERY on-duty
-- Telecaller hourly against the real target (20 connected calls / hour).
--
-- Why the old rule only reached two people: it was driven FROM DeviceCall
-- (WHERE attemptAt >= ?1 AND attemptAt < ?2 GROUP BY telecallerId HAVING/…) so an
-- agent whose phone wrote no call row in that window produced NO row at all —
-- the engine can only notify people its SQL returns. On top of that the CASE
-- graded 4+ connects as level 1 (silent), and migration 0165 never landed on the
-- remote database, so the live rule was still the console sample.
--
-- The rule now starts from the people who owe the number, and the call log only
-- supplies the numbers:
--   HumanResourcesMember (designation 'Telecaller', active, not deleted)
--     LEFT JOIN Telecaller  by email (loginEmail first) → roster id DeviceCall keys on
--     LEFT JOIN the hour's DeviceCall aggregate
-- so a person with zero dialer rows is a real row with value 0, not a missing row.
--
-- "Not absent that day" (?3 = IST day) is enforced in SQL:
--   · approved FULL-DAY leave covering ?3 (half-day / short leave still worked)
--   · HR attendance explicitly marked 'absent' for ?3
--   · an HR holiday on ?3
--   · a Sales holiday on ?3
--   · Sunday (the sales calendar's closed day — Sundays accrue ₹0 by design)
-- Windows that end outside 10:00–21:00 IST are not graded, so the off-shift hours
-- never produce a false "0 connected calls" escalation.
--
-- Ladder (the row's `level` column wins over thresholds):
--   >= 20 → 1 (Normal / Resolved — recorded, never toasted)
--   15–19 → 2 · 10–14 → 3 · 5–9 → 4 · 0–4 → 5
--
-- Guarded/idempotent: only rewrites a rule that is not already people-driven, so
-- re-running this file is a no-op and the founder's Live/Paused choice, audience
-- and cadence are untouched.

UPDATE "hlp_notification_rule"
   SET "sqlText" =
         'WITH calls AS (
  SELECT d.telecallerId AS tid,
         SUM(CASE WHEN UPPER(d.status) = ''CONNECTED'' THEN 1 ELSE 0 END) AS connected,
         COUNT(*) AS attempts,
         SUM(CASE WHEN UPPER(d.status) = ''CONNECTED'' THEN COALESCE(d.durationSec, 0) ELSE 0 END) AS talk
    FROM DeviceCall d
   WHERE d.attemptAt >= ?1 AND d.attemptAt < ?2
   GROUP BY d.telecallerId
)
SELECT m.name AS agent_name,
       m.id AS employee_key,
       COALESCE(c.connected, 0) AS hourly_connected_call,
       COALESCE(c.attempts, 0) AS attempted_calls,
       COALESCE(c.talk, 0) AS talk_seconds,
       COALESCE(c.connected, 0) AS value,
       CASE
         WHEN COALESCE(c.connected, 0) >= 20 THEN 1
         WHEN COALESCE(c.connected, 0) >= 15 THEN 2
         WHEN COALESCE(c.connected, 0) >= 10 THEN 3
         WHEN COALESCE(c.connected, 0) >= 5 THEN 4
         ELSE 5
       END AS level
  FROM HumanResourcesMember m
  LEFT JOIN Telecaller t
         ON lower(t.email) = lower(COALESCE(NULLIF(m.loginEmail, ''''), m.email))
        AND COALESCE(t.deleted, 0) = 0
  LEFT JOIN calls c ON c.tid = t.id
 WHERE COALESCE(m.deleted, 0) = 0
   AND COALESCE(m.active, 1) = 1
   AND m.designation = ''Telecaller''
   -- not on approved full-day leave that day
   AND NOT EXISTS (
         SELECT 1 FROM HumanResourcesLeave l
          WHERE l.memberId = m.id
            AND COALESCE(l.deleted, 0) = 0
            AND l.status = ''approved''
            AND l.durationType = ''full_day''
            AND l.startDate <= ?3
            AND l.endDate >= ?3)
   -- not marked absent by HR on that day
   AND NOT EXISTS (
         SELECT 1 FROM HumanResourcesAttendance a
          WHERE a.memberId = m.id
            AND a.date = ?3
            AND COALESCE(a.deleted, 0) = 0
            AND a.status = ''absent'')
   -- not a holiday / closed day
   AND NOT EXISTS (SELECT 1 FROM HumanResourcesHoliday h WHERE h.date = ?3)
   AND NOT EXISTS (SELECT 1 FROM SalesHoliday s WHERE s.day = ?3)
   AND strftime(''%w'', ?3) <> ''0''
   -- only grade an hour inside the 10:00–21:00 IST working band
   AND ((CAST(substr(?2, 12, 2) AS INTEGER) * 60 + CAST(substr(?2, 15, 2) AS INTEGER) + 330) % 1440) BETWEEN 600 AND 1260
 ORDER BY m.name',
       "titleTpl"    = 'Calling activity — {WINDOW}',
       "bodyTpl"     = '{AGENT_NAME} heads up you only have {HOURLY_CONNECTED_CALL} connected calls in {WINDOW} (target 20) — {ATTEMPTED_CALLS} attempts, {TALK_SECONDS}s talk time. Please improve your calling activity in the next hour.',
       "description" = 'Grades every on-duty Telecaller by connected calls in the previous full IST hour against the 20/hour target. Seat-driven (HR register), so an agent with no dialer rows is still graded at 0. Skips approved full-day leave, HR-marked absence, holidays, Sundays and hours outside 10:00–21:00 IST. Levels: >=20 → 1, 15–19 → 2, 10–14 → 3, 5–9 → 4, 0–4 → 5.',
       "thresholdsJson" = '[]',
       "escalationJson" = '{}',
       "updatedAt"   = datetime('now')
 WHERE "key" = 'telecaller-hourly-connected-call'
   AND instr(upper("sqlText"), 'HUMANRESOURCESMEMBER') = 0;
