# Procurement Queue

Pending-only vendor-rate queue for the procurement team. Shows ONLY items
awaiting vendor rates — never the daily sales pipeline.

Data is served live from `/api/enquiries?view=procurement` (D1/Postgres)
with client PII blanked and markup decisions withheld (API-enforced).
The frontend `ProcurementQueue` dashboard subscribes to EventHub live events.
