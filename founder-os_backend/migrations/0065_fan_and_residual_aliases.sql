-- 0065: Industrial Fan product (9-12 OCT lines) + alias top-ups from residual analysis.
-- Additive only; appends idempotent.

INSERT INTO ProductItem (id, category, name, aliases, active, createdAt, updatedAt) VALUES
('e26a9a19-8699-4557-b49e-fd176a2896e1', 'Machines', 'Industrial Fan (with Motor)', '["fan with motor"]', 1, '2026-10-12T14:30:00.000Z', '2026-10-12T14:30:00.000Z');

INSERT INTO KypGuide (id, productId, attrKey, question, guideNote, sortOrder, isRequired, condition, active, createdAt, updatedAt) VALUES
('1c360570-67aa-4c02-bf4e-69d4fcef3d94', 'e26a9a19-8699-4557-b49e-fd176a2896e1', 'ask_make_hp', 'Ask make and HP - e.g. 100 HP belt type', NULL, 0, 1, NULL, 1, '2026-10-12T14:30:00.000Z', '2026-10-12T14:30:00.000Z'),
('28280573-cb5a-4555-ac35-5cfe9bd4071b', 'e26a9a19-8699-4557-b49e-fd176a2896e1', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T14:30:00.000Z', '2026-10-12T14:30:00.000Z');

UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'air lock'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Airlock'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('air lock'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'planshifter bag' UNION SELECT 'planshifter'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Plansifter Sleeves'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('planshifter bag', 'planshifter'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'planshifter frame'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Plansifter Wooden Frame'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('planshifter frame'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'solent wall' UNION SELECT 'solenoid wall'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Solenoid Valve'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('solent wall', 'solenoid wall'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'cotton pad'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Cotton Cleaner'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('cotton pad'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'paper tape'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Paper Gum Tape'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('paper tape'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'line magnet'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Online Magnet'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('line magnet'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'hopper magnet'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Drawer Magnet'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('hopper magnet'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'magnet separator' UNION SELECT 'magnet seprator'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Magnetic De-Stoner'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('magnet separator', 'magnet seprator'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'feetroll housing' UNION SELECT 'roll body housing'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Roller Mill Housing'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('feetroll housing', 'roll body housing'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'gearset' UNION SELECT 'feetroll gear'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Roller Mill Helical Gear'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('gearset', 'feetroll gear'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'pully' UNION SELECT 'feetroll pully' UNION SELECT 'tapper lock'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Roller Mill Flat & V Belt Pulley'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('pully', 'feetroll pully', 'tapper lock'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'pankh'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Roller Mill Brush'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('pankh'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'vibro motor'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Motor'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('vibro motor'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'sisa' UNION SELECT 'lift sisa'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Lift Glass'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('sisa', 'lift sisa'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'sisa bend'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Lift Bend'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('sisa bend'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'hp fan'
  )
), updatedAt = '2026-10-12T14:30:00.000Z'
WHERE name = 'Industrial Fan (with Motor)'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('hp fan'));
