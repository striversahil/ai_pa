-- 0116_stock_planning.sql
-- SEFAR backfill support: planning params per SKU (consumption-based reorder).
-- pending_to_order stays computed (MOQ-rounded fill-to-max), never stored.

ALTER TABLE StockItem ADD COLUMN avgDailyConsumption REAL NOT NULL DEFAULT 0;
ALTER TABLE StockItem ADD COLUMN leadTimeDays REAL NOT NULL DEFAULT 0;
ALTER TABLE StockItem ADD COLUMN safetyFactor REAL NOT NULL DEFAULT 0;
ALTER TABLE StockItem ADD COLUMN moq REAL NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_StockItem_planning ON StockItem(category, active, maxLevel);
