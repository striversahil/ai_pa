-- Debtors Tracker — daily CRM remarks + promised-to-pay date.
--
-- Remarks are append-only rows (one per call/note) because a single editable
-- text field loses yesterday's context. PaymentCustomer.situationRemarks keeps
-- mirroring the latest row so existing ageing previews keep working.
--
-- The promise fields persist when the situation changes to Not answering /
-- Busy / etc. — only a newer promise replaces them, or Paid / Closed clears
-- them. promisedDays is the day count the agent picked (0 = today).
ALTER TABLE PaymentCustomer ADD COLUMN promisedDate TEXT;
ALTER TABLE PaymentCustomer ADD COLUMN promisedDays INTEGER;
ALTER TABLE PaymentCustomer ADD COLUMN promisedAt TEXT;
ALTER TABLE PaymentCustomer ADD COLUMN promisedBy TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS PaymentCustomerRemark (
  id           TEXT    PRIMARY KEY,
  customerKey  TEXT    NOT NULL,
  customerName TEXT    NOT NULL DEFAULT '',
  day          TEXT    NOT NULL,
  remark       TEXT    NOT NULL,
  actor        TEXT    NOT NULL DEFAULT '',
  deleted      INTEGER NOT NULL DEFAULT 0,
  deletedAt    TEXT,
  deletedBy    TEXT    NOT NULL DEFAULT '',
  createdAt    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_remark_customer_created
  ON PaymentCustomerRemark(customerKey, createdAt);
CREATE INDEX IF NOT EXISTS idx_payment_remark_created
  ON PaymentCustomerRemark(createdAt);
