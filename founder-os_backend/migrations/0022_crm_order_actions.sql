-- 0022: Manual CRM order actions (local override layer). Records status changes
-- performed by CRM operators from the dashboard. The runner applies these overrides
-- on top of Zoho's raw status before computing pendingStep(), so the snapshot
-- reflects the manual change and the diff logic scores points automatically.
--   action      confirm | invoice | ship | payment | cancel | void
--   fromStage   stage the order was in before this action (null if new)
--   toStage     stage after this action
--   reason      optional note from the operator
--   actor       MIS user who performed the action
--   day         IST date the action happened
CREATE TABLE IF NOT EXISTS CrmOrderAction (
  id           TEXT PRIMARY KEY,
  soNumber     TEXT NOT NULL,
  action       TEXT NOT NULL,
  fromStage    TEXT,
  toStage      TEXT NOT NULL,
  reason       TEXT,
  actor        TEXT NOT NULL,
  day          TEXT NOT NULL,
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crmorder_so ON CrmOrderAction(soNumber);
CREATE INDEX IF NOT EXISTS idx_crmorder_day ON CrmOrderAction(day);
CREATE INDEX IF NOT EXISTS idx_crmorder_action ON CrmOrderAction(action);
