-- 0188: company leave/attendance policy + the paid portion of a leave.
--
-- One singleton row (`id = 'company'`) holds the validated policy JSON. The
-- policy defaults reproduce the pre-0188 behaviour (no deductions), so the
-- payroll of an unconfigured company does not move by a rupee.
CREATE TABLE IF NOT EXISTS "HumanResourcesPolicy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "config" TEXT NOT NULL,
  "updatedBy" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Paid days computed from the allowance at decision/record time. NULL keeps
-- legacy rows on their stored `paid` flag (no backfill, no behaviour change).
ALTER TABLE "HumanResourcesLeave" ADD COLUMN "paidDays" REAL;
