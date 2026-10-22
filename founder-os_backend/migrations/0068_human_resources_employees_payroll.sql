-- Human Resources employee master, attendance, leave, holidays and payroll.
ALTER TABLE "HumanResourcesMember" ADD COLUMN "employeeCode" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "department" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "photoUrl" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "joiningDate" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "exitDate" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "employmentType" TEXT DEFAULT 'full_time';
ALTER TABLE "HumanResourcesMember" ADD COLUMN "active" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "dateOfBirth" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "address" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "emergencyContactName" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "emergencyContactPhone" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "pan" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "aadhaarLast4" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "bankName" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "bankAccountNumber" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "bankIfsc" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "pfNumber" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "esiNumber" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "notes" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "HumanResourcesMember_employeeCode_key" ON "HumanResourcesMember" ("employeeCode") WHERE "employeeCode" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "HumanResourcesMember_deleted_active_order_idx" ON "HumanResourcesMember" ("deleted", "active", "order");

CREATE TABLE IF NOT EXISTS "HumanResourcesSalaryComponent" (
  "id" TEXT PRIMARY KEY,
  "memberId" TEXT NOT NULL REFERENCES "HumanResourcesMember"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "componentType" TEXT NOT NULL,
  "calcType" TEXT NOT NULL DEFAULT 'fixed',
  "value" REAL NOT NULL DEFAULT 0,
  "isBasic" INTEGER NOT NULL DEFAULT 0,
  "order" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesSalaryComponent_memberId_deleted_order_idx" ON "HumanResourcesSalaryComponent" ("memberId", "deleted", "order");

CREATE TABLE IF NOT EXISTS "HumanResourcesAttendance" (
  "id" TEXT PRIMARY KEY,
  "memberId" TEXT NOT NULL REFERENCES "HumanResourcesMember"("id") ON DELETE CASCADE,
  "date" TEXT NOT NULL,
  "inTime" TEXT,
  "outTime" TEXT,
  "status" TEXT NOT NULL DEFAULT 'present',
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "HumanResourcesAttendance_memberId_date_key" ON "HumanResourcesAttendance" ("memberId", "date");
CREATE INDEX IF NOT EXISTS "HumanResourcesAttendance_date_deleted_idx" ON "HumanResourcesAttendance" ("date", "deleted");
CREATE INDEX IF NOT EXISTS "HumanResourcesAttendance_memberId_date_idx" ON "HumanResourcesAttendance" ("memberId", "date");

CREATE TABLE IF NOT EXISTS "HumanResourcesLeave" (
  "id" TEXT PRIMARY KEY,
  "memberId" TEXT NOT NULL REFERENCES "HumanResourcesMember"("id") ON DELETE CASCADE,
  "leaveType" TEXT NOT NULL,
  "paid" INTEGER NOT NULL DEFAULT 1,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "days" REAL NOT NULL DEFAULT 0,
  "reason" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesLeave_memberId_startDate_idx" ON "HumanResourcesLeave" ("memberId", "startDate");
CREATE INDEX IF NOT EXISTS "HumanResourcesLeave_startDate_endDate_deleted_idx" ON "HumanResourcesLeave" ("startDate", "endDate", "deleted");

CREATE TABLE IF NOT EXISTS "HumanResourcesHoliday" (
  "id" TEXT PRIMARY KEY,
  "date" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesHoliday_date_idx" ON "HumanResourcesHoliday" ("date");

CREATE TABLE IF NOT EXISTS "HumanResourcesSalarySlip" (
  "id" TEXT PRIMARY KEY,
  "memberId" TEXT NOT NULL REFERENCES "HumanResourcesMember"("id") ON DELETE CASCADE,
  "month" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "employeeName" TEXT NOT NULL,
  "employeeCode" TEXT,
  "designation" TEXT,
  "department" TEXT,
  "workingDays" REAL NOT NULL DEFAULT 0,
  "payableDays" REAL NOT NULL DEFAULT 0,
  "presentDays" REAL NOT NULL DEFAULT 0,
  "halfDays" REAL NOT NULL DEFAULT 0,
  "absentDays" REAL NOT NULL DEFAULT 0,
  "paidLeaveDays" REAL NOT NULL DEFAULT 0,
  "unpaidLeaveDays" REAL NOT NULL DEFAULT 0,
  "holidayDays" REAL NOT NULL DEFAULT 0,
  "unmarkedDays" REAL NOT NULL DEFAULT 0,
  "monthlyGross" REAL NOT NULL DEFAULT 0,
  "earnedGross" REAL NOT NULL DEFAULT 0,
  "absenceDeduction" REAL NOT NULL DEFAULT 0,
  "componentDeductions" REAL NOT NULL DEFAULT 0,
  "manualDeductions" REAL NOT NULL DEFAULT 0,
  "totalDeductions" REAL NOT NULL DEFAULT 0,
  "netPay" REAL NOT NULL DEFAULT 0,
  "snapshot" TEXT NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "finalizedAt" TEXT,
  "paidAt" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "HumanResourcesSalarySlip_memberId_month_key" ON "HumanResourcesSalarySlip" ("memberId", "month");
CREATE INDEX IF NOT EXISTS "HumanResourcesSalarySlip_month_status_idx" ON "HumanResourcesSalarySlip" ("month", "status");
