-- 0060: catalogue gap-fill round 2 (founder-approved 2026-10-10).
-- Source: unclassified-items.txt (397 unclassified rows / 292 enquiries).
-- 10 new products + 5 alias top-ups on existing products.
-- Bare generic words ("jali", "bag", "belt") deliberately NOT added as keys.

-- ── New products ──────────────────────────────────────────────────────────
INSERT INTO ProductItem (id, category, name, aliases, active, createdAt, updatedAt) VALUES
('a059a6fb-bbbe-47e7-b037-434ee4af3a79', 'Conveying Accessories', 'Lift Rubber', '["air lock lift rubber", "elevator rubber", "pneumatic lift rubber"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('1dcf5e3a-5f92-47e6-a870-189b13ef3498', 'Plansifter Accessories', 'Triangle Brush Cleaner', '["triangle brush", "triangular brush", "rhombus cleaner", "triangle brush sieve cleaner"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('a56be36c-3d02-4b10-a5e1-075ab1452605', 'Plansifter Accessories', 'Rhombus Cleaner', '["rhombus sieve cleaner", "diamond cleaner"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('83d57e2f-b6d3-424d-9712-295d8e0b85f0', 'Miscellaneous', 'Purifier Brush', '["purifier cleaning brush"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('2348f7eb-1a30-48f7-a6b5-7c6c949b49c3', 'Wire Mesh', 'Welded Wire Mesh', '["welded mesh"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('6cb15ec7-1c76-449a-a34c-e5d5f352fceb', 'Pipe & Pipe Accessories', 'Jubilee Clip', '["jubilee clamp", "jubli clamp", "hose clamp"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('60841812-4f36-41ee-990b-ae50b6caa5c1', 'Perforated Sheet', 'MTRA Sieve', '["mtra sieve"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('70ff1c75-d249-472b-b6c8-2129d19cac5b', 'Perforated Sheet', 'MTRB Sieve', '["mtrb sieve"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('1fa0fa78-4c70-4c30-aba7-4e3b6d51a5a1', 'Perforated Sheet', 'MTR Sieve', '["mtr sieve"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('39e83dd3-9634-42a7-a433-a60fab6a182b', 'Miscellaneous', 'Screw Conveyor Blade', '["screw blade", "worm blade", "screw flight"]', 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z');

-- ── Checklists ────────────────────────────────────────────────────────────
INSERT INTO KypGuide (id, productId, attrKey, question, guideNote, sortOrder, isRequired, condition, active, createdAt, updatedAt) VALUES
-- Lift Rubber
('b0600001-0000-4000-8000-000000000001', 'a059a6fb-bbbe-47e7-b037-434ee4af3a79', 'ask_size_diameter', 'Ask size/diameter (e.g. 88, 100, 113 mm)', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
-- Triangle Brush Cleaner
('b0600002-0000-4000-8000-000000000001', '1dcf5e3a-5f92-47e6-a870-189b13ef3498', 'ask_size', 'Ask size', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('b0600002-0000-4000-8000-000000000002', '1dcf5e3a-5f92-47e6-a870-189b13ef3498', 'ask_bristle_pad', 'Ask bristle or pad type', NULL, 1, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
-- Rhombus Cleaner
('b0600003-0000-4000-8000-000000000001', 'a56be36c-3d02-4b10-a5e1-075ab1452605', 'ask_size', 'Ask size', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('b0600003-0000-4000-8000-000000000002', 'a56be36c-3d02-4b10-a5e1-075ab1452605', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
-- Purifier Brush
('b0600004-0000-4000-8000-000000000001', '83d57e2f-b6d3-424d-9712-295d8e0b85f0', 'ask_length', 'Ask length (e.g. 15 inches)', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('b0600004-0000-4000-8000-000000000002', '83d57e2f-b6d3-424d-9712-295d8e0b85f0', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
-- Welded Wire Mesh
('b0600005-0000-4000-8000-000000000001', '2348f7eb-1a30-48f7-a6b5-7c6c949b49c3', 'ask_mesh_opening', 'Ask mesh opening (e.g. 15 x 15 mm)', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('b0600005-0000-4000-8000-000000000002', '2348f7eb-1a30-48f7-a6b5-7c6c949b49c3', 'ask_size', 'Ask sheet size', NULL, 1, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
-- Jubilee Clip
('b0600006-0000-4000-8000-000000000001', '6cb15ec7-1c76-449a-a34c-e5d5f352fceb', 'ask_size', 'Ask size/diameter (e.g. 18 inch)', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
-- MTRA Sieve
('b0600007-0000-4000-8000-000000000001', '60841812-4f36-41ee-990b-ae50b6caa5c1', 'ask_dimension', 'Ask dimension', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('b0600007-0000-4000-8000-000000000002', '60841812-4f36-41ee-990b-ae50b6caa5c1', 'ask_hole_size', 'Ask hole size (e.g. RH 6.00 mm)', NULL, 1, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
-- MTRB Sieve
('b0600008-0000-4000-8000-000000000001', '70ff1c75-d249-472b-b6c8-2129d19cac5b', 'ask_dimension', 'Ask dimension', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('b0600008-0000-4000-8000-000000000002', '70ff1c75-d249-472b-b6c8-2129d19cac5b', 'ask_hole_size', 'Ask hole size (e.g. RH 7.00 mm)', NULL, 1, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
-- MTR Sieve
('b0600009-0000-4000-8000-000000000001', '1fa0fa78-4c70-4c30-aba7-4e3b6d51a5a1', 'ask_dimension', 'Ask dimension', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('b0600009-0000-4000-8000-000000000002', '1fa0fa78-4c70-4c30-aba7-4e3b6d51a5a1', 'ask_hole_size', 'Ask hole size', NULL, 1, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
-- Screw Conveyor Blade
('b0600010-0000-4000-8000-000000000001', '39e83dd3-9634-42a7-a433-a60fab6a182b', 'ask_diameter', 'Ask diameter (e.g. 8 inches)', NULL, 0, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z'),
('b0600010-0000-4000-8000-000000000002', '39e83dd3-9634-42a7-a433-a60fab6a182b', 'ask_thickness', 'Ask thickness', NULL, 1, 1, NULL, 1, '2026-10-10T10:30:00.000Z', '2026-10-10T10:30:00.000Z');

-- ── Alias top-ups (append-only, idempotent; one alias per statement — D1
-- rejects long UNION chains with "too many terms in compound SELECT") ──────
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'hammer blade')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Hammer Mill Beaters' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'hammer blade');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'hammer mill blade')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Hammer Mill Beaters' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'hammer mill blade');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'capsule hole')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Oblong Slot Hole' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'capsule hole');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'capsule jaali')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Oblong Slot Hole' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'capsule jaali');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'capsule design jaali')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Oblong Slot Hole' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'capsule design jaali');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'plansifter bag')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Plansifter Sleeves' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'plansifter bag');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'sifter bag')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Plansifter Sleeves' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'sifter bag');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'rexin bag')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Plansifter Sleeves' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'rexin bag');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'cotton sleeve')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Plansifter Sleeves' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'cotton sleeve');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'aspiration sleeve')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Plansifter Sleeves' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'aspiration sleeve');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'fanner belt')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'V Belt' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'fanner belt');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'fenner belt')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'V Belt' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'fenner belt');
UPDATE ProductItem SET aliases = (SELECT json_group_array(value) FROM (SELECT value FROM json_each(ProductItem.aliases) UNION SELECT 'boulting cloth')), updatedAt = '2026-10-10T10:30:00.000Z' WHERE name = 'Milling Fabric' AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value = 'boulting cloth');
