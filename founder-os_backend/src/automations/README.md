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
├── enterprise-operations-analytics/ # */30 — 18-point enterprise supply chain analysis (index.ts)
├── telecalling-agent-analysis/   # */30 — Google Sheet per-agent metrics (index.ts)
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

## Sheet-analysis pattern (add any Google Sheet analysis in 1 folder)

The **dispatch** and **telecalling-agent** automations follow this recipe; copy one
to onboard a new sheet with zero changes to shared code or the frontend:

1. Copy the folder, pick a new `kebab-case-slug`.
2. In `rule.json` set `config.sheetUrl` to the new Google Sheet URL (or raw ID) —
   the Google Sheets API (`src/modules/google_sheets/service.ts`) accepts either.
3. Point `config.range` at the right tab, e.g. `Sheet1!A1:Z1000`.
4. Rewrite `index.ts` analysis to the new sheet's columns, keeping the `data()`
   payload shape (`meta.analysis: 'sheet'`, `kpis`, optional `warnings`/`insights`/`tables`).

The frontend `SheetAnalysisDashboard` renders any automation whose `data()` returns
that shape — new sheets show up in the Automations page automatically.

## AI-processing pattern (reusable AI for any automation)

Every piece of AI in the system goes through one shared core, so any automation —
declarative *or* code — gets the same reliability and observability for free.

### The core: `AIService` (`src/modules/ai/service.ts`)

Single shared LLM client. Handles automatically:

| Concern | Behaviour |
|---|---|
| **Mock mode** | If `LLM_API_KEY` is unset, every method returns canned responses — the whole system works in dev with no key. |
| **Key rotation** | Comma-separated keys (Groq `gsk_*` or OpenAI), shuffled, tried in order. |
| **Model fallback** | `LLM_MODEL` first, then `llama-3.3-70b-versatile` → `llama-3.1-8b-instant` → `gemma2-9b-it` (Groq) / `gpt-4o-mini` → `gpt-4o` (OpenAI). Retries on 429 / model-deprecation only. |
| **Metrics** | `totalCalls` / `failedCalls` / failure rate surface in `/health` (shown in the WAHA Session Monitor dashboard). |

Prompt-specific methods: `classifyMessage`, `summarizeConversation`, `incrementalSummarizeConversation`, `generateFounderBrief`, `generateDailySummary`, `answerFounderQuestion`, `queryBrain`, `classifyEstimateComments`, `extractEnquiryAndDate`, `matchBusinessEntity`.

### How work reaches AI — three paths

1. **Inbound WhatsApp (real-time pipeline)** — webhook → `controller.ts` → message-buffer → BullMQ classification queue (concurrency 5, 3 retries) → worker → `AIService.classifyMessage`; on AI failure it **falls back to `heuristicClassify`** so nothing is lost. At the same time `emitInboundEvents` fires `whatsapp.group.message` / `whatsapp.message.inbound` to event automations.
2. **Automations** — the reusable, no-code path (below) via the `ai_analyze` action, or directly from a handler/scanner (`AIService.<method>(...)`).
3. **On-demand REST** — e.g. `/health/whatsapp`, brain Q&A (`AIService.queryBrain` with RAG context from `modules/brain`).

### Reusable component #1 — the declarative `ai_analyze` action

Add AI to a **rule.json with zero handler code**. `ai_analyze` is a built-in action
(defined in `src/modules/automation/actions.ts`); the result is written to the run
context and reusable by **later actions** in the same rule.

```json
{ "type": "ai_analyze", "method": "classifyMessage",
  "args": { "sender": "{{payload.sender}}", "body": "{{payload.body}}",
            "timestamp": "{{payload.timestamp}}", "conversationContext": "{{config.recentContext}}" },
  "as": "classification", "onError": "skip" }
```

| field | meaning |
|---|---|
| `method` | `classifyMessage`, `summarizeConversation`, `extractEnquiry`, `classifyEstimateComments`, `queryBrain`, `answerFounderQuestion` |
| `args` | object mapped onto the method's parameters; values are templated (`{{payload.x}}`, `{{config.x}}`, `{{record.x}}`) and JSON-parsed for structured args (`{...}` / `[...]`) |
| `as` | namespace for the result — with it, later actions use `{{ai.<as>.<field>}}`; without it the result merges into `ai` directly (`{{ai.<field>}}`) |
| `onError` | `fail` (run recorded FAILED, default) or `skip` (rule continues without the result) |

**Templating the result downstream:** flat object (e.g. `classifyMessage`) → `{{ai.priority}}`, `{{ai.reason}}`, `{{ai.category}}`, `{{ai.suggested_action}}`; string methods (e.g. `queryBrain`, `answerFounderQuestion`) → `{{ai.result}}`; with `as` → `{{ai.<as>.<field>}}`.

A full classify → react rule, no handler code:

```json
{
  "type": "rule",
  "trigger": { "type": "event", "event": "whatsapp.group.message" },
  "actions": [
    { "type": "ai_analyze", "method": "classifyMessage",
      "args": { "sender": "{{payload.sender}}", "body": "{{payload.body}}", "timestamp": "{{payload.timestamp}}" } },
    { "type": "create_task",
      "title": "{{ai.priority}}: {{ai.reason}}", "source": "WHATSAPP" },
    { "type": "whatsapp_send",
      "chatId": "{{config.dppChatId}}", "allowNonAllowlisted": true,
      "body": "📊 Classified {{ai.category}} ({{ai.priority}})\n{{ai.reason}}" }
  ]
}
```

### Reusable component #2 — the handler pattern (heavier / custom AI)

For AI that needs custom orchestration (batches, RAG over DB, multi-step), import
`AIService` directly in the automation's `index.ts` handler or scanner. Same shared
core, same mock/fallback/metrics. See `whatsapp-digest` (`incrementalSummarizeConversation`),
`zoho-sent-analyzer` (`classifyEstimateComments` + `extractEnquiryAndDate`),
`morning-brief` / `eod-summary` (`generateFounderBrief` / `generateDailySummary`).

```ts
import { AIService } from '../../modules/ai/service';
// in handler(ctx) or scanner(ctx):
const result = await AIService.classifyMessage({ sender, body, timestamp, conversationContext });
```

### Guardrails & observability (automatic — do not bypass)

- **AI is never a hard dependency.** Wrap the call; fall back to heuristics
  (`modules/classification/heuristics.ts`) or continue with `onError: "skip"` so an
  LLM outage can't break the pipeline.
- **Audit + events:** record `AuditService.record(...)` and `broadcastWhatsAppEvent(...)`
  so dashboards / the Automations page see what AI did.
- **Send-safety still applies:** an `ai_analyze` result feeding a `whatsapp_send`
  still goes through the full anti-ban pipeline + allowlist gate.
- **Observability:** every call is counted in `/health` `metrics.ai`; per-run results
  are visible on the automation's detail page.
