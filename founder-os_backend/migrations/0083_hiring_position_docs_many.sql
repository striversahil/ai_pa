-- 0083: allow multiple JD and SOP documents per hiring position.
-- 0082 created a UNIQUE index on (positionId, kind); drop it and replace it
-- with a plain lookup index so a role can keep several SOPs (and JDs).
DROP INDEX IF EXISTS "HumanResourcesPositionDoc_positionId_kind_idx";
CREATE INDEX IF NOT EXISTS "HumanResourcesPositionDoc_positionId_kind_lookup_idx"
  ON "HumanResourcesPositionDoc" ("positionId", "kind");
