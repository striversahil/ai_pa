-- MIS assignment overrides (per estimate):
--   lockedTelecallerId — the estimate is ALWAYS held by this one agent and is
--     never re-poached at EOD, even when red/zombie ("despite whatever the case").
--   skipAssignment     — the estimate is NEVER assigned to any agent; excluded
--     from the assignment engine entirely (stays unassigned).
ALTER TABLE Estimate ADD COLUMN lockedTelecallerId TEXT;
ALTER TABLE Estimate ADD COLUMN skipAssignment INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_estimate_locked ON Estimate(lockedTelecallerId);
CREATE INDEX IF NOT EXISTS idx_estimate_skip ON Estimate(skipAssignment);