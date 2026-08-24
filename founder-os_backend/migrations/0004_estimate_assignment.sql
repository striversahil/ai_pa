-- Estimate auto-assignment (telecaller roster + assignment history).
ALTER TABLE Estimate ADD COLUMN assignedTelecallerId TEXT;

CREATE TABLE IF NOT EXISTS Telecaller (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  email     TEXT,
  active    INTEGER NOT NULL DEFAULT 1,
  "order"   INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS EstimateAssignment (
  id                TEXT PRIMARY KEY,
  estimateId        TEXT NOT NULL,
  telecallerId      TEXT NOT NULL,
  assignedAt        TEXT NOT NULL,
  day               TEXT NOT NULL,
  reassignedFromId  TEXT,
  status            TEXT NOT NULL DEFAULT 'assigned',
  FOREIGN KEY (estimateId) REFERENCES Estimate(estimateId) ON DELETE CASCADE,
  FOREIGN KEY (telecallerId) REFERENCES Telecaller(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_assignment_estimate ON EstimateAssignment(estimateId);
CREATE INDEX IF NOT EXISTS idx_assignment_telecaller ON EstimateAssignment(telecallerId);
CREATE INDEX IF NOT EXISTS idx_assignment_day ON EstimateAssignment(day);
