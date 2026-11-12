-- 0138_orders_backfill.sql — converge core order spine with live floor (additive only).
--
-- Gap found 2026-11-12 on live D1: CrmSalesOrder 144 vs core_sales_order 142,
-- CrmSoItem 429 vs core_so_line 412. The 2 missing orders (SO-11857, SO-11858,
-- both draft/active, created 2026-11-12T06:01:55Z) + their 17 lines arrived via
-- a sync tick whose mirror silently no-oped (mirror is non-fatal by design).
-- Header/line field diffs on the 142 mirrored rows are ZERO; stage events
-- 562=562, dispatch proofs 12=12, attachments 18=18 already exact.
--
-- This re-runs the 0130 backfills verbatim (INSERT OR IGNORE — idempotent, D1
-- rule: never INSERT…SELECT…ON CONFLICT). Only missing rows insert; everything
-- else no-ops. No DROP, no RENAME, no bridge — collapse stays a separate human
-- decision (schemas are not 1:1: legacy keeps customerId/soDelayReason/edit
-- stamps, core carries masterCustomerId; kvKey vs storageKey — see
-- docs/core-change-requests/2026-11-12-orders-collapse.md).
--
-- Orders: open scope only (same filter as 0130).
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
    SELECT COUNT(*) FROM "core_customer" "m"
    WHERE "m"."displayName" = "CrmSalesOrder"."customerName"
       OR "m"."companyName" = "CrmSalesOrder"."customerName"
  ) = 1 THEN (
    SELECT "m"."id" FROM "core_customer" "m"
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

-- Lines for newly mirrored orders (existing rows no-op on IGNORE).
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

-- Append-only children (all no-ops if already converged).
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

-- Zoho links for newly mirrored orders.
INSERT OR IGNORE INTO "core_zoho_link" ("id", "system", "namespace", "externalId", "entityType", "entityId", "metadata")
SELECT
  'zoho-order-' || "org" || '-' || "soNumber",
  'zoho', "org", "soNumber", 'sales_order', "id",
  json_object('customerName', "customerName", 'lifecycle', "lifecycle", 'value', "value")
FROM "core_sales_order";
