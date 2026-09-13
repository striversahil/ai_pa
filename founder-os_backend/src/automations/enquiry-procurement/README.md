# Sourcing Queue (Pre-Sale Vendor Rates)

Pending-only vendor-rate queue for the procurement team. Shows ONLY items
awaiting vendor rates — never the daily sales pipeline.

Data is served live from `/api/enquiries?view=procurement` (D1/Postgres)
with client PII blanked and markup decisions withheld (API-enforced).
The frontend `ProcurementQueue` dashboard subscribes to EventHub live events.

Display-only: `rule.json` trigger is `manual` (no scheduled scan — the
registry entry exists for the dashboard + scope). Live updates arrive via
scope-safe `enquiries` summaries (counts only, never PII).

## Ops thread
The queue modal carries the shared ops thread (`ProcurementThread`):
procurement-scope comments only — readable and writable from here, visible to
sales under their Procurement tab. Sales-private discussion never reaches this
view (API-enforced via `EnquiryComment.visibility`, migration 0029; the
redacted payload and redaction cache exclude `sales` rows). Item-level
back-and-forth (`flag/fix/request/quoted` on `items[].thread`) is unchanged
and renders alongside.

## Intake notes
Items arriving from the unstructured intake may carry an AI `category`
(KYP-grounded) and a `missing[]` slot list — incomplete specs stay with sales
and never reach this queue. Price-memory suggestions served to this view carry
names/routes only (no final rates — same margin policy as `stripMarginFields`).

Distinct from the CRM **SO Materials** tab, which shows post-sale Zoho sales
order line items — this queue is pre-sale vendor quotes per enquiry item.
