# Sourcing Queue (Pre-Sale Vendor Rates)

Pending-only vendor-rate queue for the procurement team. Shows ONLY items
awaiting vendor rates — never the daily sales pipeline.

End-to-end position: **middle of the loop**. Sales logs enquiries in
`enquiry-tracker` (unstructured → `items[]`); this queue adds `rates[]` per
item and flags bad specs (`specIssue`); Management (`enquiry-management`)
then decides margins (`finalRate`). All three read the SAME row via
`/api/enquiries/*`; EventHub `enquiries` summaries keep them live.

```
Sales (tracker) ──items[]──▶ THIS QUEUE (rates[] + specIssue) ──▶ Management (finalRate) ──▶ Sales (sent)
```

Queue predicate (see `modules/enquiries/queues.ts` ↔ frontend
`src/enquiry/queue.ts` — keep in sync): an enquiry is pending while it has
quotable work (`!rateAvailable && !internalRates`) and is not concluded
(`procurementSubmittedAt` empty, or fresh unquoted lines reopened it).
Fully-quoted-but-unconcluded rows STAY active so management sees live rates.

Data is served live from `/api/enquiries?view=procurement` (D1/Postgres)
with client PII blanked and markup decisions withheld (API-enforced via
`scopes.ts` + AI-only `redaction.ts` cache — missing pieces withhold with
`redactedPending`, never raw text).
The frontend `ProcurementQueue` dashboard subscribes to EventHub live events.

Display-only: `rule.json` trigger is `manual` (no scheduled scan — the
registry entry exists for the dashboard + scope). Live updates arrive via
scope-safe `enquiries` summaries (counts only, never PII).

## What procurement can/can't write (server-enforced, `update.ts`)
- CAN: `rates[]` (vendor + amount), `specIssue` flags, vendor reference media
  (append-only), remarks in `thread[]`.
- CANNOT: item identity (name/qty/spec follow stored), `rateAvailable` /
  `expectedRate` (sales-owned), margins (`selectedVendor/markup/finalRate` —
  management-only), new items (index-capped to stored length).

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

## Sales alternate requests
Sales can request an alternate make/option directly (`variationRequest` on
the item — no management approval). It renders as a sky-blue banner on the
card ("Sales requested an alternate option"); quoting it as a new vendor
rate clears it automatically (server-trailed as `quoted`). Served in the
redacted payload as live workflow metadata (never gated on the AI cache).
A fresh request wipes the item's previous vendor rates + old decision first,
so the card arrives clean — quote the requested variation as new rate rows.

Distinct from the CRM **SO Materials** tab, which shows post-sale Zoho sales
order line items — this queue is pre-sale vendor quotes per enquiry item.

## Code map (maintainability)
Backend: `modules/enquiries/queues.ts` (predicates), `scopes.ts` (redaction
policy), `redaction.ts` (AI cache), `update.ts` (`normalizeItemWrites`
restricted branch), `routes.ts` (`enquiryList` redacted path).
Frontend: `src/enquiry/queue.ts` (predicates), `src/enquiry/normalize.ts`
(row mapping), `components/ProcurementQueue|ItemCard|Thread.tsx`,
`hooks/useEnquiryData.ts` (`view="procurement"` → `?view=procurement`).
