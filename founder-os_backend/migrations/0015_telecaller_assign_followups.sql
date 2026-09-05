-- Rename Telecaller.active -> assignEstimateFollowUps (lead-conversion specialist flag).
-- Only telecallers with this ON receive estimate follow-up assignments.
ALTER TABLE Telecaller RENAME COLUMN active TO assignEstimateFollowUps;
