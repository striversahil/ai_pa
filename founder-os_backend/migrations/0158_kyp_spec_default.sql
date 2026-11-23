-- 0158_kyp_spec_default.sql — the spec default value (founder decision 2026-11-23).
--
-- A spec may declare the value a quote should start with when the vendor sheet
-- is silent (the KYP JSON carries `default` on 169 properties today). Stored as
-- JSON text so the type survives (`"pu"`, `1`, `true`, `["a","b"]`); the live
-- catalogue parses it back into `props[key].default`.
--
-- Re-runnable: ADD COLUMN is skipped when the column already exists.
ALTER TABLE KypGuide ADD COLUMN defaultValue TEXT;
