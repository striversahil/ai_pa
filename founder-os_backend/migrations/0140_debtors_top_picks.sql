-- Debtors Tracker — temporary Top-receivables flag (accountant pins).
--
-- TEMPORARY feature (2026-11-13): the accountant hand-pins priority
-- customers for collection focus. The dashboard ALSO auto-flags the top N by
-- gross due (client-side, N=20 default) — the stored rows here are the MANUAL
-- pins only; the Top chip is the union of both. Drop this table when the
-- temporary drive ends (payload field + UI go with it).
CREATE TABLE IF NOT EXISTS DebtorsTopPick (
  id           TEXT    PRIMARY KEY,
  customerKey  TEXT    NOT NULL UNIQUE,
  customerName TEXT    NOT NULL DEFAULT '',
  pickedBy     TEXT    NOT NULL DEFAULT '',
  createdAt    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_debtors_top_pick_created
  ON DebtorsTopPick(createdAt);
