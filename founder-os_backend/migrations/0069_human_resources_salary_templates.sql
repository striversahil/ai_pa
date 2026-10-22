-- Formula-based salary templates and employee salary plans.
CREATE TABLE IF NOT EXISTS "HumanResourcesSalaryTemplate" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "inputMode" TEXT NOT NULL DEFAULT 'gross',
  "isDefault" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesSalaryTemplate_deleted_isDefault_idx" ON "HumanResourcesSalaryTemplate" ("deleted", "isDefault");

CREATE TABLE IF NOT EXISTS "HumanResourcesSalaryTemplateComponent" (
  "id" TEXT PRIMARY KEY,
  "templateId" TEXT NOT NULL REFERENCES "HumanResourcesSalaryTemplate"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "componentType" TEXT NOT NULL DEFAULT 'earning',
  "calcType" TEXT NOT NULL DEFAULT 'fixed',
  "value" REAL NOT NULL DEFAULT 0,
  "formula" TEXT,
  "cap" REAL,
  "floor" REAL,
  "isBasic" INTEGER NOT NULL DEFAULT 0,
  "order" INTEGER NOT NULL DEFAULT 0,
  "deleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "HumanResourcesSalaryTemplateComponent_templateId_deleted_order_idx" ON "HumanResourcesSalaryTemplateComponent" ("templateId", "deleted", "order");
CREATE UNIQUE INDEX IF NOT EXISTS "HumanResourcesSalaryTemplateComponent_templateId_code_key" ON "HumanResourcesSalaryTemplateComponent" ("templateId", "code") WHERE "code" IS NOT NULL;

ALTER TABLE "HumanResourcesMember" ADD COLUMN "salaryTemplateId" TEXT REFERENCES "HumanResourcesSalaryTemplate"("id") ON DELETE SET NULL;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "salaryInputMode" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "salaryInputAmount" REAL;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "salaryTemplateAppliedAt" TEXT;

ALTER TABLE "HumanResourcesSalaryComponent" ADD COLUMN "formula" TEXT;
ALTER TABLE "HumanResourcesSalaryComponent" ADD COLUMN "code" TEXT;
ALTER TABLE "HumanResourcesSalaryComponent" ADD COLUMN "cap" REAL;
ALTER TABLE "HumanResourcesSalaryComponent" ADD COLUMN "floor" REAL;
ALTER TABLE "HumanResourcesSalaryComponent" ADD COLUMN "templateId" TEXT REFERENCES "HumanResourcesSalaryTemplate"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "HumanResourcesSalaryComponent_templateId_idx" ON "HumanResourcesSalaryComponent" ("templateId");

INSERT OR IGNORE INTO "HumanResourcesSalaryTemplate" ("id", "name", "description", "inputMode", "isDefault") VALUES
  ('tpl_standard_gross', 'Standard gross structure', 'HR enters monthly gross. Basic, HRA, special allowance and statutory deductions are formula-driven.', 'gross', 1),
  ('tpl_standard_basic', 'Standard basic structure', 'HR enters monthly Basic. Allowances are built from Basic and statutory deductions are formula-driven.', 'basic', 0);

INSERT OR IGNORE INTO "HumanResourcesSalaryTemplateComponent" ("id", "templateId", "name", "code", "componentType", "calcType", "value", "formula", "isBasic", "order") VALUES
  ('tplg_basic', 'tpl_standard_gross', 'Basic', 'basic', 'earning', 'percent_gross', 50, NULL, 1, 0),
  ('tplg_hra', 'tpl_standard_gross', 'House Rent Allowance', 'hra', 'earning', 'percent_basic', 50, NULL, 0, 1),
  ('tplg_travel', 'tpl_standard_gross', 'Travel Allowance', 'travel', 'earning', 'fixed', 0, NULL, 0, 2),
  ('tplg_special', 'tpl_standard_gross', 'Special Allowance', 'special', 'earning', 'balance', 0, NULL, 0, 9),
  ('tplg_pf', 'tpl_standard_gross', 'Provident Fund', 'pf', 'deduction', 'formula', 0, 'min(basic, 15000) * 0.12', 0, 10),
  ('tplg_esi', 'tpl_standard_gross', 'Employee State Insurance', 'esi', 'deduction', 'formula', 0, 'if(gross <= 21000, gross * 0.0075, 0)', 0, 11),
  ('tplg_pt', 'tpl_standard_gross', 'Professional Tax', 'pt', 'deduction', 'fixed', 0, NULL, 0, 12),
  ('tplb_basic', 'tpl_standard_basic', 'Basic', 'basic', 'earning', 'formula', 0, 'input', 1, 0),
  ('tplb_hra', 'tpl_standard_basic', 'House Rent Allowance', 'hra', 'earning', 'percent_basic', 50, NULL, 0, 2),
  ('tplb_travel', 'tpl_standard_basic', 'Travel Allowance', 'travel', 'earning', 'fixed', 0, NULL, 0, 3),
  ('tplb_pf', 'tpl_standard_basic', 'Provident Fund', 'pf', 'deduction', 'formula', 0, 'min(basic, 15000) * 0.12', 0, 10),
  ('tplb_esi', 'tpl_standard_basic', 'Employee State Insurance', 'esi', 'deduction', 'formula', 0, 'if(gross <= 21000, gross * 0.0075, 0)', 0, 11),
  ('tplb_pt', 'tpl_standard_basic', 'Professional Tax', 'pt', 'deduction', 'fixed', 0, NULL, 0, 12);
