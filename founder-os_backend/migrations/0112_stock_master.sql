-- 0112_stock_master.sql
-- Stock overhaul: auto-SKU master (category/brand/rates), multi-location,
-- movement location/rate/approval columns, SO reservations.

ALTER TABLE StockItem ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE StockItem ADD COLUMN brand TEXT NOT NULL DEFAULT '';
ALTER TABLE StockItem ADD COLUMN barcode TEXT NOT NULL DEFAULT '';
ALTER TABLE StockItem ADD COLUMN unitPurchase TEXT NOT NULL DEFAULT '';
ALTER TABLE StockItem ADD COLUMN unitFactor REAL NOT NULL DEFAULT 1;
ALTER TABLE StockItem ADD COLUMN purchaseRate REAL NOT NULL DEFAULT 0;
ALTER TABLE StockItem ADD COLUMN saleRate REAL NOT NULL DEFAULT 0;
ALTER TABLE StockItem ADD COLUMN supplier TEXT NOT NULL DEFAULT '';
ALTER TABLE StockItem ADD COLUMN minLevel REAL NOT NULL DEFAULT 0;
ALTER TABLE StockItem ADD COLUMN maxLevel REAL NOT NULL DEFAULT 0;
ALTER TABLE StockItem ADD COLUMN imageUrl TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_StockItem_category ON StockItem(category, active);

CREATE TABLE IF NOT EXISTS StockLocation (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO StockLocation (id, name, active, createdAt)
SELECT 'loc-main', 'MAIN', 1, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM StockLocation WHERE name = 'MAIN');

ALTER TABLE StockMovement ADD COLUMN locationId TEXT NOT NULL DEFAULT '';
ALTER TABLE StockMovement ADD COLUMN toLocationId TEXT NOT NULL DEFAULT '';
ALTER TABLE StockMovement ADD COLUMN rate REAL NOT NULL DEFAULT 0;
ALTER TABLE StockMovement ADD COLUMN status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE StockMovement ADD COLUMN refType TEXT NOT NULL DEFAULT '';
ALTER TABLE StockMovement ADD COLUMN refId TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_StockMovement_loc_day ON StockMovement(locationId, day);
-- Backfill legacy kinds to the new vocabulary.
UPDATE StockMovement SET kind = 'purchase-in' WHERE kind = 'receipt';
UPDATE StockMovement SET kind = 'sales-out' WHERE kind = 'issue';
UPDATE StockMovement SET locationId = 'MAIN' WHERE locationId = '' OR locationId IS NULL;

CREATE TABLE IF NOT EXISTS StockReservation (
  id TEXT PRIMARY KEY,
  itemId TEXT NOT NULL REFERENCES StockItem(id) ON DELETE CASCADE,
  locationId TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  refType TEXT NOT NULL DEFAULT 'SO',
  refId TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  day TEXT NOT NULL DEFAULT '',
  createdBy TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_StockReservation_item ON StockReservation(itemId, status);
CREATE INDEX IF NOT EXISTS idx_StockReservation_ref ON StockReservation(refId, status);
