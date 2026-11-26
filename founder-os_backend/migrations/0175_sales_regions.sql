-- 0175_sales_regions.sql — regions + position-wise allotment become HR data.
--
-- Region CODES stay R1–R4 (Estimate.region / ClientClass.masterRegion / holidays
-- store them); HR owns the label, the team-lead tier and the states list from
-- now on. Position allotment says which regions a chart seat may hold — no
-- rows for a position means "every active region", so existing chart positions
-- keep working untouched.

CREATE TABLE IF NOT EXISTS "HumanResourcesRegion" (
  "id"        TEXT PRIMARY KEY,
  "code"      TEXT NOT NULL UNIQUE,
  "name"      TEXT NOT NULL,
  "tlLevel"   TEXT NOT NULL DEFAULT 'TL1',
  "states"    TEXT NOT NULL DEFAULT '[]',
  "order"     INTEGER NOT NULL DEFAULT 0,
  "active"    INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO "HumanResourcesRegion" ("id","code","name","tlLevel","states","order") VALUES
  ('hrreg_r1','R1','North & NCR Region','TL1','["Delhi","Haryana","Punjab","Chandigarh","Uttarakhand"]',1),
  ('hrreg_r2','R2','North-Central & Himalayan Belt Region','TL2','["Uttar Pradesh","Himachal Pradesh","Jammu & Kashmir","Ladakh"]',2),
  ('hrreg_r3','R3','West & Central Region','TL2','["Rajasthan","Gujarat","Madhya Pradesh","Maharashtra","Goa"]',3),
  ('hrreg_r4','R4','South, East & Northeast Region','TL1','["Tamil Nadu","Karnataka","Telangana","Andhra Pradesh","Kerala","Puducherry","West Bengal","Assam","Bihar","Odisha","Jharkhand","Chhattisgarh","Nepal","Northeast States"]',4);

CREATE TABLE IF NOT EXISTS "HumanResourcesPositionRegion" (
  "id"            TEXT PRIMARY KEY,
  "orgPositionId" TEXT NOT NULL REFERENCES "OrgChartPosition"("id") ON DELETE CASCADE,
  "regionCode"    TEXT NOT NULL,
  "seatCap"       INTEGER,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("orgPositionId", "regionCode")
);
CREATE INDEX IF NOT EXISTS "idx_hr_position_region_position"
  ON "HumanResourcesPositionRegion" ("orgPositionId");