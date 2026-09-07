-- Lead-details block extracted from the first Zoho comments by the GH runner
-- (Enquiry Number / Source Lead / Location / Contact / Mobile). Stored per
-- estimate so both Telecalling follow-ups and ZohoEstimates can show the chips.
ALTER TABLE Estimate ADD COLUMN enquiryNumber TEXT;
ALTER TABLE Estimate ADD COLUMN sourceLead TEXT;
ALTER TABLE Estimate ADD COLUMN location TEXT;
ALTER TABLE Estimate ADD COLUMN contactName TEXT;
ALTER TABLE Estimate ADD COLUMN contactPhone TEXT;