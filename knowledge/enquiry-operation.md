# Enquiry Operation — Simple Guide

> How an enquiry moves from telecaller to price, what the AI does in between, and how everything is linked. Written for sales / ops, not engineers.

## 1. What is an Enquiry?

A telecaller pastes what the client said on WhatsApp / phone — free text + photos. Example:

> `Shiva Impex - Delhi - Chevron Belt Width 36 inch 4 ply 10mm Length 30 meter`

The system must turn that into **purchasable line items** (Item 1, Item 2…) with correct specs, then get a price.

```
Telecaller types free text
        ↓
Enquiry row (Enquiry No 14 - 21 SEP TL) — D1 table Enquiry
        ↓
Items[] — [{name, qty, spec, verbatim, category, kypItem, kypMissing, kypComplete}]
        ↓
Sales → Procurement → Management → Sent (rateStatus: rate_pending → rates_received → finalized → sent)
```

All three dashboards read the **same** `Enquiry + items[]` row via `GET /api/enquiries` and stay live via `EventHub` (`LiveEvent.Enquiries`).

---

## 2. The Full Chain (Sales → Procurement → Management)

```
Sales (tracker) ──items[]──▶ Procurement (quotes vendor rates[]) ──finalRate──▶ Management (markup → finalRate) ──▶ Sales (mark sent, needs EST No.)
        ▲                                                                                         │
        └──────────── spec fix / variationRequest / rateAvailable (sales bypass) ────────────────┘
```

- **Per-item flags** drive the queues: `rates[]`, `specIssue` (procurement hold), `rateAvailable` (sales bypass), `internalRates` (management self-quote), `variationRequest` (alternate make, no approval).
- **Money:** `₹`/`1,200.50` → `1200.50`; junk amounts are `400` with a message, never silent.
- **Thread:** `EnquiryComment` (`sales`/`procurement` scope) + `item.thread[]` (flag/fix/request/quoted) — copilot reads it, UI shows it.

---

## 3. Why KYP Matters

`founder-os_backend/data/know_your_product_v2.json` is the **single source of truth** — 136 items, 10 categories (Plansifter 26, Conveying 14, Roller Mill 10, Power Transmission 35, Pipe 10, Jet Filter 6, Magnets 9, Wire Mesh 4, Perforated Sheet 11, Misc 11).

Each item has:
- `item_name` (canonical, e.g. `Black Rubber Belt`)
- `aliases` (bazaar + global: `chevron belt`, `Resham ki jali`, `V-patti`, `cleated belt`)
- `required_attributes` (the actual questions: `Ask width`, `Ask plies: 3 ply 8mm / 4 ply 10mm / 5 ply 12mm`, `Ask length open vs endless`, `Ask quantity`)
- `notes` (background only, never a question)

Codegen `scripts/compile-kyp.mjs` → `src/modules/enquiries/kyp-lookup.ts` (slim `category/item/aliases/required_attributes`, no notes) so the Worker bundle stays small (~44KB, not 98KB).

Before KYP, 16/20 recent enquiries were `Uncategorized`. Now new ones are auto-grounded; old ones were backfilled.

---

## 4. AI Processing — 3 Calls, Inside One Enquiry

When an enquiry is created/edited, classification runs on the **GitHub Actions runner** (sole live AI runner; `home-egress/` home tunnel is discarded, GH relay `agnes-relay.yml` + `agnes-relay-bak.yml` remain for Worker-side Agnes). The runner executes the same pipeline as `src/modules/enquiries/vision-intake.ts:68` `runAgnesVisionIntake` (Agnes `agnes-3.0-flash`, `probeTimeoutMs 15s`, fallback `agnes-2.5-flash`). Runner egress is direct; Worker egress goes via the GH relay lanes (see §7):

### Call 1 — Segment (vision+text, NO catalogue)
Prompt: `ROUTER_SYSTEM_AGNES` — pure splitter. Input: `description` + up to 4 images (enquiry `imageUrls` + `item.media`). Output: `[{verbatim, qty, dims, spec, name}, …] + lead {clientCompany, contactName, phone, location}]` — client wording is **never renamed** so the model cannot bend `COTTON PAD → Cotton Cleaner`. `QTY - 1` lines attach upward, `150-30 pcs → dims 150 + qty 30 pcs`.

