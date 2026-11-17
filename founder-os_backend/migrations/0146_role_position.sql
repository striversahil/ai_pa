-- 0146: one chart position per role (Users & Permissions mapping).
-- Roles carry exactly one org-chart title (or NULL = unmapped). The org chart
-- reads this to show logins under their position cleanly; HR never maps.
ALTER TABLE auth_role ADD COLUMN position TEXT;
