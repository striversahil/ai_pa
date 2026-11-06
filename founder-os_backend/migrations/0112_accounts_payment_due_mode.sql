-- 0112_accounts_payment_due_mode.sql — two billing models for credit cards.
--
-- A credit-card bill is EITHER due on a fixed day of month (dueMode='fixed',
-- the current behaviour, dueDay) OR N days after its statement
-- (dueMode='after_statement': statement generates on statementDay, due date
-- is statement + graceDays, which can spill into the next month).
-- Existing bills default to 'fixed' — no behaviour change until edited.

ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "dueMode" TEXT DEFAULT 'fixed';
ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "graceDays" INTEGER;
