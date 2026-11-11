-- 0117_field_visits.sql — Field Staff daily-visit tracking (Sales → Field Staff tab).
--
-- Field staff never operated the dashboard; this gives them a mobile-web
-- surface: check-in per location (city), GPS pings while the page is open,
-- mill-level visit rows (machine profile + requirement), per-visit expenses
-- and per-visit follow-ups. Requirement text auto-creates a Field-Staff
-- enquiry (source='Field Staff', credited to the staffer) via the worker
-- route — the enquiry id is stored back on the mill row.

CREATE TABLE IF NOT EXISTS FieldVisit (
  id              TEXT PRIMARY KEY,
  telecallerId    TEXT NOT NULL, -- field_staff roster row
  day             TEXT NOT NULL, -- YYYY-MM-DD IST
  city            TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  lat             REAL,
  lng             REAL,
  note            TEXT NOT NULL DEFAULT '',
  checkInAt       TEXT NOT NULL,
  lastPingAt      TEXT NOT NULL DEFAULT '',
  checkOutAt      TEXT NOT NULL DEFAULT '',
  createdBy       TEXT NOT NULL DEFAULT '',
  createdByName   TEXT NOT NULL DEFAULT '',
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_field_visit_day ON FieldVisit(day);
CREATE INDEX IF NOT EXISTS idx_field_visit_staff ON FieldVisit(telecallerId);
CREATE INDEX IF NOT EXISTS idx_field_visit_staff_day ON FieldVisit(telecallerId, day);

CREATE TABLE IF NOT EXISTS FieldMillVisit (
  id                TEXT PRIMARY KEY,
  visitId           TEXT NOT NULL,
  millName          TEXT NOT NULL DEFAULT '',
  keyContact        TEXT NOT NULL DEFAULT '',
  designation       TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  rollerPlantNos    TEXT NOT NULL DEFAULT '',
  attaChakkiNos     TEXT NOT NULL DEFAULT '',
  chakkiSize        TEXT NOT NULL DEFAULT '',
  runningTime       TEXT NOT NULL DEFAULT '',
  products          TEXT NOT NULL DEFAULT '',
  millAgeYrs        TEXT NOT NULL DEFAULT '',
  machineBrand      TEXT NOT NULL DEFAULT '',
  requirement       TEXT NOT NULL DEFAULT '',
  isNewSuggested    INTEGER NOT NULL DEFAULT 1, -- auto-matcher verdict at save
  isNewManual       INTEGER,                    -- manual toggle override (null = follow suggestion)
  matchMasterId     TEXT NOT NULL DEFAULT '',
  matchMasterName   TEXT NOT NULL DEFAULT '',
  enquiryId         TEXT NOT NULL DEFAULT '',
  followUpNeeded    INTEGER NOT NULL DEFAULT 0,
  createdBy         TEXT NOT NULL DEFAULT '',
  createdByName     TEXT NOT NULL DEFAULT '',
  createdAt         TEXT NOT NULL,
  updatedAt         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_field_mill_visit ON FieldMillVisit(visitId);

CREATE TABLE IF NOT EXISTS FieldExpense (
  id            TEXT PRIMARY KEY,
  visitId       TEXT NOT NULL,
  amount        REAL NOT NULL DEFAULT 0,
  description   TEXT NOT NULL DEFAULT '',
  createdBy     TEXT NOT NULL DEFAULT '',
  createdByName TEXT NOT NULL DEFAULT '',
  createdAt     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_field_expense_visit ON FieldExpense(visitId);

CREATE TABLE IF NOT EXISTS FieldFollowup (
  id            TEXT PRIMARY KEY,
  visitId       TEXT NOT NULL,
  millVisitId   TEXT NOT NULL DEFAULT '',
  dueDate       TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  owner         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open', -- open | done | cancelled
  createdBy     TEXT NOT NULL DEFAULT '',
  createdByName TEXT NOT NULL DEFAULT '',
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_field_followup_visit ON FieldFollowup(visitId);
CREATE INDEX IF NOT EXISTS idx_field_followup_status ON FieldFollowup(status);
