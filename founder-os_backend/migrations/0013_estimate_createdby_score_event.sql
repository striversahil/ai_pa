-- Creator inference: which telecaller originated this estimate (from the first
-- 1-2 comments naming the sales agent, e.g. "muskan", "samar" for Samarjeet).
-- Populated once at creation time by the telecalling assignment engine.
ALTER TABLE Estimate ADD COLUMN createdBy TEXT;

-- Event-ledger scoring for the leaderboard: +100 per estimate converted (credited
-- to the holder at conversion moment) and -15 per EOD snatch (charged to the
-- losing agent for an unsatisfactory remark). day = IST date the event happened,
-- so the leaderboard can sum any timeframe (week/month/year) with a day filter.
CREATE TABLE IF NOT EXISTS TelecallerScoreEvent (
  id           TEXT PRIMARY KEY,
  telecallerId TEXT NOT NULL,
  estimateId   TEXT NOT NULL,
  delta        INTEGER NOT NULL,
  day          TEXT NOT NULL,
  reason       TEXT,
  createdAt    TEXT NOT NULL,
  FOREIGN KEY (telecallerId) REFERENCES Telecaller(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_scoreevent_telecaller ON TelecallerScoreEvent(telecallerId);
CREATE INDEX IF NOT EXISTS idx_scoreevent_day ON TelecallerScoreEvent(day);
CREATE INDEX IF NOT EXISTS idx_scoreevent_estimate ON TelecallerScoreEvent(estimateId);