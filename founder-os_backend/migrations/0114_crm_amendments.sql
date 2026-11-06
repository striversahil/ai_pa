-- 0114_crm_amendments.sql
-- Dispatch-floor SO amendments (client-confirmed) + full-SO local cancel.
--
-- Zoho stays READ-ONLY: these columns are a LOCAL overlay. The sync never
-- clears them and never overwrites an amended qty or a removed line.
--
-- CrmSoItem.amendedQty   client-confirmed qty override (NULL = follow Zoho qty).
-- CrmSoItem.removedAt/By line removed on the floor (stays in DB, struck-through
--                        in the panel, excluded from queues/lifecycle/dispatch).
-- CrmSoItem.isLocalAdded line added by the floor (no Zoho lineKey; sync ignores).
-- CrmSalesOrder.localCancelled* full-SO floor cancel with reason (reversible by
--                        MIS; distinct from Zoho status=cancelled/void).

ALTER TABLE "CrmSoItem" ADD COLUMN "amendedQty" REAL;
ALTER TABLE "CrmSoItem" ADD COLUMN "removedAt" TIMESTAMP;
ALTER TABLE "CrmSoItem" ADD COLUMN "removedBy" TEXT;
ALTER TABLE "CrmSoItem" ADD COLUMN "isLocalAdded" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CrmSalesOrder" ADD COLUMN "localCancelledAt" TIMESTAMP;
ALTER TABLE "CrmSalesOrder" ADD COLUMN "localCancelledBy" TEXT;
ALTER TABLE "CrmSalesOrder" ADD COLUMN "localCancelReason" TEXT;
