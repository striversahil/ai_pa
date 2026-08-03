# Zoho Sent Analyzer

## What it does
Every 15 minutes, incrementally syncs Zoho CRM estimates and AI-classifies the sent ones. The full analyzer lives **in this folder** — nothing about the analyzer is left in `modules/`. The frontend Zoho Estimates board is this automation's dashboard.

## Folder architecture
| File | Role |
|---|---|
| `service.ts` | **`SalesCopilotService`** — the complete analyzer (644 lines): Zoho API sync, comment cleaning, intent classification via AI, closed-status handling, brief/EOD context |
| `index.ts` | Handler (`runSync`) + `data` dashboard provider (KPI summary) |
| `rule.json` | Schedule metadata (`*/15 * * * *`) |

## Flow (what happens inside `service.ts`)
1. Load Zoho auth from the parsed cURL file in env.
2. **Incremental sync:** fetch only estimates changed since `lastSyncTime`; always refresh comments. Catch-up happens on the first tick after downtime.
3. Clean HTML in comments; keep only real sales comments.
4. AI-classify (intent score, follow-up gaps, deadlines) → store `Classification`.
5. Refresh closed/accepted/declined statuses.
6. `runSync` refuses to overlap itself (`isSyncRunning` guard).

## Trigger
`type: handler` · cron `*/15 * * * *`.

## External consumers (import from this folder)
- `routes/index.ts` — admin `POST /trigger/sales-sync`
- `server.ts` — sync status + trigger endpoints
- `modules/scheduler/service.ts` — registers it as the `sales_copilot` engine for brief/EOD context

## Dependencies (platform services in `src/modules/`)
- `modules/ai/service` — classification + brief/EOD text generation
- `shared/prisma` — `Estimate`, `Comment`, `Classification`
- `config`, `shared/engine`, `shared/logger`

## Data
- **Writes:** `Estimate`, `Comment`, `Classification`.
- **Serves:** `GET /api/automations/zoho-sent-analyzer/data` → KPIs + recent estimates.

## Dashboard
📊 has dashboard → frontend **Automations** page renders the full Zoho board (`/api/estimates` + `/data`).

## Config
None here — Zoho credentials live in env (`.env`, parsed cURL file).