### Call 2 — Lookup (text-only, per verbatim line)
- **Deterministic first** (`lookupDeterministic`): exact `item_name`/alias hit (`chevron belt → Black Rubber Belt`, `Resham ki jali → Milling Fabric`) — zero tokens.
- **Batched LLM fallback** only for misses: one call with `1. Category: Item[alias,…]; …` (~1.9k tokens), `confidence ≥0.65` else `Uncategorized`. `FALLBACK_MODEL` + `KYP_ITEMS_BY_CAT` validation, never invents.

Fills `kypHits[i] = {category, item}` → `cats[]`/`kypItems[]`.

### Call 2.5 — Spec-Check (what's missing)
For each matched item, take its `required_attributes` (filtered: `If the client is unsure of the grade, request a picture…` is **not** a hard gate) and run one batched LLM `SPEC_CHECK_SYSTEM`: `Item k spec: "verbatim | dims | spec | qty" + Checklist 0. …` → `{"checks":[{"missing":[0,2]}]}`. Deterministic fix for `micron opening / flour` alternative (`micron`/`maida` in haystack → not missing).

Result per item: `kypMissing = missing required_attributes` , `kypComplete = missing.length===0` (`Uncategorized → undefined`).

### What happens next
```ts
Y = lines.map((l,i)=>({name, qty, spec: [dims,spec].join, verbatim, category: cats[i], kypItem, kypMissing, kypComplete}))
priceEligible = kypComplete===true
// HF MiniLM 384-dim embed → Pinecone query topK=5 per category namespace + uncategorized → exact ≥0.97+dimsEqual / suggest ≥0.85 / miss
```
`store.updateEnquiry(id, {items: Y, ...lead})` (`src/modules/enquiries/store.ts:154` `sanitize` preserves `kyp*`) → `cacheSet('enquiry:intake:'+id)` → `broadcastLive` → UI refetches.

**Price gate:** `vision-intake.ts:381` only `kypComplete===true` items get `pineconeQuery`; incomplete stays amber with no `Past price` card until spec is filled. `Uncategorized` also gated.

**Example:** `Chevron Belt 36" 4 ply 10mm 30m` → `Conveying Accessories / Black Rubber Belt` `kypComplete:false` `Ask width ✓, Ask plies 4 ply 10mm ✓, Ask top/bottom cover, Ask length 30m ✓, Ask quantity` — 2 missing, so UI shows table `Missing Detail` and copilot lists the same.

---

## 5. What Telecaller Sees (UI)

`founder-os_frontend/src/components/SpecificationsSection.tsx:457` inside each `items.map`:

- Badge `Conveying Accessories` + `Black Rubber Belt` + `Needs 3 detail(s)` (amber) or `Spec complete ✓` (emerald) / `Uncategorized` (grey)
- Table `Missing Detail — client se poochna hai` (one column, bordered `md-table-wrap` `globals.css:596` `min-width:280px`, scrollable) — `Width required`, `Ply / thickness confirm — 3 ply (8mm)… ya 5 ply (12mm)?`, etc. `Copy questions` + `Fill spec → edit` (appends `kypMissing.join(" | ")` to spec draft).
- `IntakeItemMeta.tsx:17` shows `Past price ₹X (Similar 82%) → Quote this` only when `kypComplete!==false`; otherwise `Complete the spec above to see price`.
- `ChatbaseCopilot.tsx:58` docked + overlay, same thread as `EnquiryChat.tsx`, `enquiryId` only — all context fetched via tools.

---

## 6. What the Sales Helper (Copilot) Knows & Can Do

Backend `src/modules/enquiries/chat.ts:65` `toolDefs` (Agnes-only, `BUSY_REPLY` on 429/1015 storm):

