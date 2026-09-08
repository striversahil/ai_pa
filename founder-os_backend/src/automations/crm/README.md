# crm — Active Sales Orders pipeline

Copy of `_template`. Shows open Zoho Books sales orders grouped by the next
pending process step.

## 1. What it does

Presents a pipeline dashboard of all OPEN sales orders from Zoho Books, grouped by
the action that needs to happen next:

| Step | Meaning |
|------|--------|
| **Confirm** | Draft order — needs confirmation |
| **Invoice** | Confirmed — needs to be invoiced |
| **Ship** | Invoiced — needs shipping |
| **Payment** | Shipped/delivered — awaiting payment |

Fully paid/closed/cancelled orders are excluded from the active pipeline.

## 2. Trigger
- **Type:** `schedule`
- **Cron:** `*/15 * * * *` (every 15 minutes, via GH Actions)

## 3. Condition
None — runs unconditionally on schedule.

## 4. Actions
None — this is a read-only dashboard automation.

## 5. Source / integration
- **Zoho Books** `/api/v3/salesorders` (Status.All), fetched by the GH Actions
  runner `scripts/crm-runner.js` using the same curl credentials as the
  estimates sync (`zoho_sent/sent_estimates.txt`).
- The runner computes each order's pending step and POSTs the grouped snapshot
  to `/api/runner/crm/snapshot` (KV-cached on the Worker).
- The dashboard `data()` reads that KV snapshot — the Worker never calls Zoho.

## 6. Config
None.

## 7. Dedup
N/A — read-only dashboard.

## 8. Runbook / troubleshooting
- Log prefix: `crm-runner:` (in GH Actions run logs).
- Verify: open the CRM dashboard → KPI strip shows active SO counts + value.
- If empty/stale: check the GH Actions `cron-every-15min.yml` run for
  `crm-runner` errors; verify `zoho_sent/sent_estimates.txt` cookies are fresh.
- The snapshot KV key is `crm:salesorders_snapshot` (45-min TTL).
