# Notification Batcher

## What it does
Every 15 minutes, flushes grouped alert notifications to WhatsApp. Alerts are added in-process (e.g. by the automation action bus) via `addAlert`; the flush joins them into one message per chat.

## Folder architecture
| File | Role |
|---|---|
| `batcher.ts` | **`NotificationBatcher`** — in-memory buffer + `addAlert()` + `flushAll()` (owned by this automation) |
| `index.ts` | Handler → runs `NotificationBatcher.flushAll()` |
| `rule.json` | Schedule metadata (`*/15 * * * *`) |

## Flow (what happens inside)
1. `addAlert(chatId, text)` buffers alerts per chat.
2. `flushAll()`: for each chat, joins alerts into a numbered summary with a hash-picked heading (per-chat body variance — anti bulk-spam spin-tax).
3. `OutboundService.sendWithJitter(...)` respects the full anti-ban pipeline.
   - Outside business hours → deferred to the morning queue.
   - Failed → re-buffered for the next flush.

## Trigger
`type: handler` · cron `*/15 * * * *`.

## External consumers
- `modules/automation/actions.ts` — the `notify` action calls `NotificationBatcher.addAlert()`.

## Dependencies (platform services in `src/modules/`)
- `modules/whatsapp/outbound` — `sendWithJitter` (anti-ban pipeline)
- `modules/queue/service` — morning-queue deferral
- `shared/logger`

## Data
- In-memory buffer only (no DB rows).

## Config
None.
