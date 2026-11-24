-- 0166_accounts_task_thread.sql — a task is a thread, not a card per day.
--
-- The accounts taskbar used to render one card per (template, due date) and
-- invented a fresh instance each day, so a task repeated on the 15th and 30th
-- read as two unrelated items and a silently missed day left no trace unless
-- somebody opened the dashboard. From here on one task = one thread:
--
--   AccountsTaskLog IS the thread entry (it is already unique on
--   (templateId, dueDate, slot)). entryKind separates a real due-day row from
--   the row the engine writes for a day nobody logged:
--     'instance'  — a normal due occurrence (default; every existing row)
--     'auto_miss' — written programmatically for a past due day with no human
--                   action. Renders "Task not done on <DATE>" and counts as
--                   not done until it is resolved.
--
--   lateNote* is the resolution: the accountant describes the late work. It is
--   an AUDIT trail, not a status change — the day stays not done (founder rule
--   2026-11-25); marking the work Done late is a separate, explicit action.
--
-- No index is added: the existing UNIQUE (templateId, dueDate, slot) already
-- serves thread reads by templateId (+ dueDate range) as a prefix.
--
-- All columns are additive with defaults, so this migration is a no-op for the
-- current backend and safe to apply before the code deploys.

ALTER TABLE "AccountsTaskLog" ADD COLUMN "entryKind" TEXT DEFAULT 'instance';
ALTER TABLE "AccountsTaskLog" ADD COLUMN "lateNote" TEXT;
ALTER TABLE "AccountsTaskLog" ADD COLUMN "lateNoteBy" TEXT;
ALTER TABLE "AccountsTaskLog" ADD COLUMN "lateNoteAt" DATETIME;

-- The schedule also needs a clock: "15 at 13:00, 30 at 18:30" is one task, and
-- the sheet's two "Bank Recon … 1 P.M / 6:30 P.M" rows become ONE template with
-- a time instead of two look-alike tasks. shortTitle keeps the sheet's long
-- parenthetical out of every list row.
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "dueTime" TEXT;
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "shortTitle" TEXT;
