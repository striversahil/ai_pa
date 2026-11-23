-- 0155_vendor_rate_spec_index.sql
--
-- Spec query index (founder decision 2026-11-23).
--
-- The spec document stays ONE JSON column: VendorRate.attrValues holds the
-- schema `specs` object. Encoding is JSON text — in SQLite/D1 a text JSON and a
-- jsonb() blob answer json_extract() identically, and text keeps LIKE search and
-- the string read path working.
--
-- Speed comes from this typed mirror table instead of one index per spec key
-- (v2 has 366 distinct keys across 103 products): one row per (quote, key) with
-- a text value and a numeric value, so any key can be filtered or range-scanned
-- in milliseconds. Rows are written in the same D1 batch as the quote.
--
--   SELECT rateId FROM VendorRateSpec
--   WHERE (attrKey = 'brand' AND valueText = 'PIX')
--      OR (attrKey = 'width_mm' AND valueNum BETWEEN 900 AND 1100)
--   GROUP BY rateId HAVING COUNT(DISTINCT attrKey) = 2;
--
-- `attrValues` remains the single truth; this table is a derived index and can
-- be rebuilt at any time (see modules/product-line/spec-index.ts).

CREATE TABLE IF NOT EXISTS VendorRateSpec (
  rateId    TEXT NOT NULL,
  attrKey   TEXT NOT NULL,
  valueText TEXT,
  valueNum  REAL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (rateId, attrKey)
);

CREATE INDEX IF NOT EXISTS idx_vendorratespec_num ON VendorRateSpec(attrKey, valueNum);
CREATE INDEX IF NOT EXISTS idx_vendorratespec_txt ON VendorRateSpec(attrKey, valueText);

-- Schema v2 adds delivery_time_max_days (lead-time ranges: min 1, max 2).
-- Nullable: a row with no lead time simply has no value (founder call: leave
-- required-but-unknown envelope fields empty rather than inventing a number).
ALTER TABLE VendorRate ADD COLUMN deliveryMaxDays INTEGER;
