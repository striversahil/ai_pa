-- 0023: AI-parsed line items for the enquiry tracker. Each unstructured
-- enquiry can carry multiple purchasable items ("24GG 1 mtr", "CONVEYOR BELT
-- FASTNER QTY 1000"); the write-time AI enrichment parses them into a JSON
-- array [{ name, qty, spec }] stored here (TEXT, same pattern as
-- imageUrls/activities/additionalRequirements) and rendered item-wise in the
-- dashboard (both Sales and Procurement views — items are specs, not PII).
ALTER TABLE Enquiry ADD COLUMN items TEXT;
