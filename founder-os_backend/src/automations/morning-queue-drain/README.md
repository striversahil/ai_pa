# Morning Queue Drain

## What it does
Every minute, sends WhatsApp messages that were deferred to the morning queue (outside-hours deferrals). Drain-locked and capped at 60 sends/cycle to protect the send budget.

## Folder architecture
| File | Role |
|---|---|
| `index.ts` | Handler → calls the drain |
| `rule.json` | Schedule metadata (`* * * * *`) |

## Flow (what happens inside)
1. Calls `MessageQueueService.drainMorningQueue()`.
2. The queue service drains due entries, respects the 60/cycle cap, and holds a drain lock so two ticks never overlap.

## Trigger
`type: handler` · cron `* * * * *`.

## Why the code lives in `modules/queue`
`MessageQueueService` is **platform infrastructure**: the live send path (`whatsapp-proxy`, message-buffer, batcher, server) uses the same service to enqueue deferrals. The queue stays in `modules/`; this automation owns *when* it runs.

## Dependencies (platform services in `src/modules/`)
- `modules/queue/service` — `MessageQueueService.drainMorningQueue()`
- `modules/whatsapp/outbound` — send pipeline (via the queue service)

## Data
- **Reads:** morning-queue BullMQ queue.
- **Writes:** `OutboundIntent` records for durability.

## Config
None.
