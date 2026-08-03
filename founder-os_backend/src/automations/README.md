# Automations

**Every automation in the system lives here — one folder per automation, and its
code lives *inside* the folder.** The framework core (registry, engine, conditions,
actions, admin API) lives in [`src/modules/automation/`](../../src/modules/automation/README.md)
and is shared infrastructure — never touched per-automation. The frontend is just a
consumer of the automation API (`/api/automations`).

This layout scales to 100+ automations without touching shared code.

## Ownership rule

| Kind of code | Where it lives |
|---|---|
| The automation's own orchestration, scanner, custom actions, data providers, and dashboard | **inside `src/automations/<slug>/`** |
| Framework (registry, engine, conditions, actions, routes) | `src/modules/automation/` |
| Shared platform services used by the live request path (message send pipeline, brain RAG search, email service, queue, tasks, AI) | `src/modules/` — imported by automations |

Each folder README documents its architecture: files, flow, dependencies, data, config.

## Directory contract

```
src/automations/
├── README.md                     # this file
├── _template/                    # copy-me scaffold (rule + handler flavors)
│
│  ── self-contained automations (full code in-folder) ──
├── zoho-sent-analyzer/           # */15 — Zoho analyzer (service.ts) + dashboard
├── whatsapp-digest/              # */5 — digest batch job (process.ts)
├── sla-monitor/                  # * * * * * — SLA checker (sla-check.ts)
├── waha-session-monitor/         # */5 — WAHA health/reconnect (session-monitor.ts)
├── notification-batcher/         # */15 — alert batching (batcher.ts)
├── morning-brief/                # 0 8 — brief generation (service.ts)
├── eod-summary/                  # 0 19 — EOD generation (service.ts)
├── data-retention/               # 0 3 — delete messages > 90 days (index.ts)
│
│  ── orchestrators (own schedule; platform services do the work) ──
├── email-brain-index/            # */30 — email sync + brain re-index
├── morning-queue-drain/          # * * * * * — send due deferred messages
├── outbound-intent-recovery/     # * * * * * — re-deferral Redis-down intents
├── orphaned-message-recovery/    # */2 — re-enqueue unclassified messages
│
│  ── new rule automations (declarative + in-folder scanner/actions) ──
├── telecalling-enquiry-to-dpp/   # event + 1-min scan → WhatsApp to DPP
└── dpp-prices-dashboard/         # event + 1-min scan → PriceQuote + KPI data
```

**Hard rule:** every automation folder **must** contain a `README.md`. The registry
warns at boot (and refuses to load) if one is missing.

## Two flavors

1. **Handler automations** (`rule.json`: `"type": "handler"`) — a scheduled code body.
   `index.ts` exports `handler(ctx)`.
2. **Rule automations** (`"type": "rule"`) — declarative trigger + condition + actions.
   `index.ts` is optional (scanner / custom actions / dedup key / data provider).

## How to add a new automation (3 steps)

1. **Copy `_template`** → rename to `kebab-case-slug`.
2. **Fill `README.md`** (architecture doc) and **`rule.json`** (pick the flavor).
3. Write `index.ts` **only if** it needs custom logic (handler, scanner, custom action).

Done. The registry auto-discovers the folder at boot, syncs `rule.json` into the
`Automation` table (runtime-editable afterwards via the admin API), and schedules it.

## Guardrails (automatic, do not disable casually)

- All `whatsapp_send` actions go through the **existing anti-ban pipeline**: global
  send lock, 25-burst guard, 15/chat/min, 40–60/account/hour, working-hours deferral,
  morning queue, `OutboundIntent` durability.
- **Allowlist default:** a `whatsapp_send` to a chat that never messaged us is skipped
  unless the action sets `allowNonAllowlisted: true`.
- **Dedup + cooldown:** every rule fire records an `AutomationRun` keyed by
  `(automationId, dedupKey)` with a unique constraint — double-firing is structurally
  impossible, even across restarts.

## Admin / dashboard API

- `GET    /api/automations`             list all automations (incl. `hasDashboard`)
- `GET    /api/automations/:slug`       detail + recent runs
- `PATCH  /api/automations/:slug`       enable/disable, set cooldown (no redeploy)
- `GET    /api/automations/:slug/data`  dashboard data (opt-in via `data` export)

## Dashboard visibility

An automation declares a dashboard by exporting `data` from its `index.ts` — the API
then reports `hasDashboard: true` and the frontend **Automations** page (Next.js)
renders the dashboard for it. Example: `zoho-sent-analyzer` → Zoho estimates board.

## Future integrations

Google Sheets, webhooks, more CRM sources — all map onto the framework's three
extension points: [new events, new actions, new scanners](../../src/modules/automation/README.md#extensibility).
