# Evening EOD Summary

## What it does
Every evening at 7:00 PM IST, gathers end-of-day context from all registered engines and generates + saves the daily EOD summary via AI. The generation logic lives **in this folder**.

## Folder architecture
| File | Role |
|---|---|
| `service.ts` | **`generateAndSaveEveningSummary`** — full context-gathering + generation (owned by this automation) |
| `index.ts` | Handler → runs the generation |
| `rule.json` | Schedule metadata (`0 19 * * *`) |

## Flow (what happens inside `service.ts`)
1. Gather EOD context from engines (`whatsapp`, `email`, `sales_copilot`).
2. Count unprocessed messages + digests; compute simulated activity count.
3. Fetch tasks created today (IST day boundary via `kolkataDayStartUtc`) + pending approvals.
4. `AIService.generateDailySummary({ messagesCount, importantConversations, tasksCreated, pendingApprovals })`.
5. Save the markdown to the founder notes table.

## Trigger
`type: handler` · cron `0 19 * * *` (IST).

## External consumers
- `modules/scheduler/service.ts` — `SchedulerService.generateAndSaveEveningSummary()` wrapper (manual `POST /trigger/summary`)

## Dependencies (platform services in `src/modules/`)
- `modules/ai/service` — EOD generation
- `modules/storage/repository` — messages, digests, tasks, founder notes
- `shared/engine` — engine registry
- `shared/ist-time` — IST day boundary

## Data
- **Reads:** messages, digests, tasks, engine contexts.
- **Writes:** founder note (EOD markdown).

## Config
None.
