-- 0169_hr_character_name.sql — optional character/working name for HR members.
--
-- Two columns, both additive:
--   characterName     the alternate name shown in the dashboard
--   useCharacterName  when 1, every display surface shows
--                     "Character Name (Legal Name)"; the legal `name` column
--                     is never overwritten.
--
-- Existing rows default to off/null, so nothing changes until HR enables it.
ALTER TABLE "HumanResourcesMember" ADD COLUMN "characterName" TEXT;
ALTER TABLE "HumanResourcesMember" ADD COLUMN "useCharacterName" INTEGER NOT NULL DEFAULT 0;
