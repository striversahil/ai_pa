-- 0152: employee leave applications — full day / half day / short leave.
--
-- The existing HumanResourcesLeave table becomes a request lifecycle instead of
-- an HR-only record. Every row now carries a status, so one table keeps feeding
-- attendance + payroll (no second source of truth):
--
--   status        'approved' (default) | 'pending' | 'rejected'
--                 Existing rows are approved, so nothing changes for them.
--   durationType  'full_day' (default) | 'half_day' | 'short'
--                 half_day is worth 0.5 working days; short leave is a recorded
--                 time window that does not move pay.
--   requestedBy   login label of the employee who applied (NULL for HR records).
--   fromTime/toTime  optional HH:mm window (short leave / half day).
--   decidedBy / decidedAt / decisionNote  the HR decision (note mandatory on reject).
--
-- Consumers must read approved rows only: attendance auto-marks and payroll
-- deductions never count a pending or rejected request.
ALTER TABLE "HumanResourcesLeave" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "HumanResourcesLeave" ADD COLUMN "durationType" TEXT NOT NULL DEFAULT 'full_day';
ALTER TABLE "HumanResourcesLeave" ADD COLUMN "requestedBy" TEXT;
ALTER TABLE "HumanResourcesLeave" ADD COLUMN "fromTime" TEXT;
ALTER TABLE "HumanResourcesLeave" ADD COLUMN "toTime" TEXT;
ALTER TABLE "HumanResourcesLeave" ADD COLUMN "decidedBy" TEXT;
ALTER TABLE "HumanResourcesLeave" ADD COLUMN "decidedAt" TEXT;
ALTER TABLE "HumanResourcesLeave" ADD COLUMN "decisionNote" TEXT;

CREATE INDEX IF NOT EXISTS "HumanResourcesLeave_status_startDate_idx"
  ON "HumanResourcesLeave" ("status", "startDate");
