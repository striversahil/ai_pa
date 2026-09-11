# Management Review

Pending-only rate review for management. Shows ONLY rated items awaiting a
markup decision + finalize — never the daily sales pipeline.

Data is served live from `/api/enquiries/*` (full view; markup + finalize
actions are MIS-only, API-enforced). The frontend `ManagementReview`
dashboard subscribes to EventHub live events.
