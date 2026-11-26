-- 0173_hr_assets.sql — employee assets and role-position standards.
--
-- Assets are separate from office Inventory: these are the things a specific
-- employee holds ( laptop, phone, SIM ), plus optional standards per chart
-- position that define the expected kit for that role.

CREATE TABLE IF NOT EXISTS "HumanResourcesAssetType" (
  "id"           TEXT PRIMARY KEY,
  "name"         TEXT NOT NULL,
  "nameKey"      TEXT NOT NULL UNIQUE,
  "defaultSpecs" TEXT,
  "order"        INTEGER NOT NULL DEFAULT 0,
  "active"       INTEGER NOT NULL DEFAULT 1,
  "createdBy"    TEXT,
  "updatedBy"    TEXT,
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_hr_asset_type_active_order"
  ON "HumanResourcesAssetType" ("active", "order");

CREATE TABLE IF NOT EXISTS "HumanResourcesAsset" (
  "id"          TEXT PRIMARY KEY,
  "memberId"    TEXT NOT NULL REFERENCES "HumanResourcesMember"("id") ON DELETE CASCADE,
  "assetTypeId" TEXT NOT NULL REFERENCES "HumanResourcesAssetType"("id") ON DELETE RESTRICT,
  "label"       TEXT NOT NULL DEFAULT '',
  "identifier"  TEXT,
  "specs"       TEXT,
  "status"      TEXT NOT NULL DEFAULT 'assigned',
  "assignedOn"  TEXT NOT NULL,
  "returnedOn"  TEXT,
  "notes"       TEXT,
  "deleted"     INTEGER NOT NULL DEFAULT 0,
  "createdBy"   TEXT,
  "updatedBy"   TEXT,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_hr_asset_member"
  ON "HumanResourcesAsset" ("memberId", "deleted");
CREATE INDEX IF NOT EXISTS "idx_hr_asset_type_status"
  ON "HumanResourcesAsset" ("assetTypeId", "status");

CREATE TABLE IF NOT EXISTS "HumanResourcesPositionAsset" (
  "id"            TEXT PRIMARY KEY,
  "orgPositionId" TEXT NOT NULL REFERENCES "OrgChartPosition"("id") ON DELETE CASCADE,
  "assetTypeId"   TEXT NOT NULL REFERENCES "HumanResourcesAssetType"("id") ON DELETE RESTRICT,
  "quantity"      INTEGER NOT NULL DEFAULT 1,
  "specNote"      TEXT,
  "required"      INTEGER NOT NULL DEFAULT 1,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("orgPositionId", "assetTypeId")
);
CREATE INDEX IF NOT EXISTS "idx_hr_position_asset_type"
  ON "HumanResourcesPositionAsset" ("assetTypeId");

INSERT OR IGNORE INTO "HumanResourcesAssetType"
  ("id", "name", "nameKey", "defaultSpecs", "order", "active")
VALUES
  ('hrasset-laptop', 'Laptop',       'laptop',       'RAM, storage and model configuration', 0, 1),
  ('hrasset-mobile', 'Mobile Phone', 'mobile phone', 'Model and storage', 1, 1),
  ('hrasset-sim',    'SIM Card',     'sim card',     'Carrier and number', 2, 1),
  ('hrasset-headset','Headset',      'headset',      'Model / connectivity', 3, 1),
  ('hrasset-id',     'ID Card',      'id card',      'Employee ID card', 4, 1),
  ('hrasset-other',  'Other',        'other',        'Describe the asset in specs', 5, 1);
