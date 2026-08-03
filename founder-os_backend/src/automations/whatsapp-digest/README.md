# WhatsApp Digest

## What it does
Every 5 minutes, batches unprocessed WhatsApp messages by chat, summarizes each chat with AI (incremental when a digest already exists), extracts action items into tasks, and marks messages processed. The processing logic lives **in this folder**.

## Folder architecture
| File | Role |
|---|---|
| `process.ts` | **`processMessagesToDigests`** — the full digest batch job (owned by this automation) |
| `index.ts` | Handler → runs the job |
| `rule.json` | Schedule metadata (`*/5 * * * *`) |

## Flow (what happens inside `process.ts`)
1. Fetch all unprocessed messages; exit early if none.
2. Group by chat.
3. Per chat:
   - Existing digest? → `incrementalSummarizeConversation`; else `summarizeConversation`.
   - Save the digest record.
   - Create tasks from `action_items`.
   - Mark the chat's messages processed.
4. Per-chat failures are isolated (logged, loop continues).

## Trigger
`type: handler` · cron `*/5 * * * *`.

## External consumers (import from this folder)
- `server.ts` & `routes/triggers.ts` — manual `POST /trigger/digest`
- `routes/digests.ts` — lazy-processing fallback when no digests exist
- `modules/whatsapp/engine.ts` — `runSync` for the WhatsApp engine

## Dependencies (platform services in `src/modules/`)
- `modules/whatsapp/service` — fetch unprocessed / mark processed
- `modules/ai/service` — conversation summarization
- `modules/storage/repository` — digest read/write
- `modules/tasks/service` — task creation
- `shared/logger`

## Data
- **Reads:** `Message` (unprocessed).
- **Writes:** `Digest`, `Task`, flips `Message.processed = true`.

## Config
None.
