# Automation Framework

The fixed core that powers **every** automation — both the migrated engines (Zoho
analyzer, WhatsApp digest, SLA, queue sweeps, …) and new rule-based automations. One
automation = one folder in [`src/automations/`](../../automations/README.md); this
module is shared code and should not need to change as automations are added.

## Components

| File | Responsibility |
|---|---|
| `types.ts` | Shared types: `AutomationDefinition`, `Trigger`, `Condition`, `ActionSpec`, `AutomationContext`, `ScanRecord`, `AutomationModule`. |
| `registry.ts` | Discovers `src/automations/*`, validates each folder (README.md required), loads `rule.json` + `index.ts`, syncs into the `Automation` table, schedules cron triggers. |
| `engine.ts` | Dispatch: `trigger(event, payload)` for events and `scan(slug)` for schedules. Evaluates conditions, dedups, executes actions, records `AutomationRun`. |
| `conditions.ts` | JSON condition DSL evaluator (operators below). Values support `{{config.x}}` templating. |
| `actions.ts` | Action bus: built-in actions + dispatch to per-automation `custom:*` actions. |
| `template.ts` | `{{config.x}}` / `{{payload.x}}` / `{{record.x}}` / `{{x}}` interpolation. |
| `routes.ts` | Admin/dashboard API (mounted at `/api/automations`). |

## Two flavors of automation

- **Handler** (`"type": "handler"`) — a code body on a schedule. `index.ts` exports
  `handler(ctx)` that calls an existing service. The migrated engines are handlers
  (wrapping, never modifying, their services).
- **Rule** (default) — declarative trigger + condition + actions. `index.ts` is optional
  and may export `scanner`, `dedupKey`, `actions` (custom), `data` (dashboard).

## Data model (Prisma)

```
Automation
  id, slug (unique = folder name), name, description, type (rule|handler)
  triggerJson     { type: 'event' | 'schedule' | 'event_plus_scan', event?, cron?|cron[], fallbackCron? }
  conditionJson   JSON DSL or null
  actionsJson     ActionSpec[]
  configJson      per-automation config (templated into conditions/actions)
  dedupField      optional dot-path to the identity field on a subject
  enabled, cooldownMs, lastRunAt, runCount, readmePath

AutomationRun
  id, automationId → Automation
  dedupKey, status (SUCCESS | SKIPPED | FAILED), payloadJson, error, createdAt
  @@unique([automationId, dedupKey])   // structural double-fire guard
```

**Definition ↔ runtime:** `rule.json` is the *template*. On boot the registry upserts by
`slug`; runtime-editable fields (`enabled`, `cooldownMs`, `configJson`) persist from the
DB across redeploys, so edits via the admin API survive. New/changed `rule.json` values
win for everything else.

## Trigger model

| type | fires via | used for |
|---|---|---|
| `event` | `AutomationEngine.trigger(event, payload)` emitted from source modules | near-real-time reactions |
| `schedule` | cron (registry) → `scan(slug)` | periodic work |
| `event_plus_scan` | event **plus** a `fallbackCron` scan | real-time with a missed-event backstop (e.g. the 5-min guarantee on telecalling) |

## Engine flow

### Event path — `AutomationEngine.trigger(event, payload)`
```
source module emits (webhook → controller.ts, etc.)
  → for each enabled rule automation subscribed to `event`
      condition.evaluate(subject)?
        dedupKey = dedupField | custom dedupKey()
        already ran (unique run row) / within cooldown? → skip
        → execute actions with { subject: payload, config } context
        → record AutomationRun
```

### Scan path — schedule cron → `AutomationEngine.scan(slug)`
```
handler automations: run module.handler(ctx) and update run stats
rule automations:    records = module.scanner(ctx)
                     for each record: condition + dedup + cooldown → actions
```

Scans run even when an event was missed (e.g. backend down at ingest) — that is what
makes the "forward within 5 minutes" guarantee possible: event + 60s scan fallback.

## Condition DSL

```json
{ "all": [ { "field": "status", "op": "eq", "value": "open" } ] }
{ "any": [ ... ] }
{ "not": { ... } }
```

| op | meaning |
|---|---|
| `eq` / `neq` | equal / not equal (string, number, boolean) |
| `gt` / `gte` / `lt` / `lte` | numeric comparison |
| `contains` | substring (strings) or element-of (arrays) |
| `in` / `notIn` | value is in array |
| `exists` | field is present and non-null |
| `olderThan` / `youngerThan` | date/ISO comparison: `{ value: "3d" }` (d/h/m/s suffixes) |

