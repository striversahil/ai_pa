-- 0092_report_sheet.sql — Reporting Sheet (weekly management review).
--
-- One row per department-section per period. The payload is schemaless JSON so
-- sections gain/lose metrics without migrations; the server whitelists fields
-- per section (see src/modules/reporting/types.ts SECTION_DEFS) before write.
--
-- Periods are ISO weeks ('2026-W44', Monday–Sunday IST) today; the granularity
-- column already supports per-day periods ('YYYY-MM-DD') for the daily mode
-- later — same table, same code path.
-- Re-running is safe (upsert-only; audit is insert-only, never updated).

CREATE TABLE IF NOT EXISTS ReportEntry (
  id               TEXT PRIMARY KEY,
  period           TEXT NOT NULL,
  granularity      TEXT NOT NULL DEFAULT 'week',
  department       TEXT NOT NULL,
  section          TEXT NOT NULL,
  payloadJson      TEXT NOT NULL DEFAULT '{}',
  origin           TEXT NOT NULL DEFAULT 'manual',
  submittedBy      TEXT NOT NULL DEFAULT '',
  submittedByName  TEXT NOT NULL DEFAULT '',
  createdAt        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_entry_period
  ON ReportEntry(period, granularity, department, section);
CREATE INDEX IF NOT EXISTS idx_report_entry_dept
  ON ReportEntry(department, period);

CREATE TABLE IF NOT EXISTS ReportAudit (
  id          TEXT PRIMARY KEY,
  actorId     TEXT NOT NULL DEFAULT '',
  actorName   TEXT NOT NULL DEFAULT '',
  action      TEXT NOT NULL,
  entityId    TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  createdAt   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_report_audit_created ON ReportAudit(createdAt);
CREATE INDEX IF NOT EXISTS idx_report_audit_entity ON ReportAudit(entityId);
