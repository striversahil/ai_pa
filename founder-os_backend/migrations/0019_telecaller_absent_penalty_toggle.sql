-- Absentee cover system + runtime penalty toggle:
--   Telecaller.absentSince       — set when MIS marks an agent absent. Her open
--     `sent` estimates are dealt equally to the active conversion specialists as
--     TEMP covers; marking her present hands them back.
--   EstimateAssignment.tempForTelecallerId — provenance of an absent-cover row:
--     the id of the ABSENT agent the estimate ultimately returns to. Carried
--     through EOD re-poaches so the chain back to the original holder survives.
ALTER TABLE Telecaller ADD COLUMN absentSince TEXT;
ALTER TABLE EstimateAssignment ADD COLUMN tempForTelecallerId TEXT;
CREATE INDEX IF NOT EXISTS idx_ea_temp_for ON EstimateAssignment(tempForTelecallerId);
