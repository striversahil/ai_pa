# DPP Prices → Dashboard

## What it does
Turns DPP WhatsApp price messages into structured `PriceQuote` rows and serves dashboard KPIs. DPP sends lines like `Brick - 4500`, `Cement: ₹380` — each parsed line becomes a quote.

## Folder architecture
| File | Role |
|---|---|
| `index.ts` | Scanner (fallback catch-up) + `storePrices` custom action + `data` dashboard provider |
| `rule.json` | Declarative trigger / condition / action wiring |

## Flow (what happens inside)
1. **Event path:** an inbound 1:1 WhatsApp message fires `whatsapp.message.inbound`. Condition requires `chatId == config.dppChatId`, so only DPP messages proceed.
2. **Scan path (fallback):** every minute, `scanner()` pulls recent messages from the DPP chat (last 10 min) so nothing is lost if the live event was missed while the backend was down.
3. **`storePrices` action:** splits the body into lines, matches `item — price` (regex `/^(.+?)\s*[-:–]\s*([₹$]?\s*[\d,]+(?:\.\d+)?)$/i`), and upserts a `PriceQuote` per item.
4. **Dedup:** keyed on `wahaMessageId`, so the same message can never be stored twice.

## Trigger
`type: rule` · event `whatsapp.message.inbound` + fallback scan `* * * * *`.

## Dependencies (platform services in `src/modules/` or `src/shared/`)
- `shared/prisma` — `PriceQuote` read/write
- Framework engine (conditions, dedup, cooldown) in `modules/automation/`

## Data
- **Writes:** `PriceQuote` rows (unique `(messageId, itemName)`).
- **Serves:** `GET /api/automations/dpp-prices-dashboard/data` → `{ totalQuotes, distinctItems, latestQuoteAt, lastQuote, items[] }`.

## Config
| Key | Value |
|---|---|
| `dppChatId` | WhatsApp chat ID of the DPP contact — **currently empty; set it to activate** |

## Dashboard
📊 has dashboard → the frontend **Automations** page renders the DPP Price board from the `/data` endpoint.
