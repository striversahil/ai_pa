# Product Line

Vendor-quote catalogue built from the founder-authored KYP schema.

> **Schema v2 is the sole truth (2026-11-23).**
> `resources/json/kyp/bui_milling_vendor_kyp_schema_v2.json` defines products
> (103), categories (11), aliases (394), the per-product spec contract and the
> prose ask prompts. Products and the spec-ask are GENERATED from it:
>
> ```
> node scripts/gen-kyp-catalog.mjs          # resources/json/kyp/*.json →
>                                           #   src/automations/product-line/kyp-catalog.ts
>                                           #   migrations/0156_kyp_catalog_v2_seed.sql
> node scripts/gen-kyp-catalog.mjs --check  # what the kyp-schema guard runs
> ```
>
> Never hand-edit those two outputs, and never hand-type a product. Guard
> `scripts/guards/kyp-schema.test.mjs` fails on drift and asserts the JSON's own
> invariants (one `allOf` branch per definition, category bound, aliases present,
> `specs.$ref` self-targeting, required ⊆ props, rules target real keys).

> **Data wipe 2026-11-22 (founder decision).** `ProductItem` (products),
> `KypGuide` (the spec-ask checklist) and `VendorRate` (vendor quotes) were all
> deleted (migration `0154`), together with the Product Line AI agents
> (knowledge copilot + "Add vendor rates" intake) and their photos. The
> `Vendor` master was kept. `0156` then seeded the v2 catalogue. Seed `0046`
> re-populates a fresh DB with the OLD 136-item list, so re-run `0154` + `0155`
> + `0156` there.

## Tables

- `ProductItem` — one row per schema product: `id = pi_<product_key>`,
  `name` = derived label ("Milling Fabric"), `category` from the schema branch
  (`transmission_belt` seeds under `conveying_accessories`, founder call),
  `aliases` = the schema's discovery words (Indian mandi + Western OEM names).
- `KypGuide` — one row per (product, spec key): `attrKey` is the schema key
  (`width_mm`), `question` its derived label ("Width (mm)"), `isRequired` from
  the definition's `required`, `condition` the flattened `if/then` bounds
  (`[{whenKey, whenValue, key, min, max}]`), `sortOrder` the property order.
- `Vendor` — supplier master (name, contacts, location, type, year). Brand is
  NOT a vendor: `brand` lives in the quote's spec document.
- `VendorRate` — **vendor quote, never a selling price.** `pricePerUnit` =
  vendor price before discount, `discountPercent` separate, `baseRate` =
  stored derived net (`price × (1 − d/100)`). Customer price is computed at
  read in `match.ts` (`effectivePrice` → `applyMarkup`, +25%): changing markup
  never rewrites stored rates.

## Specs: one JSON column + a typed query index

`VendorRate.attrValues` holds the schema `specs` object as JSON — the single
source of truth for a quote's specs. `brand`, and `material` /
`machine_make_model` on products whose branch does not declare them, live
INSIDE it (`EXTRA_SPEC_KEYS` in `kyp-schema.ts` is the allowlist that keeps
that legal against `additionalProperties: false`).

Fast, flexible spec queries ride `VendorRateSpec` (migration `0155`): one typed
row per (quote, spec key) with `valueText` + `valueNum`, indexed on
`(attrKey, valueNum)` and `(attrKey, valueText)`, written in the same D1 batch
as the quote (`spec-index.ts`). Any key is queryable without one index per key
(366 keys × 103 products would be absurd):

```sql
-- brand = PIX, width ≥ 1000
SELECT rateId FROM VendorRateSpec
WHERE (attrKey = 'brand' AND valueText = 'PIX')
   OR (attrKey = 'width_mm' AND valueNum >= 1000)
GROUP BY rateId HAVING COUNT(DISTINCT attrKey) = 2;
```

HTTP: `GET /api/product-line/rates?spec=brand:PIX&spec=width_mm:>=1000&spec=material:in:ss,gi`
(`eq`, `in:`, `>=`, `<=`, `a..b`; repeatable, all filters must match).

## Editing the catalogue (dashboard, 2026-11-23)

Everything the export contains is editable in the UI, and D1 is the working copy:

| Layer | Where | Notes |
|---|---|---|
| product name / category / aliases | `ProductEditor` | category rename = bulk update on every product using it |
| spec label / type / enum / min / max / required / order / add / remove | `SpecsEditor` | `attrKey` immutable; delete blocked while quotes answer the spec (error carries the count) |
| KYP JSON | `GET /api/product-line/schema.json` | `schema-export.ts` rebuilds v2 from D1, downloads as a file |

