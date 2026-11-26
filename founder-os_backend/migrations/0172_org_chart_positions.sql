-- 0172_org_chart_positions.sql — D1-backed organization chart.
--
-- The live chart was static in organization.json. This table is the editable
-- copy HR/root own; the JSON file remains the seed/fallback. Rows are seeded
-- lazily by the backend from a typed seed that is guard-checked against
-- organization.json, so the SQL only owns the shape.

CREATE TABLE IF NOT EXISTS "OrgChartPosition" (
  "id"            TEXT PRIMARY KEY,
  "title"         TEXT NOT NULL,
  "titleKey"      TEXT NOT NULL UNIQUE,
  "department"    TEXT,
  "wing"          TEXT NOT NULL DEFAULT 'Operations',
  "reportsToId"   TEXT REFERENCES "OrgChartPosition"("id") ON DELETE SET NULL,
  "isTop"         INTEGER NOT NULL DEFAULT 0,
  "isHead"        INTEGER NOT NULL DEFAULT 0,
  "loginPosition" TEXT,
  "order"         INTEGER NOT NULL DEFAULT 0,
  "active"        INTEGER NOT NULL DEFAULT 1,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_org_chart_reports_to"
  ON "OrgChartPosition" ("reportsToId");
CREATE INDEX IF NOT EXISTS "idx_org_chart_active_order"
  ON "OrgChartPosition" ("active", "order");
