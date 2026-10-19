-- 0063: single "Bearing (Numbered)" product under Power Transmission Elements.
-- Numbered enquiry lines ("Bearing 6215K", "Maize Conveyor Bearing P209",
-- "Roll Body Bearing 22216") match NO existing product deterministically —
-- the catalogue only holds bearing TYPES (Deep Groove, Spherical, Bearing
-- Block...). This gives the intake grade-rule + system-prompt bearing block
-- an exact-name target. Additive only: no existing row touched, no aliases
-- (nothing else may resolve here by accident), no rates.
-- Housed P/F units that ARE known stay routed by prompt to Bearing Block;
-- H-sleeves to Bearing Sleeve — this product is for loose/unknown codes.

INSERT INTO ProductItem (id, category, name, aliases, active, createdAt, updatedAt) VALUES
('718efcd9-e301-494e-8800-3c7dfb359f6c', 'Power Transmission Elements', 'Bearing (Numbered)', '[]', 1, '2026-10-12T08:00:00.000Z', '2026-10-12T08:00:00.000Z');

INSERT INTO KypGuide (id, productId, attrKey, question, guideNote, sortOrder, isRequired, condition, active, createdAt, updatedAt) VALUES
('4ad2bd8d-82ab-4351-a13e-b551f5429e2f', '718efcd9-e301-494e-8800-3c7dfb359f6c', 'ask_bearing_code', 'Ask the full bearing code exactly as written (e.g. 6215K, P209, F211)', NULL, 0, 1, NULL, 1, '2026-10-12T08:00:00.000Z', '2026-10-12T08:00:00.000Z'),
('65e83678-1bac-43d5-a4d6-e4ddd6e21c5e', '718efcd9-e301-494e-8800-3c7dfb359f6c', 'ask_bore_size_if_known', 'Ask bore/inner size if known', NULL, 1, 1, NULL, 1, '2026-10-12T08:00:00.000Z', '2026-10-12T08:00:00.000Z'),
('93122795-d9cb-4e4e-b3e2-7e3c2b8d050b', '718efcd9-e301-494e-8800-3c7dfb359f6c', 'ask_quantity', 'Ask quantity', NULL, 2, 1, NULL, 1, '2026-10-12T08:00:00.000Z', '2026-10-12T08:00:00.000Z');
