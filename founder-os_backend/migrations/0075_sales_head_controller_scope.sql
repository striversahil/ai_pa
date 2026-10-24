-- Sales Head can open the telecalling Controller (region links, roster,
-- history reset). The `sales-head` scope already exists; the seeded role was
-- missing it, so its holders fell back to a locked Controller. Idempotent.

INSERT OR IGNORE INTO auth_role_scope ("roleKey", "scopeKey")
SELECT 'sales-head', 'sales-head'
WHERE EXISTS (SELECT 1 FROM auth_role WHERE "key" = 'sales-head')
  AND EXISTS (SELECT 1 FROM auth_scope WHERE "key" = 'sales-head');
