-- 0107_payment_statement_day.sql — credit-card statement date.
--
-- A credit card's amount is only known once the statement is generated, so the
-- template carries the statement DAY (1–31) next to the due day. The service
-- derives the statement date that prices each cycle (same month when the
-- statement lands before the due day, previous month otherwise) and exposes it
-- as `statementDate` on every payment row. NULL for non-credit-card bills.
ALTER TABLE AccountsTaskTemplate ADD COLUMN statementDay INTEGER;
