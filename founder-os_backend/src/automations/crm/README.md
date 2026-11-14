# crm — Dispatch Floor

Sales orders synced from **Zoho Books into D1 rows**, scheduled and dispatched
by the dispatch desk. Zoho stays **read-only** — nothing here writes back.

The old department control room (Overview / CRM Desk / Accounts / Dispatch /
Procurement tabs over a KV snapshot) is retired. Scheduling needs per-item
state and an audit trail, and a KV blob can only be diffed wholesale.

Files:

- `index.ts` — `handler()` is a no-op log (`POST /api/trigger/crm`; the real
  work is `scripts/crm-runner.js` + the floor sync route). `data()` serves the
  floor straight from D1 via `modules/crm/store` (legacy automation-registry
  surface).
- `rule.json` — handler, `schedule: */15 * * * *`, scope **`crm`**.

## Data model (migration 0097)

| Table | Role |
|---|---|
| `CrmSalesOrder` | one row per `org + soNumber`: Zoho fields, client **billing/shipping address** (floor-editable — an edit sets a marker and the sync leaves that address alone), **payment terms** (extracted Payment line from Zoho's free-text `terms`), the **EST no.** (`referenceNumber`), derived `lifecycle`, `sourceState` (`active` / `deleted_source`), per-order delay reason, miss counter |
| `CrmSoItem` | one row per line item — **the unit of scheduling**: tentative dispatch date, dispatch state, delay reason, dispatched qty, plus the amendment overlay (`amendedQty`, `removedAt/By`, `isLocalAdded` for floor-added lines) |
| `CrmScheduleEvent` | append-only audit: `schedule`, `delay`, `reschedule`, `dispatch`, `partial_dispatch`, `source_deleted`, `confirmed_removal`, `address_updated`, `item_amended`, `item_removed`, `item_added`, `order_cancelled_local`, `order_reopened_local` |
| `CrmDispatchProof` (migration 0105; photos 0106; batch items 0107; receipts + packing list 0108) | one row per dispatch action: the fresh invoice PDF ID + optional before/after packing photo IDs + transport receipt / courier receipt / packing list IDs + batch items JSON. UNIQUE per file so a repeat partial must upload a new invoice |

## Amendments + full-SO cancel (migration 0114, floor overlay)

The client confirms a different count, drops a line, adds one, or calls the
whole SO off. The floor records it as a **local overlay** — never a Zoho
write-back:

| Change | Storage | Queue effect |
|---|---|---|
| qty change | `CrmSoItem.amendedQty` (NULL = follow Zoho) | floor works against the amended qty (dispatch caps, remaining) |
| line removal | `removedAt/By` (row stays, struck-through in the panel) | out of every queue, lifecycle, overdue and dispatch validation |
| added line | `isLocalAdded` row (`local:*` key) | behaves like a normal undated line |
| full-SO cancel | `localCancelledAt/By/Reason` + lifecycle parked at `cancelled` | out of every working queue; all floor actions locked; MIS reverses with `POST …/reopen` |

`PUT /api/crm/orders/:id/items` (qtyChanges + removals + additions, one
client-confirmation note for the batch, every line audit-logged as
`item_amended` / `item_removed` / `item_added`),
`POST /api/crm/orders/:id/cancel-local` (`order_cancelled_local`) and
`POST /api/crm/orders/:id/reopen` (MIS-only, `order_reopened_local`) — all
three behind the same `dispatch`-scope floor gate as the other writes
(reopen additionally requires MIS).

The sync never clobbers the overlay: an amended qty survives every tick (the
rate still refreshes and re-prices the line), a removed line keeps its flag,
floor-added `local:*` lines are ignored, and a floor cancel keeps its
parked lifecycle until MIS reopens it. Removing an already-dispatched line
or amending below the dispatched quantity is rejected on both sides
(`scripts/guards/crm-lifecycle.test.mjs`).

## Lifecycle (derived from items, never set by hand)

```
unscheduled → partially_scheduled → scheduled → partially_dispatched → dispatched
                     ↘ reschedule (mandatory reason) when a committed date slips
cancelled   ← Zoho said cancelled/void (out of the queues, kept for audit)
```

- A **new** order lands `unscheduled` (red) — nothing ships until it is dated.
- Scheduling some items → `partially_scheduled`; every item dated → `scheduled`.
- An item whose committed date passed and is still undispatched is **overdue**;
  the floor forces the reschedule dialog (comprehensive reason) before moving on.
- Dispatching some items → `partially_dispatched`; all → `dispatched`.
- **Proof gate (2026-11-04, extras 2026-11-05):** every dispatch burns a FRESH
  invoice PDF. Five optional extras ride along when the floor has them:
  before/after packing photos (`packing_before` / `packing_after`, photos only)
  and the transport receipt / courier receipt / packing list
  (`transport_receipt` / `courier_receipt` / `packing_list`, photo **or** PDF).
  All six are `SoAttachment` rows the dispatch floor may upload itself;
  LR/POD/other stay MIS-only. A missing or already-used invoice fails the whole
  dispatch; a repeat partial needs a new invoice.
- **Photos afterwards (2026-11-05):** the floor may dispatch invoice-only and
  attach the packing photos later from the same panel
  (`POST /api/crm/orders/:id/proofs/:proofId/photos`, first-write-wins per
  slot, same consumed-file rules). A missing photo shows as Pending inside the
  proof card. Files serve inline by default, `?download=1` forces a download.
- **Proof files in the panel:** consumed proofs carry resolved file metadata
  (`files.*` — fileName/mime/size/url) so the card draws a thumbnail per slot
  and opens images in the shared Lightbox and PDFs in the fullscreen PdfViewer,
  with an explicit download on both.

**Tab membership is per item, not per lifecycle bucket.** One order with a
dispatched item, a dated item and an undated item is genuinely open in all
three states, so it appears under **Dispatched**, **Scheduled** AND **To Schedule**.
Filtering by the derived lifecycle hid exactly the leftover work (a
`partially_dispatched` order with undated items never showed up under Schedule).
An order whose items have not been captured yet counts as unscheduled — nothing
ships before it is dated. `cancelled` is out of every working tab. Every tab
reads newest-first (created date desc, then SO number desc).

Rules live once per side and are asserted equal by
`scripts/guards/crm-lifecycle.test.mjs`:
backend `modules/crm/scheduling.ts` ↔ frontend `src/crm/lifecycle.ts`
(queue predicates: `modules/crm/queues.ts` ↔ `src/crm/queue.ts`).

## Sync (runner → D1)

`scripts/crm-runner.js` pages Zoho and POSTs
`/api/runner/crm/orders/sync` (Bearer `SHARED_SECRET`):

| Situation | Result |
|---|---|
| new OPEN order inside `FLOOR_WINDOW_DAYS` | inserted at `unscheduled` |
| existing order | Zoho fields refreshed; **local scheduling never clobbered** |
| brand-new COMPLETE order | skipped (it was never on the floor) |
| line item "Packaging & Forwarding" | dropped — a standing charge, never dated or shipped |
| unchanged order (per-order fingerprint) | write skipped |
| absent from the scan | `missCount++` → flagged `deleted_source` at 2 |
| re-verified 404 by id | flagged immediately (definitive) |
| flagged order reappears | self-heals to `active` |
| human confirms a deletion | row + items purged, audit event kept |

The floor is bounded to 30 days (`FLOOR_WINDOW_DAYS`, mirrored in the runner) —
Zoho reports 5,000+ open SOs going back years, and the per-order item fetch
(rate limited) could never catch up on the backlog. Line items and the client
addresses both come from the SAME per-order detail call, so they land together
on a per-tick budget (80 orders, ~2s apart) and accumulate newest-first; a floor
order shows "No line items captured yet" until the fetcher reaches it (a 30-day
cold start clears in ~2 ticks).

One-off historical backfill (2026-11-13): `CRM_BACKFILL_FROM=2026-01-01 node
scripts/crm-runner.js` (or the manual `CRM backfill 2026` workflow, same
serial-Zoho concurrency group as the 15-min cron) pages Zoho until
`created_time` passes the floor and POSTs ~40-order chunks with
`{ backfill:true }`. The Worker then bypasses the 30-day cutoff, skips
miss/score/mirror writes, and inserts `completeHistory` lines as fully
dispatched; `pending_so.json` keys import open for the qty-aware pending split
applied afterwards. Resumable — tracked orders with items are skipped.

## Read cache (2026-11-14)

`listOrders` + `dispatchSummary` serve from ONE cached raw floor scan
(`modules/crm/store-parts/cache.ts`, KV-backed `cached()` with a 60s TTL):
the D1 cost is paid once per TTL across all views/regions/searches, and each
request filters the snapshot in memory. Every floor write funnels through
`mirrorOrderTouch` and every runner tick through `syncOrders`, and both call
`invalidateCrmFloorCache()` — so the TTL only bounds cross-isolate lag.
The source-deleted view keeps its dedicated query (tombstoned rows live
outside the cached window). The Phase 4a shadow compare runs once per sync
tick, never per dashboard read.

## Points (DepartmentScoreEvent)

Scored inside `syncOrders()` from **status moves since the last tick** — the
same rules the retired KV snapshot diff used:

| Movement | Credit |
|---|---|
| new SO created today | CRM +25 |
| left confirm | CRM +50, Procurement +25 (material allocated) |
| left invoice | Accounts +50 |
| left ship | Dispatch +50 — **suppressed** if the floor already scored it |
| closed paid | Accounts +100 (all remaining stages implied) |
| cancelled / void | −20 to the desk holding the order |

The dispatch floor credits **+50 full / +25 partial once per SO** when the desk
marks items dispatched; `hasDispatchCredit()` matches both the bare `soNumber`
(local credit) and the org-scoped `org:so` (Zoho credit), so one shipment can
never score twice.

## API

`GET /api/crm/orders?view=&q=` · `GET /api/crm/summary` ·
`GET /api/crm/orders/:id` (with audit trail) ·
`POST /api/crm/orders/:id/{schedule,reschedule,dispatch,confirm-source-deletion}` ·
`PUT /api/crm/orders/:id/{addresses,items}` ·
`POST /api/crm/orders/:id/{cancel-local,reopen}`.

Read = `crm` or `dispatch` scope; writes = `dispatch` (MIS/root always).
Frontend `IMPLIED_SCOPES.dispatch = ["crm"]` so a dispatch holder can open the
floor. Every mutation is auto-broadcast (`data-changed`) — the dashboard refetches
without manual refresh.
