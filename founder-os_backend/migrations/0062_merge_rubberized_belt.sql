-- 0062: retire the bogus "Belts" category (founder order 2026-10-10).
-- "Rubberized Elevator Belt" was its only product (no guides). Merge into
-- "Black Rubber Belt" (Conveying Accessories):
--   1. its name becomes an alias of Black Rubber Belt (idempotent append);
--   2. its single live rate (HP TRADING, 5" x 4-ply x 10mm @ Rs 320/mtr)
--      moves to Black Rubber Belt verbatim (spec keys kept as-quoted);
--   3. the empty product row is deleted (no guides, no BulkRow refs).
-- The "Belts" category vanishes with its last product (categories derive
-- from ProductItem rows; nothing else references it).

UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'rubberized elevator belt'
  )
), updatedAt = '2026-10-10T14:00:00.000Z'
WHERE name = 'Black Rubber Belt'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'rubberized elevator belt');

UPDATE VendorRate SET productId = '7d838dca-0a1e-489b-a6f6-6efe9247797b',
  updatedAt = '2026-10-10T14:00:00.000Z'
WHERE id = '9241ab2e-492e-4ee3-a7ea-f22ed7d48a7f';

DELETE FROM ProductItem WHERE id = 'ec5a9e61-a8cf-4dcc-9ad7-d0a98b6c13a7';
