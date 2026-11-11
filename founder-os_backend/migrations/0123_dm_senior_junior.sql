-- Digital Marketing Senior/Junior split (2026-11-11): the roster role is now
-- senior|junior (was manager|either). Legacy 'manager' rows/templates read as
-- Senior. Code normalizes defensively too — this backfills existing data.
UPDATE "DigitalMarketingManager" SET role = 'senior' WHERE role = 'manager';
UPDATE "DigitalMarketingTaskTemplate" SET "ownerRole" = 'senior' WHERE "ownerRole" = 'manager';
