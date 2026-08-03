# Outbound Intent Recovery

## What it does
Every minute, replays outbound messages whose send was interrupted while Redis was down. Outbound sends are durably persisted as `OutboundIntent` rows; this automation re-deferrals them once Redis/queue is back.

## Folder architecture
| File | Role |
|---|---|
| `index.ts` | Handler → calls the recovery |
| `rule.json` | Schedule metadata (`* * * * *`) |

## Flow (what happens inside)
1. Calls `MessageQueueService.recoverOutboundIntents()`.
2. Finds persisted intents that never landed in the queue and re-enqueues them.

## Trigger
`type: handler` · cron `* * * * *`.

## Why the code lives in `modules/queue`
`MessageQueueService` is **platform infrastructure** (also used by the live send path). This automation owns *when* recovery runs.

## Dependencies (platform services in `src/modules/`)
- `modules/queue/service` — `MessageQueueService.recoverOutboundIntents()`
- `shared/prisma` — `OutboundIntent` rows

## Data
- **Reads:** `OutboundIntent` (pending).
- **Writes:** re-enqueues onto the queue.

## Config
None.
