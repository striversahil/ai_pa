-- ═════════════════════════════════════════════════════════════════════════════
-- prisma/sql/core/002_seed_platform.sql  ·  🔒 LOCKED
-- The operating rules of the business, as data. Idempotent (re-runnable).
--
-- The order flow encoded here:
--   Sales     : registers enquiry → gets AI/supplier rates → sends estimate →
--               confirms the sales order                       (DRAFT → CONFIRMED)
--   Accounts  : verifies the transaction (approval)        → ACCOUNTS_VERIFIED
--   Accounts / Store : reserves stock for every line      → STOCK_CONFIRMED
--   Accounts  : advance received or credit approved        → PAYMENT_CONFIRMED
--   Dispatch  : plans, ships, uploads proof                → READY / DISPATCHED / DELIVERED
-- Every step creates a BusinessAction for the next department, with an
-- escalation ladder if nobody acts in time.
--
-- ⚠ Verify with your CA before go-live: GST rates (tax_rate section), HSN
--   mapping of products, e-invoice applicability, and the chart of accounts.
-- ═════════════════════════════════════════════════════════════════════════════
SET client_min_messages = warning;
BEGIN;
SELECT core.set_actor('SYSTEM', NULL, 'seed:002_seed_platform');

-- ── Organisation ─────────────────────────────────────────────────────────────
INSERT INTO core."Department" (id, code, name, "updatedAt") VALUES
  (gen_random_uuid(), 'MANAGEMENT', 'Management', now()),
  (gen_random_uuid(), 'SALES',      'Sales', now()),
  (gen_random_uuid(), 'ACCOUNTS',   'Accounts', now()),
  (gen_random_uuid(), 'PURCHASE',   'Purchase', now()),
  (gen_random_uuid(), 'INVENTORY',  'Inventory / Store', now()),
  (gen_random_uuid(), 'DISPATCH',   'Dispatch', now()),
  (gen_random_uuid(), 'HR',         'Human Resources', now()),
  (gen_random_uuid(), 'MARKETING',  'Marketing', now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO core."Position" (id, code, name, "departmentId", rank, "updatedAt")
SELECT gen_random_uuid(), p.code, p.name, d.id, p.rank, now()
FROM (VALUES
  ('FOUNDER',        'Founder',               'MANAGEMENT', 0),
  ('SALES_HEAD',     'Sales Head',            'SALES',      10),
  ('TL1',            'Team Lead 1',           'SALES',      20),
  ('TL2',            'Team Lead 2',           'SALES',      30),
  ('SALES_EXEC',     'Sales Executive / Telecaller', 'SALES', 50),
  ('FIELD_EXEC',     'Field Executive',       'SALES',      50),
  ('ACCOUNTS_HEAD',  'Accounts Head',         'ACCOUNTS',   10),
  ('ACCOUNTANT',     'Accountant',            'ACCOUNTS',   40),
  ('PURCHASE_EXEC',  'Purchase Executive',    'PURCHASE',   40),
  ('STORE_KEEPER',   'Store Keeper',          'INVENTORY',  40),
  ('DISPATCH_HEAD',  'Dispatch Head',         'DISPATCH',   10),
  ('DISPATCH_EXEC',  'Dispatch Executive',    'DISPATCH',   40),
  ('HR_EXEC',        'HR Executive',          'HR',         40),
  ('MARKETING_MGR',  'Marketing Manager',     'MARKETING',  30)
) AS p(code, name, dept, rank)
JOIN core."Department" d ON d.code = p.dept
ON CONFLICT (code) DO NOTHING;

INSERT INTO core."Region" (id, code, name, states, "updatedAt") VALUES
  (gen_random_uuid(), 'R1', 'Region 1', '{}', now()),
  (gen_random_uuid(), 'R2', 'Region 2', '{}', now()),
  (gen_random_uuid(), 'R3', 'Region 3', '{}', now()),
  (gen_random_uuid(), 'R4', 'Region 4', '{}', now())
ON CONFLICT (code) DO NOTHING;

-- ── Roles and which positions hold them ──────────────────────────────────────
INSERT INTO core."Role" (id, key, name, "isSystem", "updatedAt") VALUES
  (gen_random_uuid(), 'founder',        'Founder (full oversight)', true, now()),
  (gen_random_uuid(), 'sales_staff',    'Sales staff',              true, now()),
  (gen_random_uuid(), 'sales_tl',       'Sales team lead',          true, now()),
  (gen_random_uuid(), 'sales_head',     'Sales head',               true, now()),
  (gen_random_uuid(), 'accounts',       'Accounts',                 true, now()),
  (gen_random_uuid(), 'accounts_head',  'Accounts head',            true, now()),
  (gen_random_uuid(), 'purchase',       'Purchase',                 true, now()),
  (gen_random_uuid(), 'store',          'Store / inventory',        true, now()),
  (gen_random_uuid(), 'dispatch',       'Dispatch',                 true, now()),
  (gen_random_uuid(), 'svc_rate_engine','AI rate engine (service)', true, now()),
  (gen_random_uuid(), 'svc_automation', 'Automation runtime (service)', true, now()),
  (gen_random_uuid(), 'svc_gsp',        'GST connector (service)',  true, now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO core."PositionRole" ("positionId", "roleId")
SELECT p.id, r.id FROM (VALUES
  ('FOUNDER', 'founder'),
  ('SALES_HEAD', 'sales_head'), ('SALES_HEAD', 'sales_tl'), ('SALES_HEAD', 'sales_staff'),
  ('TL1', 'sales_tl'), ('TL1', 'sales_staff'),
  ('TL2', 'sales_tl'), ('TL2', 'sales_staff'),
  ('SALES_EXEC', 'sales_staff'), ('FIELD_EXEC', 'sales_staff'),
  ('ACCOUNTS_HEAD', 'accounts_head'), ('ACCOUNTS_HEAD', 'accounts'),
  ('ACCOUNTANT', 'accounts'),
  ('PURCHASE_EXEC', 'purchase'),
  ('STORE_KEEPER', 'store'),
  ('DISPATCH_HEAD', 'dispatch'), ('DISPATCH_EXEC', 'dispatch')
) AS m(pos, role)
JOIN core."Position" p ON p.code = m.pos JOIN core."Role" r ON r.key = m.role
ON CONFLICT DO NOTHING;

-- ── Permission matrix ────────────────────────────────────────────────────────
-- (role, entity, action, scope, field, conditions). Field '*' = whole record.
-- TRANSITION conditions list the stages that role may move an order INTO.
CREATE TEMP TABLE _perm (role text, entity text, action text, scope text, field text, cond jsonb) ON COMMIT DROP;
INSERT INTO _perm VALUES
  -- Founder: everything, everywhere, including export
  ('founder', '*', 'VIEW', 'ALL', '*', NULL), ('founder', '*', 'CREATE', 'ALL', '*', NULL),
  ('founder', '*', 'EDIT', 'ALL', '*', NULL), ('founder', '*', 'APPROVE', 'ALL', '*', NULL),
  ('founder', '*', 'TRANSITION', 'ALL', '*', NULL), ('founder', '*', 'EXPORT', 'ALL', '*', NULL),

  -- Sales staff: own enquiries, estimates, orders and customers
  ('sales_staff', 'screen:sales_workspace', 'VIEW', 'ALL', '*', NULL),
  ('sales_staff', 'SalesEnquiry',     'VIEW',   'OWN', '*', NULL),
  ('sales_staff', 'SalesEnquiry',     'CREATE', 'OWN', '*', NULL),
  ('sales_staff', 'SalesEnquiry',     'EDIT',   'OWN', '*', NULL),
  ('sales_staff', 'EnquiryRateQuote', 'VIEW',   'OWN', '*', NULL),
  ('sales_staff', 'EnquiryRateQuote', 'CREATE', 'OWN', '*', NULL),
  ('sales_staff', 'Customer',         'VIEW',   'OWN', '*', NULL),
  ('sales_staff', 'Customer',         'CREATE', 'OWN', '*', NULL),
  ('sales_staff', 'Customer',         'EDIT',   'OWN', '*', NULL),
  ('sales_staff', 'Customer',         'VIEW',   'OWN', 'pan', '{"deny": true}'),
  ('sales_staff', 'SalesEstimate',    'VIEW',   'OWN', '*', NULL),
  ('sales_staff', 'SalesEstimate',    'CREATE', 'OWN', '*', NULL),
  ('sales_staff', 'SalesEstimate',    'EDIT',   'OWN', '*', NULL),
  ('sales_staff', 'SalesOrder',       'VIEW',   'OWN', '*', NULL),
  ('sales_staff', 'SalesOrder',       'CREATE', 'OWN', '*', NULL),
  ('sales_staff', 'SalesOrder',       'TRANSITION', 'OWN', '*', '{"toStages": ["CONFIRMED", "ON_HOLD"]}'),
  ('sales_staff', 'Invoice',          'VIEW',   'OWN', '*', NULL),
  ('sales_staff', 'Product',          'VIEW',   'ALL', '*', NULL),
  ('sales_staff', 'StockAvailability','VIEW',   'ALL', '*', NULL),
  ('sales_staff', 'BusinessAction',   'VIEW',   'OWN', '*', NULL),
  ('sales_staff', 'BusinessAction',   'EDIT',   'OWN', '*', NULL),
  ('sales_staff', 'BusinessAction',   'CREATE', 'OWN', '*', NULL),

  -- Team leads: their team/region, can reassign and approve small discounts
  ('sales_tl', 'screen:sales_team', 'VIEW', 'ALL', '*', NULL),
  ('sales_tl', 'SalesEnquiry',   'VIEW', 'REGION', '*', NULL), ('sales_tl', 'SalesEnquiry',  'EDIT', 'REGION', '*', NULL),
  ('sales_tl', 'SalesEstimate',  'VIEW', 'REGION', '*', NULL), ('sales_tl', 'SalesEstimate', 'EDIT', 'REGION', '*', NULL),
  ('sales_tl', 'SalesOrder',     'VIEW', 'REGION', '*', NULL),
  ('sales_tl', 'Customer',       'VIEW', 'REGION', '*', NULL),
  ('sales_tl', 'BusinessAction', 'VIEW', 'TEAM', '*', NULL),  ('sales_tl', 'BusinessAction', 'EDIT', 'TEAM', '*', NULL),
  ('sales_tl', 'ApprovalRequest','APPROVE', 'TEAM', '*', '{"types": ["DISCOUNT"]}'),

  -- Sales head: whole department
  ('sales_head', 'screen:sales_management', 'VIEW', 'ALL', '*', NULL),
  ('sales_head', 'SalesEnquiry',  'VIEW', 'DEPARTMENT', '*', NULL), ('sales_head', 'SalesEnquiry',  'EDIT', 'DEPARTMENT', '*', NULL),
  ('sales_head', 'SalesEstimate', 'VIEW', 'DEPARTMENT', '*', NULL), ('sales_head', 'SalesEstimate', 'EDIT', 'DEPARTMENT', '*', NULL),
  ('sales_head', 'SalesOrder',    'VIEW', 'DEPARTMENT', '*', NULL),
  ('sales_head', 'SalesOrder',    'TRANSITION', 'DEPARTMENT', '*', '{"toStages": ["CONFIRMED", "ON_HOLD", "CANCELLED"]}'),
  ('sales_head', 'Customer',      'VIEW', 'ALL', '*', NULL),        ('sales_head', 'Customer', 'EDIT', 'ALL', '*', NULL),
  ('sales_head', 'BusinessAction','VIEW', 'DEPARTMENT', '*', NULL), ('sales_head', 'BusinessAction', 'EDIT', 'DEPARTMENT', '*', NULL),
  ('sales_head', 'ApprovalRequest','APPROVE', 'DEPARTMENT', '*', '{"types": ["DISCOUNT", "SPECIAL_PRICE", "DOCUMENT_CANCELLATION"]}'),
  ('sales_head', 'SalesEnquiry',  'EXPORT', 'DEPARTMENT', '*', NULL),

  -- Accounts: verify transactions, stock confirmation, payment, invoicing
  ('accounts', 'screen:accounts_desk', 'VIEW', 'ALL', '*', NULL),
  ('accounts', 'SalesOrder',      'VIEW', 'ALL', '*', NULL),
  ('accounts', 'SalesOrder',      'TRANSITION', 'ALL', '*', '{"toStages": ["ACCOUNTS_VERIFIED", "STOCK_CONFIRMED", "PAYMENT_CONFIRMED", "ON_HOLD"]}'),
  ('accounts', 'InventoryReservation', 'CREATE', 'ALL', '*', NULL),
  ('accounts', 'InventoryReservation', 'EDIT',   'ALL', '*', NULL),
  ('accounts', 'StockAvailability','VIEW', 'ALL', '*', NULL),
  ('accounts', 'Customer',        'VIEW', 'ALL', '*', NULL),
  ('accounts', 'Invoice',         'VIEW', 'ALL', '*', NULL), ('accounts', 'Invoice', 'CREATE', 'ALL', '*', NULL),
  ('accounts', 'Invoice',         'EDIT', 'ALL', '*', NULL),
  ('accounts', 'AdjustmentNote',  'VIEW', 'ALL', '*', NULL), ('accounts', 'AdjustmentNote', 'CREATE', 'ALL', '*', NULL),
  ('accounts', 'PaymentReceipt',  'VIEW', 'ALL', '*', NULL), ('accounts', 'PaymentReceipt', 'CREATE', 'ALL', '*', NULL),
  ('accounts', 'PaymentReceipt',  'EDIT', 'ALL', '*', NULL),
  ('accounts', 'PaymentPromise',  'CREATE', 'ALL', '*', NULL),
  ('accounts', 'SupplierBill',    'VIEW', 'ALL', '*', NULL), ('accounts', 'SupplierBill', 'CREATE', 'ALL', '*', NULL),
  ('accounts', 'JournalEntry',    'VIEW', 'ALL', '*', NULL),
  ('accounts', 'BusinessAction',  'VIEW', 'DEPARTMENT', '*', NULL), ('accounts', 'BusinessAction', 'EDIT', 'DEPARTMENT', '*', NULL),
  ('accounts', 'ApprovalRequest', 'APPROVE', 'ALL', '*', '{"types": ["ORDER_VERIFICATION", "STOCK_CONFIRMATION", "PAYMENT_CONFIRMATION"]}'),
  ('accounts_head', 'ApprovalRequest', 'APPROVE', 'ALL', '*', '{"types": ["CREDIT_LIMIT", "DOCUMENT_CANCELLATION"]}'),
  ('accounts_head', 'JournalEntry', 'CREATE', 'ALL', '*', NULL),
  ('accounts_head', 'Invoice', 'EXPORT', 'ALL', '*', NULL),

  -- Purchase & store
  ('purchase', 'screen:purchase_desk', 'VIEW', 'ALL', '*', NULL),
  ('purchase', 'Supplier', 'VIEW', 'ALL', '*', NULL), ('purchase', 'Supplier', 'CREATE', 'ALL', '*', NULL), ('purchase', 'Supplier', 'EDIT', 'ALL', '*', NULL),
  ('purchase', 'SupplierRate', 'VIEW', 'ALL', '*', NULL), ('purchase', 'SupplierRate', 'CREATE', 'ALL', '*', NULL),
  ('purchase', 'PurchaseOrder', 'VIEW', 'ALL', '*', NULL), ('purchase', 'PurchaseOrder', 'CREATE', 'ALL', '*', NULL), ('purchase', 'PurchaseOrder', 'EDIT', 'ALL', '*', NULL),
  ('purchase', 'EnquiryRateQuote', 'VIEW', 'ALL', '*', NULL), ('purchase', 'EnquiryRateQuote', 'CREATE', 'ALL', '*', NULL),
  ('store', 'screen:store', 'VIEW', 'ALL', '*', NULL),
  ('store', 'Product', 'VIEW', 'ALL', '*', NULL), ('store', 'Product', 'EDIT', 'ALL', '*', NULL),
  ('store', 'StockAvailability', 'VIEW', 'ALL', '*', NULL),
  ('store', 'GoodsReceipt', 'CREATE', 'ALL', '*', NULL), ('store', 'GoodsReceipt', 'EDIT', 'ALL', '*', NULL),
  ('store', 'StockLedgerEntry', 'CREATE', 'ALL', '*', NULL),
  ('store', 'InventoryReservation', 'CREATE', 'ALL', '*', NULL),
  ('store', 'SalesOrder', 'VIEW', 'ALL', '*', NULL),
  ('store', 'SalesOrder', 'TRANSITION', 'ALL', '*', '{"toStages": ["STOCK_CONFIRMED"]}'),

  -- Dispatch
  ('dispatch', 'screen:dispatch_board', 'VIEW', 'ALL', '*', NULL),
  ('dispatch', 'SalesOrder', 'VIEW', 'ALL', '*', NULL),
  ('dispatch', 'SalesOrder', 'TRANSITION', 'ALL', '*', '{"toStages": ["READY_TO_DISPATCH", "PARTIALLY_DISPATCHED", "DISPATCHED", "DELIVERED"]}'),
  ('dispatch', 'Dispatch', 'VIEW', 'ALL', '*', NULL), ('dispatch', 'Dispatch', 'CREATE', 'ALL', '*', NULL), ('dispatch', 'Dispatch', 'EDIT', 'ALL', '*', NULL),
  ('dispatch', 'Attachment', 'CREATE', 'ALL', '*', NULL),
  ('dispatch', 'BusinessAction', 'VIEW', 'DEPARTMENT', '*', NULL), ('dispatch', 'BusinessAction', 'EDIT', 'DEPARTMENT', '*', NULL),

  -- Service accounts (machines): narrow on purpose
  ('svc_rate_engine', 'SupplierRate', 'VIEW', 'ALL', '*', NULL),
  ('svc_rate_engine', 'EnquiryRateQuote', 'CREATE', 'ALL', '*', NULL),
  ('svc_automation', 'BusinessAction', 'CREATE', 'ALL', '*', NULL),
  ('svc_automation', 'Notification', 'CREATE', 'ALL', '*', NULL),
  ('svc_automation', 'ApprovalRequest', 'CREATE', 'ALL', '*', NULL),
  ('svc_gsp', 'Invoice', 'EDIT', 'ALL', 'irn', NULL),
  ('svc_gsp', 'Dispatch', 'EDIT', 'ALL', 'eWayBillNo', NULL);

-- Explicit DENY: sales never sees cost/margin of other people's lines, nobody
-- below founder exports customer lists.
INSERT INTO _perm VALUES
  ('sales_staff', 'Customer', 'EXPORT', 'ALL', '*', '{"effect": "DENY"}'),
  ('sales_tl',    'Customer', 'EXPORT', 'ALL', '*', '{"effect": "DENY"}');

INSERT INTO core."PermissionRule" (id, "roleId", "entityType", "fieldName", action, scope, effect, conditions, priority, "updatedAt")
SELECT gen_random_uuid(), r.id, p.entity, p.field, p.action::core."PermissionAction", p.scope::core."PermissionScope",
       CASE WHEN p.cond ->> 'effect' = 'DENY' OR (p.cond ->> 'deny')::boolean THEN 'DENY' ELSE 'ALLOW' END::core."PermissionEffect",
       NULLIF(p.cond - 'effect' - 'deny', '{}'::jsonb),
       CASE WHEN p.cond ->> 'effect' = 'DENY' OR (p.cond ->> 'deny')::boolean THEN 10 ELSE 100 END, now()
FROM _perm p JOIN core."Role" r ON r.key = p.role
WHERE NOT EXISTS (SELECT 1 FROM core."PermissionRule" x
                  WHERE x."roleId" = r.id AND x."entityType" = p.entity AND x."fieldName" = p.field
                    AND x.action::text = p.action AND x.scope::text = p.scope);

-- How OWN / REGION / DEPARTMENT scopes resolve for each entity.
INSERT INTO core."EntityAccessConfig" ("entityType", "ownerField", "regionField", "departmentField", "customerField", sensitivity, "logViews", "updatedAt") VALUES
  ('SalesEnquiry',     'ownerId',            'regionId', NULL,           'customerId', 'NORMAL',    true, now()),
  ('SalesEstimate',    'ownerId',            'regionId', NULL,           'customerId', 'NORMAL',    true, now()),
  ('SalesOrder',       'ownerId',            'regionId', NULL,           'customerId', 'NORMAL',    true, now()),
  ('Invoice',          NULL,                 'regionId', NULL,           'customerId', 'NORMAL',    true, now()),
  ('Customer',         'assignment:SALES_OWNER', 'assignment:region', NULL, 'id',       'SENSITIVE', true, now()),
  ('PaymentReceipt',   NULL,                 NULL,       NULL,           'customerId', 'NORMAL',    true, now()),
  ('Dispatch',         'salesOrder.ownerId', 'salesOrder.regionId', NULL, NULL,        'NORMAL',    true, now()),
  ('BusinessAction',   'assigneeId',         NULL,       'departmentId', 'customerId', 'NORMAL',    true, now()),
  ('EnquiryRateQuote', 'enquiryLine.enquiry.ownerId', 'enquiryLine.enquiry.regionId', NULL, NULL, 'SENSITIVE', true, now()),
  ('JournalEntry',     NULL,                 NULL,       NULL,           NULL,         'SENSITIVE', true, now()),
  ('Employee',         'id',                 NULL,       NULL,           NULL,         'SENSITIVE', true, now())
ON CONFLICT ("entityType") DO NOTHING;

INSERT INTO core."FieldPolicy" (id, "entityType", "fieldName", editable, derived, "requiresApprovalType", sensitivity, notes, "updatedAt")
SELECT gen_random_uuid(), f.e, f.f, f.editable, f.derived, f.appr::core."ApprovalType", f.sens::core."Sensitivity", f.notes, now()
FROM (VALUES
  ('SalesEstimateLine', 'unitCost',    true,  false, NULL,            'SENSITIVE',  'Cost/margin: every view logged'),
  ('SalesOrderLine',    'unitCost',    true,  false, NULL,            'SENSITIVE',  NULL),
  ('EnquiryRateQuote',  'unitCost',    true,  false, NULL,            'SENSITIVE',  NULL),
  ('SalesEstimateLine', 'discountPct', true,  false, 'DISCOUNT',      'NORMAL',     'Approval per discount policies'),
  ('SalesEstimate',     'grandTotal',  false, true,  NULL,            'NORMAL',     'Computed from lines'),
  ('SalesOrder',        'grandTotal',  false, true,  NULL,            'NORMAL',     'Computed from lines'),
  ('SalesOrder',        'stage',       false, false, NULL,            'NORMAL',     'Changed only through a stage transition'),
  ('SalesOrder',        'regionId',    true,  false, 'DATA_CORRECTION','NORMAL',    'Moves leaderboard credit'),
  ('Customer',          'gstin',       true,  false, 'DATA_CORRECTION','NORMAL',    NULL),
  ('Customer',          'legalName',   true,  false, 'DATA_CORRECTION','NORMAL',    NULL),
  ('Customer',          'pan',         true,  false, NULL,            'RESTRICTED', NULL),
  ('Customer',          'creditLimit', true,  false, 'CREDIT_LIMIT',  'SENSITIVE',  NULL),
  ('CustomerContact',   'phoneE164',   true,  false, NULL,            'SENSITIVE',  'Lead data: views logged'),
  ('PriceListItem',     'unitPrice',   true,  false, 'SPECIAL_PRICE', 'NORMAL',     NULL),
  ('Product',           'taxRateId',   true,  false, 'DATA_CORRECTION','NORMAL',    'Affects every future invoice'),
  ('Product',           'hsnCode',     true,  false, 'DATA_CORRECTION','NORMAL',    NULL),
  ('BankAccount',       'accountNumber', true, false, 'DATA_CORRECTION','SENSITIVE', NULL),
  ('Invoice',           '*',           false, false, NULL,            'NORMAL',     'Frozen after issue (trigger)')
) AS f(e, f, editable, derived, appr, sens, notes)
ON CONFLICT ("entityType", "fieldName") DO NOTHING;

-- ── Order stage gates ────────────────────────────────────────────────────────
-- WHO may move an order is decided by PermissionRule (TRANSITION + toStages).
-- WHAT must be true is decided here. checkKey is implemented in the core service.
INSERT INTO core."StageGateRule" (id, "entityType", "toStage", "fromStages", "checkKey", "requiredApprovalType", description, "updatedAt")
SELECT gen_random_uuid(), 'SalesOrder', g.to_stage, g.from_stages, g.check_key, g.appr::core."ApprovalType", g.descr, now()
FROM (VALUES
  ('CONFIRMED',           '{DRAFT}'::text[],                            'has_customer_lines_and_addresses', NULL,                  'Sales confirms: customer, bill-to/ship-to and at least one line present'),
  ('ACCOUNTS_VERIFIED',   '{CONFIRMED}'::text[],                        NULL,                               'ORDER_VERIFICATION',  'Accounts has approved the transaction (GSTIN, pricing, terms)'),
  ('STOCK_CONFIRMED',     '{ACCOUNTS_VERIFIED}'::text[],                'all_lines_reserved_or_on_po',      NULL,                  'Every open line is reserved in stock or covered by an issued PO'),
  ('PAYMENT_CONFIRMED',   '{STOCK_CONFIRMED}'::text[],                  'advance_received_or_credit_ok',    NULL,                  'Verified receipts cover the required advance, or the order is within credit'),
  ('PAYMENT_CONFIRMED',   '{STOCK_CONFIRMED}'::text[],                  'over_credit_limit',                'CREDIT_LIMIT',        'If the order exceeds the customer credit limit, a credit approval is required'),
  ('READY_TO_DISPATCH',   '{PAYMENT_CONFIRMED}'::text[],                NULL,                               NULL,                  'Dispatch accepts the order into the plan'),
  ('PARTIALLY_DISPATCHED','{READY_TO_DISPATCH,PARTIALLY_DISPATCHED}'::text[], 'dispatch_posted_partial',     NULL,                  'Set by the system when a dispatch posts and lines remain'),
  ('DISPATCHED',          '{READY_TO_DISPATCH,PARTIALLY_DISPATCHED}'::text[], 'all_lines_dispatched',       NULL,                  'Set by the system when every line has shipped'),
  ('DELIVERED',           '{DISPATCHED}'::text[],                       'proof_of_delivery_uploaded',       NULL,                  'POD attached to every dispatch'),
  ('CANCELLED',           '{}'::text[],                                 'not_dispatched',                   'DOCUMENT_CANCELLATION','Cancellation needs approval and nothing shipped')
) AS g(to_stage, from_stages, check_key, appr, descr)
WHERE NOT EXISTS (SELECT 1 FROM core."StageGateRule" x WHERE x."entityType" = 'SalesOrder' AND x."toStage" = g.to_stage
                  AND x."checkKey" IS NOT DISTINCT FROM g.check_key);

-- ── Approval chains ──────────────────────────────────────────────────────────
INSERT INTO core."ApprovalPolicy" (id, key, name, "approvalType", "entityType", condition, priority, "updatedAt") VALUES
  (gen_random_uuid(), 'order_verification',   'Accounts verifies a confirmed order', 'ORDER_VERIFICATION', 'SalesOrder', NULL, 100, now()),
  (gen_random_uuid(), 'discount_5_to_10',     'Discount above 5% up to 10%',         'DISCOUNT', 'SalesEstimate', '{"maxLineDiscountPct": {"gt": 5, "lte": 10}}', 100, now()),
  (gen_random_uuid(), 'discount_over_10',     'Discount above 10%',                  'DISCOUNT', 'SalesEstimate', '{"maxLineDiscountPct": {"gt": 10}}', 90, now()),
  (gen_random_uuid(), 'price_below_list',     'Price below price list',              'SPECIAL_PRICE', 'SalesEstimate', '{"belowListPrice": true}', 100, now()),
  (gen_random_uuid(), 'credit_over_limit',    'Order exceeds customer credit limit', 'CREDIT_LIMIT', 'SalesOrder', '{"overCreditLimit": true}', 100, now()),
  (gen_random_uuid(), 'order_cancellation',   'Cancel a confirmed order',            'DOCUMENT_CANCELLATION', 'SalesOrder', NULL, 100, now()),
  (gen_random_uuid(), 'invoice_cancellation', 'Cancel an issued invoice',            'DOCUMENT_CANCELLATION', 'Invoice', NULL, 100, now()),
  (gen_random_uuid(), 'master_correction',    'Correct GSTIN / legal name / HSN / tax rate', 'DATA_CORRECTION', '*', NULL, 100, now())
ON CONFLICT (key) DO NOTHING;

INSERT INTO core."ApprovalPolicyStage" (id, "policyId", stage, "approverType", "positionId", "roleId", "slaMinutes")
SELECT gen_random_uuid(), ap.id, s.stage, s.atype::core."ApproverType",
       (SELECT id FROM core."Position" WHERE code = s.pos), (SELECT id FROM core."Role" WHERE key = s.role), s.sla
FROM (VALUES
  ('order_verification',   1, 'ROLE',           NULL,            'accounts', 120),
  ('discount_5_to_10',     1, 'DIRECT_MANAGER', NULL,            NULL,       240),
  ('discount_over_10',     1, 'DIRECT_MANAGER', NULL,            NULL,       240),
  ('discount_over_10',     2, 'POSITION',       'SALES_HEAD',    NULL,       480),
  ('price_below_list',     1, 'POSITION',       'SALES_HEAD',    NULL,       480),
  ('credit_over_limit',    1, 'POSITION',       'ACCOUNTS_HEAD', NULL,       240),
  ('credit_over_limit',    2, 'POSITION',       'FOUNDER',       NULL,       1440),
  ('order_cancellation',   1, 'POSITION',       'SALES_HEAD',    NULL,       480),
  ('invoice_cancellation', 1, 'POSITION',       'ACCOUNTS_HEAD', NULL,       480),
  ('master_correction',    1, 'POSITION',       'ACCOUNTS_HEAD', NULL,       1440)
) AS s(policy, stage, atype, pos, role, sla)
JOIN core."ApprovalPolicy" ap ON ap.key = s.policy
ON CONFLICT ("policyId", stage) DO NOTHING;

-- ── Escalation ladders ───────────────────────────────────────────────────────
-- afterMinutes counts from the action's due time.
INSERT INTO core."EscalationPolicy" (id, key, name, category, "departmentId", "updatedAt")
SELECT gen_random_uuid(), e.key, e.name, e.category, d.id, now()
FROM (VALUES
  ('qualify_enquiry',   'New enquiry not qualified',          'qualify_enquiry',   'SALES'),
  ('estimate_followup', 'Estimate follow-up overdue',         'estimate_followup', 'SALES'),
  ('verify_order',      'Order awaiting accounts verification','verify_order',     'ACCOUNTS'),
  ('confirm_stock',     'Order awaiting stock confirmation',  'confirm_stock',     'INVENTORY'),
  ('confirm_payment',   'Order awaiting payment confirmation','confirm_payment',   'ACCOUNTS'),
  ('schedule_dispatch', 'Order ready but not dispatched',     'schedule_dispatch', 'DISPATCH'),
  ('collect_payment',   'Overdue invoice follow-up',          'collect_payment',   'ACCOUNTS'),
  ('default',           'Any other overdue task',             NULL,                NULL)
) AS e(key, name, category, dept)
LEFT JOIN core."Department" d ON d.code = e.dept
ON CONFLICT (key) DO NOTHING;

INSERT INTO core."EscalationStep" (id, "policyId", level, "afterMinutes", target, "targetPositionId", reassign, "raisePriority", channels, "templateKey")
SELECT gen_random_uuid(), p.id, s.level, s.after_min, s.target::core."EscalationTarget",
       (SELECT id FROM core."Position" WHERE code = s.pos), s.reassign, s.raise::core."ActionPriority",
       s.channels::core."NotificationChannel"[], s.tpl
FROM (VALUES
  ('qualify_enquiry',   1,    0, 'ASSIGNEE',        NULL,            false, NULL,     '{IN_APP,WHATSAPP}', 'action_overdue'),
  ('qualify_enquiry',   2,  120, 'DIRECT_MANAGER',  NULL,            false, 'HIGH',   '{IN_APP,WHATSAPP}', 'escalated_to_you'),
  ('qualify_enquiry',   3,  480, 'DIRECT_MANAGER',  NULL,            true,  'URGENT', '{IN_APP,WHATSAPP}', 'reassigned_to_you'),
  ('estimate_followup', 1,    0, 'ASSIGNEE',        NULL,            false, NULL,     '{IN_APP,WHATSAPP}', 'action_overdue'),
  ('estimate_followup', 2,  240, 'DIRECT_MANAGER',  NULL,            false, 'HIGH',   '{IN_APP,WHATSAPP}', 'escalated_to_you'),
  ('estimate_followup', 3, 1440, 'POSITION',        'SALES_HEAD',    false, 'URGENT', '{IN_APP,WHATSAPP}', 'escalated_to_you'),
  ('verify_order',      1,    0, 'ASSIGNEE',        NULL,            false, NULL,     '{IN_APP,WHATSAPP}', 'action_overdue'),
  ('verify_order',      2,  120, 'DEPARTMENT_HEAD', NULL,            false, 'HIGH',   '{IN_APP,WHATSAPP}', 'escalated_to_you'),
  ('verify_order',      3,  480, 'POSITION',        'FOUNDER',       false, 'URGENT', '{IN_APP,WHATSAPP}', 'escalated_to_you'),
  ('confirm_stock',     1,    0, 'ASSIGNEE',        NULL,            false, NULL,     '{IN_APP,WHATSAPP}', 'action_overdue'),
  ('confirm_stock',     2,  240, 'DEPARTMENT_HEAD', NULL,            false, 'HIGH',   '{IN_APP,WHATSAPP}', 'escalated_to_you'),
  ('confirm_payment',   1,    0, 'ASSIGNEE',        NULL,            false, NULL,     '{IN_APP,WHATSAPP}', 'action_overdue'),
  ('confirm_payment',   2,  240, 'POSITION',        'ACCOUNTS_HEAD', false, 'HIGH',   '{IN_APP,WHATSAPP}', 'escalated_to_you'),
  ('schedule_dispatch', 1,    0, 'ASSIGNEE',        NULL,            false, NULL,     '{IN_APP,WHATSAPP}', 'action_overdue'),
  ('schedule_dispatch', 2,  240, 'POSITION',        'DISPATCH_HEAD', false, 'HIGH',   '{IN_APP,WHATSAPP}', 'escalated_to_you'),
  ('schedule_dispatch', 3, 1440, 'POSITION',        'FOUNDER',       false, 'URGENT', '{IN_APP}',          'escalated_to_you'),
  ('collect_payment',   1,    0, 'ASSIGNEE',        NULL,            false, NULL,     '{IN_APP,WHATSAPP}', 'action_overdue'),
  ('collect_payment',   2, 2880, 'POSITION',        'ACCOUNTS_HEAD', false, 'HIGH',   '{IN_APP,WHATSAPP}', 'escalated_to_you'),
  ('default',           1,    0, 'ASSIGNEE',        NULL,            false, NULL,     '{IN_APP}',          'action_overdue'),
  ('default',           2, 1440, 'DIRECT_MANAGER',  NULL,            false, 'HIGH',   '{IN_APP,WHATSAPP}', 'escalated_to_you')
) AS s(policy, level, after_min, target, pos, reassign, raise, channels, tpl)
JOIN core."EscalationPolicy" p ON p.key = s.policy
ON CONFLICT ("policyId", level) DO NOTHING;

-- ── Notification templates (WhatsApp template names are placeholders until
--    Meta approves them) ─────────────────────────────────────────────────────
INSERT INTO core."NotificationTemplate" (id, key, channel, locale, subject, body, "waTemplateName", "waLanguage", variables, "updatedAt")
SELECT gen_random_uuid(), t.key, t.ch::core."NotificationChannel", 'en', t.subject, t.body, t.wa, CASE WHEN t.wa IS NULL THEN NULL ELSE 'en' END, t.vars::text[], now()
FROM (VALUES
  ('action_assigned',   'IN_APP',   'New task: {{title}}',             '{{title}} is due {{dueAt}}.', NULL, '{title,dueAt,link}'),
  ('action_assigned',   'WHATSAPP', NULL,                              'New task: {{title}}, due {{dueAt}}. {{link}}', 'bui_task_assigned', '{title,dueAt,link}'),
  ('action_overdue',    'IN_APP',   'Overdue: {{title}}',              '{{title}} was due {{dueAt}}.', NULL, '{title,dueAt,link}'),
  ('action_overdue',    'WHATSAPP', NULL,                              'Reminder: "{{title}}" was due {{dueAt}}. {{link}}', 'bui_task_overdue', '{title,dueAt,link}'),
  ('escalated_to_you',  'IN_APP',   'Escalated: {{title}}',            '{{assigneeName}} has not completed "{{title}}" (due {{dueAt}}). Level {{level}}.', NULL, '{title,assigneeName,dueAt,level,link}'),
  ('escalated_to_you',  'WHATSAPP', NULL,                              'Escalation L{{level}}: {{assigneeName}} has not completed "{{title}}" (due {{dueAt}}). {{link}}', 'bui_task_escalated', '{title,assigneeName,dueAt,level,link}'),
  ('reassigned_to_you', 'IN_APP',   'Reassigned to you: {{title}}',    'Moved from {{fromName}} after escalation.', NULL, '{title,fromName,link}'),
  ('reassigned_to_you', 'WHATSAPP', NULL,                              '"{{title}}" has been reassigned to you from {{fromName}}. {{link}}', 'bui_task_reassigned', '{title,fromName,link}'),
  ('approval_needed',   'IN_APP',   'Approval needed: {{title}}',      '{{requesterName}} requests {{approvalType}}.', NULL, '{title,requesterName,approvalType,link}'),
  ('approval_needed',   'WHATSAPP', NULL,                              'Approval needed: {{title}} from {{requesterName}}. {{link}}', 'bui_approval_needed', '{title,requesterName,link}'),
  ('approval_decided',  'IN_APP',   '{{decision}}: {{title}}',         '{{approverName}} {{decision}} your request.', NULL, '{title,decision,approverName,link}'),
  ('stage_changed',     'IN_APP',   '{{soNo}} → {{toStage}}',          'Order {{soNo}} moved to {{toStage}} by {{actorName}}.', NULL, '{soNo,toStage,actorName,link}')
) AS t(key, ch, subject, body, wa, vars)
ON CONFLICT (key, channel, locale) DO NOTHING;

-- ── Reference data ───────────────────────────────────────────────────────────
INSERT INTO core."LeadSource" (id, code, name, channel) VALUES
  (gen_random_uuid(), 'TELECALLING',   'Telecalling (outbound)', 'outbound'),
  (gen_random_uuid(), 'INCOMING_CALL', 'Incoming call',          'inbound'),
  (gen_random_uuid(), 'AI_INBOUND',    'AI inbound assistant',   'inbound'),
  (gen_random_uuid(), 'WHATSAPP',      'WhatsApp',               'inbound'),
  (gen_random_uuid(), 'B2B_PORTAL',    'B2B portal',             'partner'),
  (gen_random_uuid(), 'FIELD_STAFF',   'Field staff visit',      'outbound'),
  (gen_random_uuid(), 'META_ADS',      'Meta ads',               'marketing'),
  (gen_random_uuid(), 'GOOGLE_ADS',    'Google ads',             'marketing'),
  (gen_random_uuid(), 'REFERRAL',      'Referral',               'partner'),
  (gen_random_uuid(), 'REPEAT',        'Existing customer',      'inbound')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core."UnitOfMeasure" (id, code, name, "gstUqc", decimals) VALUES
  (gen_random_uuid(), 'NOS', 'Numbers',   'NOS', 0),
  (gen_random_uuid(), 'PCS', 'Pieces',    'PCS', 0),
  (gen_random_uuid(), 'SET', 'Sets',      'SET', 0),
  (gen_random_uuid(), 'KGS', 'Kilograms', 'KGS', 3),
  (gen_random_uuid(), 'MTR', 'Metres',    'MTR', 2),
  (gen_random_uuid(), 'BOX', 'Box',       'BOX', 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO core."PaymentTerm" (id, code, name, "dueDays", "advancePct") VALUES
  (gen_random_uuid(), 'ADVANCE_100', '100% advance',              0,  100),
  (gen_random_uuid(), 'ADV50_BAL',   '50% advance, balance before dispatch', 0, 50),
  (gen_random_uuid(), 'NET15',       'Net 15 days',               15, 0),
  (gen_random_uuid(), 'NET30',       'Net 30 days',               30, 0)
ON CONFLICT (code) DO NOTHING;

-- GST rates after the September 2025 rationalisation. VERIFY with your CA;
-- each product's rate comes from its HSN code.
INSERT INTO core."TaxRate" (id, code, name, "gstRate", "isExempt", "effectiveFrom", "effectiveTo", active) VALUES
  (gen_random_uuid(), 'EXEMPT', 'Exempt / nil', 0,  true,  '2017-07-01', NULL, true),
  (gen_random_uuid(), 'GST5',   'GST 5%',       5,  false, '2017-07-01', NULL, true),
  (gen_random_uuid(), 'GST18',  'GST 18%',      18, false, '2017-07-01', NULL, true),
  (gen_random_uuid(), 'GST40',  'GST 40%',      40, false, '2025-09-22', NULL, true),
  (gen_random_uuid(), 'GST12',  'GST 12% (historical)', 12, false, '2017-07-01', '2025-09-21', false),
  (gen_random_uuid(), 'GST28',  'GST 28% (historical)', 28, false, '2017-07-01', '2025-09-21', false)
ON CONFLICT (code) DO NOTHING;

COMMIT;
