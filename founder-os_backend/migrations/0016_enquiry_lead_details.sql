-- Sales-agent lead details on enquiries: parsed by AI from the first 1–2
-- comments (Enquiry Number, Source Lead, Location).
ALTER TABLE Enquiry ADD COLUMN enquiryNumber TEXT NOT NULL DEFAULT '';
ALTER TABLE Enquiry ADD COLUMN sourceLead TEXT NOT NULL DEFAULT '';
ALTER TABLE Enquiry ADD COLUMN location TEXT NOT NULL DEFAULT '';