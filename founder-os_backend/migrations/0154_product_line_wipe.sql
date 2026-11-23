-- 0154_product_line_wipe.sql
-- Founder decision 2026-11-22: wipe the Product Line transactional data.
--
-- Deleted: every vendor quote (VendorRate), the spec-ask checklist (KypGuide)
-- and the product master rows (ProductItem). The Vendor master is KEPT.
-- The Product Line AI agents (knowledge copilot + add-vendor-rates intake)
-- were removed from the code in the same change, and their photo files are
-- purged from CHAT_FILES (prefix product-photo/).
--
-- Order matters: rates reference products + vendors, guide references products.
--
-- NOTE: migration 0046 seeds the KYP sheet (data/know_your_product_v2.json)
-- into ProductItem/KypGuide on a FRESH database. That seed was left intact, so
-- a newly created database must also run this migration to stay empty.
DELETE FROM VendorRate;
DELETE FROM KypGuide;
DELETE FROM ProductItem;
