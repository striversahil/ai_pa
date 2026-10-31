-- 0090_hr_personal_phone.sql
-- Employee contact details split into office vs personal.
--
-- Why: the employee form previously had a single "Phone"/"Email" pair plus
-- "Emergency contact"/"Emergency phone". HR asked for an explicit office/personal
-- split:
--   phone                 → Office Phone   (existing column, semantics unchanged)
--   email                 → Office Email   (existing column, semantics unchanged)
--   emergencyContactName  → Personal Contact (existing column, semantics unchanged)
--   emergencyContactPhone → Personal Email   (existing column, reused — values are
--                                             left untouched; HR can correct them)
--   personalPhone         → Personal Phone   (THIS migration)
--
-- Columns are NOT renamed: the API field names are the contract with the existing
-- clients and the D1 shim, so only the new personal phone column is added.

ALTER TABLE "HumanResourcesMember" ADD COLUMN "personalPhone" TEXT;
