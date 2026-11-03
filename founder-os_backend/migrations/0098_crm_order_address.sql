-- 0098 — dispatch floor: client addresses on the order + drop the constant charge line.
--
-- Zoho Books returns billing_address / shipping_address only on the per-order
-- detail endpoint (the list response never carries them), so the floor stores
-- them on the row and the runner fills them in with the same detail pass that
-- captures line items.
ALTER TABLE CrmSalesOrder ADD COLUMN billingAddress TEXT NOT NULL DEFAULT '';
ALTER TABLE CrmSalesOrder ADD COLUMN shippingAddress TEXT NOT NULL DEFAULT '';

-- "Packaging & Forwarding" is a standing charge on every SO, not something the
-- dispatch desk can date or ship. It polluted the item list (62 rows) and the
-- scheduling flow, so it is removed here and filtered at sync time.
DELETE FROM CrmSoItem
 WHERE lower(trim(name)) IN (
   'packaging & forwarding', 'packaging and forwarding', 'packaging & forwarding charges',
   'packaging', 'forwarding'
 );
