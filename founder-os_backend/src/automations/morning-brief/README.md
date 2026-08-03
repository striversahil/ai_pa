# Morning Founder Brief

## What it does
Every morning at 8:00 AM IST, gathers context from all registered engines (WhatsApp digests, unread emails, Zoho, pending tasks) and generates + saves the founder briefing via AI. The generation logic lives **in this folder**.

## Folder architecture
| File | Role |
|---|---|
| `service.ts` | **`generateAndSaveMorningBrief`** — full context-gathering + generation (owned by this automation) |
| `index.ts` | Handler → runs the generation |
| `rule.json` | Schedule metadata (`0 8 * * *`) |

## Flow (what happens inside `service.ts`)
1. Gather briefing context from engines via `EngineRegistry` (`whatsapp`, `email`, `sales_copilot`).
2. Fetch pending/in-progress tasks from `StorageRepository`.
3. `AIService.generateFounderBrief({ meetings, whatsappDigests, unreadEmails, pendingTasks })`.
4. Save the markdown to the founder notes table.

## Trigger
`type: handler` · cron `0 8 * * *` (IST).

## External consumers
- `modules/scheduler/service.ts` — `SchedulerService.generateAndSaveMorningBrief()` wrapper (manual `POST /trigger/briefing`)

## Dependencies (platform services in `src/modules/`)
- `modules/ai/service` — briefing generation
- `modules/storage/repository` — tasks + founder notes
- `shared/engine` — engine registry (context gatherers)

## Data
- **Reads:** tasks, engine contexts.
- **Writes:** founder note (briefing markdown).

## Config
None.
