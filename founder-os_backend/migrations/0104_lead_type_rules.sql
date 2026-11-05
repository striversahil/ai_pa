-- 0104_lead_type_rules.sql — ClientTypeRule seeds for the trader + conveyor-belt import.
--
-- Two new customerTypeBase families enter the book with this import:
--   Reseller      every traders.json row (Customer Type = 'Reseller') → 'reseller'
--                 (excluded from the ₹1L/day end-consumer target, like resellers).
--   Conveyor Belt every conveyor_belt.json row → unset segment (ITS OWN type —
--                 founder decision 2026-11-04; the sales-head maps it later).
-- Everything else keeps its 0094 seed. INSERT OR IGNORE so re-runs are safe.
INSERT OR IGNORE INTO ClientTypeRule (typeBase, segment) VALUES
  ('Reseller', 'reseller'),
  ('Conveyor Belt', '');
