-- CRM order workflow: D1 rows replace the KV snapshot.
--
-- Why: the old CRM dashboard served a single KV blob (crm:salesorders_snapshot)
-- that could only be diffed wholesale. Dispatch scheduling needs per-item state
-- (tentative dispatch date, delay reason, dispatched qty), an audit trail of
-- every promise and slip, and a way to mark orders that Zoho stopped returning.
-- None of that fits in a blob.
--
--   CrmSalesOrder   — one row per SO (org + soNumber), local lifecycle + source state
--   CrmSoItem       — one row per line item; the unit of scheduling and dispatch
--   CrmScheduleEvent— append-only audit (schedule / reschedule / delay / dispatch …)
--
-- Zoho stays read-only: nothing here is pushed back into Zoho Books.
-- Safe to re-run: CREATE ... IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS "CrmSalesOrder" (
  "id"                TEXT PRIMARY KEY,
  "org"               TEXT NOT NULL DEFAULT '',
  "soNumber"          TEXT NOT NULL,
  "zohoId"            TEXT NOT NULL DEFAULT '',
  "customerName"      TEXT NOT NULL DEFAULT '',
  "customerId"        TEXT NOT NULL DEFAULT '',
  "value"             REAL NOT NULL DEFAULT 0,
  "currency"          TEXT NOT NULL DEFAULT 'INR',
  "orderStatus"       TEXT NOT NULL DEFAULT '',
  "invoicedStatus"    TEXT NOT NULL DEFAULT '',
  "shippedStatus"     TEXT NOT NULL DEFAULT '',
  "paidStatus"        TEXT NOT NULL DEFAULT '',
  "status"            TEXT NOT NULL DEFAULT 'open',
  "salesperson"       TEXT NOT NULL DEFAULT '',
  "referenceNumber"   TEXT NOT NULL DEFAULT '',
  "createdDate"       TEXT NOT NULL DEFAULT '',
  "lifecycle"         TEXT NOT NULL DEFAULT 'unscheduled',
  "sourceState"       TEXT NOT NULL DEFAULT 'active',
  "soDelayReason"     TEXT,
  "fingerprint"       TEXT NOT NULL DEFAULT '',
  "missCount"         INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt"       TEXT NOT NULL,
  "lastSeenAt"        TEXT NOT NULL,
  "deletedDetectedAt" TEXT,
  "createdAt"         TEXT NOT NULL,
  "updatedAt"         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_crmsalesorder_org_so" ON "CrmSalesOrder"(org, soNumber);
CREATE INDEX IF NOT EXISTS "idx_crmsalesorder_lifecycle" ON "CrmSalesOrder"(lifecycle);
CREATE INDEX IF NOT EXISTS "idx_crmsalesorder_source" ON "CrmSalesOrder"(sourceState);
CREATE INDEX IF NOT EXISTS "idx_crmsalesorder_created" ON "CrmSalesOrder"(createdDate);

CREATE TABLE IF NOT EXISTS "CrmSoItem" (
  "id"                    TEXT PRIMARY KEY,
  "soId"                  TEXT NOT NULL,
  "lineKey"               TEXT NOT NULL,
  "name"                  TEXT NOT NULL DEFAULT '',
  "sku"                   TEXT NOT NULL DEFAULT '',
  "description"           TEXT NOT NULL DEFAULT '',
  "qty"                   REAL NOT NULL DEFAULT 0,
  "unit"                  TEXT NOT NULL DEFAULT '',
  "rate"                  REAL NOT NULL DEFAULT 0,
  "itemTotal"             REAL NOT NULL DEFAULT 0,
  "dispatchState"         TEXT NOT NULL DEFAULT 'unscheduled',
  "tentativeDispatchDate" TEXT,
  "delayReason"           TEXT,
  "dispatchedQty"         REAL NOT NULL DEFAULT 0,
  "dispatchedAt"          TEXT,
  "scheduledBy"           TEXT,
  "scheduledAt"           TEXT,
  "createdAt"             TEXT NOT NULL,
  "updatedAt"             TEXT NOT NULL,
  UNIQUE (soId, lineKey),
  FOREIGN KEY (soId) REFERENCES "CrmSalesOrder"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_crmsoitem_state" ON "CrmSoItem"(dispatchState);
CREATE INDEX IF NOT EXISTS "idx_crmsoitem_date" ON "CrmSoItem"(tentativeDispatchDate);

CREATE TABLE IF NOT EXISTS "CrmScheduleEvent" (
  "id"        TEXT PRIMARY KEY,
  "soId"      TEXT NOT NULL,
  "soNumber"  TEXT NOT NULL DEFAULT '',
  "itemId"    TEXT,
  "kind"      TEXT NOT NULL,
  "fromDate"  TEXT,
  "toDate"    TEXT,
  "reason"    TEXT,
  "actor"     TEXT NOT NULL DEFAULT '',
  "qty"       REAL,
  "day"       TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_crmscheduleevent_so" ON "CrmScheduleEvent"(soId);
CREATE INDEX IF NOT EXISTS "idx_crmscheduleevent_kind" ON "CrmScheduleEvent"(kind);
CREATE INDEX IF NOT EXISTS "idx_crmscheduleevent_day" ON "CrmScheduleEvent"(day);
