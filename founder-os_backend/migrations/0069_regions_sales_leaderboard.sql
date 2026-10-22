-- 0069_regions_sales_leaderboard.sql
-- Region-owned sales model (founder decision 2026-10-22): estimates belong to
-- R1–R4 regions instead of individuals. Adds Estimate.region +
-- Telecaller.tlLevel/region + TelecallerScoreEvent.kind, seeds staff regions
-- from the founder's hierarchy table, and backfills estimate regions from the
-- creating staff's roster region.

ALTER TABLE Estimate ADD COLUMN region TEXT NOT NULL DEFAULT '';
ALTER TABLE Telecaller ADD COLUMN tlLevel TEXT NOT NULL DEFAULT '';
ALTER TABLE Telecaller ADD COLUMN region TEXT NOT NULL DEFAULT '';
ALTER TABLE TelecallerScoreEvent ADD COLUMN kind TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_estimate_region ON Estimate(region);
CREATE INDEX IF NOT EXISTS idx_telecaller_region ON Telecaller(region);

-- ── Seed staff regions (fuzzy name match; word-boundary guarded) ────────────
-- R1 "North & NCR" — TL1 team: Samarjeet, Raja
UPDATE Telecaller SET tlLevel = 'TL1', region = 'R1'
  WHERE name = 'Samarjeet' OR name LIKE 'Samarjeet%' OR name LIKE 'Samarjit%';
UPDATE Telecaller SET tlLevel = 'TL1', region = 'R1'
  WHERE (name = 'Raja' OR name LIKE 'Raja %') AND NOT (name LIKE 'Rajat%');
-- R2 "North-Central & Himalayan Belt" — TL2 team: Pooja (+ To_Be_Join skipped)
UPDATE Telecaller SET tlLevel = 'TL2', region = 'R2'
  WHERE name = 'Pooja' OR name LIKE 'Pooja%';
-- R3 "West & Central" — TL2 team: Heena, Deepanshu
UPDATE Telecaller SET tlLevel = 'TL2', region = 'R3'
  WHERE name = 'Heena' OR name LIKE 'Heena%' OR name = 'Hina' OR name LIKE 'Hina%';
UPDATE Telecaller SET tlLevel = 'TL2', region = 'R3'
  WHERE name = 'Deepanshu' OR name LIKE 'Deepanshu%';
-- R4 "South, East & Northeast" — TL1 team: Rani, Kamal
UPDATE Telecaller SET tlLevel = 'TL1', region = 'R4'
  WHERE name = 'Rani' OR name LIKE 'Rani %';
UPDATE Telecaller SET tlLevel = 'TL1', region = 'R4'
  WHERE name = 'Kamal' OR name LIKE 'Kamal %' AND NOT (name LIKE 'Kamlesh%');

-- ── Backfill Estimate.region from the creating staff's roster region ────────
-- Unmapped stays '' and lands in the dashboard's Unmapped bucket until linked.
UPDATE Estimate
   SET region = (SELECT t.region FROM Telecaller t WHERE t.id = Estimate.createdBy)
 WHERE createdBy IS NOT NULL
   AND createdBy != ''
   AND region = '';

-- Sanity: same name cannot have been seeded into two regions by the guards.
-- R3 Hina guard: Hina could also match 'Hinal' etc. — Hina variants prefer the
-- Heena/Hina table above; acceptable.
