-- 0028: Dated next step on estimates (holder/MIS-set customer commitment).
-- While nextStepDate is today-or-future the estimate is protected from the
-- red-risk/EOD penalty regardless of the AI verdict; a past date reads red
-- until chased. Engines never write these columns.
ALTER TABLE Estimate ADD COLUMN nextStep TEXT;
ALTER TABLE Estimate ADD COLUMN nextStepDate TEXT;
