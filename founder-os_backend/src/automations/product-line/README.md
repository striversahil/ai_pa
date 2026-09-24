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

Reads: `GET /api/automations/product-line/data` (KV-cached full payload).
Writes: MIS-only CRUD under `/api/product-line/*` (worker route
`src/worker/routes/product-line.ts`, Express mirror `src/routes/product-line.ts`).

Seeded once from `data/know_your_product_v2.json` (migration 0046).
