# Telecalling Enquiry → Forward to DPP

## What it does
Within ~5 minutes of an enquiry landing in the telecalling group, forwards it to DPP on WhatsApp — so sales gets the enquiry immediately instead of waiting for a manual forward.

## Folder architecture
| File | Role |
|---|---|
| `index.ts` | Scanner — fallback catch-up for missed events |
| `rule.json` | Declarative trigger / condition / actions |

## Flow (what happens inside)
1. **Event path:** a new `whatsapp.group.message` event fires with `{ chatId, sender, body, wahaMessageId, timestamp }`.
2. **Condition:** `chatId == config.teleGroupChatId` AND `sender != config.dppChatId` (never forward DPP's own messages back).
3. **Action:** `whatsapp_send` to `config.dppChatId` with a formatted enquiry body (`allowNonAllowlisted: true`, since DPP never messages us first).
4. **Dedup:** on `wahaMessageId` — one forward per message, forever.
5. **Scan path (fallback):** every minute, `scanner()` picks up telecalling-group messages from the last 15 min in case the live event was missed while the backend was down.

## Trigger
`type: rule` · event `whatsapp.group.message` + fallback scan `* * * * *`.

## Dependencies (platform services in `src/modules/`)
- `modules/whatsapp/outbound` — anti-ban send pipeline (via the `whatsapp_send` action)
- `shared/prisma` — message reads for the fallback scanner

## Data
- **Reads:** `Message` (telecalling group, recent).
- **Writes:** `AutomationRun` rows (dedup guard).

## Config
| Key | Value |
|---|---|
| `teleGroupChatId` | Telecalling group chat ID — **currently empty; set it to activate** |
| `dppChatId` | DPP contact chat ID — **currently empty; set it to activate** |
