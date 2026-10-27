-- 0082: HR hiring kit — one position with at most one JD and one SOP PDF.
-- Row per document holds metadata only; PDF bytes live in CHAT_FILES KV under
-- hrdocs/<uuid>.pdf (same pattern as SoAttachment invoice/LR/POD PDFs).
CREATE TABLE IF NOT EXISTS "HumanResourcesHiringPosition" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL UNIQUE,
  "createdBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "HumanResourcesHiringPosition_nameKey_idx" ON "HumanResourcesHiringPosition" ("nameKey");

CREATE TABLE IF NOT EXISTS "HumanResourcesPositionDoc" (
  "id" TEXT PRIMARY KEY,
  "positionId" TEXT NOT NULL REFERENCES "HumanResourcesHiringPosition"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL DEFAULT 'jd',
  "title" TEXT NOT NULL DEFAULT '',
  "fileName" TEXT NOT NULL,
  "mime" TEXT NOT NULL DEFAULT 'application/pdf',
  "size" INTEGER NOT NULL DEFAULT 0,
  "kvKey" TEXT NOT NULL UNIQUE,
  "uploadedBy" TEXT NOT NULL DEFAULT '',
  "createdAt" TEXT NOT NULL DEFAULT (datetime('now')),
  "updatedAt" TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "HumanResourcesPositionDoc_positionId_kind_idx" ON "HumanResourcesPositionDoc" ("positionId", "kind");
CREATE INDEX IF NOT EXISTS "HumanResourcesPositionDoc_positionId_idx" ON "HumanResourcesPositionDoc" ("positionId");
