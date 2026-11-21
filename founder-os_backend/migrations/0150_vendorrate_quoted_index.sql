-- 0150 (2026-11-21): paged Rates tab sorts newest-first over the whole
-- VendorRate table (GET /api/product-line/rates, ORDER BY quotedAt DESC, id DESC).
CREATE INDEX IF NOT EXISTS idx_vendorrate_quoted ON VendorRate(quotedAt DESC, id DESC);
