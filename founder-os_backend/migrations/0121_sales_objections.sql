-- 0121_sales_objections.sql — Sales Objections tab (Sales workspace).
--
-- Agents log objections they face in the field, filed against an estimate
-- number and/or a client name (free text, at least one required — no real
-- estimate link for v1). Every agent on the sales surface sees every
-- objection; managers (MIS/sales-head) reply with coaching and
-- resolve/reopen. Replies are append-only.

CREATE TABLE IF NOT EXISTS SalesObjection (
  id            TEXT PRIMARY KEY,
  estNumber     TEXT NOT NULL DEFAULT '',
  clientName    TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'other', -- price | delivery | quality | competition | payment_terms | other
  detail        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open',  -- open | resolved
  createdBy     TEXT NOT NULL DEFAULT '',
  createdByName TEXT NOT NULL DEFAULT '',
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sales_objection_status ON SalesObjection(status);
CREATE INDEX IF NOT EXISTS idx_sales_objection_updated ON SalesObjection(updatedAt);
CREATE INDEX IF NOT EXISTS idx_sales_objection_est ON SalesObjection(estNumber);
CREATE INDEX IF NOT EXISTS idx_sales_objection_client ON SalesObjection(clientName);

CREATE TABLE IF NOT EXISTS SalesObjectionReply (
  id            TEXT PRIMARY KEY,
  objectionId   TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  createdBy     TEXT NOT NULL DEFAULT '',
  createdByName TEXT NOT NULL DEFAULT '',
  createdAt     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_objection_reply ON SalesObjectionReply(objectionId);
