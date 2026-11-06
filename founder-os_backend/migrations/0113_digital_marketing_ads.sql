-- Digital Marketing ADS registry: manually tracked ad runs (migration 0113).
-- Registry-only (replaces the derived dmm-06/08/09 rows in the ADS tab).
CREATE TABLE IF NOT EXISTS "DigitalMarketingAd" (
  "id" TEXT PRIMARY KEY,
  "type" TEXT NOT NULL DEFAULT 'meta',
  "title" TEXT NOT NULL DEFAULT '',
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "amountSpent" REAL NOT NULL DEFAULT 0,
  "leads" INTEGER NOT NULL DEFAULT 0,
  "enquiries" INTEGER NOT NULL DEFAULT 0,
  "dataDescription" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'planned',
  "createdBy" TEXT,
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "DigitalMarketingAd_startDate_idx" ON "DigitalMarketingAd" ("startDate");
CREATE INDEX IF NOT EXISTS "DigitalMarketingAd_status_idx" ON "DigitalMarketingAd" ("status");

CREATE TABLE IF NOT EXISTS "DigitalMarketingAdAttachment" (
  "id" TEXT PRIMARY KEY,
  "adId" TEXT NOT NULL REFERENCES "DigitalMarketingAd"("id") ON DELETE CASCADE,
  "fileName" TEXT NOT NULL,
  "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
  "size" INTEGER NOT NULL DEFAULT 0,
  "kvKey" TEXT NOT NULL UNIQUE,
  "uploadedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS "DigitalMarketingAdAttachment_adId_idx" ON "DigitalMarketingAdAttachment" ("adId");
