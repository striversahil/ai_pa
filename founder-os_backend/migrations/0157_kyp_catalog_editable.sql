-- 0157_kyp_catalog_editable.sql
--
-- Makes the KYP catalogue editable in the UI (founder decision 2026-11-23).
--
-- Until now `type` / `enum` / `min` / `max` for a spec lived only in the
-- compiled schema (`kyp-catalog.ts`), so the dashboard could edit a spec's
-- question text but not its type, its choice list or its bounds. Those fields
-- move into `KypGuide` so the UI owns the whole contract and the KYP JSON can
-- be exported straight from D1.
--
-- `ProductItem.key` is the schema `product_key`. Seeded rows already encode it
-- in the id (`pi_<key>`); this column makes it explicit and rename-proof, so a
-- product can be renamed without breaking its export branch.
--
-- Backfill runs after ALTER; regenerate `0156_kyp_catalog_v2_seed.sql`
-- (`node scripts/gen-kyp-catalog.mjs`) and re-run it to fill the new guide
-- columns (the seed upsert writes them).

ALTER TABLE ProductItem ADD COLUMN key TEXT;

UPDATE ProductItem
   SET key = substr(id, 4)
 WHERE (key IS NULL OR key = '')
   AND id LIKE 'pi\_%' ESCAPE '\';

CREATE UNIQUE INDEX IF NOT EXISTS idx_productitem_key ON ProductItem(key);

ALTER TABLE KypGuide ADD COLUMN type TEXT;
ALTER TABLE KypGuide ADD COLUMN enumJson TEXT;
ALTER TABLE KypGuide ADD COLUMN minNum REAL;
ALTER TABLE KypGuide ADD COLUMN maxNum REAL;
