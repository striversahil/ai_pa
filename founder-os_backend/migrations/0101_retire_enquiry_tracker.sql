-- 0101_retire_enquiry_tracker.sql
-- Retire the Sales Enquiries automation (slug `enquiry-tracker`).
--
-- The unified Sales workspace absorbed the dashboard: Enquiries now renders
-- inside `sales` from /api/enquiries/* routes, and the old dashboard branch,
-- nav icon and hasDashboard flag are already gone. The registry entry itself
-- was display-only (manual trigger, never fired) — its only remaining reader
-- was the founder-overview Enquiries section, which now builds from
-- enquiry-procurement + enquiry-management.
--
-- Live enquiry data + CRUD live under /api/enquiries/* and are untouched.
-- Follows migrations/0096_retire_enterprise_ops.sql: delete runs first, then
-- the registry row (GET /api/automations reads this table directly).

DELETE FROM AutomationRun
WHERE automationId IN (SELECT id FROM Automation WHERE slug = 'enquiry-tracker');

DELETE FROM Automation WHERE slug = 'enquiry-tracker';
