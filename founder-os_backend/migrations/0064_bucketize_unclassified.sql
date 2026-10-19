-- 0064: bucketize the 155 unclassified lines (founder-approved bifurcation).
-- 2 new categories (Machines x12, Lab Equipment x7), 8 products under existing
-- categories, 2 Miscellaneous catch-alls, alias top-ups for the fits-existing set.
-- Additive only: no existing row modified except idempotent alias APPENDS.

INSERT INTO ProductItem (id, category, name, aliases, active, createdAt, updatedAt) VALUES
('de04ca2e-d712-4d86-9861-c0c72164834d', 'Machines', 'Suji Dryer', '[]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('603fd2d9-ac7d-42ae-900e-6782ceb460c5', 'Machines', 'Vacuum Cleaner', '["vaccum cleaner"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('fc8e8e8d-9cef-4ab0-9740-5d3a5981996e', 'Machines', 'Grinder', '[]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('61facafa-cda3-41cd-bf6c-b8a6fc53b7b6', 'Machines', 'Impact Pulverizer Machine', '["impact pulverizer"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('7bd0aa6f-cd50-4867-96a4-e305a50dc035', 'Machines', 'Air Blower', '[]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('6e68b853-da44-4ebf-8e31-345476784b69', 'Machines', 'Grain Grinding Machine', '[]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('ee2a297e-1e17-49e0-8506-88f66fa1fc9f', 'Machines', 'Vibro Sifter', '["vibratory sifter"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('de054ff3-0615-4f85-b214-3b8db56ee315', 'Machines', 'Pre Cleaner', '["pre-cleaner"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('14cd8d5b-a7e9-4f1e-aff9-6b3f85d92bd9', 'Machines', 'Entoleter', '[]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('0687ca86-f7af-4ceb-8670-9c92bd01037f', 'Machines', 'Destoner Machine', '["d stonner machine", "destoner", "d stoner"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('0898082c-93d2-4d29-bdf3-234af1af46d8', 'Machines', 'Vibratory Separator', '["vibrater separator"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('f18a5016-abfe-474f-a5ff-d41d0499e876', 'Machines', 'Flexi Spout Cleaner', '[]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('f15be384-3a3f-49b8-b520-0e6070a93b38', 'Lab Equipment', 'Hectoliter', '["hectolitre"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('350c2a7e-897b-4109-85f1-141359c975e7', 'Lab Equipment', 'Analytical Balance', '["weighing balance"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('8cdb00d0-1593-470b-b3f4-ab8c98e09bbc', 'Lab Equipment', 'Laboratory Oven', '["lab oven", "oven"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('2bf4bde3-ff89-4173-86f3-97865c69b306', 'Lab Equipment', 'Muffle Furnace', '[]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('78df715c-2543-4482-b404-49b4f6743068', 'Lab Equipment', 'Gluten Washer', '[]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('1084cf0b-4a85-45b6-b7ea-bff4b3db2301', 'Lab Equipment', 'Falling Number Apparatus', '["falling number"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('8ec430e7-b85c-43d1-ade2-9fe690244f7c', 'Lab Equipment', 'Dough Mixer', '["dough mixture"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('6f6a10dc-ad2d-4a23-be9a-b79d8d7624e7', 'Power Transmission Elements', 'Chain Lock', '["chain connecting link", "connecting link"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('13c1d8cc-4c0e-4957-8795-a7b7d4957703', 'Conveying Accessories', 'PVC Bucket', '["pvc bucket"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('73c4c95b-70bf-4d01-8001-f75812eece02', 'Conveying Accessories', 'MS Bucket (Fabricated)', '["ms bucket", "fabricated bucket"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('9f868f8f-3773-4092-95c2-8fa5ff8b803f', 'Conveying Accessories', 'PP Elevator Bucket', '["pp bucket", "plastic elevator bucket"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('60da2824-b838-45c2-aaa8-59b9e38c0872', 'Pipe & Pipe Accessories', 'Round Pipe', '["ms pipe", "gi pipe", "round pipe", "ms round pipe"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('f1ac2bea-0de7-42ae-b33c-2b680fb7be76', 'Magnets', 'Pot Magnet', '["neodymium magnet", "disc magnet", "pot magnet"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('50863a35-d8b3-4838-94bd-b46eb140e67b', 'Conveying Accessories', 'Heat Resistant Belt', '["heat resistant belt"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('80c20177-36bd-4900-99c7-c5fd63462bf6', 'Conveying Accessories', 'Conveyor Roller', '["conveyor roller", "idler roller"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('fe2382aa-36ad-4528-9278-deb13488212e', 'Miscellaneous', 'General Hardware & Fasteners', '["hex bolt", "nut bolt", "threaded rod", "eye bolt", "tie rod"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('b958b7ff-b5b1-4bb9-98ae-488e8e26552c', 'Miscellaneous', 'Machine Frames (Assorted)', '["destoner frame", "mtra frame", "sieve frame set"]', 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z');

INSERT INTO KypGuide (id, productId, attrKey, question, guideNote, sortOrder, isRequired, condition, active, createdAt, updatedAt) VALUES
('33a363c3-57d8-49ce-9687-78b050968529', 'de04ca2e-d712-4d86-9861-c0c72164834d', 'ask_make_capacity', 'Ask make and capacity (e.g. 1 ton per hour)', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('15f86d75-0722-4ac9-821f-00fc0fb44be5', 'de04ca2e-d712-4d86-9861-c0c72164834d', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('76ea4d28-5abd-4c33-8a1f-364dba0a7ea6', '603fd2d9-ac7d-42ae-900e-6782ceb460c5', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('50bfb97f-ad2b-4e91-bce9-4e6ae44ad073', '603fd2d9-ac7d-42ae-900e-6782ceb460c5', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('dc8716c2-d44d-4b47-8f49-198f12b7e463', 'fc8e8e8d-9cef-4ab0-9740-5d3a5981996e', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('a50dbd77-db84-4243-828e-0a6d442f5972', 'fc8e8e8d-9cef-4ab0-9740-5d3a5981996e', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('f91f4c91-34e9-409d-8208-af450ba622e3', '61facafa-cda3-41cd-bf6c-b8a6fc53b7b6', 'ask_make_capacity', 'Ask make and capacity (kg per hour)', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('bf968cae-dbdc-4b82-a0e9-b5fa782329dd', '61facafa-cda3-41cd-bf6c-b8a6fc53b7b6', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('02bf31c7-51fe-4285-b770-1283d9e64923', '7bd0aa6f-cd50-4867-96a4-e305a50dc035', 'ask_power_spec', 'Ask power/spec (e.g. 1 HP)', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('99ba7e64-06e4-400d-b287-6a8585c89a64', '7bd0aa6f-cd50-4867-96a4-e305a50dc035', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('d6dd0a30-18a0-4501-b059-ba5ba4dc60e3', '6e68b853-da44-4ebf-8e31-345476784b69', 'ask_make_capacity', 'Ask make and capacity', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('c404ee09-9c68-4f0b-8134-40acbfe97c5d', '6e68b853-da44-4ebf-8e31-345476784b69', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('a20d27dc-de2d-47c0-837a-5364b00cf984', 'ee2a297e-1e17-49e0-8506-88f66fa1fc9f', 'ask_make_capacity', 'Ask make and capacity (ton per hour)', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('a2777d0b-c150-4f12-bc15-1fd090e917eb', 'ee2a297e-1e17-49e0-8506-88f66fa1fc9f', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('8df5e737-219d-4ece-bd4d-9d867977b99e', 'de054ff3-0615-4f85-b214-3b8db56ee315', 'ask_make_capacity', 'Ask make and capacity', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('071794bf-342c-4ed9-880e-9fc4d5787f5c', 'de054ff3-0615-4f85-b214-3b8db56ee315', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('3e1c329b-ad63-409b-b9fa-090aa23a86c5', '14cd8d5b-a7e9-4f1e-aff9-6b3f85d92bd9', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('ddf269dc-f801-4b12-92a7-12bfbaa41341', '14cd8d5b-a7e9-4f1e-aff9-6b3f85d92bd9', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('44db36da-a286-40d5-b629-7598949bd00c', '0687ca86-f7af-4ceb-8670-9c92bd01037f', 'ask_make_capacity', 'Ask make and capacity (ton per hour)', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('179ede28-1ba8-484e-b59a-366463569fa2', '0687ca86-f7af-4ceb-8670-9c92bd01037f', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('35488c9c-9652-48a6-9f37-9b2309fd05be', '0898082c-93d2-4d29-bdf3-234af1af46d8', 'ask_make_model', 'Ask make/model and size', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('4cf7d0c1-3339-46a5-a5d9-fb3bf7d0d13c', '0898082c-93d2-4d29-bdf3-234af1af46d8', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('0299ba79-24d3-4020-aa87-15fac1f5b260', 'f18a5016-abfe-474f-a5ff-d41d0499e876', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('c79a4898-721c-4145-bc91-d49ff3064ad9', 'f18a5016-abfe-474f-a5ff-d41d0499e876', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('8dbcf752-aa64-49cd-b6fa-bdf76d2b1e79', 'f15be384-3a3f-49b8-b520-0e6070a93b38', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('6c157f56-4727-492e-a3d8-e1a19c71b78a', 'f15be384-3a3f-49b8-b520-0e6070a93b38', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('68e7454c-eb27-423e-8816-41b9e509e50a', '350c2a7e-897b-4109-85f1-141359c975e7', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('3cd68306-359f-41b7-89d7-2623112649c3', '350c2a7e-897b-4109-85f1-141359c975e7', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('4818c673-61b7-4e26-84e3-b77fdf75c283', '8cdb00d0-1593-470b-b3f4-ab8c98e09bbc', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('75ac06aa-cc1a-4f9b-806a-0e86c6c1e3e5', '8cdb00d0-1593-470b-b3f4-ab8c98e09bbc', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('47f8844c-b973-4c83-b8f2-1bd2f3267555', '2bf4bde3-ff89-4173-86f3-97865c69b306', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('a1241d71-fa84-4b26-97d3-4fc0c20d16ea', '2bf4bde3-ff89-4173-86f3-97865c69b306', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('cf8e8d9b-79c6-4fa1-a5ce-62e36b19daf9', '78df715c-2543-4482-b404-49b4f6743068', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('25c8eb9b-9017-4953-ba61-5e85d3117ecf', '78df715c-2543-4482-b404-49b4f6743068', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('c69d6046-721c-42d2-b656-4e3b5fe4673d', '1084cf0b-4a85-45b6-b7ea-bff4b3db2301', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('2f6d05fd-1133-4b7d-bedb-5633c94d92ea', '1084cf0b-4a85-45b6-b7ea-bff4b3db2301', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('11e39634-4475-4ebf-95a8-9a110e52dd81', '8ec430e7-b85c-43d1-ade2-9fe690244f7c', 'ask_make_model', 'Ask make/model', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('110c309d-5c27-41db-9a51-58a9a539bdbe', '8ec430e7-b85c-43d1-ade2-9fe690244f7c', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('10a17e21-d9bb-4803-a9fd-54d6f3e1cb80', '6f6a10dc-ad2d-4a23-be9a-b79d8d7624e7', 'ask_chain_size', 'Ask chain size (e.g. R40-1, 1/2 inch)', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('13e37728-6a6a-42f1-9254-6ac233882daf', '6f6a10dc-ad2d-4a23-be9a-b79d8d7624e7', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('e16245fc-fd55-4d05-9f0a-575705ed7eff', '13c1d8cc-4c0e-4957-8795-a7b7d4957703', 'ask_size', 'Ask size/diameter', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('06b36ab8-2226-4aa8-a5d5-536367017814', '13c1d8cc-4c0e-4957-8795-a7b7d4957703', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('d6e589b1-1e6b-4643-81f0-04dfa5839430', '73c4c95b-70bf-4d01-8001-f75812eece02', 'ask_size', 'Ask size (e.g. 12x6) and thickness', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('3f221f43-2493-438c-b530-b0b547c72006', '73c4c95b-70bf-4d01-8001-f75812eece02', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('d7e9a12b-7858-484b-8d2b-858ebe3f799a', '9f868f8f-3773-4092-95c2-8fa5ff8b803f', 'ask_size', 'Ask size', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('c391fda2-3f66-45fe-ab2d-c8db468f422c', '9f868f8f-3773-4092-95c2-8fa5ff8b803f', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('8bb70da0-cf21-4e82-8d33-9465437e09ce', '60da2824-b838-45c2-aaa8-59b9e38c0872', 'ask_diameter_thickness', 'Ask diameter and thickness', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('8a79e78a-c6c2-4305-9e77-8db4cf3b336f', '60da2824-b838-45c2-aaa8-59b9e38c0872', 'ask_length', 'Ask length', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('6a58a30d-7c22-441c-a655-c310e4bb5543', '60da2824-b838-45c2-aaa8-59b9e38c0872', 'ask_quantity', 'Ask quantity', NULL, 2, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('907237cf-5e36-4915-8565-f106fd10dcd1', 'f1ac2bea-0de7-42ae-b33c-2b680fb7be76', 'ask_diameter_thickness', 'Ask diameter and thickness', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('1d643bb2-65d5-47b3-9f74-fc02c718e99d', 'f1ac2bea-0de7-42ae-b33c-2b680fb7be76', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('efacc4ae-68fa-46ae-b56b-8a71796d9d20', '50863a35-d8b3-4838-94bd-b46eb140e67b', 'ask_width_thickness_length', 'Ask width, thickness and length', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('9871a3ec-c28e-4f84-ad3e-cbb6c6767899', '50863a35-d8b3-4838-94bd-b46eb140e67b', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('b2f67b1a-a670-4e71-812b-e7344d5b5175', '80c20177-36bd-4900-99c7-c5fd63462bf6', 'ask_diameter_length', 'Ask diameter and length', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('091b2f7f-6f74-44b7-800b-7a165ec0d210', '80c20177-36bd-4900-99c7-c5fd63462bf6', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('b16737cb-e87c-48d6-8a70-8824cec07754', 'fe2382aa-36ad-4528-9278-deb13488212e', 'ask_size_spec', 'Ask size/specification', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('a6fd1300-7352-4a20-bf58-6e4a0f697daa', 'fe2382aa-36ad-4528-9278-deb13488212e', 'ask_quantity', 'Ask quantity', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('e3f74849-c68c-466b-8d9d-d88b4fbcd09c', 'b958b7ff-b5b1-4bb9-98ae-488e8e26552c', 'ask_machine_model', 'Ask machine make/model the frame suits', NULL, 0, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('3058ab55-b6af-42f3-b8b5-65a53ab3642c', 'b958b7ff-b5b1-4bb9-98ae-488e8e26552c', 'ask_size', 'Ask size', NULL, 1, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z'),
('10f513f8-253c-4aef-81fc-8cc9995801d5', 'b958b7ff-b5b1-4bb9-98ae-488e8e26552c', 'ask_quantity', 'Ask quantity', NULL, 2, 1, NULL, 1, '2026-10-12T12:00:00.000Z', '2026-10-12T12:00:00.000Z');

-- ── Alias top-ups (append-only, idempotent) ──
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'chain sprocket' UNION SELECT 'nabhi'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Simplex Chain Sprocket'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('chain sprocket', 'nabhi'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'c groove pulley' UNION SELECT 'groove pulley'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Plain Bore V Belt Pulley'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('c groove pulley', 'groove pulley'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'h315' UNION SELECT 'h2316' UNION SELECT 'bearing socket'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Bearing Sleeve'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('h315', 'h2316', 'bearing socket'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'mtra top sieve' UNION SELECT 'mtra bottom sieve'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'MTRA Sieve'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('mtra top sieve', 'mtra bottom sieve'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'silo sleeve' UNION SELECT 'lansifter sleeve'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Plansifter Sleeves'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('silo sleeve', 'lansifter sleeve'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'hammmer blade'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Hammer Mill Beaters'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('hammmer blade'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'koli'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Reducer'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('koli'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'kali'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Elbow Bend'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('kali'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'gi y'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Y (Y-Piece)'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('gi y'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'gi t'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Tee'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('gi t'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'lab shifter' UNION SELECT 'sedimentation shaker'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Test Sieves'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('lab shifter', 'sedimentation shaker'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'crusher belt' UNION SELECT 'excavating conveyor belt'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Black Rubber Belt'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('crusher belt', 'excavating conveyor belt'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'leather belt'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Transmission Belt'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('leather belt'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'pvc white guide'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'PVC / PU Conveyor Belt'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('pvc white guide'));
UPDATE ProductItem SET aliases = (
  SELECT json_group_array(value) FROM (
    SELECT value FROM json_each(ProductItem.aliases)
    UNION SELECT 'rings' UNION SELECT 'pipe ring'
  )
), updatedAt = '2026-10-12T12:00:00.000Z'
WHERE name = 'Lock Ring'
  AND NOT EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN ('rings', 'pipe ring'));
