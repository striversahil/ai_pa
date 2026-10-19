-- 0061: drop "quantity" and "reference picture/photo" asks from the required
-- spec checklists (founder order 2026-10-10).
-- Two shapes, attrKey NEVER touched (stored VendorRate specs key off it):
--  a) pure quantity/picture questions (incl. MOQ/pack notes) -> DELETE row;
--  b) combined questions (real spec ask + quantity/picture clause) -> UPDATE
--     question text keeps the real ask, drops the qty/picture clause.

-- ── (a) pure quantity ─────────────────────────────────────────────────────
DELETE FROM KypGuide WHERE question IN (
'Ask quantity',
'Ask quantity required',
'Ask quantity (in meters)',
'Ask quantity in pieces -- one size only, no size question needed',
'Ask quantity -- MOQ is 100 pieces per pack for 6 mm and 8 mm, 50 pieces per pack for 10 mm',
'Ask quantity -- sold per piece, any quantity accepted',
'Ask quantity of bags/pieces required',
'Ask quantity in pieces',
'Ask quantity, priced per piece',
'Ask quantity of boxes',
'Ask quantity -- MOQ differs by material: rubber 500 pcs, nylon 200 pcs, PVC 200 pcs; order strictly in multiples of the MOQ',
'Ask quantity -- MOQ 500 pcs, order in multiples of 500',
'Ask quantity -- usually sold per set/box covering one joint width',
'Always confirm quantity in meters'
);

-- ── (a) pure picture/photo ────────────────────────────────────────────────
DELETE FROM KypGuide WHERE question IN (
'Offer a reference picture if unsure',
'Offer a reference picture if unsure -- a common market size is roughly 75x58x8 mm sold about 500 pieces to a carton, but confirm the exact size and pack count before quoting',
'Offer a reference picture -- the three types look alike at a glance',
'Offer a reference picture if unsure which type',
'If unsure, offer a reference picture',
'If unsure which type is needed, offer a reference picture',
'If unsure of size, offer a reference picture',
'If unsure of the exact rope needed, offer a reference picture',
'If unsure, offer/request a picture',
'Prefer that the client provide a reference picture',
'Request a picture to confirm',
'Request pictures to confirm the exact part -- this is a large, made-to-order part, not stocked',
'Request a picture to confirm the material -- fiber and nylon look near-identical and clients are often unsure which they actually have',
'Request a picture or the old gear''s marking if unsure',
'Request a picture or the belt sample if unsure of the tooth profile -- profiles look similar but are not interchangeable',
'Request a picture or the old part -- this design has the most variants in the range',
'If the client is unsure of the grade, request a picture or a physical swatch of the old cloth',
'If the client has a specific fabric or the exact old sleeve, request a picture or a sample -- easy to send the wrong size without one'
);

-- ── (b) combined: keep the real ask ───────────────────────────────────────
UPDATE KypGuide SET question = 'Ask brand preference', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask brand preference and quantity';
UPDATE KypGuide SET question = 'Ask hole size, sheet gauge, sheet size, material', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask hole size, sheet gauge, sheet size, material, quantity';
UPDATE KypGuide SET question = 'Ask material', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask material and quantity';
UPDATE KypGuide SET question = 'Ask chain pitch/number and length required', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask chain pitch/number, length required, and quantity';
UPDATE KypGuide SET question = 'Ask housing type/series if known (e.g. P or F series)', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask housing type/series if known (e.g. P or F series), or ask for a picture of the housing';
UPDATE KypGuide SET question = 'Send the old coupling''s size marking', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Send the old coupling''s size marking or a picture if unsure';
UPDATE KypGuide SET question = 'Ask dimple/hole size, sheet gauge, sheet size, material', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask dimple/hole size, sheet gauge, sheet size, material, quantity';
UPDATE KypGuide SET question = 'Glue-type tape: only available in 3 mm thickness; ask width', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Glue-type tape: only available in 3 mm thickness; ask width and quantity; MOQ 100 m per roll';
UPDATE KypGuide SET question = 'Ask diameter/thickness and length', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask diameter/thickness, length, and quantity';
UPDATE KypGuide SET question = 'Ask length required', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question IN ('Ask length required and quantity', 'Ask length/quantity required');
UPDATE KypGuide SET question = 'Ask the scourer make/model', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask the scourer make/model and quantity';
UPDATE KypGuide SET question = 'Ask length required (ordered by the meter)', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask length required (ordered by the meter) and quantity';
UPDATE KypGuide SET question = 'Ask gauss rating', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask gauss rating and quantity';
UPDATE KypGuide SET question = 'Ask the hammer mill make/model', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask the hammer mill make/model and quantity';
UPDATE KypGuide SET question = 'Ask any brand preference -- Kangaroo and Max are the common manual brands stocked', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask quantity and any brand preference -- Kangaroo and Max are the common manual brands stocked';
UPDATE KypGuide SET question = 'Ask slot size (length x width), sheet gauge, sheet size, material', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask slot size (length x width), sheet gauge, sheet size, material, quantity';
UPDATE KypGuide SET question = 'Ask mesh count and sheet size', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask mesh count, sheet size, and quantity';
UPDATE KypGuide SET question = 'Ask the roller mill make', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask the roller mill make and quantity';
UPDATE KypGuide SET question = 'If the client is specifying a single gear: ask number of teeth and bore size (hole in center -- generally 60 mm, or custom e.g. 70 mm)', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'If the client is specifying a single gear: ask number of teeth, bore size (hole in center -- generally 60 mm, or custom e.g. 70 mm), and quantity required';
UPDATE KypGuide SET question = 'Ask pipe/line size', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask pipe/line size and quantity';
UPDATE KypGuide SET question = 'Ask sheet size, material', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask sheet size, material, quantity';
UPDATE KypGuide SET question = 'Ask length required (priced per meter)', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask length required; quantity is priced per meter';
UPDATE KypGuide SET question = 'Ask size', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask size and quantity';
UPDATE KypGuide SET question = 'Ask whether a lid/pan/shaker is needed too', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask how many sieves, and whether a lid/pan/shaker is needed too';
UPDATE KypGuide SET question = 'Ask size (length x width, mm) -- ordered in multiples of 100', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask size (length x width, mm) and quantity -- ordered in multiples of 100';
UPDATE KypGuide SET question = 'Ask cylinder/screen size and hole spec, material', updatedAt = '2026-10-10T11:30:00.000Z' WHERE question = 'Ask cylinder/screen size and hole spec, material, quantity';
