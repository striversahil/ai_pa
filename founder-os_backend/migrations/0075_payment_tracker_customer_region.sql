-- Payment Tracker: customer-level sales region.
--
-- Region is maintained once per customer (contact master) and mirrored onto
-- every DebtorInvoice row for that customer so sales filters keep working.
-- '' = unassigned.
ALTER TABLE "PaymentCustomer" ADD COLUMN "region" TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "PaymentCustomer_region_idx" ON "PaymentCustomer" ("region");
