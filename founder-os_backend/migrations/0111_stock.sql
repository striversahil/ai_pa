-- 0111_stock.sql
-- Stock automation (manual inventory): SKU catalogue + dated movements.
-- Closing stock is derived (sum of movements on/before a day), never stored.

CREATE TABLE IF NOT EXISTS StockItem (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  productName TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'pcs',
  reorderLevel REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_StockItem_active_sku ON StockItem(active, sku);

CREATE TABLE IF NOT EXISTS StockMovement (
  id TEXT PRIMARY KEY,
  itemId TEXT NOT NULL REFERENCES StockItem(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'adjustment',
  qty REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  createdBy TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_StockMovement_item_day ON StockMovement(itemId, day);
CREATE INDEX IF NOT EXISTS idx_StockMovement_day_kind ON StockMovement(day, kind);
