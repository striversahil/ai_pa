-- Phase 1 identity (2026-11-12): single employee roster + org + roles/permissions.
-- Backfill is idempotent (INSERT OR IGNORE on reused roster ids) so it can be
-- re-run to catch stragglers between apply and dual-write landing.
-- Email matching is exact on lower(trim()): shared/blank emails are skipped,
-- never guessed. Precedence on cross-roster dup email: telecaller > accountant
-- > marketer > HR (first wins; verify query lists the skipped for cleanup).

CREATE TABLE IF NOT EXISTS "core_department" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL DEFAULT '',
  "parentId" TEXT,
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "core_position" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL DEFAULT '',
  "departmentId" TEXT REFERENCES "core_department"("id"),
  "rank" INTEGER NOT NULL DEFAULT 100,
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "core_team" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL DEFAULT '',
  "departmentId" TEXT REFERENCES "core_department"("id"),
  "regionId" TEXT REFERENCES "core_region"("id"),
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "core_region" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL DEFAULT '',
  "states" TEXT NOT NULL DEFAULT '[]',
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "core_employee" (
  "id" TEXT PRIMARY KEY,
  "employeeCode" TEXT UNIQUE,
  "fullName" TEXT NOT NULL DEFAULT '',
  "displayName" TEXT,
  "workEmail" TEXT,
  "phoneE164" TEXT,
  "whatsappE164" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "sourceTable" TEXT NOT NULL DEFAULT '',
  "grade" TEXT,
  "neodoveUserId" TEXT,
  "neodoveUserName" TEXT,
  "absentSince" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "core_employee_email_idx" ON "core_employee"("workEmail");
CREATE INDEX IF NOT EXISTS "core_employee_status_idx" ON "core_employee"("status");

CREATE TABLE IF NOT EXISTS "core_emp_dept" (
  "id" TEXT PRIMARY KEY,
  "employeeId" TEXT NOT NULL REFERENCES "core_employee"("id") ON DELETE CASCADE,
  "departmentId" TEXT NOT NULL REFERENCES "core_department"("id"),
  "isPrimary" INTEGER NOT NULL DEFAULT 1,
  "validFrom" TEXT NOT NULL DEFAULT (datetime('now')),
  "validTo" TEXT,
  "reason" TEXT
);
CREATE INDEX IF NOT EXISTS "core_emp_dept_emp_idx" ON "core_emp_dept"("employeeId", "validTo");

CREATE TABLE IF NOT EXISTS "core_emp_position" (
  "id" TEXT PRIMARY KEY,
  "employeeId" TEXT NOT NULL REFERENCES "core_employee"("id") ON DELETE CASCADE,
  "positionId" TEXT NOT NULL REFERENCES "core_position"("id"),
  "isPrimary" INTEGER NOT NULL DEFAULT 1,
  "validFrom" TEXT NOT NULL DEFAULT (datetime('now')),
  "validTo" TEXT,
  "reason" TEXT
);
CREATE INDEX IF NOT EXISTS "core_emp_position_emp_idx" ON "core_emp_position"("employeeId", "validTo");

CREATE TABLE IF NOT EXISTS "core_emp_region" (
  "id" TEXT PRIMARY KEY,
  "employeeId" TEXT NOT NULL REFERENCES "core_employee"("id") ON DELETE CASCADE,
  "regionId" TEXT NOT NULL REFERENCES "core_region"("id"),
  "responsibility" TEXT NOT NULL DEFAULT 'PRIMARY',
  "validFrom" TEXT NOT NULL DEFAULT (datetime('now')),
  "validTo" TEXT,
  "reason" TEXT
);
CREATE INDEX IF NOT EXISTS "core_emp_region_emp_idx" ON "core_emp_region"("employeeId", "validTo");

CREATE TABLE IF NOT EXISTS "core_team_member" (
  "id" TEXT PRIMARY KEY,
  "teamId" TEXT NOT NULL REFERENCES "core_team"("id") ON DELETE CASCADE,
  "employeeId" TEXT NOT NULL REFERENCES "core_employee"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "validFrom" TEXT NOT NULL DEFAULT (datetime('now')),
  "validTo" TEXT
);

CREATE TABLE IF NOT EXISTS "core_report_line" (
  "id" TEXT PRIMARY KEY,
  "employeeId" TEXT NOT NULL REFERENCES "core_employee"("id") ON DELETE CASCADE,
  "managerId" TEXT NOT NULL REFERENCES "core_employee"("id"),
  "type" TEXT NOT NULL DEFAULT 'DIRECT',
  "validFrom" TEXT NOT NULL DEFAULT (datetime('now')),
  "validTo" TEXT
);

CREATE TABLE IF NOT EXISTS "core_user_link" (
  "authUserId" TEXT PRIMARY KEY,
  "employeeId" TEXT NOT NULL UNIQUE REFERENCES "core_employee"("id"),
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "core_service_account" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL DEFAULT '',
  "description" TEXT,
  "apiKeyHash" TEXT,
  "active" INTEGER NOT NULL DEFAULT 1,
  "lastUsedAt" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "core_role" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL DEFAULT '',
  "description" TEXT,
  "isSystem" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "core_position_role" (
  "positionId" TEXT NOT NULL REFERENCES "core_position"("id"),
  "roleId" TEXT NOT NULL REFERENCES "core_role"("id"),
  PRIMARY KEY ("positionId", "roleId")
);

CREATE TABLE IF NOT EXISTS "core_emp_role" (
  "id" TEXT PRIMARY KEY,
  "employeeId" TEXT NOT NULL REFERENCES "core_employee"("id") ON DELETE CASCADE,
  "roleId" TEXT NOT NULL REFERENCES "core_role"("id"),
  "reason" TEXT,
  "validFrom" TEXT NOT NULL DEFAULT (datetime('now')),
  "validTo" TEXT
);

CREATE TABLE IF NOT EXISTS "core_perm_rule" (
  "id" TEXT PRIMARY KEY,
  "roleId" TEXT NOT NULL REFERENCES "core_role"("id") ON DELETE CASCADE,
  "entityType" TEXT NOT NULL,
  "fieldName" TEXT NOT NULL DEFAULT '*',
  "action" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'OWN',
  "effect" TEXT NOT NULL DEFAULT 'ALLOW',
  "conditions" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "core_perm_rule_role_idx" ON "core_perm_rule"("roleId", "entityType", "action");

CREATE TABLE IF NOT EXISTS "core_access_config" (
  "entityType" TEXT PRIMARY KEY,
  "ownerField" TEXT,
  "regionField" TEXT,
  "departmentField" TEXT,
  "customerField" TEXT,
  "sensitivity" TEXT NOT NULL DEFAULT 'NORMAL',
  "logViews" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "core_field_policy" (
  "id" TEXT PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "fieldName" TEXT NOT NULL,
  "editable" INTEGER NOT NULL DEFAULT 1,
  "derived" INTEGER NOT NULL DEFAULT 0,
  "requiresApprovalType" TEXT,
  "sensitivity" TEXT NOT NULL DEFAULT 'NORMAL',
  "notes" TEXT,
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE ("entityType", "fieldName")
);

CREATE TABLE IF NOT EXISTS "core_series" (
  "key" TEXT PRIMARY KEY,
  "nextNumber" INTEGER NOT NULL DEFAULT 1
);

CREATE TRIGGER IF NOT EXISTS "trg_no_delete_core_employee" BEFORE DELETE ON "core_employee"
BEGIN SELECT RAISE(ABORT, 'core_employee rows are never deleted — set INACTIVE instead'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_delete_core_user_link" BEFORE DELETE ON "core_user_link"
BEGIN SELECT RAISE(ABORT, 'core_user_link rows are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS "trg_no_delete_core_role" BEFORE DELETE ON "core_role"
BEGIN SELECT RAISE(ABORT, 'core_role rows are never deleted'); END;

-- ── Seeds: organisation ──
INSERT OR IGNORE INTO "core_department" ("id", "code", "name") VALUES
  ('dept-mgmt', 'MANAGEMENT', 'Management'),
  ('dept-sales', 'SALES', 'Sales'),
  ('dept-accounts', 'ACCOUNTS', 'Accounts'),
  ('dept-purchase', 'PURCHASE', 'Purchase'),
  ('dept-inventory', 'INVENTORY', 'Inventory / Store'),
  ('dept-dispatch', 'DISPATCH', 'Dispatch'),
  ('dept-hr', 'HR', 'Human Resources'),
  ('dept-marketing', 'MARKETING', 'Marketing');

INSERT OR IGNORE INTO "core_position" ("id", "code", "name", "departmentId", "rank") VALUES
  ('pos-founder', 'FOUNDER', 'Founder', 'dept-mgmt', 0),
  ('pos-md', 'MD', 'Managing Director', 'dept-mgmt', 5),
  ('pos-sales-head', 'SALES_HEAD', 'Sales Head', 'dept-sales', 10),
  ('pos-tl1', 'TL1', 'Team Lead 1', 'dept-sales', 20),
  ('pos-tl2', 'TL2', 'Team Lead 2', 'dept-sales', 30),
  ('pos-sales-exec', 'SALES_EXEC', 'Sales Executive / Telecaller', 'dept-sales', 50),
  ('pos-field-exec', 'FIELD_EXEC', 'Field Executive', 'dept-sales', 50),
  ('pos-accounts-head', 'ACCOUNTS_HEAD', 'Accounts Head', 'dept-accounts', 10),
  ('pos-accountant', 'ACCOUNTANT', 'Accountant', 'dept-accounts', 40),
  ('pos-purchase-exec', 'PURCHASE_EXEC', 'Purchase Executive', 'dept-purchase', 40),
  ('pos-store-keeper', 'STORE_KEEPER', 'Store Keeper', 'dept-inventory', 40),
  ('pos-dispatch-head', 'DISPATCH_HEAD', 'Dispatch Head', 'dept-dispatch', 10),
  ('pos-dispatch-exec', 'DISPATCH_EXEC', 'Dispatch Executive', 'dept-dispatch', 40),
  ('pos-hr-exec', 'HR_EXEC', 'HR Executive', 'dept-hr', 40),
  ('pos-marketing-mgr', 'MARKETING_MGR', 'Marketing Manager', 'dept-marketing', 30);

INSERT OR IGNORE INTO "core_region" ("id", "code", "name", "states") VALUES
  ('region-r1', 'R1', 'Region 1', '[]'),
  ('region-r2', 'R2', 'Region 2', '[]'),
  ('region-r3', 'R3', 'Region 3', '[]'),
  ('region-r4', 'R4', 'Region 4', '[]');

-- ── Seeds: roles (md = dormant oversight: VIEW-only, no holder yet) ──
INSERT OR IGNORE INTO "core_role" ("id", "key", "name", "isSystem") VALUES
  ('role-founder', 'founder', 'Founder (full oversight)', 1),
  ('role-md', 'md', 'Managing Director (read-only oversight)', 1),
  ('role-sales-staff', 'sales_staff', 'Sales staff', 1),
  ('role-sales-tl', 'sales_tl', 'Sales team lead', 1),
  ('role-sales-head', 'sales_head', 'Sales head', 1),
  ('role-accounts', 'accounts', 'Accounts', 1),
  ('role-accounts-head', 'accounts_head', 'Accounts head', 1),
  ('role-purchase', 'purchase', 'Purchase', 1),
  ('role-store', 'store', 'Store / inventory', 1),
  ('role-dispatch', 'dispatch', 'Dispatch', 1);

INSERT OR IGNORE INTO "core_position_role" ("positionId", "roleId") VALUES
  ('pos-founder', 'role-founder'),
  ('pos-md', 'role-md'),
  ('pos-sales-head', 'role-sales-head'),
  ('pos-sales-head', 'role-sales-tl'),
  ('pos-sales-head', 'role-sales-staff'),
  ('pos-tl1', 'role-sales-tl'),
  ('pos-tl1', 'role-sales-staff'),
  ('pos-tl2', 'role-sales-tl'),
  ('pos-tl2', 'role-sales-staff'),
  ('pos-sales-exec', 'role-sales-staff'),
  ('pos-field-exec', 'role-sales-staff'),
  ('pos-accounts-head', 'role-accounts-head'),
  ('pos-accounts-head', 'role-accounts'),
  ('pos-accountant', 'role-accounts'),
  ('pos-purchase-exec', 'role-purchase'),
  ('pos-store-keeper', 'role-store'),
  ('pos-dispatch-head', 'role-dispatch'),
  ('pos-dispatch-exec', 'role-dispatch');

-- ── Seeds: permission matrix (mirror of current scope behavior) ──
-- founder: everything. md: VIEW everywhere (read-only oversight, incl. margins).
INSERT OR IGNORE INTO "core_perm_rule" ("id", "roleId", "entityType", "fieldName", "action", "scope") VALUES
  ('pm-founder-all', 'role-founder', '*', '*', 'VIEW', 'ALL'),
  ('pm-founder-create', 'role-founder', '*', '*', 'CREATE', 'ALL'),
  ('pm-founder-edit', 'role-founder', '*', '*', 'EDIT', 'ALL'),
  ('pm-founder-approve', 'role-founder', '*', '*', 'APPROVE', 'ALL'),
  ('pm-founder-transition', 'role-founder', '*', '*', 'TRANSITION', 'ALL'),
  ('pm-founder-export', 'role-founder', '*', '*', 'EXPORT', 'ALL'),
  ('pm-md-view', 'role-md', '*', '*', 'VIEW', 'ALL'),
  ('pm-staff-ws', 'role-sales-staff', 'screen:sales_mywork', '*', 'VIEW', 'ALL'),
  ('pm-staff-enq-v', 'role-sales-staff', 'SalesEnquiry', '*', 'VIEW', 'OWN'),
  ('pm-staff-enq-c', 'role-sales-staff', 'SalesEnquiry', '*', 'CREATE', 'OWN'),
  ('pm-staff-enq-e', 'role-sales-staff', 'SalesEnquiry', '*', 'EDIT', 'OWN'),
  ('pm-staff-est-v', 'role-sales-staff', 'SalesEstimate', '*', 'VIEW', 'OWN'),
  ('pm-staff-est-c', 'role-sales-staff', 'SalesEstimate', '*', 'CREATE', 'OWN'),
  ('pm-staff-est-e', 'role-sales-staff', 'SalesEstimate', '*', 'EDIT', 'OWN'),
  ('pm-staff-so-v', 'role-sales-staff', 'SalesOrder', '*', 'VIEW', 'OWN'),
  ('pm-staff-so-c', 'role-sales-staff', 'SalesOrder', '*', 'CREATE', 'OWN'),
  ('pm-staff-cust-v', 'role-sales-staff', 'Customer', '*', 'VIEW', 'OWN'),
  ('pm-staff-cust-c', 'role-sales-staff', 'Customer', '*', 'CREATE', 'OWN'),
  ('pm-staff-cust-e', 'role-sales-staff', 'Customer', '*', 'EDIT', 'OWN'),
  ('pm-staff-cust-export-deny', 'role-sales-staff', 'Customer', '*', 'EXPORT', 'ALL'),
  ('pm-staff-inv-v', 'role-sales-staff', 'Invoice', '*', 'VIEW', 'OWN'),
  ('pm-staff-prod-v', 'role-sales-staff', 'Product', '*', 'VIEW', 'ALL'),
  ('pm-staff-act-v', 'role-sales-staff', 'BusinessAction', '*', 'VIEW', 'OWN'),
  ('pm-staff-act-e', 'role-sales-staff', 'BusinessAction', '*', 'EDIT', 'OWN'),
  ('pm-tl-ws', 'role-sales-tl', 'screen:sales_team', '*', 'VIEW', 'ALL'),
  ('pm-tl-enq-v', 'role-sales-tl', 'SalesEnquiry', '*', 'VIEW', 'REGION'),
  ('pm-tl-enq-e', 'role-sales-tl', 'SalesEnquiry', '*', 'EDIT', 'REGION'),
  ('pm-tl-est-v', 'role-sales-tl', 'SalesEstimate', '*', 'VIEW', 'REGION'),
  ('pm-tl-est-e', 'role-sales-tl', 'SalesEstimate', '*', 'EDIT', 'REGION'),
  ('pm-tl-so-v', 'role-sales-tl', 'SalesOrder', '*', 'VIEW', 'REGION'),
  ('pm-tl-cust-v', 'role-sales-tl', 'Customer', '*', 'VIEW', 'REGION'),
  ('pm-tl-cust-export-deny', 'role-sales-tl', 'Customer', '*', 'EXPORT', 'ALL'),
  ('pm-tl-act-v', 'role-sales-tl', 'BusinessAction', '*', 'VIEW', 'TEAM'),
  ('pm-tl-act-e', 'role-sales-tl', 'BusinessAction', '*', 'EDIT', 'TEAM'),
  ('pm-head-ws', 'role-sales-head', 'screen:sales_manage', '*', 'VIEW', 'ALL'),
  ('pm-head-enq', 'role-sales-head', 'SalesEnquiry', '*', 'VIEW', 'DEPARTMENT'),
  ('pm-head-est', 'role-sales-head', 'SalesEstimate', '*', 'VIEW', 'DEPARTMENT'),
  ('pm-head-so', 'role-sales-head', 'SalesOrder', '*', 'VIEW', 'DEPARTMENT'),
  ('pm-head-cust-v', 'role-sales-head', 'Customer', '*', 'VIEW', 'ALL'),
  ('pm-head-cust-e', 'role-sales-head', 'Customer', '*', 'EDIT', 'ALL'),
  ('pm-head-act', 'role-sales-head', 'BusinessAction', '*', 'VIEW', 'DEPARTMENT'),
  ('pm-acct-ws', 'role-accounts', 'screen:accounts_desk', '*', 'VIEW', 'ALL'),
  ('pm-acct-so-v', 'role-accounts', 'SalesOrder', '*', 'VIEW', 'ALL'),
  ('pm-acct-inv', 'role-accounts', 'Invoice', '*', 'VIEW', 'ALL'),
  ('pm-acct-inv-c', 'role-accounts', 'Invoice', '*', 'CREATE', 'ALL'),
  ('pm-acct-inv-e', 'role-accounts', 'Invoice', '*', 'EDIT', 'ALL'),
  ('pm-acct-rcpt', 'role-accounts', 'PaymentReceipt', '*', 'VIEW', 'ALL'),
  ('pm-acct-rcpt-c', 'role-accounts', 'PaymentReceipt', '*', 'CREATE', 'ALL'),
  ('pm-acct-cust-v', 'role-accounts', 'Customer', '*', 'VIEW', 'ALL'),
  ('pm-accthead-export', 'role-accounts-head', 'Invoice', '*', 'EXPORT', 'ALL'),
  ('pm-pur-ws', 'role-purchase', 'screen:purchase_desk', '*', 'VIEW', 'ALL'),
  ('pm-pur-sup', 'role-purchase', 'Supplier', '*', 'VIEW', 'ALL'),
  ('pm-pur-sup-c', 'role-purchase', 'Supplier', '*', 'CREATE', 'ALL'),
  ('pm-pur-po', 'role-purchase', 'PurchaseOrder', '*', 'VIEW', 'ALL'),
  ('pm-pur-po-c', 'role-purchase', 'PurchaseOrder', '*', 'CREATE', 'ALL'),
  ('pm-store-ws', 'role-store', 'screen:store', '*', 'VIEW', 'ALL'),
  ('pm-store-prod', 'role-store', 'Product', '*', 'VIEW', 'ALL'),
  ('pm-store-stock', 'role-store', 'StockAvailability', '*', 'VIEW', 'ALL'),
  ('pm-disp-ws', 'role-dispatch', 'screen:dispatch_board', '*', 'VIEW', 'ALL'),
  ('pm-disp-so-v', 'role-dispatch', 'SalesOrder', '*', 'VIEW', 'ALL'),
  ('pm-disp-d', 'role-dispatch', 'Dispatch', '*', 'VIEW', 'ALL'),
  ('pm-disp-d-c', 'role-dispatch', 'Dispatch', '*', 'CREATE', 'ALL'),
  ('pm-disp-d-e', 'role-dispatch', 'Dispatch', '*', 'EDIT', 'ALL');

-- DENY rows ride the same table with effect='DENY' (priority 10 beats ALLOW 100).
INSERT OR IGNORE INTO "core_perm_rule" ("id", "roleId", "entityType", "fieldName", "action", "scope", "effect", "priority") VALUES
  ('pm-deny-staff-export', 'role-sales-staff', 'Customer', '*', 'EXPORT', 'ALL', 'DENY', 10),
  ('pm-deny-tl-export', 'role-sales-tl', 'Customer', '*', 'EXPORT', 'ALL', 'DENY', 10);

INSERT OR IGNORE INTO "core_access_config" ("entityType", "ownerField", "regionField", "departmentField", "customerField", "sensitivity", "logViews") VALUES
  ('SalesEnquiry', 'ownerId', 'regionId', NULL, 'customerId', 'NORMAL', 1),
  ('SalesEstimate', 'ownerId', 'regionId', NULL, 'customerId', 'NORMAL', 1),
  ('SalesOrder', 'ownerId', 'regionId', NULL, 'customerId', 'NORMAL', 1),
  ('Invoice', NULL, 'regionId', NULL, 'customerId', 'NORMAL', 1),
  ('Customer', 'assignment:SALES_OWNER', 'assignment:region', NULL, 'id', 'SENSITIVE', 1),
  ('PaymentReceipt', NULL, NULL, NULL, 'customerId', 'NORMAL', 1),
  ('Dispatch', 'salesOrder.ownerId', 'salesOrder.regionId', NULL, NULL, 'NORMAL', 1),
  ('BusinessAction', 'assigneeId', NULL, 'departmentId', 'customerId', 'NORMAL', 1),
  ('Employee', 'id', NULL, NULL, NULL, 'SENSITIVE', 1);

INSERT OR IGNORE INTO "core_field_policy" ("id", "entityType", "fieldName", "editable", "derived", "requiresApprovalType", "sensitivity", "notes") VALUES
  ('fp-est-cost', 'SalesEstimateLine', 'unitCost', 1, 0, NULL, 'SENSITIVE', 'Cost/margin: MD-role views only, every view logged'),
  ('fp-so-cost', 'SalesOrderLine', 'unitCost', 1, 0, NULL, 'SENSITIVE', NULL),
  ('fp-est-disc', 'SalesEstimateLine', 'discountPct', 1, 0, 'DISCOUNT', 'NORMAL', 'Approval per discount policies'),
  ('fp-est-total', 'SalesEstimate', 'grandTotal', 0, 1, NULL, 'NORMAL', 'Computed from lines'),
  ('fp-so-total', 'SalesOrder', 'grandTotal', 0, 1, NULL, 'NORMAL', 'Computed from lines'),
  ('fp-so-stage', 'SalesOrder', 'stage', 0, 0, NULL, 'NORMAL', 'Changed only through a stage transition'),
  ('fp-so-region', 'SalesOrder', 'regionId', 1, 0, 'DATA_CORRECTION', 'NORMAL', 'Moves leaderboard credit'),
  ('fp-cust-gstin', 'Customer', 'gstin', 1, 0, 'DATA_CORRECTION', 'NORMAL', NULL),
  ('fp-cust-name', 'Customer', 'legalName', 1, 0, 'DATA_CORRECTION', 'NORMAL', NULL),
  ('fp-cust-pan', 'Customer', 'pan', 1, 0, NULL, 'RESTRICTED', NULL),
  ('fp-cust-credit', 'Customer', 'creditLimit', 1, 0, 'CREDIT_LIMIT', 'SENSITIVE', NULL),
  ('fp-contact-phone', 'CustomerContact', 'phoneE164', 1, 0, NULL, 'SENSITIVE', 'Lead data: views logged');

INSERT OR IGNORE INTO "core_service_account" ("id", "key", "name", "description") VALUES
  ('svc-rate-engine', 'ai-rate-engine', 'AI rate engine', 'Reads supplier rates, proposes estimate lines'),
  ('svc-automation', 'automation-runtime', 'Automation runtime', 'Opens actions, sends notifications, raises approvals'),
  ('svc-gsp', 'gsp-connector', 'GST connector', 'E-invoice / e-way bill filings only'),
  ('svc-neodove', 'neodove-sync', 'NeoDove sync', 'Call-log ingestion only');

INSERT OR IGNORE INTO "core_series" ("key", "nextNumber") VALUES ('EMP', 1);

-- ── Backfill: one core_employee per roster row (id reused = traceable) ──
-- 1) Telecallers (incl. field_staff + team_lead types; deleted → INACTIVE).
INSERT OR IGNORE INTO "core_employee"
  ("id", "fullName", "workEmail", "phoneE164", "whatsappE164", "status", "sourceTable", "grade", "neodoveUserId", "neodoveUserName", "absentSince", "createdAt")
SELECT "id", "name", NULLIF(trim("email"), ''), "phone", "whatsapp",
  CASE WHEN "deleted" = 1 THEN 'INACTIVE' ELSE 'ACTIVE' END,
  'telecaller',
  CASE WHEN "type" = 'team_lead' THEN NULLIF("tlLevel", '') ELSE NULL END,
  "neodoveUserId", "neodoveUserName", "absentSince", "createdAt"
FROM "Telecaller";

-- 2) Accountants (skip emails already taken by a telecaller).
INSERT OR IGNORE INTO "core_employee"
  ("id", "fullName", "workEmail", "phoneE164", "status", "sourceTable", "grade", "createdAt")
SELECT "id", "name", NULLIF(trim("email"), ''), "phone",
  CASE WHEN "deleted" = 1 THEN 'INACTIVE' ELSE 'ACTIVE' END,
  'accountant', lower("role"), "createdAt"
FROM "Accountant"
WHERE "id" NOT IN (SELECT "id" FROM "core_employee")
  AND (trim("email") = '' OR trim("email") IS NULL OR lower(trim("email")) NOT IN
    (SELECT lower(trim("workEmail")) FROM "core_employee" WHERE "workEmail" IS NOT NULL AND trim("workEmail") <> ''));

-- 3) Digital marketing (legacy 'manager' reads as Senior).
INSERT OR IGNORE INTO "core_employee"
  ("id", "fullName", "workEmail", "phoneE164", "status", "sourceTable", "grade", "createdAt")
SELECT "id", "name", NULLIF(trim("email"), ''), "phone",
  CASE WHEN "deleted" = 1 THEN 'INACTIVE' ELSE 'ACTIVE' END,
  'digital_marketing_manager',
  CASE WHEN lower("role") = 'junior' THEN 'junior' ELSE 'senior' END,
  "createdAt"
FROM "DigitalMarketingManager"
WHERE "id" NOT IN (SELECT "id" FROM "core_employee")
  AND (trim("email") = '' OR trim("email") IS NULL OR lower(trim("email")) NOT IN
    (SELECT lower(trim("workEmail")) FROM "core_employee" WHERE "workEmail" IS NOT NULL AND trim("workEmail") <> ''));

-- 4) HR members (keep existing employeeCode; inactive when active=0).
INSERT OR IGNORE INTO "core_employee"
  ("id", "employeeCode", "fullName", "workEmail", "phoneE164", "status", "sourceTable", "grade", "createdAt")
SELECT "id", NULLIF(trim("employeeCode"), ''), "name", NULLIF(trim(COALESCE("loginEmail", "email")), ''),
  "phone", CASE WHEN "active" = 0 THEN 'INACTIVE' ELSE 'ACTIVE' END,
  'human_resources_member', "designation", COALESCE("createdAt", datetime('now'))
FROM "HumanResourcesMember"
WHERE "id" NOT IN (SELECT "id" FROM "core_employee")
  AND (COALESCE(trim("loginEmail"), trim("email"), '') = '' OR lower(trim(COALESCE("loginEmail", "email"))) NOT IN
    (SELECT lower(trim("workEmail")) FROM "core_employee" WHERE "workEmail" IS NOT NULL AND trim("workEmail") <> ''));

-- EMP codes for everyone without one (HR keeps theirs), gapless from series.
-- Bump the series past already-taken EMP-NNNN codes FIRST (HR rows may hold
-- EMP-0001 etc.; numbering from 1 would collide with them).
UPDATE "core_series" SET "nextNumber" =
  COALESCE((SELECT MAX(CAST(substr("employeeCode", 5) AS INTEGER)) + 1 FROM "core_employee"
    WHERE "employeeCode" GLOB 'EMP-*' AND CAST(substr("employeeCode", 5) AS INTEGER) > 0), 1)
WHERE "key" = 'EMP';
UPDATE "core_employee" SET "employeeCode" =
  'EMP-' || printf('%04d',
    (SELECT "nextNumber" FROM "core_series" WHERE "key" = 'EMP') - 1
    + (SELECT count(*) FROM "core_employee" e2 WHERE e2."rowid" <= "core_employee"."rowid"))
WHERE "employeeCode" IS NULL;
UPDATE "core_series" SET "nextNumber" =
  COALESCE((SELECT MAX(CAST(substr("employeeCode", 5) AS INTEGER)) + 1 FROM "core_employee"
    WHERE "employeeCode" LIKE 'EMP-%'), 1)
WHERE "key" = 'EMP';

-- ── Position / department / region assignments ──
INSERT OR IGNORE INTO "core_emp_position" ("id", "employeeId", "positionId", "isPrimary", "reason")
SELECT 'ep-' || e."id", e."id",
  CASE
    WHEN t."type" = 'field_staff' THEN 'pos-field-exec'
    WHEN t."type" = 'team_lead' AND t."tlLevel" = 'TL2' THEN 'pos-tl2'
    WHEN t."type" = 'team_lead' THEN 'pos-tl1'
    ELSE 'pos-sales-exec'
  END, 1, 'phase-1 backfill'
FROM "core_employee" e JOIN "Telecaller" t ON t."id" = e."id" WHERE e."sourceTable" = 'telecaller';

INSERT OR IGNORE INTO "core_emp_position" ("id", "employeeId", "positionId", "isPrimary", "reason")
SELECT 'ep-' || e."id", e."id", 'pos-accountant', 1, 'phase-1 backfill'
FROM "core_employee" e WHERE e."sourceTable" = 'accountant';

INSERT OR IGNORE INTO "core_emp_position" ("id", "employeeId", "positionId", "isPrimary", "reason")
SELECT 'ep-' || e."id", e."id", 'pos-marketing-mgr', 1, 'phase-1 backfill'
FROM "core_employee" e WHERE e."sourceTable" = 'digital_marketing_manager';

INSERT OR IGNORE INTO "core_emp_position" ("id", "employeeId", "positionId", "isPrimary", "reason")
SELECT 'ep-' || e."id", e."id", 'pos-hr-exec', 1, 'phase-1 backfill'
FROM "core_employee" e WHERE e."sourceTable" = 'human_resources_member';

INSERT OR IGNORE INTO "core_emp_dept" ("id", "employeeId", "departmentId", "isPrimary", "reason")
SELECT 'ed-' || p."employeeId", p."employeeId", pos."departmentId", 1, 'phase-1 backfill'
FROM "core_emp_position" p JOIN "core_position" pos ON pos."id" = p."positionId";

INSERT OR IGNORE INTO "core_emp_region" ("id", "employeeId", "regionId", "responsibility", "reason")
SELECT 'er-' || t."id" || '-1', t."id", r."id", 'PRIMARY', 'phase-1 backfill'
FROM "Telecaller" t JOIN "core_region" r ON r."code" = t."region"
WHERE t."region" IN ('R1', 'R2', 'R3', 'R4');

INSERT OR IGNORE INTO "core_emp_region" ("id", "employeeId", "regionId", "responsibility", "reason")
SELECT 'er-' || t."id" || '-2', t."id", r."id", 'SECONDARY', 'phase-1 backfill'
FROM "Telecaller" t JOIN "core_region" r ON r."code" = t."region2"
WHERE t."region2" IN ('R1', 'R2', 'R3', 'R4') AND t."region2" <> t."region";

-- ── Login links (email-exact; unmapped logins stay unlinked, never guessed) ──
INSERT OR IGNORE INTO "core_user_link" ("authUserId", "employeeId")
SELECT u."id", e."id" FROM "auth_user" u JOIN "core_employee" e
  ON lower(trim(u."email")) = lower(trim(e."workEmail"))
WHERE e."workEmail" IS NOT NULL AND trim(e."workEmail") <> ''
  AND NOT EXISTS (SELECT 1 FROM "core_user_link" l WHERE l."employeeId" = e."id");
