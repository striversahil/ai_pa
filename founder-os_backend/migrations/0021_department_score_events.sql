-- 0021: Department score ledger for the CRM automation. Every measurable
-- movement of a sales order (confirm → invoice → ship → payment → paid, plus
-- new orders and cancellations) credits or debits the owning department's
-- point balance, so each department dashboard (CRM / Accounts / Dispatch /
-- Procurement) has a measurable game exactly like the telecalling leaderboard.
--   dept         crm | accounts | dispatch | procurement
--   points       +50 confirm (crm) · +25 material allocated (procurement) ·
--                +50 invoice raised (accounts) · +50 shipped (dispatch) ·
--                +100 payment received (accounts) · +25 new order (crm) ·
--                −20 cancelled (charged to the dept owning the stage it was in)
--   actor        Zoho salesperson for CRM/Dispatch; NULL for team desks
--   day          IST date the event happened (leaderboards sum any timeframe)
CREATE TABLE IF NOT EXISTS DepartmentScoreEvent (
  id           TEXT PRIMARY KEY,
  dept         TEXT NOT NULL,
  soNumber     TEXT NOT NULL,
  points       INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  actor        TEXT,
  day          TEXT NOT NULL,
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deptscore_dept ON DepartmentScoreEvent(dept);
CREATE INDEX IF NOT EXISTS idx_deptscore_day ON DepartmentScoreEvent(day);
CREATE INDEX IF NOT EXISTS idx_deptscore_actor ON DepartmentScoreEvent(actor);
CREATE INDEX IF NOT EXISTS idx_deptscore_so ON DepartmentScoreEvent(soNumber);