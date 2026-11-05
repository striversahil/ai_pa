-- 0108_tl_second_region.sql
-- TL1 two-region model (founder decision 2026-11-05): one TL1 handles TWO
-- regions at once, the pair decided by the sales-head. Adds Telecaller.region2
-- (TL2s keep it '') and seeds the R1+R2 Team Leads: Rajiv Kapoor (primary R1,
-- secondary R2) + Sanjay Sharma (primary R2, secondary R1).
--
-- Reseller target (same decision): each TL1 owes ₹1L/working-day of RESELLER
-- accepted value summed across their two regions, with the same weekly
-- carry-forward ledger as the region end-consumer target (targets.ts reuses
-- DAILY_REGION_TARGET = 100_000 for the TL ledger — no new constant needed).

ALTER TABLE Telecaller ADD COLUMN region2 TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_telecaller_region2 ON Telecaller(region2);

-- Adopt pre-existing rows (MIS may have created them before this migration).
UPDATE Telecaller SET tlLevel = 'TL1', region = 'R1', region2 = 'R2'
  WHERE name LIKE 'Rajiv%Kapoor%';

UPDATE Telecaller SET tlLevel = 'TL1', region = 'R2', region2 = 'R1'
  WHERE name LIKE 'Sanjay%Sharma%';

-- Seed the missing ones (idempotent: only when no such name exists yet).
INSERT INTO Telecaller (id, name, tlLevel, region, region2, type, assignEstimateFollowUps, "order", deleted, createdAt)
SELECT 'tl-rajiv-kapoor', 'Rajiv Kapoor', 'TL1', 'R1', 'R2', 'telecaller', 1, 90, 0, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM Telecaller WHERE name LIKE 'Rajiv%Kapoor%');

INSERT INTO Telecaller (id, name, tlLevel, region, region2, type, assignEstimateFollowUps, "order", deleted, createdAt)
SELECT 'tl-sanjay-sharma', 'Sanjay Sharma', 'TL1', 'R2', 'R1', 'telecaller', 1, 91, 0, datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM Telecaller WHERE name LIKE 'Sanjay%Sharma%');
