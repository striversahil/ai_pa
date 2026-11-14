-- 0143_rename_analyzer.sql — rename the Zoho Sent Analyzer automation to Analyzer
-- (founder decision 2026-11-14: the dashboard is retired as a standalone and
-- now renders as the Analyzer tab inside the Sales workspace).
--
-- Slug, scope, runner and data provider are untouched — display name only.
UPDATE automation SET name = 'Analyzer' WHERE slug = 'zoho-sent-analyzer';
