-- 0179 — retire the position-wise region allotment.
--
-- Founder decision 2026-11-28: since 0177 a person's regions are picked on
-- their own employee row from the Sales team chart, so a chart seat no longer
-- whitelists regions. The table had no writer and no reader left and was empty
-- (0 rows) — it only ever held UI config, no history id points at it.
DROP TABLE IF EXISTS "HumanResourcesPositionRegion";
