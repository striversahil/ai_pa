-- 0131_core_stock.sql — Phase 4b: stock ledger mirror (entries + reservations + warehouses).
--
-- Founder votes 2026-11-12: all movements (even pending/draft — full audit
-- trail); reservations mirrored as shape now (zero live rows, dual-write lands
-- so the first reservation flows); warehouses mirrored as facts from
-- StockLocation. Item master (StockItem) stays legacy for now — core holds the
-- LEDGER (entries), obligations (reservations), and places (warehouses).
-- ids reused verbatim. Movements/reservations are append-only in spirit:
-- mirror is INSERT OR IGNORE + status refresh (approve/release transitions).
-- NOTE: D1 rejects INSERT…SELECT…ON CONFLICT — INSERT OR IGNORE only.

CREATE TABLE IF NOT EXISTS "core_stock_entry" (
  "id" TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL DEFAULT '',
  "day" TEXT NOT NULL DEFAULT '',
  "kind" TEXT NOT NULL DEFAULT 'adjustment',
  "qty" REAL NOT NULL DEFAULT 0,
  "locationId" TEXT NOT NULL DEFAULT '',
  "toLocationId" TEXT NOT NULL DEFAULT '',
  "rate" REAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "refType" TEXT NOT NULL DEFAULT '',
  "refId" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_stock_entry_item_day_idx" ON "core_stock_entry" ("itemId", "day");
CREATE INDEX IF NOT EXISTS "core_stock_entry_ref_idx" ON "core_stock_entry" ("refType", "refId");

CREATE TABLE IF NOT EXISTS "core_reservation" (
  "id" TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL DEFAULT '',
  "locationId" TEXT NOT NULL DEFAULT '',
  "qty" REAL NOT NULL DEFAULT 0,
  "refType" TEXT NOT NULL DEFAULT 'SO',
  "refId" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'open',
  "day" TEXT NOT NULL DEFAULT '',
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS "core_reservation_item_idx" ON "core_reservation" ("itemId", "status");
CREATE INDEX IF NOT EXISTS "core_reservation_ref_idx" ON "core_reservation" ("refId", "status");

CREATE TABLE IF NOT EXISTS "core_warehouse" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL DEFAULT '',
  "active" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Backfill: every movement, every reservation, every location.
INSERT OR IGNORE INTO "core_stock_entry" (
  "id", "itemId", "day", "kind", "qty", "locationId", "toLocationId",
  "rate", "status", "refType", "refId", "note", "createdBy", "createdAt"
)
SELECT "id", "itemId", "day", "kind", "qty", "locationId", "toLocationId",
  "rate", "status", "refType", "refId", "note", "createdBy", "createdAt"
FROM "StockMovement";

INSERT OR IGNORE INTO "core_reservation" (
  "id", "itemId", "locationId", "qty", "refType", "refId",
  "status", "day", "createdBy", "createdAt"
)
SELECT "id", "itemId", "locationId", "qty", "refType", "refId",
  "status", "day", "createdBy", "createdAt"
FROM "StockReservation";

INSERT OR IGNORE INTO "core_warehouse" ("id", "name", "active", "createdAt")
SELECT "id", "name", "active", "createdAt" FROM "StockLocation";
