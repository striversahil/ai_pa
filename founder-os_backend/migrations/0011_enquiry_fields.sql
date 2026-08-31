-- Enquiry tracker field changes: EST no. (required) + additional requirements.
-- assignedAgentId already exists (SQLite stores the new UUID strings fine).
ALTER TABLE Enquiry ADD COLUMN estNumber TEXT NOT NULL DEFAULT '';
ALTER TABLE Enquiry ADD COLUMN additionalRequirements TEXT;