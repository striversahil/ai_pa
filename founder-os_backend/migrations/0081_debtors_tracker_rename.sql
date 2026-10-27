-- Rename Payment Tracker → Debtors Tracker (dashboard, scope, assignments).
-- Safe to re-run: every statement is idempotent.

-- 1) Dashboard automation row. Keep the UUID id so run history stays attached.
--    If a deploy raced the migration and both rows exist, drop the stale one.
DELETE FROM automation
WHERE slug = 'payment-tracker'
  AND EXISTS (SELECT 1 FROM automation WHERE slug = 'debtors-tracker');

UPDATE OR IGNORE automation
SET slug = 'debtors-tracker', name = 'Debtors Tracker'
WHERE slug = 'payment-tracker';

-- 2) Auth scope. Create the canonical scope, copy every role/user assignment,
--    then remove the old key so the admin panel shows one Debtors Tracker.
INSERT INTO auth_scope (key, label, description)
VALUES (
  'debtors-tracker',
  'Debtors Tracker',
  'Pending-receivables control desk: debtor ageing, collections ledger and reminder previews'
)
ON CONFLICT(key) DO UPDATE SET
  label = excluded.label,
  description = excluded.description;

INSERT OR IGNORE INTO auth_role_scope (roleKey, scopeKey)
SELECT roleKey, 'debtors-tracker' FROM auth_role_scope WHERE scopeKey = 'payment-tracker';

INSERT OR IGNORE INTO auth_user_scope (userId, scopeKey)
SELECT userId, 'debtors-tracker' FROM auth_user_scope WHERE scopeKey = 'payment-tracker';

DELETE FROM auth_role_scope WHERE scopeKey = 'payment-tracker';
DELETE FROM auth_user_scope WHERE scopeKey = 'payment-tracker';
DELETE FROM auth_scope WHERE key = 'payment-tracker';
