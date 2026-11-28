-- 0186_hr_shifts.sql
-- HR shifts (founder request 2026-11-28): HR defines individual employee
-- types with their own check-in / check-out window, then assigns a shift to
-- an employee; attendance derives "late" from that window.
--
--   HumanResourcesShift  one row per shift (name, optional employmentType,
--                        startTime/endTime HH:mm IST, graceMinutes).
--                        employmentType NULL = the company default shift.
--   HumanResourcesMember.shiftId  the assigned shift (NULL = fall back to
--                        the company default for the employment type).
--
-- The same migration retires the old `holiday` ATTENDANCE status: a holiday
-- is decided by HR in the holiday calendar, never typed per employee, so the
-- rows that used it are copied verbatim and deleted.
--
--   _backup_hr_attendance_holiday_20261128  the retired rows.

CREATE TABLE IF NOT EXISTS "HumanResourcesShift" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "employmentType" TEXT,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "graceMinutes" INTEGER NOT NULL DEFAULT 10,
  "active" INTEGER NOT NULL DEFAULT 1,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "updatedAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesShift_active_order_idx" ON "HumanResourcesShift" ("active", "order");

ALTER TABLE "HumanResourcesMember" ADD COLUMN "shiftId" TEXT REFERENCES "HumanResourcesShift"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "HumanResourcesMember_shiftId_idx" ON "HumanResourcesMember" ("shiftId");

CREATE TABLE IF NOT EXISTS _backup_hr_attendance_holiday_20261128 AS
  SELECT * FROM HumanResourcesAttendance WHERE status = 'holiday';
DELETE FROM HumanResourcesAttendance WHERE status = 'holiday';
