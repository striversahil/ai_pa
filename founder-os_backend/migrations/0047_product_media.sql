-- Product media: photo + manufacturing video URLs on the product master.
ALTER TABLE ProductItem ADD COLUMN imageUrl TEXT;
ALTER TABLE ProductItem ADD COLUMN videoUrl TEXT;
