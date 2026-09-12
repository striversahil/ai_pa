# Management Review

Pending-only rate review for management. Shows ONLY rated items awaiting a
markup decision + finalize — never the daily sales pipeline.

Data is served live from `/api/enquiries/*` (full view; markup + finalize
actions are MIS-only, API-enforced — non-privileged readers get final rates
but never `selectedVendor`/`markup`). The frontend `ManagementReview`
dashboard subscribes to EventHub live events.

Display-only: `rule.json` trigger is `manual` (no scheduled scan — the
registry entry exists for the dashboard + scope). Pending and history are
disjoint: an enquiry is either awaiting a decision or decided, never both.
