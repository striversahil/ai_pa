# Stock

Manual SKU inventory — the store's stock book as a first-class dashboard.

Reads: `GET /api/automations/stock/data?days=7` — one KV-cached payload
(`stock:data:v1:<days>`, 5 min TTL): SKU, product name, unit, on-hand qty,
reorder level, status (`out|low|ok`) + day-wise closing map
(`closings[itemId][YYYY-MM-DD]`).

Writes (worker route `src/worker/routes/stock.ts` — Express is frozen):
`POST /api/stock/items`, `PATCH /api/stock/items/:id`,
`POST /api/stock/movements`, `POST /api/stock/backfill` (MIS-only, `stock` scope).
Every write busts the cache and broadcasts the typed `stock` live event
(auto-live covers rest).

Planning fields per SKU (`avgDailyConsumption`, `maxLevel` = reorderLevel,
`leadTimeDays`, `safetyFactor`, `moq`) come from the SEFAR backfill
(`scripts/build-stock-backfill.mjs` ← repo-root `stock_update.json` → deterministic
seed SQL `scripts/stock-backfill.seed.sql`, SKUs `BOL-0001…`). `pendingToOrder`
is computed live as MOQ-rounded fill-to-max — never stored, never posted as
movements, so on-hand stays purely derived.

Closing stock is derived (sum of movements ≤ day), never stored.
