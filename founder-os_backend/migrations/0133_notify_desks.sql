-- 0133_notify_desks.sql — Phase 6a: seed the two work-queue desks + nothing else.
-- (No retirements in 6a — founder vote.) hlp_dashboard/widget tables were
-- created in 0125; these are the first data rows. Dashboards resolve widgets
-- against the existing scope-filtered reads (GET /api/dashboards/:key).

INSERT OR IGNORE INTO "hlp_dashboard" ("id", "key", "name", "requiredScreenKey", "layout", "isDefaultFor", "active")
VALUES
  ('dash-sales-my-work', 'sales_my_work', 'My Work', 'screen:sales_mywork',
   '{"version":1}', '["pos-sales-exec","pos-field-exec"]', 1),
  ('dash-sales-team', 'sales_team', 'Team Queue', 'screen:sales_team',
   '{"version":1}', '["pos-tl1","pos-tl2","pos-sales-head"]', 1);

INSERT OR IGNORE INTO "hlp_widget" ("id", "dashboardId", "key", "type", "title", "dataSource", "config", "position", "sortOrder")
VALUES
  ('dash-sales-my-work:queue', 'dash-sales-my-work', 'queue', 'kpi', 'My queue', 'work/my',
   '{"openLabel":"open","overdueLabel":"overdue"}', 'top', 0),
  ('dash-sales-my-work:unread', 'dash-sales-my-work', 'unread', 'kpi', 'Notifications', 'notifications/unread',
   '{}', 'top', 1),
  ('dash-sales-team:queue', 'dash-sales-team', 'queue', 'table', 'Team queue', 'work/team',
   '{"groupBy":"assignee"}', 'top', 0),
  ('dash-sales-team:unread', 'dash-sales-team', 'unread', 'kpi', 'Notifications', 'notifications/unread',
   '{}', 'top', 1);
