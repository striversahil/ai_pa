-- 0184_hr_fund_zero.sql
-- Founder request 2026-11-28: bring the office expense balance back to 0 by
-- deleting the entries that make it non-zero.
--
-- The balance is derived, never stored:
--   SUM(HumanResourcesFundTxn.amount) - SUM(HumanResourcesExpense.amount)
--   where the expense is office spend (expenseType fixed | variable).
-- Field-staff expenses never touch the balance and are left untouched.
--
-- Everything is copied verbatim first (_backup_* tables) so the ledger can be
-- restored with a single INSERT ... SELECT if the founder ever wants it back.

CREATE TABLE IF NOT EXISTS _backup_hr_fund_20261128 AS SELECT * FROM HumanResourcesFundTxn;
CREATE TABLE IF NOT EXISTS _backup_hr_expense_20261128 AS SELECT * FROM HumanResourcesExpense;

-- Stock movements link back to the expense that bought them; that FK is
-- informational only and must not block the cleanup.
UPDATE HumanResourcesInventoryTxn SET expenseId = NULL WHERE expenseId IS NOT NULL;

DELETE FROM HumanResourcesFundTxn;
DELETE FROM HumanResourcesExpense WHERE expenseType IN ('fixed', 'variable');
