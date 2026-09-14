# Enquiry Tracker

Live sales pipeline dashboard. Enquiries and comments are stored in D1 (Worker)
or Postgres (Express) and pushed to open dashboards over the EventHub
(`LiveEvent.Enquiries`). No scheduled processing — this automation exists so the
tracker shows up in the Automations registry with a `View Dashboard` entry
(`rule.json` trigger is `manual`).

## API
- `GET  /api/enquiries` → `{ enquiries, comments }`
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
into `items: [{ name, qty, spec, media, category }]` by the GH intake runner
(`scripts/enquiry-intake-runner.js`, every 30 min via `cron-every-30min.yml`):
two-stage grounding on `data/know_your_product_v2.json` ONLY (136 items,
10 categories — no derived taxonomy/slot files): Stage A routes each line to
a category from a slim `Category: item, …` list (~680 tokens, client wording
kept verbatim) with vision; Stage B grounds each routed category with that
category's full aliases + `required_attributes` (worst ~4k tokens) to the
exact `item_name`, verbatim spec, and `missing[]`. Then a price-memory lookup. Results land
fill-empty-only (manual edits always win) plus KV suggestions at
`enquiry:intake:<id>` (7d TTL) for the sales `IntakePanel`. Stored on the row;
sales can edit/delete/add manually. Each item carries `media:
[{ type: 'image'|'video', url }]` (data-URI, ≤10MB each, ≤10 per item) —
media passes through unredacted in procurement (technical drawings) but is
part of the freshness hash. Visible in both views with inline video players +
Lightbox playback. Money inputs accept `₹`/commas (`₹1,200.50` → 1200.50);
anything else non-numeric is a 400 with a message.

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
