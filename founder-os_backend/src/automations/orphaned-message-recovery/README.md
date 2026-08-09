# Orphaned Message Recovery

## What it does
Every 2 minutes, re-enqueues messages that were saved to the DB but never classified (e.g. the classification worker died mid-batch). Guarantees every inbound message eventually gets classified/digested.

## Folder architecture
| File | Role |
|---|---|
| `index.ts` | Handler → calls the recovery |
| `rule.json` | Schedule metadata (`*/2 * * * *`) |

## Flow (what happens inside)
1. Calls `MessageQueueService.recoverOrphanedMessages()`.
2. Finds `Message` rows without a matching classification-queue job and re-enqueues them.

## Trigger
`type: handler` · cron `*/2 * * * *`.

## Why the code lives in `modules/queue`
`MessageQueueService` is **platform infrastructure** (also used by the live ingest path). This automation owns *when* recovery runs.

## Dependencies (platform services in `src/modules/`)
- `modules/queue/service` — `MessageQueueService.recoverOrphanedMessages()`
- `shared/prisma` — `Message` rows

## Data
- **Reads:** `Message` (unprocessed, not queued).
- **Writes:** re-enqueues onto the classification queue.

## Config
None.