- `get_enquiry_summary` — now projects `items[{index,name,qty,spec,category,kypItem,kypMissing,kypComplete,rates,finalRate}]` + `missing` aggregated from `kypMissing` + `completeness {complete,incomplete,uncategorized}` (`chat.ts:174`), so `What's missing?` matches the amber table.
- `search_price_memory {itemIndex}` — same Pinecone lookup as intake, read-only.
- `read_thread {scope}` — `sales`/`procurement` comments + last 6 `item.thread` entries.
- `propose_comment {text, scope}` / `propose_spec_fix {itemIndex, spec}` — drafts only, telecaller taps `Confirm & apply` (`ChatbaseCopilot.tsx:210` → `POST /api/enquiries/:id/chat/execute` `chat.ts:539` → `enquiryUpdate` with `normalizeItemWrites`).

System prompts `chat.ts:340/459`:
- Sales scope: `Reply in Hinglish (Hindi + English mix, Roman script) — telecaller style… Keep specs/prices in English` + `You are the sales staff helper — you work ON BEHALF of the BUI telecaller… push the enquiry toward price-ready.`
- Procurement never sees client PII/final rates, management sees full detail.

Manual `Edit` / `Fill spec` and copilot `spec_fix` both preserve `kyp*` until the next `vision-intake` (re-intake via `aiPending` or `POST /api/debug/vision-intake/:id`).

---

## 7. Scheduling & Resilience

- **One Cloudflare Cron** `* * * * *` `wrangler.toml` `src/worker/cron.ts:14` routes by `minute%5/10/15/30` + daily `02:30/13:30…` → `dispatchGitHubWorkflow(..., GITHUB_ACCESS_TOKEN)` `workflow_dispatch` (`cron-*.yml` have **no `schedule:`**). Heavy AI (including enquiry classification `ops-enquiry-intake.yml`) runs **only on GitHub Actions runners** `scripts/*-runner.js` (`scripts/ai-gateway.js` JS port, direct Agnes egress). `home-egress/` home tunnel is **discarded**; GH relay `agnes-relay.yml`/`agnes-relay-bak.yml` remain.
- **AI Gateway** `src/shared/ai-gateway.ts` (mirrored `scripts/ai-gateway.js`) — sticky `sessionKey` (consistent-hash), plain-429 cool+rotate `60s→8min`, `1015` cool ≤60s + rotate, `401` disable, `probeTimeoutMs 15s` + `timeoutMs 20s`, fallback `agnes-2.5-flash`. Worker-side Agnes (chat/stream/vision) goes **GH relay lanes** (`AGNES_PROXY_URL=https://egress-gh.apotza.com` + `AGNES_PROXY_URL_BAK`, `agnes-relay` + `agnes-relay-bak` hot-standby `3h` rolling restarts, KV `ai:relay:active[:bak]`); runner (`scripts/ai-gateway.js`) is direct. `AGNES_PROXY_ALWAYS` (old home-egress) is ignored.
- **D1 / Prisma** `src/shared/prisma-d1.ts` hand-rolled shim; after `prisma/schema.prisma` change run `prisma generate` + register in shim; migrations `migrations/NNNN_*.sql` → `wrangler d1 execute --remote`.
- **KV** `src/shared/cache.ts` `cached(key, ttl, compute)` `kvx:` single-flight + `cacheDel`; invalidate via `invalidateDerivedEstimateCaches` etc. when you add a write path.

---

## 8. Deploy & Extend

- Backend: `cd founder-os_backend && node scripts/build-worker.mjs && node scripts/smoke-worker.mjs && npx wrangler deploy`
- Frontend: `cd founder-os_frontend && NODE_ENV=production npm run build --webpack && npx wrangler pages deploy out --project-name founder-os-frontend`
- After editing `know_your_product_v2.json`: `node scripts/compile-kyp.mjs` then rebuild both; markdown now full (`Markdown.tsx` `katex` `$$`/`$`/`\[...\]`/`> quote`/`---`/`| table |`) `globals.css:3` `@import "katex/dist/katex.min.css"`.

That’s it — free text in, grounded `kypMissing` table out, price only when `kypComplete`, helper speaks Hinglish and drafts on your behalf.
