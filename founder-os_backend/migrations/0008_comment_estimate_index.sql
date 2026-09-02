-- Indexes for the telecalling risk model: latestCommentDates() queries
-- Comment by estimateId (IN list) ordered by date — without these indexes D1
-- full-scans the Comment table on every cache refresh, burning row reads.
CREATE INDEX IF NOT EXISTS idx_comment_estimateId ON Comment(estimateId);
CREATE INDEX IF NOT EXISTS idx_comment_date ON Comment(date);