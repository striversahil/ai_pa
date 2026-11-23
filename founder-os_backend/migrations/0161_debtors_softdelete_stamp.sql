-- 0161_debtors_softdelete_stamp.sql — keep historical debtors views stable.
--
-- "As of" views (Summary date range) rebuild the ledger from dated rows, so a
-- bill deleted AFTER the selected date must still show at that date. The old
-- boolean `deleted` cannot express "when", so every soft delete now stamps
-- `deletedAt` (IST calendar day, YYYY-MM-DD) and readers compare it to the
-- as-of date. Legacy rows already flagged deleted are backfilled from
-- `updatedAt` (deleteInvoice always bumped it); collections have no such
-- column, so their legacy deletes stay unstamped and remain invisible
-- historically — exactly the pre-feature behaviour.
ALTER TABLE "DebtorInvoice" ADD COLUMN "deletedAt" TEXT;
ALTER TABLE "PaymentCollection" ADD COLUMN "deletedAt" TEXT;

UPDATE "DebtorInvoice"
   SET "deletedAt" = substr(CAST("updatedAt" AS TEXT), 1, 10)
 WHERE COALESCE("deleted", 0) IN (1, 'true', 'TRUE')
   AND ("deletedAt" IS NULL OR "deletedAt" = '')
   AND substr(CAST("updatedAt" AS TEXT), 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
