-- 0093_report_sheet_rows.sql — tabular blocks for the Reporting Sheet.
--
-- Telecaller-performer rows and region-order rows are edited cell-by-cell, so
-- they live in their own columns (not nested in payloadJson).

ALTER TABLE ReportEntry ADD COLUMN telecallerRowsJson TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ReportEntry ADD COLUMN regionOrdersJson TEXT NOT NULL DEFAULT '[]';
