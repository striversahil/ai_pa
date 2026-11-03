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
| `CrmSalesOrder` | one row per `org + soNumber`: Zoho fields, derived `lifecycle`, `sourceState` (`active` / `deleted_source`), per-order delay reason, miss counter |
| `CrmSoItem` | one row per line item — **the unit of scheduling**: tentative dispatch date, dispatch state, delay reason, dispatched qty |
| `CrmScheduleEvent` | append-only audit: `schedule`, `delay`, `reschedule`, `dispatch`, `partial_dispatch`, `source_deleted`, `confirmed_removal` |

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
| unchanged order (per-order fingerprint) | write skipped |
| absent from the scan | `missCount++` → flagged `deleted_source` at 2 |
| re-verified 404 by id | flagged immediately (definitive) |
| flagged order reappears | self-heals to `active` |
| human confirms a deletion | row + items purged, audit event kept |

The floor is bounded to 30 days (`FLOOR_WINDOW_DAYS`, mirrored in the runner) —
Zoho reports 5,000+ open SOs going back years, and the per-order item fetch
(rate limited) could never catch up on the backlog. Line items land ~12
orders/tick and accumulate; older floor orders show "No line items captured
yet" until the fetcher reaches them.

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
`POST /api/crm/orders/:id/{schedule,reschedule,dispatch,confirm-source-deletion}`.

Read = `crm` or `dispatch` scope; writes = `dispatch` (MIS/root always).
Frontend `IMPLIED_SCOPES.dispatch = ["crm"]` so a dispatch holder can open the
floor. Every mutation is auto-broadcast (`data-changed`) — the dashboard refetches
without manual refresh.
