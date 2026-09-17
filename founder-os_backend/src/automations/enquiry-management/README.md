# Management Review

Pending-only rate review for management. Shows ONLY rated items awaiting a
markup decision + finalize — never the daily sales pipeline.

End-to-end position: **end of the loop**. Sales logs (`enquiry-tracker`),
Procurement quotes (`enquiry-procurement` → `rates[]`), THIS review decides
per-item margin (`selectedVendor` + `markup` → `finalRate`, ceil5) and
finalizes (`rateStatus=finalized`); Sales then marks `sent` (needs EST No.).
All three read the SAME row via `/api/enquiries/*`; EventHub `enquiries`
summaries keep them live.

```
Sales ──▶ Procurement (rates[]) ──▶ THIS REVIEW (markup → finalRate, finalize) ──▶ Sales (sent)
```

Queue predicate (see `modules/enquiries/queues.ts` ↔ frontend
`src/enquiry/queue.ts` — keep in sync): an enquiry is pending while ANY item
`itemNeedsDecision` (unavailable, undisputed spec, quoted or internal, no
`finalRate` yet). NO submit gate — management sees live vendor rates the
moment procurement adds them. History = every quotable item finalized;
partial finalizes stay active.

Data is served live from `/api/enquiries/*` (full view; markup + finalize
actions are MIS-only, API-enforced — non-privileged readers get final rates
but never `selectedVendor`/`markup`). The frontend `ManagementReview`
dashboard subscribes to EventHub live events.

Display-only: `rule.json` trigger is `manual` (no scheduled scan — the
registry entry exists for the dashboard + scope). Pending and history are
disjoint: an enquiry is either awaiting a decision or decided, never both.

## Flagging procurement (rate requests)
**Flag procurement sends IMMEDIATELY** — the request PATCHes straight away,
so it works on locked (finalized/sent) enquiries too and can never be lost
by closing the panel (the old staged-then-save flow dropped flags where Save
was disabled). A fresh request on a finalized item reopens the decision
server-side; procurement answering with a new rate clears it. Unanswered
requests can be withdrawn (explicit `""` clears + trails `withdrawn`).
A FRESH flag also clears the item's previous vendor rates + old decision, so
procurement re-quotes clean instead of appending to a wrong quote.

## Handle internally — removed
Marking NEW items internal is removed from all UI (management panel +
procurement queue); everything flows through procurement. Legacy rows
already flagged internal keep rendering (badges, entry form, return path);
the backend still honors stored flags so old rows never brick.

## Decision rules (server-enforced, `update.ts` + `scopes.ts`)
- Only MIS/admin writes `selectedVendor/markup/finalRate/finalDiscountPercent`
  (+ `finalizedAt` stamp); other writers' values are ignored AND preserved
  (never wiped).
- `finalize`/`sent` require 100% of loop items decided (completeness gate).
- Fresh `ratesRequested` reopens a finalized item (decision clears, handoff
  clears); late quotes on `finalized` keep the committed rate + `quoted`
  thread note.
- Pricing math: `final = ceil5(rate × (1−discount%) × (1+markup%))` — see
  frontend `src/enquiry/pricing.ts` (`finalFromMargin`, `splitBulkTotal`).

## Code map (maintainability)
Backend: `modules/enquiries/queues.ts` (predicates), `scopes.ts`
(`canManageRates`, `stripMarginFields`, `validateRatesInput`),
`update.ts` (`applyRateLifecycles`, `applyLateQuoteReopen`), `routes.ts`
(`enquiryUpdate` privileged path).
Frontend: `src/enquiry/queue.ts` (predicates), `src/enquiry/pricing.ts`
(`ceil5`, `finalFromMargin`, `splitBulkTotal`, `shareKey`),
`components/ManagementReview.tsx` (queue table),
`components/ManagementRatesPanel.tsx` (staged decision UI — pure math
imported from pricing), `hooks/useEnquiryData.ts` (`view="sales"` privileged).
