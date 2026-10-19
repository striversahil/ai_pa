-- 0059: catalogue gap-fill for unclassified enquiry lines (Enquiry No 1 - 07 OCT TL).
-- 6 new products (elevator-leg + scourer spares the catalogue didn't sell) with
-- required KYP checklists, plus "scourer jali/jaali" aliases on the 3 existing
-- Wire Mesh scourer products (bare "jali" deliberately NOT added — "M/S Jali"
-- must keep resolving to Perforated Sheet / Round Hole).
-- Live source is D1 (intake lookup + sales chat read ProductItem/KypGuide);
-- the data/*.json seed feeds only the retired legacy runner (left untouched).

-- ── New products ──────────────────────────────────────────────────────────
INSERT INTO ProductItem (id, category, name, aliases, active, createdAt, updatedAt) VALUES
('8aef873d-5636-4655-8faf-dcbd8846d3b0', 'Conveying Accessories', 'Airlock', '["air lock", "rotary airlock", "airlock valve", "airlock feeder"]', 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('612f647a-133f-403d-93a6-f113cbaf8f0f', 'Conveying Accessories', 'Airlock Glass', '["air lock glass", "airlock sight glass", "airlock viewing glass"]', 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('3bbca128-941d-4eef-8caa-54171dc035d7', 'Conveying Accessories', 'Airlock Glass Rubber', '["air lock glass rubber", "airlock glass gasket", "airlock rubber gasket"]', 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('b139fd80-44de-4472-9ca3-d1bf5f378954', 'Conveying Accessories', 'Lift Bend', '["elevator bend", "lift elbow", "elevator leg bend"]', 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('123f9c78-4b48-4143-93f5-f12902ba2df1', 'Conveying Accessories', 'Lift Glass', '["elevator glass", "lift sight glass", "elevator viewing glass"]', 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('7f997eb4-df88-4da2-aa85-114873433015', 'Miscellaneous', 'Scourer Blade', '["scourer knife", "scourer scraper blade"]', 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z');

-- ── Checklists (KypGuide, one row per required question) ──────────────────
INSERT INTO KypGuide (id, productId, attrKey, question, guideNote, sortOrder, isRequired, condition, active, createdAt, updatedAt) VALUES
-- Airlock
('a11c0001-0000-4000-8000-000000000001', '8aef873d-5636-4655-8faf-dcbd8846d3b0', 'ask_size_diameter', 'Ask size/diameter (e.g. 6 inch)', NULL, 0, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0001-0000-4000-8000-000000000002', '8aef873d-5636-4655-8faf-dcbd8846d3b0', 'ask_complete_unit_or_spares', 'Ask complete unit or spares', NULL, 1, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0001-0000-4000-8000-000000000003', '8aef873d-5636-4655-8faf-dcbd8846d3b0', 'ask_quantity', 'Ask quantity', NULL, 2, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
-- Airlock Glass
('a11c0002-0000-4000-8000-000000000001', '612f647a-133f-403d-93a6-f113cbaf8f0f', 'ask_diameter_length_thickness', 'Ask diameter, length, and thickness', NULL, 0, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0002-0000-4000-8000-000000000002', '612f647a-133f-403d-93a6-f113cbaf8f0f', 'ask_frame_gasket_needed', 'Ask whether a frame/gasket is needed with it', NULL, 1, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0002-0000-4000-8000-000000000003', '612f647a-133f-403d-93a6-f113cbaf8f0f', 'ask_quantity', 'Ask quantity', NULL, 2, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
-- Airlock Glass Rubber
('a11c0003-0000-4000-8000-000000000001', '3bbca128-941d-4eef-8caa-54171dc035d7', 'ask_size_to_suit', 'Ask size (glass diameter it suits)', NULL, 0, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0003-0000-4000-8000-000000000002', '3bbca128-941d-4eef-8caa-54171dc035d7', 'ask_thickness', 'Ask thickness', NULL, 1, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0003-0000-4000-8000-000000000003', '3bbca128-941d-4eef-8caa-54171dc035d7', 'ask_quantity', 'Ask quantity', NULL, 2, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
-- Lift Bend
('a11c0004-0000-4000-8000-000000000001', 'b139fd80-44de-4472-9ca3-d1bf5f378954', 'ask_diameter', 'Ask diameter (e.g. 118 mm)', NULL, 0, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0004-0000-4000-8000-000000000002', 'b139fd80-44de-4472-9ca3-d1bf5f378954', 'ask_thickness', 'Ask thickness (e.g. 5 mm)', NULL, 1, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0004-0000-4000-8000-000000000003', 'b139fd80-44de-4472-9ca3-d1bf5f378954', 'ask_angle', 'Ask bend angle (e.g. 90 degree)', NULL, 2, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0004-0000-4000-8000-000000000004', 'b139fd80-44de-4472-9ca3-d1bf5f378954', 'ask_quantity', 'Ask quantity', NULL, 3, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
-- Lift Glass
('a11c0005-0000-4000-8000-000000000001', '123f9c78-4b48-4143-93f5-f12902ba2df1', 'ask_size', 'Ask size (e.g. 130 x 300 mm)', NULL, 0, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0005-0000-4000-8000-000000000002', '123f9c78-4b48-4143-93f5-f12902ba2df1', 'ask_thickness', 'Ask thickness', NULL, 1, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0005-0000-4000-8000-000000000003', '123f9c78-4b48-4143-93f5-f12902ba2df1', 'ask_quantity', 'Ask quantity', NULL, 2, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
-- Scourer Blade
('a11c0006-0000-4000-8000-000000000001', '7f997eb4-df88-4da2-aa85-114873433015', 'ask_dimensions', 'Ask dimensions (length x width)', NULL, 0, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0006-0000-4000-8000-000000000002', '7f997eb4-df88-4da2-aa85-114873433015', 'ask_thickness', 'Ask thickness', NULL, 1, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0006-0000-4000-8000-000000000003', '7f997eb4-df88-4da2-aa85-114873433015', 'ask_scourer_make_model', 'Ask the scourer make/model', NULL, 2, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z'),
('a11c0006-0000-4000-8000-000000000004', '7f997eb4-df88-4da2-aa85-114873433015', 'ask_quantity', 'Ask quantity', NULL, 3, 1, NULL, 1, '2026-10-10T09:00:00.000Z', '2026-10-10T09:00:00.000Z');

-- ── Scourer-mesh alias top-up ("Scourer Jali" lines) ───────────────────────
-- Appends (never rewrites) so existing aliases survive; json_each guard keeps
-- re-runs idempotent.
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'scourer jali' UNION SELECT 'scourer jaali'
  )
), updatedAt = '2026-10-10T09:00:00.000Z'
WHERE name = 'Flat & Round Wire Scourer Mesh'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'scourer jali');

UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'scourer jali' UNION SELECT 'scourer jaali'
  )
), updatedAt = '2026-10-10T09:00:00.000Z'
WHERE name = 'Mat Type Scourer Mesh'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'scourer jali');

UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'scourer jali' UNION SELECT 'scourer jaali'
  )
), updatedAt = '2026-10-10T09:00:00.000Z'
WHERE name = 'Pointed and Round Wire Scourer Mesh'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'scourer jali');
