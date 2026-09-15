# estimates — shared Zoho-estimate write logic (Worker + Express)

One implementation, two runtimes. `src/worker/routes/estimates.ts`,
`src/worker/routes/runner.ts` and `src/server.ts` are auth + broadcast
adapters only — every rule below lives here and runs identically on D1
(Worker, via the `shared/prisma` → `prisma-d1` redirect) and PostgreSQL
(Express). **Never put handler logic in a router.**

## Modules

| File | Owns |
|---|---|
| `status-sync.ts` → `applyStatusUpdates(updates)` | Status transitions in any direction. Accepted/confirmed flips credit the telecalling close ledger via `recordConversionClose` (idempotent — safe on replays). Declines = status sync only (penalty retired). Returns `{ updated, closesCredited }`. |
| `lead-details.ts` → `applyLeadDetails(rows)` | Lead-block chips (enquiry/source/location/contact). `leadGeneratedBy` NEVER writes `createdBy` — it only counts toward the 3-field validity gate, then is discarded. The By field comes solely from `../enquiries/estimate-link.ts`. `<3`-field captures consume one of `MAX_DETAILS_ATTEMPTS=10` instead of storing; at 10 the estimate gives up (`detailsFailed`) until genuinely new comments re-admit it. Returns `{ updated, attempted, failed }`. |

## Linked modules (same pattern, kept where they live)

* `../enquiries/estimate-link.ts` — the Enquiry ↔ Estimate link, single
  source of truth: `Enquiry.estNumber = Estimate.estimateNumber`;
  `Estimate.createdBy` is overwritten from `Enquiry.assignedAgentId` on
  enquiry save (`syncEstimateCreatorFromEnquiry`), one-click claim
  (`claimEstimateForAgent`: free → assign + stamp creator; held → report
  holder only, never steal), and engine creator-first
  (`enquiryAgentByEstNumber`). Backs `GET /api/estimates/lookup` and
  `POST /api/enquiries/:id/claim-estimate` (the B2B form Check & Assign
  button).

## Rules for editors

* Routers validate auth/shape, call one function here, then `notifyLive` +
  invalidate (`invalidateDerivedEstimateCaches` / `invalidateRiskCache`
  when rows changed) — copy the existing route bodies, don't reinvent.
* No new fields without registering them in `shared/prisma-d1.ts`
  (`BOOL/DATE/ID_FIELDS`, `RELATIONS`) — D1 reads silently miss them.
* Converted-By names the **generator** (`createdBy`); holder-only fallback
  is for pre-link rows. Never derive attribution from holder alone.
