-- 0122_field_staff_global.sql — global day-based expenses/follow-ups + retired GPS.
--
-- Expenses/follow-ups stop being confined to one location visit:
-- each row now carries its own day (YYYY-MM-DD IST) + staffId so the
-- calendar + global follow-up queue work without a checked-in visit.
-- visitId='' means a day-level row (no parent visit). Existing rows are
-- backfilled from their parent FieldVisit. GPS columns stay (old rows keep
-- values) but new writes store NULL/'' — automated tracking is discontinued.

ALTER TABLE FieldExpense ADD COLUMN day TEXT NOT NULL DEFAULT '';
ALTER TABLE FieldExpense ADD COLUMN staffId TEXT NOT NULL DEFAULT '';

ALTER TABLE FieldFollowup ADD COLUMN day TEXT NOT NULL DEFAULT '';
ALTER TABLE FieldFollowup ADD COLUMN staffId TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_field_expense_day ON FieldExpense(day, staffId);
CREATE INDEX IF NOT EXISTS idx_field_followup_day ON FieldFollowup(status, day);

-- Backfill from parent visits (visitId='' rows keep '' and are day-patched on write).
UPDATE FieldExpense SET
  day = COALESCE((SELECT day FROM FieldVisit WHERE FieldVisit.id = FieldExpense.visitId), day),
  staffId = COALESCE((SELECT telecallerId FROM FieldVisit WHERE FieldVisit.id = FieldExpense.visitId), staffId)
WHERE (day = '' OR staffId = '') AND visitId <> '';

UPDATE FieldFollowup SET
  day = COALESCE((SELECT day FROM FieldVisit WHERE FieldVisit.id = FieldFollowup.visitId), day),
  staffId = COALESCE((SELECT telecallerId FROM FieldVisit WHERE FieldVisit.id = FieldFollowup.visitId), staffId)
WHERE (day = '' OR staffId = '') AND visitId <> '';
