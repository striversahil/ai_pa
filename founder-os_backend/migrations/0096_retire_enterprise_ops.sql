-- Retire the Enterprise Operations & Order Analytics automation.
--
-- The dashboard served a hardcoded JSON snapshot (analysis_date 2026-08-05)
-- that never refreshed from Zoho — the live operations/order view is now the
-- CRM — Active Sales Orders automation (slug `crm`), which reads the real
-- Zoho Books pipeline through the GH runner snapshot.
--
-- Removes: the registry row (+ its run history) and the now-unused
-- `enterprise-ops` permission scope with every role/user grant on it.
-- Safe to re-run: every statement is idempotent.
--
-- Table names: auth_* are snake_case (0003_add_auth.sql); the automation
-- ledger is PascalCase (d1/schema.sql). SQLite resolves both case-insensitively.

-- 1) Run history first, so the delete works whether or not the D1 connection
--    has foreign_keys pragma on (the FK is ON DELETE CASCADE).
DELETE FROM AutomationRun
WHERE automationId IN (SELECT id FROM Automation WHERE slug = 'enterprise-operations-analytics');

-- 2) Registry row. GET /api/automations reads this table directly (not the
--    in-memory RULES map), so a stale row would keep the card in the UI.
DELETE FROM Automation WHERE slug = 'enterprise-operations-analytics';

-- 3) Permission scope + grants. Without this the admin panel keeps offering
--    an "Enterprise Ops" grant that unlocks a dashboard that no longer exists.
DELETE FROM auth_role_scope WHERE scopeKey = 'enterprise-ops';
DELETE FROM auth_user_scope WHERE scopeKey = 'enterprise-ops';
DELETE FROM auth_scope WHERE key = 'enterprise-ops';
