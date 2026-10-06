-- Rates filed with unknown specs: missing checklist questions stay flagged.
ALTER TABLE VendorRate ADD COLUMN missingSpecs TEXT;
