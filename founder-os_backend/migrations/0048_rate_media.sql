-- Vendor-quote media: per-rate item photo + manufacturing video.
-- (Media lives on the vendor's quote, not the product master.)
ALTER TABLE VendorRate ADD COLUMN imageUrl TEXT;
ALTER TABLE VendorRate ADD COLUMN videoUrl TEXT;
