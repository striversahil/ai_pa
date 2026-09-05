CREATE INDEX IF NOT EXISTS idx_comment_estimateId ON Comment(estimateId);
CREATE INDEX IF NOT EXISTS idx_comment_date ON Comment(date);

-- Telecaller soft delete (MIS Controller — deleted agents stay restorable)
ALTER TABLE Telecaller ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;