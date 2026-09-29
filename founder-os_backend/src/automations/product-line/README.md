# Product Line

Product master dashboard (the KYP sheet as data, not JSON).

- `ProductItem`: identity only (category, name, aliases). No sub-categories,
  no fixed spec columns — every item defines its own checklist.
- `KypGuide`: the ultimate guide table — one row per checklist question per
  product (`attrKey` stable slug, question, guide note, order, required flag,
  optional condition). Intake spec-check, copilot "what's missing", and the UI
  chips all read these rows.
- `Vendor` + `VendorRate`: supplier master + priced quote facts. A rate keys
  off the attribute snapshot (`attrKey`), never the bare item.

Reads: `GET /api/automations/product-line/data` (KV-cached full payload —
dashboard ONLY, pagination pending).
Writes: MIS-only CRUD under `/api/product-line/*` (worker route
`src/worker/routes/product-line.ts`, Express mirror `src/routes/product-line.ts`).

Seeded once from `data/know_your_product_v2.json` (migration 0046).

## Scale path (20K+ rows)

Hot paths NEVER load the full payload (it caps rates at 300 and breaches
KV/CPU limits past ~10K). They use these targeted, per-product cached
queries from `service.ts` instead:

- `getProductIndex()` → slim `{id, category, name, aliases, active}` for
  catalogue matching (`product-line:index:v1`).
- `getProductDetail(id)` → product + guide + **all** its rates, no take-cap
  (`product-line:detail:v1:<id>`).
- `getRatesForProduct(id)` → all rates for one product, vendor names joined
  (`product-line:rates:v1:<id>`).
- `getVendorIndex()` + `countRatesForVendor(id)` → slim vendor list with
  per-hit accurate quote counts.

`update.ts` `touched()` busts the index + per-product rates caches alongside
the monolith/detail keys, so reads stay fresh after every write.

## Matching (`match.ts`)

Pure, framework-free sales matcher over live D1 rows (Worker + Express
share it): `resolveProduct()` (exact name/alias beats category-gated
partial), `scoreRates()` (0.7 spec overlap + 0.2 recency + 0.1 exact hits →
0–1 confidence), `salesSafeQuote()` (vendor fields stripped BEFORE the LLM
sees anything), `applyMarkup()` (flat +25%, same ceil5/rupee-round as
frontend `src/enquiry/pricing.ts` — change both together).

Consumers: sales enquiry chat (`find_price`/`ask_specs`/`quote_price` in
`modules/enquiries/chat.ts`), intake options mining (`intake.ts`
`ask_specs`), knowledge copilot (`copilot.ts`). Reads live tables ONLY —
never the `kyp-lookup.ts` codegen artifact (intake-time lookup only).

Identification tiers (deterministic first, LLM only for misses): exact
id/name/alias → substring either-way → token-overlap (`matchTokens` strips
dims/units/filler + plural-normalizes; containment ≥0.5 with ≥2 shared
tokens; typos and spec-only lines deliberately stay unresolved). Auto-resolve
is strict; `rankProducts()` offers a loose bar for user pick-lists (sales
`find_price` candidates → user picks → `productId` lock-in) — safe because
quoting still needs pick + specs + the confidence gate.
