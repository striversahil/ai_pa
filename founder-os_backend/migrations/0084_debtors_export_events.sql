-- Debtors Tracker — receivables CSV export log.
--
-- The global "Count" column in the downloaded CSV is COUNT(*) over this table,
-- so it is INSERT-only: two people downloading at the same moment can never
-- lose an increment (a read-modify-write counter on Setting could). The table
-- also keeps who/when/rows for audit.
CREATE TABLE IF NOT EXISTS DebtorsExportEvent (
  id        TEXT    PRIMARY KEY,
  actor     TEXT    NOT NULL DEFAULT '',
  source    TEXT    NOT NULL DEFAULT 'receivables-csv',
  rowCount  INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_debtors_export_createdAt ON DebtorsExportEvent(createdAt);
