# crm — Active Sales Orders pipeline

Read-only dashboard automation. Shows OPEN Zoho Books sales orders grouped
by the next pending process step. The Worker never calls Zoho — the GH
Actions runner fetches + computes, the Worker's `data()` serves the cached
snapshot.

Files:

- `index.ts` — `handler()` is a no-op log (triggered via
  `POST /api/trigger/crm` but all work lives in the runner); `data()` reads
  the KV snapshot for `GET /api/automations/crm/data`.
- `rule.json` — handler, `schedule: */15 * * * *`, scope **`zoho`**
  (not `crm` — the CRM view is gated by the zoho permission category).

## 1. What it does

Presents a pipeline of all OPEN sales orders grouped by next action:

| Step | Meaning (exact rule in `pendingStep()`) |
|------|------------------------------------------|
| **confirm** | Default: draft / anything open that matches no later stage |
| **invoice** | `order_status` confirmed/approved (or any `invoiced_status` set) but not invoiced |
| **ship** | `invoiced_status` invoiced/partial but not shipped |
| **payment** | `shipped_status` shipped/partial but not paid |
| *(excluded)* | `paid_status=paid` or `order_status=closed` or `status` cancelled/void → `complete`, dropped from the active pipeline |

Precedence matters: paid/closed is checked first, then shipped, then
invoiced, then confirmed — an order matching multiple stages lands in the
latest one. Fully paid/closed/cancelled/void orders never appear.

## 2. Trigger

- **Type:** `handler` · **Cron:** `*/15 * * * *` (GH `cron-every-15min.yml`
  → `workflow_dispatch` → runner; worker `/api/trigger/crm` only logs).
- **Condition:** none — runs unconditionally on schedule.
- **Actions:** none — read-only; no writes, no dedup, no config.

## 3. Source / integration

- **Zoho Books** `/api/v3/salesorders` (`filter_by=Status.All`,
  `per_page=200`, newest first, up to 20 pages, stop on short/empty page),
  fetched by GH runner `scripts/crm-runner.js` using the same curl
  credentials as the estimates sync (`zoho_sent/sent_estimates.txt`).
  Note: the CRM parser only handles single-quoted curl (`'…'`) — unlike
  the zoho runner it has no double-quote fallback, so a re-exported curl
  file in `"…"` format will fail with "Could not extract URL".
- The runner computes `pendingStep()` per order, aggregates
  `{count, value, orders[]}` per step (**orders capped at 100 per step** —
  the dashboard never sees beyond the first 100; counts/values are complete),
  rounds values to 2 decimals, and POSTs
  `{date (IST), totalActive, totalValue, byProcess}` to
  `/api/runner/crm/snapshot` (KV-cached on the Worker).
- `data()` reads KV `crm:salesorders_snapshot` (45-min TTL) and returns it
  **only when `snapshot.date === today (IST)`** (`{…, fresh:true}`).
  Stale/absent snapshot → empty pipeline
  (`{totalActive:0, totalValue:0, byProcess:{}, computedAt:null, fresh:false}`)
  — the dashboard shows zeros, never yesterday's data. The runner refreshes
  it on the next tick.

## 4. Config / dedup

None (read-only dashboard).

## 5. Runbook / troubleshooting

- Log prefix: `crm-runner:` (GH Actions run logs). Success line:
  `N page(s), M active SOs (₹V) — confirm:a  invoice:b …`.
- Verify: open the CRM dashboard → KPI strip shows active SO counts + value
  with `fresh:true` (check the payload, not just the numbers).
- If empty/zeros with `fresh:false`: the runner hasn't posted today's
  snapshot — check the `cron-every-15min.yml` run for `crm-runner` errors;
  verify `zoho_sent/sent_estimates.txt` cookies are fresh; confirm
  `WORKER_URL`/`SHARED_SECRET` GH secrets.
- Snapshot KV key is `crm:salesorders_snapshot` (45-min TTL, date-gated as
  above — TTL expiry alone doesn't cause zeros, a stale `date` does).
- Gotchas: scope is `zoho` (grant zoho to see CRM); per-step order lists
  truncate at 100 (counts don't); handler endpoint does nothing by design.
