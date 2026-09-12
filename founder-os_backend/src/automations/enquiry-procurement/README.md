# Sourcing Queue (Pre-Sale Vendor Rates)

Pending-only vendor-rate queue for the procurement team. Shows ONLY items
awaiting vendor rates — never the daily sales pipeline.

Data is served live from `/api/enquiries?view=procurement` (D1/Postgres)
with client PII blanked and markup decisions withheld (API-enforced).
The frontend `ProcurementQueue` dashboard subscribes to EventHub live events.

Display-only: `rule.json` trigger is `manual` (no scheduled scan — the
registry entry exists for the dashboard + scope). Live updates arrive via
scope-safe `enquiries` summaries (counts only, never PII).

Distinct from the CRM **SO Materials** tab, which shows post-sale Zoho sales
order line items — this queue is pre-sale vendor quotes per enquiry item.
