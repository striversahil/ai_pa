-- 0025: Procurement workflow stage for the enquiry tracker. New requirements
-- arrive as Rate Pending; the first vendor rate moves them to Rates Received;
-- Management finalizes (markup applied). Empty string = legacy rows.
ALTER TABLE Enquiry ADD COLUMN rateStatus TEXT NOT NULL DEFAULT '';
