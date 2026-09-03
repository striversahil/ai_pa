-- Snatch reason: why the previous holder lost an estimate at EOD. Shown to the
-- losing agent in the dashboard so the mechanic teaches what loses a deal.
ALTER TABLE EstimateAssignment ADD COLUMN snatchReason TEXT;