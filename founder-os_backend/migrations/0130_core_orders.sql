-- 0130_core_orders.sql — Phase 4a: order spine mirror + shadow (flip later).
--
-- Founder votes 2026-11-12: mirror + shadow first (same as customers/sales);
-- open orders only (cancelled/void/source-deleted stay legacy; the sync never
-- creates history rows for closed orders, and neither do we).
-- Live at write time: 142 active orders (73 dispatched + 11 partial + 12
-- scheduled + 45 unscheduled + 1 cancelled), 412 lines, 562 stage events,
-- 12 dispatch proofs, 18 attachments.
--
-- core id REUSE: order/line/event/proof/attachment ids are reused verbatim.
-- masterCustomerId = UNIQUE exact name match or '' (never guessed, same rule
-- as sales). Estimates are never hard-deleted, but orders CAN vanish at the
-- source — sourceState/deletedDetectedAt mirror as facts; no tombstone
-- convention (a deleted_source row that returns resurrects with live values).
-- NOTE: D1 rejects INSERT…SELECT…ON CONFLICT — INSERT OR IGNORE only.

CREATE TABLE IF NOT EXISTS "core_sales_order" (
  "id" TEXT PRIMARY KEY,
  "org" TEXT NOT NULL DEFAULT '',
  "soNumber" TEXT NOT NULL DEFAULT '',
  "zohoId" TEXT NOT NULL DEFAULT '',
  "customerName" TEXT NOT NULL DEFAULT '',
  "masterCustomerId" TEXT NOT NULL DEFAULT '',
  "value" REAL NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "orderStatus" TEXT NOT NULL DEFAULT '',
  "invoicedStatus" TEXT NOT NULL DEFAULT '',
  "shippedStatus" TEXT NOT NULL DEFAULT '',
  "paidStatus" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'open',
  "salesperson" TEXT NOT NULL DEFAULT '',
  "referenceNumber" TEXT NOT NULL DEFAULT '',
  "region" TEXT NOT NULL DEFAULT '',
  "billingAddress" TEXT NOT NULL DEFAULT '',
  "shippingAddress" TEXT NOT NULL DEFAULT '',
  "paymentTerms" TEXT NOT NULL DEFAULT '',
  "createdDate" TEXT NOT NULL DEFAULT '',
  "lifecycle" TEXT NOT NULL DEFAULT 'unscheduled',
  "sourceState" TEXT NOT NULL DEFAULT 'active',
  "fingerprint" TEXT NOT NULL DEFAULT '',
  "missCount" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" TEXT,
  "lastSeenAt" TEXT,
  "deletedDetectedAt" TEXT,
  "localCancelledAt" TEXT,
  "localCancelledBy" TEXT,
  "localCancelReason" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "core_sale_order_org_number_idx" ON "core_sales_order" ("org", "soNumber");
CREATE INDEX IF NOT EXISTS "core_sale_order_lifecycle_idx" ON "core_sales_order" ("lifecycle");
CREATE INDEX IF NOT EXISTS "core_sale_order_region_idx" ON "core_sales_order" ("region");
CREATE INDEX IF NOT EXISTS "core_sale_order_customer_idx" ON "core_sales_order" ("masterCustomerId");

CREATE TABLE IF NOT EXISTS "core_so_line" (
  "id" TEXT PRIMARY KEY,
  "soId" TEXT NOT NULL DEFAULT '',
  "lineKey" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT '',
  "sku" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "qty" REAL NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL DEFAULT '',
  "rate" REAL NOT NULL DEFAULT 0,
  "itemTotal" REAL NOT NULL DEFAULT 0,
  "dispatchState" TEXT NOT NULL DEFAULT 'unscheduled',
  "tentativeDispatchDate" TEXT,
  "delayReason" TEXT,
  "dispatchedQty" REAL NOT NULL DEFAULT 0,
  "dispatchedAt" TEXT,
  "scheduledBy" TEXT,
  "scheduledAt" TEXT,
  "amendedQty" REAL,
  "removedAt" TEXT,
  "removedBy" TEXT,
  "isLocalAdded" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "core_so_line_so_key_idx" ON "core_so_line" ("soId", "lineKey");
CREATE INDEX IF NOT EXISTS "core_so_line_state_idx" ON "core_so_line" ("dispatchState");

CREATE TABLE IF NOT EXISTS "core_stage_event" (
  "id" TEXT PRIMARY KEY,
  "soId" TEXT NOT NULL DEFAULT '',
  "soNumber" TEXT NOT NULL DEFAULT '',
  "itemId" TEXT,
  "kind" TEXT NOT NULL DEFAULT '',
  "fromDate" TEXT,
  "toDate" TEXT,
  "reason" TEXT,
  "actor" TEXT NOT NULL DEFAULT '',
  "qty" REAL,
  "day" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_stage_event_so_idx" ON "core_stage_event" ("soId");
CREATE INDEX IF NOT EXISTS "core_stage_event_kind_idx" ON "core_stage_event" ("kind");

CREATE TABLE IF NOT EXISTS "core_dispatch_proof" (
  "id" TEXT PRIMARY KEY,
  "soId" TEXT NOT NULL DEFAULT '',
  "soNumber" TEXT NOT NULL DEFAULT '',
  "invoiceId" TEXT NOT NULL DEFAULT '',
  "beforeId" TEXT,
  "afterId" TEXT,
  "actor" TEXT NOT NULL DEFAULT '',
  "day" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_dispatch_proof_so_idx" ON "core_dispatch_proof" ("soId");

-- Attachments consolidate here (Phase 0 gap closed): file bytes stay in
-- KV/R2 as today, storageKey abstracts. Burn-once preserved via UNIQUE key.
CREATE TABLE IF NOT EXISTS "core_attachment" (
  "id" TEXT PRIMARY KEY,
  "soNumber" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'other',
  "fileName" TEXT NOT NULL DEFAULT '',
  "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "size" INTEGER NOT NULL DEFAULT 0,
  "storageKey" TEXT NOT NULL DEFAULT '',
  "uploadedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "core_attachment_key_idx" ON "core_attachment" ("storageKey");
CREATE INDEX IF NOT EXISTS "core_attachment_so_idx" ON "core_attachment" ("soNumber");

-- Backfill: open orders only (skip cancelled / void / source-deleted).
INSERT OR IGNORE INTO "core_sales_order" (
  "id", "org", "soNumber", "zohoId", "customerName", "masterCustomerId",
  "value", "currency", "orderStatus", "invoicedStatus", "shippedStatus",
  "paidStatus", "status", "salesperson", "referenceNumber", "region",
  "billingAddress", "shippingAddress", "paymentTerms", "createdDate",
  "lifecycle", "sourceState", "fingerprint", "missCount",
  "firstSeenAt", "lastSeenAt", "deletedDetectedAt",
  "localCancelledAt", "localCancelledBy", "localCancelReason",
  "createdAt", "updatedAt"
)
SELECT
  "id", "org", "soNumber", "zohoId", "customerName",
  CASE WHEN (
    SELECT COUNT(*) FROM "MasterCustomer" "m"
    WHERE "m"."displayName" = "CrmSalesOrder"."customerName"
       OR "m"."companyName" = "CrmSalesOrder"."customerName"
  ) = 1 THEN (
    SELECT "m"."id" FROM "MasterCustomer" "m"
    WHERE "m"."displayName" = "CrmSalesOrder"."customerName"
       OR "m"."companyName" = "CrmSalesOrder"."customerName"
    LIMIT 1
  ) ELSE '' END,
  "value", "currency", "orderStatus", "invoicedStatus", "shippedStatus",
  "paidStatus", "status", "salesperson", "referenceNumber", "region",
  "billingAddress", "shippingAddress", "paymentTerms", "createdDate",
  "lifecycle", "sourceState", "fingerprint", "missCount",
  "firstSeenAt", "lastSeenAt", "deletedDetectedAt",
  "localCancelledAt", "localCancelledBy", "localCancelReason",
  "createdAt", "updatedAt"
FROM "CrmSalesOrder"
WHERE lower("status") NOT IN ('cancelled', 'void')
  AND "sourceState" <> 'deleted_source';

-- Backfill lines + stage events + proofs + attachments for mirrored orders.
INSERT OR IGNORE INTO "core_so_line" (
  "id", "soId", "lineKey", "name", "sku", "description", "qty", "unit",
  "rate", "itemTotal", "dispatchState", "tentativeDispatchDate", "delayReason",
  "dispatchedQty", "dispatchedAt", "scheduledBy", "scheduledAt",
  "amendedQty", "removedAt", "removedBy", "isLocalAdded", "createdAt", "updatedAt"
)
SELECT "id", "soId", "lineKey", "name", "sku", "description", "qty", "unit",
  "rate", "itemTotal", "dispatchState", "tentativeDispatchDate", "delayReason",
  "dispatchedQty", "dispatchedAt", "scheduledBy", "scheduledAt",
  "amendedQty", "removedAt", "removedBy", "isLocalAdded", "createdAt", "updatedAt"
FROM "CrmSoItem"
WHERE "soId" IN (SELECT "id" FROM "core_sales_order");

INSERT OR IGNORE INTO "core_stage_event" (
  "id", "soId", "soNumber", "itemId", "kind", "fromDate", "toDate",
  "reason", "actor", "qty", "day", "createdAt"
)
SELECT "id", "soId", "soNumber", "itemId", "kind", "fromDate", "toDate",
  "reason", "actor", "qty", "day", "createdAt"
FROM "CrmScheduleEvent"
WHERE "soId" IN (SELECT "id" FROM "core_sales_order");

INSERT OR IGNORE INTO "core_dispatch_proof" (
  "id", "soId", "soNumber", "invoiceId", "beforeId", "afterId",
  "actor", "day", "createdAt"
)
SELECT "id", "soId", "soNumber", "invoiceId", "beforeId", "afterId",
  "actor", "day", "createdAt"
FROM "CrmDispatchProof"
WHERE "soId" IN (SELECT "id" FROM "core_sales_order");

INSERT OR IGNORE INTO "core_attachment" (
  "id", "soNumber", "kind", "fileName", "mime", "size", "storageKey",
  "uploadedBy", "createdAt"
)
SELECT "id", "soNumber", "kind", "fileName", "mime", "size", "kvKey",
  "uploadedBy", "createdAt"
FROM "SoAttachment";

-- Zoho links for mirrored orders.
INSERT OR IGNORE INTO "core_zoho_link" ("id", "system", "namespace", "externalId", "entityType", "entityId", "metadata")
SELECT
  'zoho-order-' || "org" || '-' || "soNumber",
  'zoho', "org", "soNumber", 'sales_order', "id",
  json_object('customerName', "customerName", 'lifecycle', "lifecycle", 'value', "value")
FROM "core_sales_order";
