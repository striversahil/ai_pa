# Enquiry Tracker (Sales Pipeline)

Live sales pipeline dashboard — the **origin** of every enquiry. Sales logs
unstructured enquiries here; Procurement (`enquiry-procurement`) quotes them;
Management (`enquiry-management`) decides margins. All three dashboards read
the SAME `Enquiry + items[]` row via `/api/enquiries/*` and stay in sync over
the EventHub (`LiveEvent.Enquiries`, summary-only broadcasts).

```
Sales (tracker) ──items[]──▶ Procurement (quotes rates) ──rates[]──▶ Management (markup+finalize) ──finalRate──▶ Sales (mark sent)
       ▲                                                                                                                   │
       └────────────────────── spec fixes / variation requests / rateAvailable ─────────────────────────────────────────────┘
```

## Pipeline states (`rateStatus`)

`rate_pending` (created) → `rates_received` (first vendor rate, auto) →
`finalized` (management, all loop items decided) → `sent` (sales, needs EST No.)

Per-item flags drive the queues: `rates[]`, `ratesRequested`, `specIssue`
(procurement hold), `rateAvailable` (sales bypass), `internalRates`
(management self-quote), `selectedVendor/markup/finalRate/finalizedAt`
(management decision), `thread[]` (server-authored flag/fix/request/quoted trail).

## API
- `GET  /api/enquiries` → `{ enquiries, comments }` (privileged: full PII;
  margins stripped unless MIS — see `modules/enquiries/scopes.ts`)
- `GET  /api/enquiries/clients` → `[{ name, openEstimates, enquiries }]` —
  client master merged from Zoho customers + companies used on enquiries
  (procurement gets `[]`; client PII stays hidden there)
- `GET  /api/enquiries/agents` — sales roster (procurement gets `[]`)
- `POST /api/enquiries` — create enquiry (daily no. from an atomic Setting
  counter; junk quote amounts are 400s, never silent drops). New enquiries are
  logged unstructured: free-text `description` + enquiry-level photo
  `imageUrls` with `items: []` — the intake runner (below) splits items,
  extracts lead fields and checks price memory afterwards
- `PATCH /api/enquiries/:id` — update (send `items` to save manual item edits;
  editing `description` without `items` resets items for AI re-split)
- `DELETE /api/enquiries/:id` — delete
- `GET/POST /api/enquiries/:id/comments` — threaded comments, scoped
  (`visibility: 'sales' | 'procurement'`; replies inherit the parent's scope,
  restricted writers can only post `procurement`; see Scoped threads)
- `GET  /api/enquiries/:id/intake` — AI intake panel for the sales UI:
  `{ ready, suggestions[] ({ itemIndex, name, finalRate, score, route }),
  missing[], candidates[] }` (procurement-scoped readers get names/routes
  only — no final rates)

Live broadcasts carry scope-safe summaries only (counts + label parts, never
PII/free text); every view refetches its own scoped payload on events.
The dashboard payload (`data()`) is KV-cached 60s and busted on every write.

## Line items (Item 1..N)
The unstructured enquiry (`description` + enquiry-level photos) is AI-split
 into `items: [{ name, qty, spec, media, category }]` worker-natively by
 `modules/enquiries/vision-intake.ts` (`kickAgnesIntake` on create/update via
 `waitUntil`, Agnes vision, edge <5s; legacy GH `scripts/enquiry-intake-runner.js`
 follows the same design as fallback): segment → lookup on
 `data/know_your_product_v2.json` ONLY (136 items, 10 categories — slim
 codegen twin `src/modules/enquiries/kyp-lookup.ts` for the edge bundle, no
 derived taxonomy/slot files): Call 1 segments each line (vision, NO catalogue
 — pure splitter, client wording kept verbatim, so the model cannot
 hallucinate catalogue names or drop lines to fit them); Call 2 looks each
 verbatim line up (deterministic alias-index first, one batched LLM fallback
 with the item+alias list only for misses, <0.5 confidence stays
 Uncategorized). Then a price-memory lookup. Results land