`catalog-live.ts` turns those rows into the same contract as the compiled seed (cached in
`product-line:catalog:v1`, busted by every write) and `rate-specs.ts` typechecks quote writes against it —
so an edit changes validation immediately. Guards: `scripts/guards/kyp-schema.test.mjs` (generator parity,
spec typechecker, export round-trip, filter vocabulary).

## Rate intake: prompt -> chat model -> paste (2026-11-23)

`prompt.ts` keeps an editable prompt (Setting `product-line:rate-prompt`); its
`{{ACTIVE_VENDORS}}` placeholder becomes "name — city" for active vendors. The model answers with:

```
{ "create_vendors": false,
  "rates": [ { "product_key": "milling_fabric", "vendor": "…", "unit": "meter",
               "price_per_unit": 120, "discount_percent": 10, "moq": "100 m",
               "delivery_days": 5, "delivery_max_days": 7, "quoted_at": "2026-11-20",
               "specs": { "grade": "GG", "grade_number": 40 } } ] }
```

`rate-import.ts` (pure parsing in `rate-import-parse.ts`) resolves the product by key/name/alias, the
vendor by name (creating it only when the payload asks), then calls `createRate` — the same typechecker,
`missingSpecs` recompute and spec-index write as the drawer. Rows fail independently.

## Batches: one paste = one undoable unit (2026-11-23)

`rate-batch.ts` owns the trace: `createBatch` (source, actor, label, row count) → quotes written with
`VendorRate.batchId` → `finishBatch` (created/failed counts, vendor names, failures). `listBatches` joins a
live count, `deleteBatch` removes exactly those quotes (+ spec-index rows) and keeps the row as `deleted`.

`rate-import.ts` is two-phase: `previewImport` resolves + typechecks without writing and names the vendors
that would be created (the review step), then `importRates` lands it under one batch using the operator's
`vendors: [{ name, action: create|map|skip, …fields }]`. A vendor is created only from an explicit `create`
decision — `is_new_vendor` from the agent is a candidate flag, never an instruction.

## Typecheck on write

`rate-specs.ts` runs `validateSpecs` (type, enum, min/max/exclusiveMinimum,
required, if-then) on every quote write before the D1 write: a schema violation
is a 400, and a required value that is simply unknown stays EMPTY and is
recorded in `missingSpecs` (founder call — never invent a number).
`validateEnvelope` does the same for the non-spec columns (unit enum, integer
MOQ, positive price, 0–100 discount, lead-time range).

## Reads / writes

Reads: `GET /api/automations/product-line/data` (KV-cached payload —
products, guide, vendors and COUNTED totals: `rateTotal`, per-product
`rateCount` + `bestPrice`, per-vendor `rateCount`, all GROUP BY over the
whole table). Rates are NOT in it (2026-11-21, founder paging standard):
`GET /api/product-line/rates?page=&limit=&q=&productId=&vendorId=&status=&spec=`
pages them 50 at a time with whole-table search
(`service-parts/rates-page.ts` on `shared/paging.ts`; index migration 0150).
`GET /api/product-line/products/:id` returns `getProductSummary` (identity +
guide + counts) — the detail screen pages its quotes through the same rates
endpoint with `productId`.
Writes: products / guide / vendors are root-only; quote rows need the
`product-line` scope (or root) under `/api/product-line/*` (worker route
`src/worker/routes/product-line.ts`).

## Scale path (20K+ rows)

Hot paths NEVER read the dashboard payload. They use these targeted,
per-product cached queries from `service.ts` instead:

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
partial), `scoreRates()` (spec overlap ONLY → 0–1 confidence; recency and
exact hits are reported but carry no weight), `salesSafeQuote()` (vendor fields stripped BEFORE the LLM
sees anything), `applyMarkup()` (flat +25%, same ceil5/rupee-round as
frontend `src/enquiry/pricing.ts` — change both together).

Consumers: sales enquiry chat (`find_price`/`ask_specs`/`quote_price` in
`modules/enquiries/chat.ts`), and vision-intake Call-2
(`modules/enquiries/vision-intake.ts` — deterministic tiers + token tier +
LLM-answer resolve-back, all over the live index). Reads live tables ONLY —
single source of truth, no static catalogue copy anywhere. The catalogue index
is now the schema-seeded `ProductItem` rows, so `aliases` are the schema's own
discovery words.

Identification tiers (deterministic first, LLM only for misses): exact
id/name/alias → substring either-way → token-overlap (`matchTokens` strips
dims/units/filler + plural-normalizes; containment ≥0.5 with ≥2 shared
tokens; typos and spec-only lines deliberately stay unresolved). Auto-resolve
is strict; `rankProducts()` offers a loose bar for user pick-lists (sales
`find_price` candidates → user picks → `productId` lock-in) — safe because
quoting still needs pick + specs + the confidence gate.
