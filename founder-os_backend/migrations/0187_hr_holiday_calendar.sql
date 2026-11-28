-- 0187_hr_holiday_calendar.sql
--
-- A holiday becomes a RULE, not a single row per day (founder request
-- 2026-11-28): one date, a continuous timespan, or every <weekday> inside a
-- window. Payroll keeps paying a holiday (it stays a working day), while
-- leave-day counting excludes it.
--
-- The old table had "date" NOT NULL UNIQUE, which cannot express a range.
-- Copy it aside, rebuild, and keep the single-date pointer for old rows.

CREATE TABLE IF NOT EXISTS "_backup_hr_holidays_20261128" AS
  SELECT * FROM "HumanResourcesHoliday";

CREATE TABLE "HumanResourcesHoliday_new" (
  "id" TEXT PRIMARY KEY,
  "date" TEXT,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "weekday" INTEGER,
  "kind" TEXT NOT NULL DEFAULT 'single',
  "name" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO "HumanResourcesHoliday_new"
  ("id", "date", "startDate", "endDate", "weekday", "kind", "name", "createdAt", "updatedAt")
SELECT "id", "date", "date", "date", NULL, 'single', "name", "createdAt", "updatedAt"
  FROM "HumanResourcesHoliday";

DROP TABLE "HumanResourcesHoliday";
ALTER TABLE "HumanResourcesHoliday_new" RENAME TO "HumanResourcesHoliday";

-- Only single-date rules share the legacy pointer; ranges/weekdays are
-- identified by their own window (duplicates are rejected in code).
CREATE UNIQUE INDEX IF NOT EXISTS "HumanResourcesHoliday_single_date_idx"
  ON "HumanResourcesHoliday" ("date") WHERE "kind" = 'single';
CREATE INDEX IF NOT EXISTS "HumanResourcesHoliday_window_idx"
  ON "HumanResourcesHoliday" ("startDate", "endDate");