fill-empty-only (manual edits always win) plus KV suggestions at
`enquiry:intake:<id>` (7d TTL) for the sales `IntakePanel`. Stored on the row;
sales can edit/delete/add manually. Each item carries `media:
[{ type: 'image'|'video', url }]` (data-URI, ≤10MB each, ≤10 per item) —
media passes through unredacted in procurement (technical drawings) but is
part of the freshness hash. Visible in both views with inline video players +
Lightbox playback. Money inputs accept `₹`/commas (`₹1,200.50` → 1200.50);
anything else non-numeric is a 400 with a message.

## Alternate options (sales view)
Management-shared alternates reach sales ANONYMIZED (API-enforced in
`scopes.ts` `stripMarginFields`): "Alternate option N" + green final rate +
forwarded note — never vendor names. If the client wants a different
make/option, sales taps **Request alternate option**, describes it, and it
goes straight to procurement as `variationRequest` — NO management approval.
Procurement quoting a new rate clears it; sales may withdraw anytime.
A FRESH request starts a new quoting round: previous vendor rates + old
decision linkage are removed server-side (trailed in the item thread), so
procurement re-quotes the requested variation clean.

## Price memory (Pinecone)
Finalized items (`finalRate` set, spec undisputed) are embedded (HF
MiniLM 384-dim, spec text only — never PII) into the `enquiry-items` index,
one namespace per KYP category (`uncategorized` for pre-KYP backfill rows;
see `modules/enquiries/similarity.ts`). New items route exact (≥0.97 +
dims-equal → auto-quote, `rateAvailable: true`, skips both queues) /
suggest (≥0.85 → 1-click card in sales) / miss (today's loop unchanged).
Backfill: `scripts/enquiry-memory-backfill-runner.js --dry-run` reports first,
then indexes. Runner endpoints: `GET /api/runner/enquiry-memory/finalized`,
`GET /api/runner/enquiry-intake/pending`, `POST /api/runner/enquiry-intake/result`
(all `SHARED_SECRET`-gated).

## Scoped threads
`EnquiryComment.visibility` (`sales` default via migration 0029): sales sees
both threads (Sales/Procurement tabs in `EnquiryDetail`); procurement sees and
posts only `procurement` (its queue modal mounts `ProcurementThread`); the
redacted API + redaction cache exclude `sales` rows entirely. Live broadcasts
stay summary-only (+ `visibility` in the event extra).

## Dashboard
- Slug: `enquiry-tracker`
- Frontend renderer: `EnquiryTracker` (mounted via `Automations.tsx`), scope `enquiries`.

## Code map (maintainability)
Backend (`founder-os_backend/src/modules/enquiries/` — one concern per file):
- `types.ts` — row/item/comment/thread shapes + daily-no/label helpers
- `parse.ts` — pure parsers (media/rates/thread/qty/money/ISO)
- `queues.ts` — queue predicates (which enquiry sits in which dashboard;
  mirrors frontend `src/enquiry/queue.ts` — keep in sync)
- `scopes.ts` — authz (`isRestrictedViewer`/`canManageRates`), margin policy
  (`stripMarginFields`), money validation, live summaries, creator resolve
- `redaction.ts` — procurement-safe AI redaction cache (hash-verified)
- `update.ts` — item lifecycles (`normalizeItemWrites`, `applyRateLifecycles`,
  `applyLateQuoteReopen`, `applyIntakeBulkResult`)
- `routes.ts` — CRUD orchestrator only (imports the above; re-exports for compat)
- `store.ts` — persistence (D1/Memory; Prisma in `store-prisma.ts`)

Frontend (`founder-os_frontend/src/enquiry/` + components):
- `enquiry/queue.ts` — queue predicates (single frontend truth; `types/index.ts`
  re-exports for compat)
- `enquiry/normalize.ts` — `toEnquiry`/`toComment`/`initialsOf` (hook imports)
- `enquiry/pricing.ts` — `ceil5`/`fmtINR`/`RATE_STATUS_LABEL`/final-rate math
- `hooks/useEnquiryData.ts` — live list + optimistic mutations + write chains
- `components/EnquiryTracker|List|Detail|Modal|RowItem|Chat.tsx` — sales views
