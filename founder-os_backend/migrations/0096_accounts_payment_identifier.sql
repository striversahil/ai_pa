-- 0096_accounts_payment_identifier.sql — optional bill number on payment dues.
--
-- One free-text identifier per bill (card number, mobile number, loan/account
-- no., policy no. …). Lives on the template so every cycle + history row
-- inherits it. Optional, existing bills read NULL.

ALTER TABLE "AccountsTaskTemplate" ADD COLUMN "identifier" TEXT;
