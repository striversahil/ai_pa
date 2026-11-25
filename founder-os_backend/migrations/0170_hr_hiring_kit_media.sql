-- 0170_hr_hiring_kit_media.sql — questionnaire PDFs + video walkthrough link.
--
-- Questionnaire documents reuse HumanResourcesPositionDoc with kind =
-- 'questionnaire' (no schema change needed there). A position gets at most one
-- video walkthrough URL, stored on the position row.
ALTER TABLE "HumanResourcesHiringPosition" ADD COLUMN "videoUrl" TEXT;