`field` is a dot-path on the subject. `value` supports `{{config.x}}` so rules can
reference their runtime-editable config.

## Action bus

| type | args (templated) | backend |
|---|---|---|
| `whatsapp_send` | `chatId`, `body`, `allowNonAllowlisted?` | `OutboundService.sendWithJitter` (full anti-ban pipeline + allowlist gate) |
| `create_task` | `title`, `owner?`, `source?` | `TasksService.createTask` |
| `notify` | `chatId`, `message` | `NotificationBatcher.addAlert` (15-min flush) |
| `ai_analyze` | `method`, `args`, `as?`, `onError?` | `AIService` (see below) |
| `sheets_update` | `spreadsheetId`, `range`, `values` | not wired yet (GoogleSheetsService is read-only today) |
| `zoho_update` | `recordType`, `id`, `fields` | not wired yet |
| `email_send` | `to`, `subject`, `body` | not wired yet (EmailService has no send) |
| `custom:<key>` | any | the automation's own `index.ts` `actions` map |

### `ai_analyze` — call AI from declarative rule.json

Lets rule automations run a curated `AIService` method without writing a handler.
The result is written to the run context and available to later actions via templates.

```json
{ "type": "ai_analyze", "method": "classifyMessage",
  "args": { "sender": "{{payload.sender}}", "body": "{{payload.body}}",
            "timestamp": "{{payload.timestamp}}", "conversationContext": "{{config.recentContext}}" },
  "as": "classification", "onError": "skip" }
```

| field | meaning |
|---|---|
| `method` | one of `classifyMessage`, `summarizeConversation`, `extractEnquiry`, `classifyEstimateComments`, `queryBrain`, `answerFounderQuestion` |
| `args` | object mapped onto the method's parameters; values are templated and JSON-parsed (`{...}` / `[...]`) |
| `as` | namespace for the result (default: merged into `ai` directly) |
| `onError` | `fail` (run FAILED, default) or `skip` (run continues without the result) |

Templating downstream: no `as` → `{{ai.<field>}}` (e.g. `{{ai.priority}}`); with `as`
→ `{{ai.<as>.<field>}}`; string results (e.g. `queryBrain`) → `{{ai.result}}`.
`classifyMessage` output is a flat object, so a `whatsapp_send` body can do
`Priority: {{ai.priority}} — {{ai.reason}}`. Multi-key/model fallback, mock mode and
`/health` AI metrics all apply automatically via `AIService`.

## Event catalog (current)

| event | emitted from | payload |
|---|---|---|
| `whatsapp.message.inbound` | webhook → `controller.ts` `emitInboundEvents` | `{ chatId, sender, body, wahaMessageId, timestamp }` |
| `whatsapp.group.message` | same (group chats) | same |
| *(future)* `zoho.estimate.updated`, `email.inbound`, `task.created`, `sla.breach` | one `emit()` line in the source module | TBD |

## Scanner interface

```ts
type Scanner = (ctx: AutomationContext) => Promise<ScanRecord[]>;
```
Custom scanners come from the automation's `index.ts` (e.g. telecalling-enquiry-to-dpp
queries recent group messages from PostgreSQL).

## Extensibility — adding the 100th automation & integration

Three extension points, each a small code touch in ONE place:

1. **New event** — `emit()` once from the source module; automations subscribe by name
   in `rule.json`. Nothing else changes.
2. **New action** — add a case in `actions.ts` (or a `custom:*` action in the
   automation's own `index.ts`).
3. **New scan provider** — a rule's `index.ts` exports a `scanner`; no shared-code change.

## Guardrails (automatic)

- Every `whatsapp_send` uses the existing anti-ban outbound pipeline; automation sends
  can never bypass the global lock, burst guard, rate limits, working-hours deferral, or
  `OutboundIntent` durability.
- **Allowlist default ON:** `whatsapp_send` to a never-messaged chat is skipped unless
  `allowNonAllowlisted: true` (needed for outbound-only targets like DPP).
- **Dedup + cooldown** make double-firing structurally impossible (`@@unique`).

## Deployment notes

- Runtime (dev): `ts-node` reads `rule.json`/`README.md` straight from `src/automations/`.
- Compiled (`npm start`): `npm run build` runs `tsc && node scripts/copy-automations.js`,
  which copies each automation's `README.md` + `rule.json` into `dist/automations/` so
  compiled and dev runs behave identically.

## Non-goals (for now)

- No GUI editor — admin API only; `rule.json` + `README.md` are the source docs.
- No inter-automation dependencies / DAG orchestration — each automation is independent.
- No per-automation secret storage yet — secrets live in env / config until needed.
