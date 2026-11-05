-- 0109_team_lead_type.sql
-- Team Lead is a first-class roster role (founder decision 2026-11-05): it is
-- NOT a telecaller with a flag — `Telecaller.type = 'team_lead'` (tlLevel stays
-- 'TL1', region + region2 pair unchanged). Backfills the two seeded TL1s; the
-- roster APIs accept 'team_lead' from this point on.
--
-- No schema change needed (type is free TEXT); this is a data backfill so a
-- fresh DB and the live D1 converge.

UPDATE Telecaller SET type = 'team_lead'
  WHERE tlLevel = 'TL1' AND (type IS NULL OR type = '' OR type = 'telecaller');
