# crm — Department Control Room + Points System

Department-split, points-driven CRM dashboard. Shows OPEN Zoho Books sales
orders grouped by the next pending process step, with a **DepartmentScoreEvent**
points ledger (mirrors `TelecallerScoreEvent` in telecalling). The Worker never
calls Zoho — the GH Actions runner fetches + computes, the Worker diffs
snapshots to score points, and `data()` serves the cached snapshot + ledger.

Files:

- `index.ts` — `handler()` is a no-op log (triggered via
  `POST /api/trigger/crm` but all work lives in the runner + snapshot route);
  `data()` reads the KV snapshot + aggregates the score ledger for
  `GET /api/automations/crm/data`.
- `rule.json` — handler, `schedule: */15 * * * *`, scope **`zoho`**.

## 1. What it does

Presents a department control room with horizontal tabs
(**Overview | CRM Desk | Accounts | Dispatch | Procurement**):

| Tab | Content |
|-----|---------|
| **Overview** | KPI strip (active SOs, pipeline value, points-today per dept), 4 pipeline stage cards, recent movements feed |
| **CRM Desk** | KPIs (pending confirm, points today/week), CRM leaderboard (7d), orders awaiting confirmation |
| **Accounts** | KPIs, two tables — To Invoice + Awaiting Payment |
| **Dispatch** | KPIs, orders to ship |
| **Procurement** | KPIs (distinct materials, total qty, open orders), materials table |

### Stage → desk ownership

| Step | Meaning | Desk |
|------|---------|------|
| **confirm** | Default: draft / anything open that matches no later stage | CRM Desk |
| **invoice** | `order_status` confirmed/approved but not invoiced | Accounts |
| **ship** | `invoiced_status` invoiced/partial but not shipped | Dispatch |
| **payment** | `shipped_status` shipped/partial but not paid | Accounts (collections) |
| *(excluded)* | `paid_status=paid` or `order_status=closed` or cancelled/void → `complete`, dropped from active pipeline | — |

### Points system (DepartmentScoreEvent ledger)

| Movement | Points | Dept | Actor |
|---|---|---|---|
| New SO created today | +25 | crm | salesperson |
| Left `confirm` stage (order confirmed) | +50 | crm | salesperson |
| (same event) Material allocated | +25 | procurement | — |
| Left `invoice` stage (invoice raised) | +50 | accounts | — |
| Left `ship` stage (shipped) | +50 | dispatch | salesperson |
| Closed as paid (payment received) | +100 | accounts | — |
| Closed cancelled/void | −20 | dept owning the stage it was in | salesperson |

Backward stage jumps score nothing. The Worker diffs each new snapshot against
the previous KV snapshot (so→stage map) and writes ledger rows via
`prisma.departmentScoreEvent.createMany`.

## 2. Trigger

- **Type:** `handler` · **Cron:** `*/5 * * * *` (GH `cron-every-5min.yml`
  → `workflow_dispatch` → runner; worker `/api/trigger/crm` only logs).
  5-min cadence = new sales orders surface (and score +25) within ~5 min of
  creation in Zoho.
- **Condition:** none — runs unconditionally on schedule.
- **Actions:** the snapshot route (`POST /api/runner/crm/snapshot`) writes
  `DepartmentScoreEvent` rows + busts the `crm:data` cache key.

## 3. Source / integration

- **Zoho Books** `/api/v3/salesorders` (`filter_by=Status.All`,
  `per_page=200`, newest first, up to 30 pages, early stop when a page has no
  active orders AND nothing created within 120 days), fetched by GH runner
  `scripts/crm-runner.js` using the same curl credentials as the estimates
  sync (`zoho_sent/sent_estimates.txt`).
- The runner computes `pendingStep()` per order, aggregates
  `{count, value, orders[]}` per step (**orders capped at 400 per stage** via
  `DETAIL_CAP`, closed capped at 400 via `CLOSED_CAP`, materials capped at 300
  via `MATERIALS_CAP**), rounds values to 2 decimals, and POSTs
  `{date (IST), totalActive, totalValue, stages, closed, materials,
  salespeople, meta}` to `/api/runner/crm/snapshot` (KV-cached on the Worker).
- `data()` reads KV `crm:salesorders_snapshot` (45-min TTL) and returns it
  **only when `snapshot.date === today (IST)`** (`{…, fresh:true}`).
  Stale/absent snapshot → empty pipeline + zeroed scores
  (`{totalActive:0, totalValue:0, stages:{}, scores:{…all zero},
  computedAt:null, fresh:false}`) — the dashboard shows a "waiting for first
  snapshot" state, never yesterday's data. The runner refreshes it on the next
  tick.
- `data()` also aggregates the score ledger in parallel: today's points (by
  dept), 7-day points, CRM leaderboard (7d, by actor: points/events/
  created/confirmed), and a recent 50-event feed.

## 4. Config / dedup

None (read-only dashboard + append-only points ledger).

## 5. Runbook / troubleshooting

- Log prefix: `crm-runner:` (GH Actions run logs). Success line:
  `N page(s), M active SOs (₹V) — confirm:a  invoice:b  ship:c  payment:d`.
- Verify: open the CRM dashboard → KPI strip shows active SO counts + value
  with `fresh:true` (check the payload, not just the numbers).
- If empty/zeros with `fresh:false`: the runner hasn't posted today's
  snapshot — check the `cron-every-5min.yml` run for `crm-runner` errors;
  verify `zoho_sent/sent_estimates.txt` cookies are fresh; confirm
  `WORKER_URL`/`SHARED_SECRET` GH secrets. (The Zoho "Sales Orders Today"
  tile refreshes on the same 5-min workflow via `SO_ONLY=1`; the full
  estimates sync still runs every 15 min.)
- **Migration:** `0021_department_score_events.sql` MUST be applied to remote
  D1 before the points ledger works (the snapshot route writes
  `DepartmentScoreEvent` rows; without the table the writes fail best-effort
  and the ledger stays empty).
- Snapshot KV key is `crm:salesorders_snapshot` (45-min TTL, date-gated as
  above — TTL expiry alone doesn't cause zeros, a stale `date` does).
- Data cache key is `crm:data` (60-s TTL, busted on every runner refresh).
- Gotchas: scope is `zoho` (grant zoho to see CRM); per-stage order lists
  truncate at 400 (counts don't); handler endpoint does nothing by design; if
  the Procurement tab is empty, check `meta.withLineItems` — Zoho's list
  response may not include line items (the runner records whether it did).

