-- 0141_management_review_scope.sql — Management Review gets its own grantable scope
-- (founder decision 2026-11-13: access is decided in Users & Permissions, never
-- by a name in code).
--
-- The MIS retirement (0139) deleted the `mis` scope the panel used to ride on,
-- leaving the gates root-only with nothing grantable in the admin panel. This
-- adds `enquiry-management` as a first-class scope (label: Management Review)
-- and restores the pre-retirement grant: the `samarth` role holds it (the role
-- the deleted `mis` scope used to unlock). Row order respects FKs; all writes
-- are idempotent. Also removes the stray `samarth`->`samarth` overview grant
-- added during access probing (unrelated dashboard, was never granted before).
INSERT OR IGNORE INTO auth_scope (key, label, description) VALUES
  ('enquiry-management', 'Management Review', 'Finalize rates, share with sales and answer sales/procurement queries');
INSERT OR IGNORE INTO auth_role_scope (roleKey, scopeKey)
  SELECT 'samarth', 'enquiry-management' WHERE EXISTS (SELECT 1 FROM auth_role WHERE key = 'samarth');
DELETE FROM auth_role_scope WHERE roleKey = 'samarth' AND scopeKey = 'samarth';
