-- Bounded lead-details AI retry budget (10 turns) + terminal "gave up" flag.
-- Each 15-min runner pass that AI-processes an estimate but extracts <3 fields
-- consumes one attempt (detailsAttempts + 1). At 10 failed attempts detailsFailed
-- flips to 1 and the estimate leaves the AI capture loop for good (the UI shows
-- "Details unavailable"; the fingerprint fast-path stops re-entering the pass).
-- A later successful capture (>= 3 fields, e.g. after the agent posts the lead
-- block in a NEW comment, which re-admits the estimate for one more turn) still
-- stores the fields and resets both columns.
ALTER TABLE Estimate ADD COLUMN detailsAttempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Estimate ADD COLUMN detailsFailed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_estimate_details_failed ON Estimate(detailsFailed);
