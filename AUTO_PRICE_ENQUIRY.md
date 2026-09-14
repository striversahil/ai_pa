# Auto Price Enquiry System

> Owner: Sahil (Brindavan Udyog — B2B flour-mill spares).
> Status: pipeline live end-to-end (sales → procurement → management → sent);
> this doc tracks the goal, what exists, verified behavior, and what remains
> to make repeat enquiries quote without human touch.

## 1. Goal

An enquiry that matches a known item + spec **auto-quotes instantly**.
Everything else reaches procurement **complete** and returns with a rate **once** —
and every management approval makes the next identical enquiry automatic.

### The loop being eliminated

Today: sales logs an unstructured enquiry (jargon text or a photo) → the
procurement team discovers a wrong dimension *after* sourcing has started →
back to sales for correction → vendor rates → management margin → quote.
Repeat enquiries cycle the same loop instead of quoting from memory, and the
business owner sits in the middle of every round trip.

Target state:

```
sales free text / photo
  → AI splits into line items + extracts client block
  → category routing → spec grounding vs KYP catalogue
  → completeness check (missing dims bounce to SALES immediately)
  → price-memory lookup
      → exact hit      → auto-quote, no human touches it
      → suggest        → 1-click accept in sales UI
      → miss           → procurement queue (category + item + correct attrs pre-filled)
  → procurement: vendor rates (or spec flag → sales fix)
  → management: margin + approve
  → write-back into memory/catalog → next identical enquiry auto-quotes
```

## 2. Background / pain points

- Requirements arrive unstructured: trade slang ("Resham ki jali"), abbreviations,
  mixed Hindi/English, sometimes only as a photo of a handwritten note or old part.
- ~600 spare types × dimensions × vendors; the vendor price list itself is a
  ~1000-row messy Excel that also needs structuring before it can power quotes.
- Different items need different dimensions (teeth + pitch vs mesh count vs
  width × ply × length) — one rigid table cannot hold them.
- Sales capture mistakes are currently caught late (by procurement, mid-sourcing).
  That late catch is the expensive part of the loop, not the matching itself.
- Margin approval must stay a manual management gate (business decision), but the
  tooling around it should be effortless: item + vendor quotes side by side + margin input.

## 3. Architecture (current)

```
EnquiryModal (sales) ──POST /api/enquiries──▶ Worker (Hono + D1)
                                                    │ fire-and-forget
                        ┌───────────────────────────┼───────────────────────────┐
                        │ enrichment (lead fields + │ intake dispatch           │
                        │ procurement redaction)    │ (ops-enquiry-intake.yml)  │
                        └───────────────────────────┼───────────────────────────┘
                                                    ▼
            GH Actions enquiry-intake-runner (OpenRouter vision+text, 4-way parallel,
              per-enquiry claims, 30-min backstop sweep)
              Stage A router → Stage B grounder → Stage C price memory
                                                    │ POST /api/runner/enquiry-intake/result
                                                    ▼
            D1 row updated (fill-empty-only) + KV suggestions (enquiry:intake:<id>, 7d)
              → sales IntakePanel / IntakeItemMeta → procurement → management → sent
```

- Live runtime is the Cloudflare Worker + D1; heavy AI runs in GitHub Actions
  runners calling `/api/runner/*` (Bearer `SHARED_SECRET`). Express/Postgres
  mirrors the routes as an alternate runtime (not production).
- One WebSocket (`/api/events`, EventHub DO) fans scope-safe `enquiries`
  summaries (counts + labels, never PII); dashboards refetch their scoped payload.

## 4. What is built (detailed)

### 4.1 Unstructured intake — `POST /api/enquiries`

- Free-text `description` + enquiry-level `imageUrls` (create) or per-item
  `media` (edit); `items: []` on create — the runner splits afterwards.
- Daily number `Enquiry No N - DD MON SRC` from an atomic IST counter;
  `source: TL | AI | Incoming | B2B`; EST No. optional at create.
- Lead auto-ownership: creator's `Telecaller` roster row (login email → name);
  never the auth-session id.
- New rows start `rateStatus: 'rate_pending'`.
- Two fire-and-forget kicks: AI enrichment (structured lead fields + procurement
  redaction cache) and intake workflow dispatch (`kickIntakeNow` in
  `founder-os_backend/src/worker/routes/enquiries.ts:16`).
- Code: `founder-os_backend/src/modules/enquiries/routes.ts`
  (`enquiryCreate`), `src/worker/routes/enquiries.ts`.

