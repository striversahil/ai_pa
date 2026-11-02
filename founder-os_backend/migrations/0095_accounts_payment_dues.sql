-- 0095_accounts_payment_dues.sql — Payment dues tab (recurring bills).
--
-- Payments reuse the task engine: a payment is a template with kind='payment'
-- (biller, category, amount, remindDays) whose per-cycle log instances carry
-- paidAmount/paidRef. Marking paid = done + amount + reference.
-- Existing task rows are untouched (kind defaults to 'task').

ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'task';
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "biller" TEXT;
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "category" TEXT;
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "amount" REAL;
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "remindDays" TEXT NOT NULL DEFAULT '7,3,1';
CREATE INDEX IF NOT EXISTS "AccountsTaskTemplate_kind_active_idx" ON "AccountsTaskTemplate" ("kind", "active");

ALTER TABLE "AccountsTaskLog" ADD COLUMN "paidAmount" REAL;
ALTER TABLE "AccountsTaskLog" ADD COLUMN "paidRef" TEXT;
