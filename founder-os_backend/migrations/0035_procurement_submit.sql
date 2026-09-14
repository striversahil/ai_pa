-- 0035: explicit procurement handoff. Procurement presses Submit to Management
-- per enquiry (procurementSubmittedAt); only then does the enquiry conclude
-- in procurement and enter the management queue. Backfilled for in-flight
-- rows that already carry rates (see deploy notes).
ALTER TABLE Enquiry ADD COLUMN procurementSubmittedAt TEXT NOT NULL DEFAULT '';
