# SLA Monitor

## What it does
Every minute, finds inbound messages that breached the 15-minute response SLA, alerts Slack (critical/warning), and auto-resolves messages older than 30 minutes to keep the queue honest.

## Folder architecture
| File | Role |
|---|---|
| `sla-check.ts` | **`SLAChecker`** — full breach-detection logic (owned by this automation) |
| `index.ts` | Handler → runs `SLAChecker.check()` |
| `rule.json` | Schedule metadata (`* * * * *`) |

## Flow (what happens inside)
1. Compute 10-min (warning) and 15-min (deadline) cutoffs.
2. Query unprocessed messages:
   - Older than deadline → **breach**. Increment consecutive counter, `Alerter.alert(..., 'critical')`, audit `SLA_BREACHED`.
   - Between deadline and warning → `Alerter.alert(..., 'warning')`.
3. Messages older than 30 min get auto-marked `processed` with reason `SLA_EXCEEDED`.
4. No breaches → reset consecutive counter.

## Trigger
`type: handler` · cron `* * * * *`.

## Dependencies (platform services in `src/modules/`)
- `modules/monitoring/alerter` — Slack alerting
- `modules/storage/repository` — in-memory DB fallback
- `modules/audit/service` — audit log
- `shared/prisma`, `shared/logger`

## Data
- **Reads:** `Message` (unprocessed, by timestamp).
- **Writes:** flips over-30-min messages to `processed`; writes `AuditLog`.

## Config
None.