### 4.2 Two-stage AI grounding — `scripts/enquiry-intake-runner.js`

Sole taxonomy source: `founder-os_backend/data/know_your_product_v2.json`
(136 items, 10 categories). Deleted predecessors (`kyp_taxonomy.json`,
`kyp_slots.json`) — no code references them.

- **Stage A — router** (vision + text, slim numbered list ~686 tokens):
  free text + up to 4 images (enquiry photos first, then item media) →
  `{ lines: [{ verbatim, category (bare digit 1–10), qty, dims, spec }],
  lead: { clientCompany, contactName, contactEmail, contactPhone, location,
  sourceLead } }`. Client wording is copied exactly, never renamed; lead fields
  never invented (empty when absent; `Lead of …` agent references ignored).
  Numbered categories were adopted after live testing showed the model echoing
  material/item words (`"Nylon"`) as the category — digits route deterministically.
- **Stage B — grounder** (text-only, one call per routed category with that
  category's full aliases + `required_attributes`, worst ~4k tokens):
  verbatim lines → exact v2 `item_name` + verbatim `spec` + `missing[]` derived
  from the catalogue's `needs`. Unknown lines pass through verbatim (never invented).
- **Server guard**: only exact v2 category names are stored; anything else is
  re-resolved via full-index fuzzy match or parked under `Uncategorized`.
- **Result apply** (`POST /api/runner/enquiry-intake/result`, fill-empty-only):
  structured fields only when blank, items only when the row has none;
  suggestions + `missing[]` → KV for the sales UI. Manual edits always win.
- Parallelism: 4-way batches, per-enquiry claims with 10-min TTL
  (`POST /api/runner/enquiry-intake/claim`); `--dry-run` / `--limit=` supported.

### 4.3 Price memory — Pinecone `enquiry-items` + HF MiniLM

- Finalized items embedded (spec text only, 384-dim, never PII), one namespace
  per KYP category (`uncategorized` for pre-KYP rows):
  `founder-os_backend/src/modules/enquiries/similarity.ts`,
  `scripts/enquiry-memory-backfill-runner.js`.
- Routing per item: `exact` (score ≥ 0.97 + dims-equal → `rateAvailable: true`,
  skips the procurement→management loop) / `suggest` (≥ 0.85 → 1-click card in
  sales `IntakePanel`) / `miss` (procurement queue as usual).
- Light `canon()` normalization for the exact-match comparison only
  (lowercase, inch/mm word unification).

### 4.4 Procurement queue — `enquiry-procurement` scope

- Pending predicate `itemNeedsRates`: `!rateAvailable && (rates == 0 || ratesRequested)`
  (`founder-os_frontend/src/types/index.ts:85`). Empty enquiries wait on sales.
- PII-redacted view (AI rewrite cache `enquiry:redacted:<id>`, hash-verified per
  piece; missing pieces withheld with re-enrichment kicked, never guessed).
  No client names, no agent roster, no margins (`selectedVendor/markup/finalRate`
  stripped).
- Owns rates + spec flags only: `rates[{ vendor, rate, description, specSame,
  specDiff, quotedAt }]`; `specIssue` holds the item out of management until
  sales fixes the spec; identity fields (name/qty/spec/media) follow the stored row.
- First vendor rate flips `rate_pending → rates_received`; a rate change clears
  `ratesRequested` and appends a `quoted` trail entry. Every flag/remark/fix/
  request is server-stamped into `thread[]` (visible across rounds).

### 4.5 Management review — `enquiry-management` (MIS/admin)

- Pending predicate `itemNeedsDecision`: rated, unfinalized, undisputed spec
  (`types/index.ts:91`).
- Full sales payload + margins: `selectedVendor + markup + finalRate` per item,
  `ratesRequested` (sends back to procurement, clears the previous decision),
  privileged re-flag of `specIssue` (reopens finalized items).
- Completeness gate: `finalized`/`sent` refused unless 100% loop items
  (correct spec, rate unavailable) carry a final rate. Privileged item saves
  auto-advance to `finalized` with `finalizedAt` stamps when all loop items
  are decided.
- Sales close: `finalized → sent` only with an EST No. on the row.
  `POST /:id/additional-requirements` appends a new line item and reopens
  `finalized → rate_pending`.

### 4.6 Threads, scopes, live behavior

- Comments `sales | procurement` (`migration 0029`); replies inherit the parent's
  scope; restricted writers post `procurement` only. Full row broadcast never
  carries PII — summaries only.
- Scopes: `enquiry-tracker` (full sales pipeline), `procurement` (redacted queue),
  `mis`/admin (management + margins). `stripMarginFields` keeps vendor/markup
  management-only in every non-privileged response.
- Toasts: sales sees rates-ready / spec-flag / spec-diff; procurement sees
  management requests + sales fixes; management sees fresh vendor rates — all
  from live summaries, payloads refetch scoped.

## 5. Verified behavior (live test, production path)

Run on OpenRouter (11-key pool) + HF + Pinecone with
`Nylon Conveyor Belt 7" x 3 ply x 13 mtr Length`:

- Stage A kept `verbatim` exact, split `dims`/`spec`, routed category `2`
  (Conveying Accessories); lead block extracted alongside the item from the same
  text (`Sharma Flour Mills / Rajesh Sharma / 98110 12345 / Haryana`), `sourceLead`
  left empty (not stated, not invented).
- Stage B grounded to `Cotton, Nylon, Polyester Belt`, spec verbatim, and asked
  the right questions: `Quantity not specified` + `Confirm material:
  catalogue lists 'nylon-cotton' — confirm pure nylon or blend`. The old silent
  rename is now a surfaced question.
- Price memory: HF 384-dim OK, Pinecone reachable, best score 0.23 ≪ 0.85 →
  `miss` → procurement queue (correct for an unsolved item).
- Test artifact: `/tmp/opencode/test-intake-cycle.js` (throwaway harness running
  the exact committed prompts; re-runnable).

## 6. Known shortfalls (verified against code)

1. **No intake gate** — `missing[]` renders as chips (`IntakeItemMeta`,
   `SpecificationsSection`) but nothing blocks flow; incomplete items still enter
   procurement. The late catch survives.
2. **No unit normalization at write** — only string-level `canon()`; `7"`,
   `178mm`, `7 inch` are different specs and different embedding inputs.
3. **Memory has no vendor, no date** — candidates carry `{finalRate, name, score}`;
   auto-quotes can't say *whose* rate or *how old*.
4. **No vendor-Excel ingestion** — memory learns only from finalized enquiries;
   the ~1000-row multi-vendor sheet has no pipeline in.
5. **No custom-spec routing** — no `notes` key; a free-text qualifier on a
   matching item would auto-quote past it.
6. **`required_attributes` still prose** — interpreted per call, not a typed registry.
7. **Intake latency** — items/`missing[]` land minutes after create (GH dispatch +
   sweep); the row sits empty meanwhile.

## 7. To be built (in order)

### Phase 1 — close the loop
1. **Intake gate**: item with non-empty `missing[]` gets `needs_sales_fix` with the
   exact KYP question attached; excluded from `isProcurementPendingEnquiry`.
   Acceptance: an incomplete item can never appear in the procurement queue.
2. **`catalog` table (D1)** per approval:
   `item_id, spec JSON, vendor_id, price, currency, approved_by, approved_at,
   revalidate_after`. Pinecone stays the fast lookup; D1 the record of
   *whose rate, how old*. Query with `json_extract(spec, '$.size_mm')`; filter
   in JS per `item_id` (rows per item are few).
3. **Staleness rule**: `exact` matches past `revalidate_after` (default 6–12 mo)
   route to procurement for re-check with a visible "revalidate" badge.

### Phase 2 — feed the memory
4. **Vendor Excel ingestion**: one GH Action (SheetJS) with a human-reviewed
   column map once → same memory/catalog format (category namespaces preserved).
   Adds the `vendors` table alongside.
5. **Custom-spec `notes` key**: extracted in Stage B; non-empty → skip `exact`,
   force procurement/management review, stored as separate catalog rows so
   recurring custom orders can still match exactly.

### Phase 3 — harden
6. **Unit normalization at write**: dims → mm, materials → enum at result-apply;
   raw text retained for display. Equality checks replace fuzzy comparison.
7. **Typed `category_attributes` registry** (`attr_key, data_type, unit,
   allowed_values, required`) for top-quoted items first → deterministic
   `missing[]` and prompt generation; review-queue corrections feed aliases.

## 8. Deliberately not building

- `categories` / `items` as DB tables — v2 JSON + Pinecone namespaces cover 136
  static items; tables add nothing until runtime alias editing is needed.
- Separate `enquiry_lines` table — items fit the JSON column (≤50/row); extend
  the existing `Enquiry` model instead.
- Vector DB beyond Pinecone / Cloudflare Vectorize — unnecessary at this scale;
  in-memory + KV prefilter remains sufficient.
- Automating the management margin decision — stays a manual gate by design.
