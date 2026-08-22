# Founder OS — Architecture Document

> **Status of this doc:** rewritten against the current code on `main` (Aug 2026).
> The platform is no longer a single Cloudflare Worker — it is a **multi-runtime
> system** where a Cloudflare Worker/D1 API is the live data plane and **all heavy
> AI + cron is executed by GitHub Actions** (`scripts/*-runner.js`). An Express/
> PostgreSQL server shares the same modules as an alternate/local runtime, plus a
> separate WhatsApp ingress worker (`waba-worker`) and a GitHub-Actions-driven AI layer.

## 1. System Overview

Founder OS is a modular executive-assistant platform for **Brindavan Udyog (India)**, a
B2B industrial manufacturing company. It unifies WhatsApp conversations, Zoho Books
estimates, telecalling/CRM data, Google Sheets, and an LLM-powered "Company Brain"
behind a single Next.js dashboard.

### Operational model (what actually runs in production)

**All heavy AI, cron, and scheduled processing is executed by GitHub Actions**
(`scripts/*-runner.js` jobs) that call the Cloudflare Worker's `/api/runner/*`
endpoints for D1 reads/writes and call the LLM directly. The Worker itself is a
**thin JSON API over D1** — it does not run heavy loops or its own scheduler in
production. The Express/PostgreSQL server is an alternative runtime that shares the
same `src/modules/*` and `src/automations/*` code and *can* run those jobs
in-process via `node-cron`, but in the live deployment the operational path is
Worker + GitHub Actions.

```
   WA Engine Pro (cloud)  ──┐
   (WhatsApp gateway)       │   (A) webhook-relay/relay.js  ──► Express /api/whatsapp/webhook
                            │       (disk WAL buffer, retries)   (alt/local runtime)
                            │
                            └──► (B) waba-worker (CF Worker, D1) ──► drained by ──┐
                                    raw payloads stored in D1 queue    local-runner │
                                                                      (polls /api/logs)│
    GitHub Actions (cron, external dispatch)                              │          │
   node scripts/*-runner.js ──► founder-os-worker ◄─────────────────────┘          │
   (ALL heavy AI + cron: digest, brief, summary, zoho, email, neodove)              │
                                          │                                        │
                        ┌─────────────────┴──────────┐             ┌──────────────┴──────┐
                        │ founder-os-worker (CF D1)  │             │ Express (PostgreSQL) │ ◄── SSE /api/whatsapp/events
                        │ LIVE API (thin; GH-Actions │             │ ALT/LOCAL runtime    │
                        │  does the heavy + cron work)│             │ (node-cron in code)  │
                        └────────────┬───────────────┘             └──────────┬───────────┘
                                     └───────────────┬────────────────────────┘
                                                     │
                                    Next.js static dashboard
                                    (Cloudflare Pages, Pages Functions /api proxy)
```

| Runtime | Entry | DB | Role |
|---------|-------|----|------|
| **Cloudflare Worker** (`founder-os_backend/src/worker.ts`) | `wrangler deploy` → `founder-os-worker` | D1 (SQLite) | **Live API.** Thin JSON API over D1; heavy AI/cron delegated to GH Actions runners via `/api/runner/*`. |
| **GitHub Actions runners** (`scripts/*-runner.js`) | `.github/workflows/cron-*.yml` (external dispatch) | — (call Worker) | **Where all heavy processing & cron actually happens** (digest, brief, summary, zoho, email, neodove). |
| **waba-worker** (`waba-worker/src/index.ts`) | `wrangler deploy` → `waba-worker` | D1 (`waba-worker`) | Dedicated WhatsApp webhook ingress + durable processing queue. Raw payloads stored in D1, drained by `local-runner.js` (polls `/api/logs`, writes `/api/update`). |
| **Express server** (`founder-os_backend/src/server.ts`) | `pnpm dev` / `node dist/server.js` | PostgreSQL (Prisma) | Alternate/local runtime. Same route surface + modules; *can* run automations in-process via `node-cron` + BullMQ/Redis, but not the live operational path. |
| **webhook-relay** (`webhook-relay/relay.js`) | `node relay.js` | disk WAL | Zero-dep buffer between WA Engine Pro and the Express backend; acks instantly, forwards with backoff. |
| **local-runner.js** | `node local-runner.js` | (reads waba-worker D1) | Local AI processing loop: polls the waba-worker queue, classifies each message (deterministic rules + LLM fallback), writes results back. |
| **Frontend** (`founder-os_frontend`) | `next build` → Cloudflare Pages | — | Static Next.js dashboard; talks to the Worker/Express API via Pages Functions `/api` proxy. |

### Key principles
- **Dual runtime, shared modules:** `founder-os_backend/src/modules/*` and `src/automations/*`
  are imported by both the Express server and the Cloudflare Worker. The Worker build
  (`scripts/build-worker.mjs`) bundles `worker.ts`; the server runs `server.ts` via ts-node.
- **Strategy pattern for storage:** `src/storage/*` defines a `StorageProvider` interface with
  `prisma-provider` (Postgres), `d1-provider` (D1), and `in-memory-provider` (fallback).
- **Pluggable automations:** Each automation is a folder under `src/automations/<slug>/` with an
  `index.ts` (and required `README.md`). An `AutomationEngine` runs rule/handler automations.
- **Heavy AI / cron off the request path — done by GitHub Actions:** All heavy jobs run as
  standalone `scripts/*-runner.js` scripts in GH Actions (external cron-job.org dispatch),
  calling the Worker's `/api/runner/*`. The Express server *can* run the same automations
  in-process via `node-cron`, but that is not the live operational path.
- **Graceful degradation:** Falls back to in-memory mock data when the DB / LLM is unavailable.

### Repository structure (actual)
```
/ai_pa
├── architecture.md                     # this file
├── Dockerfile / docker-compose.yml     # Express backend container (alt/local deploy)
├── docker-compose.local-runner.yml     # Express + local-runner compose
├── start.sh / deploy.sh                # local dev / Docker deploy helpers
├── founder-os_backend/                 # backend monorepo (Express + Worker + waba-worker share code)
│   ├── prisma/schema.prisma            # 22-model PostgreSQL schema (source of truth)
│   ├── src/
│   │   ├── server.ts                   # Express 5 entrypoint (alt/local runtime)
│   │   ├── worker.ts                    # Cloudflare Worker entrypoint (Hono + D1) — LIVE
│   │   ├── config/ config-worker.ts    # env validation (server / worker variants)
│   │   ├── routes/                      # Express routers (whatsapp-webhook, health, triggers, ...)
│   │   ├── modules/                     # ai, automation, brain, whatsapp, waba, email, ...
│   │   ├── automations/                 # 18 automation folders + _template
│   │   ├── storage/ shared/ middleware/ durable/ utils/ types/
│   │   └── scripts/                     # build-worker.mjs, smoke-worker.mjs, d1-mock.mjs
│   ├── wrangler.toml                    # founder-os-worker config (D1 + EventHub DO)
│   └── dist-worker/ dist/               # build outputs
├── waba-worker/                        # separate Cloudflare Worker (WhatsApp ingress + D1 queue)
│   ├── src/index.ts  schema.sql  wrangler.toml
├── webhook-relay/relay.js              # Node WAL buffer → Express backend
├── local-runner.js                     # local AI classification loop (drains waba-worker)
├── scripts/                            # GH Actions file-based runners (heavy AI runs HERE)
│   ├── runner-lib.js                   # shared helpers (workerRequest, omnirouteJson, extractJson)
│   ├── whatsapp-digest-runner.js
│   ├── morning-brief-runner.js
│   ├── eod-summary-runner.js
│   ├── zoho-sent-runner.js             # Zoho sync + LLM classification + comments
│   ├── email-brain-index-runner.js
│   ├── neodove-report-runner.js        # NeoDove telecaller report (today + backfill)
│   └── trigger-workflows.sh            # manual cron-job.org dispatch helper
├── founder-os_frontend/               # Next.js 16 static dashboard (Cloudflare Pages)
├── .github/workflows/                 # cron-every-{5,10,15,30}min.yml + cron-daily-ist.yml
├── zoho_sent/                         # Zoho Books cURL export (sent_estimates.txt)
├── random_dump/                       # design docs, n8n workflows
└── WA_Engine_Pro_API_Documentation.md / WHATSAPP_FLOW.md / whatsapp_plan.md / whatsapp-business-autopilot-architecture.md / whatsapp_context.md   # reference docs
```


## 2. Alternate / Local Runtime — Express / PostgreSQL

> This runtime shares all `src/modules/*` and `src/automations/*` with the Cloudflare
> Worker but runs on Node + PostgreSQL. In the **live deployment**, heavy AI and cron are
> driven by **GitHub Actions**, not by this server's in-process `node-cron`. The section
> below documents the server's capabilities; treat GitHub Actions + the Worker as the
> operational execution engine (see §3 and §5).

### 2.1 Tech stack
| Component | Technology |
|-----------|-----------|
| Runtime | Node.js (ts-node in dev, compiled `dist/server.js` in prod) |
| Framework | Express 5 |
| ORM | Prisma 6 (PostgreSQL datasource) |
| Database | PostgreSQL (external; `DATABASE_URL`) |
| Scheduler | `node-cron` (in-process) + `cron-parser` |
| Queue | BullMQ + Redis (ioredis) — message processing queue |
| LLM | OpenAI-compatible client (`openai`) → Omniroute endpoint |
| Embeddings | HuggingFace Router API (384-dim), stored as JSON |
| Validation | Zod 4 |
| Logging | Pino (+ pino-pretty) |
| Rate limiting | express-rate-limit, ipaddr.js |
| Package manager | pnpm 10 |

### 2.2 `src/server.ts` route surface
Express routers are mounted and a set of direct `app.get/post` handlers cover the
public API. Auth: `requireSecret` guards `/api/trigger/*` and `/api/automations/*`
(Bearer `SHARED_SECRET`); public GETs are open for the dashboard.

| Method | Path | Source |
|--------|------|--------|
| GET | `/api/status` | server.ts — DB & LLM diagnostics |
| GET | `/api/brief/latest` | server.ts — latest morning brief / EOD |
| GET | `/api/digests` | server.ts |
| GET | `/api/tasks` | server.ts |
| GET | `/api/messages/:chatId` | server.ts |
| GET | `/api/sheet-data` | server.ts |
| POST | `/api/ask-founder-ai` | server.ts — Brain RAG alias |
| POST | `/api/trigger/digest` / `email-sync` / `briefing` / `summary` | server.ts |
| GET/POST | `/api/trigger/sales-sync[/status]` | server.ts |
| POST | `/api/brain/query` | server.ts |
| GET | `/api/brain/stats` | server.ts |
| POST | `/api/trigger/brain-index` | server.ts |
| GET | `/api/audit`, `/api/audit/pending`, `/api/audit/sla-breaches` | server.ts |
| POST | `/api/whatsapp/send` | server.ts |
| GET | `/api/whatsapp/contacts`, `/contacts/:contactUid/messages`, `/note` (GET/PUT), `/summarize` | server.ts |
| GET | `/api/whatsapp/events` | server.ts — SSE stream |
| `*` | `/api/whatsapp/webhook` | routes/whatsapp-webhook |
| `*` | `/health`, `/api/health` | routes/health |
| `*` | `/api/automations*` | modules/automation (router) |
| `*` | `/api/whatsapp-marketing*` | routes/whatsapp-marketing |
| `*` | `/api/pending-items*` | routes/pending-items |

`routes/index.ts` also exposes `/api/estimates`, `/api/tasks`, `/api/messages`,
`/api/digests`, `/api/brief`, `/api/sheet-data`, `/api/status`.

### 2.3 Internal module layout (`src/modules/*`)
| Module | Responsibility |
|--------|---------------|
| `ai` | LLM service + `deterministicClassifier.ts` + prompt templates (`prompts/`) |
| `aisensy` | AiSensy campaign client |
| `audit` | Audit log writes/reads (`AuditLog`) |
| `automation` | `engine.ts`, `registry.ts` (fs glob + node-cron), `registry-worker.ts` (static imports, no cron), `routes.ts`, `actions.ts`, `conditions.ts`, `template.ts`, `types.ts` |
| `brain` | `embedder.ts`, `indexer.ts`, `service.ts` — Company Brain RAG |
| `classification` | `heuristics.ts`, `service.ts` — Zoho estimate classification |
| `digest` | `service.ts` — WhatsApp conversation digests |
| `email` | `engine.ts`, `service.ts` — email sync + brain indexing |
| `google_sheets` | `service.ts` (server) + `service-worker.ts` (Worker) |
| `monitoring` | `alerter.ts` (Slack), `health.ts` |
| `queue` | `service.ts` (BullMQ) + `service-worker.ts` (D1/DO fallback) |
| `scheduler` | `service.ts` (node-cron boot) + `service-worker.ts` |
| `storage` | `repository.ts` — `StorageRepository` over the active provider |
| `tasks` | `service.ts` — action items |
| `waba` | `client.ts` — Meta/WABA Cloud API client |
| `whatsapp` | `controller.ts` (server) + `controller-worker.ts`, `engine.ts`, `service.ts`, `outbound.ts`, `message-buffer.ts`, `session-status.ts`, `wa-engine-cache.ts`, `rate-limit-store*.ts` |

### 2.4 Storage providers (`src/storage/*`)
`interfaces.ts` defines `StorageProvider`. Implementations: `prisma-provider.ts`
(Postgres, used by the Express runtime), `d1-provider.ts` (D1, for the Worker), `in-memory-provider.ts`
(graceful fallback). `index.ts` selects the provider from env. All higher-level code
goes through `modules/storage/repository.ts`.

### 2.5 Scheduler & automations (in-process)
On boot, `SchedulerService.init()` → `AutomationRegistry.load()` reads every folder
in `src/automations/` (requires `README.md`), upserts an `Automation` row, and wires
`node-cron` triggers. `AutomationEngine` evaluates conditions/actions. Cooldowns and
runtime config (`enabled`, `configJson`) persist in the `Automation` table across
redeploys; dedup keys in `AutomationRun` make double-firing impossible.

| Automation (slug) | Type | Trigger (node-cron) | Purpose |
|-------------------|------|---------------------|---------|
| `data-retention` | handler | `0 3 * * *` | Delete WhatsApp messages > 90 days |
| `dpp-prices-dashboard` | rule (event+scan) | `*` (fallback) | Parse DPP price messages → `PriceQuote` |
| `enterprise-operations-analytics` | handler | `*/30 * * * *` | 18-point supply-chain analytics dashboard |
| `eod-summary` | handler | `0 19 * * *` (7 PM IST) | End-of-day summary |
| `morning-queue-drain` | handler | `*` | Send due deferred WhatsApp messages (Redis) |
| `neodove-telecaller-report` | handler | `*/10 * * * *` | Per-agent NeoDove call perf (GH runner refreshes TODAY) |
| `notification-batcher` | handler | `*/15 * * * *` | Flush grouped alerts to WhatsApp |
| `orphaned-message-recovery` | handler | `*/2 * * * *` | Re-enqueue saved-but-unclassified messages |
| `outbound-intent-recovery` | handler | `*` | Re-defer persisted outbound intents once Redis back |
| `sla-monitor` | handler | `*` | Flag SLA breaches → Slack |
| `telecalling-agent-analysis` | handler | `*/30 * * * *` | Read Telecalling Agents sheet → per-agent metrics |
| `telecalling-enquiry-to-dpp` | rule | event+scan | Enquiry messages → DPP |
| `wa-engine-monitor` | handler | `*` | WA Engine session/health monitor + dashboard |
| `whatsapp-digest` | handler | event+scan | WhatsApp → AI digest (`process.ts`) |
| `whatsapp-marketing` | handler | scheduled/recurring | Campaign send via WABA/AiSensy |
| `zoho-sent-analyzer` | handler | `*/15` (GH) | Zoho sync + AI classification |
| `email-brain-index` | handler | `*/30` (GH) | Email sync + brain index |
| `morning-brief` | handler | daily IST (GH) | Morning briefing |
| `_template` | — | — | Scaffold for new automations |

> On the **Worker** deployment, `registry-worker.ts` statically imports the same
> folders but does **not** wire node-cron — scheduled execution is driven by GitHub
> Actions calling `/api/trigger/:slug`.

### 2.6 Queue & SSE
- **BullMQ/Redis** (`modules/queue`): inbound WhatsApp messages are enqueued for
  classification/processing; `morning-queue-drain` and `outbound-intent-recovery`
  handle deferred sends. If Redis is unavailable, intents persist as `OutboundIntent`
  rows and are recovered when Redis returns.
- **SSE** (`/api/whatsapp/events`): real-time push to the dashboard; backed by the
  `durable/event-hub.ts` EventHub Durable Object on the Worker, in-memory on Express.


## 3. Edge Backend — Cloudflare Worker (Hono + D1)

`founder-os_backend/src/worker.ts` is bundled by `scripts/build-worker.mjs` →
`dist-worker/worker.js` and deployed as `founder-os-worker` (D1 binding `DB`,
`EVENT_HUB` Durable Object). It mirrors the Express route surface but keeps handlers
thin — heavy AI is performed by GH Actions runners that call `/api/runner/*`.

### 3.1 Public & system endpoints (subset; full list mirrors §2.2)
- `/health`, `/api/health`, `/api/health/whatsapp`, `/webhook`, `/dashboard`
- `/api/status`, `/api/brief/latest`, `/api/digests`, `/api/tasks`,
  `/api/messages/:chatId`, `/api/sheet-data`, `/api/estimates`, `/api/estimates/baseline`
- `/api/brain/query`, `/api/ask-founder-ai`, `/api/brain/stats`
- `/api/whatsapp/send`, `/api/whatsapp-proxy/send`, `/api/whatsapp/contacts*`,
  `/api/whatsapp/events`, `/api/whatsapp/summarize`
- `/api/pending-items*`, `/api/automations*`, `/api/whatsapp-marketing*`
- `/api/neodove/report`, `/api/estimates/classify`, `/api/estimates/bulk-upsert`
- `/api/audit*`, `/api/events` (SSE)

### 3.2 Runner API (Bearer `SHARED_SECRET`) — consumed by `scripts/*-runner.js`
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/runner/messages/unprocessed` | Unprocessed WhatsApp messages |
| GET | `/api/runner/digests/latest` | Latest digest per chat |
| GET | `/api/runner/chat-notes` | Chat notes for briefing |
| POST | `/api/runner/digests` | Persist digests |
| POST | `/api/runner/tasks` | Persist action items |
| POST | `/api/runner/pending-items` | Persist founder pending items |
| POST | `/api/runner/messages/mark-processed` | Mark processed |
| GET | `/api/runner/brief-data` | Brief aggregate reads |
| POST | `/api/runner/founder-notes` | Save founder note |
| GET | `/api/runner/zoho/state` | Estimates + max comment id + watermark |
| POST | `/api/runner/zoho/comments` | Upsert Zoho comments |
| POST | `/api/runner/zoho/status` | Sync closed estimate statuses |
| POST | `/api/runner/zoho/classification` | Upsert AI classification |
| POST | `/api/runner/emails` | Upsert synced emails |
| GET | `/api/runner/brain/sources` | Brain source list |
| POST | `/api/runner/brain/context` | Upsert brain context rows |
| POST | `/api/runner/estimates/baseline` | Freeze today's baseline |
| POST | `/api/runner/neodove/report` | Upsert NeoDove report |

### 3.3 Trigger dispatch
`POST /api/trigger/:slug` runs the matching automation (auth required). On the Worker,
cron-driven automations are reached via GitHub Actions → `curl /api/trigger/:slug`.

## 4. WhatsApp ingestion paths

There are **two** ingestion routes from WA Engine Pro (the WhatsApp gateway):

 1. **Relay → Express:** WA Engine Pro → `webhook-relay/relay.js` →
    `POST /api/whatsapp/webhook` on the Express backend (default `http://127.0.0.1:5000`).
    The relay acks WA Engine Pro immediately, writes a disk write-ahead log, and forwards
    with backoff so a backend outage never drops messages (backend dedupes by
    `wahaMessageId`).
 2. **Edge/queue (waba-worker):** WA Engine Pro → `waba-worker` (`/webhook`) stores raw
    payloads in its D1 `waba_payloads` table (UNIQUE `whatsapp_id`). `local-runner.js`
    polls `/api/logs?mode=cron`, classifies each (deterministic rules + LLM fallback),
    and writes back via `/api/update`. Idempotent by `whatsapp_id`.
    (Note: the GitHub Actions cron workflows do **not** drain waba-worker — they call
    `founder-os-worker`'s `/api/runner/*` instead. waba-worker + local-runner is the
    local/dev classification path.)

`local-runner.js` ports `deterministicClassifier.ts` rules and calls Omniroute for
ambiguous messages; it naturally drains backlog accumulated while the machine was off.

## 5. GitHub Actions — AI processing & scheduling

Heavy jobs are standalone Node scripts in repo-root `scripts/` that call the Worker's
`/api/runner/*` (D1 reads/writes) and make LLM calls via Omniroute directly.

| Workflow | Cadence (UTC) | Jobs |
|----------|---------------|------|
| `cron-every-5min.yml` | `*/5` | `whatsapp-digest-runner.js` (heavy AI) |
| `cron-every-10min.yml` | `*/10` | `neodove-report-runner.js` (today, intraday overwrite) |
| `cron-every-15min.yml` | `*/15` | `zoho-sent-runner.js` (full sync + AI; `force` dispatch reclassifies all active) |
| `cron-every-30min.yml` | `*/30` | `email-brain-index-runner.js` |
| `cron-daily-ist.yml` | `30 19` (baseline-freeze 01:00 IST), `30 21` (data-retention 03:00 IST) | baseline-freeze (curl), data-retention (curl), `morning-brief-runner.js`, `eod-summary-runner.js`, `neodove-report-runner.js` (yesterday + N-day backfill) |

Secrets for runners: `WORKER_URL`, `SHARED_SECRET`, `OMNIROUTE_BASE_URL`,
`OMNIROUTE_API_KEY`, `OMNIROUTE_MODEL`. Zoho creds are inferred at runtime from
`zoho_sent/sent_estimates.txt` (cURL export) — no separate Zoho secrets.

### 5.1 External dispatch (cron-job.org → workflow_dispatch)
GitHub's native `schedule:` is unreliable (observed 30–40 min drift), so all workflows
are triggered externally:

```
cron-job.org (UTC schedule, POST + PAT)
  └─ https://api.github.com/repos/striversahil/ai_pa/actions/workflows/<wf>/dispatches
       └─ GitHub Actions runs the workflow on demand
```

⚠️ The cron-job.org API silently ignores `requestHeaders` — the GitHub PAT must be set
under `extendedData.headers` (object form). Manual equivalent:
`GITHUB_PAT=... ./scripts/trigger-workflows.sh <every-5min|every-10min|every-15min|every-30min|daily|all>`.


## 6. Data Models (PostgreSQL via Prisma — 22 models)

`founder-os_backend/prisma/schema.prisma` is the source of truth. The Worker uses a
D1-compatible subset. Migrations live in `prisma/` (`0001_create_token_table.sql`,
`0002_add_sales_agent.sql`).

- **Contact** — WhatsApp contact/chat: `chatId` (unique), `name`, `phoneNumber`, `isGroup`, `unreadCount`, `hasInbound`, `lastMessage*`.
- **Message** — `wahaMessageId` (unique), `chatId`, `sender`, `body`, `timestamp`, `processed`, `isHistorical`, quote fields, `classification`, `classificationReason`, `classifiedAt`, `slaDeadline`.
- **OutboundIntent** — deferred sends persisted when Redis is down (`status` PENDING/ENQUEUED).
- **Email** — `subject`, `sender`, `body`, `processed`.
- **Digest** — `chatId`, `chatName`, `summary`, `priority` (enum), `category`, `sentiment`, `requiresFounder`, `suggestedReply`.
- **Task** — `title`, `owner`, `status` (enum), `deadline`, `source`, `sourceId`.
- **ChatPendingItem** — per-chat "pending from me" ledger (`status` OPEN/DONE/CANCELLED, `resolvedBy`).
- **ChatNote** — founder's private per-chat note (`chatId` PK).
- **FounderNote** — free founder notes.
- **Estimate** — `estimateId` (PK), `estimateNumber`, `customerName`, `total`, `date` (String), `status`, `lastSyncTime`, `skipMatching`.
- **Comment** — `commentId` (PK), `estimateId` FK, `description`, `commentedBy`, `date`, `dateDescription`, `dateFormatted`.
- **Classification** — `estimateId` PK; flags `meaningfulUpdate`, `notAnswering`, `movingSlow`, `underDiscussion`, `confirm` (String), `intentScore` (Int), `reasoning`, `summary`, `salesAgent` (default "Unassigned"), `processedAt`.
- **AuditLog** — `action`, `entityType`, `entityId`, `metadata` (JSON).
- **BrainContext** — normalized searchable index: `source`, `sourceId` (unique pair), `entityName`, `content`, `metadata`, `eventDate`, `indexedAt`.
- **Automation** — runtime registry: `slug` (unique), `name`, `type` (rule|handler), `triggerJson`, `conditionJson`, `actionsJson`, `configJson`, `enabled`, `cooldownMs`, `lastRunAt`, `runCount`.
- **AutomationRun** — one fire: `automationId` FK, `dedupKey` (unique pair), `status`, `payloadJson`, `error`.
- **PriceQuote** — parsed DPP price lines: `messageId` (unique), `dppChatId`, `itemName`, `unitPrice`, `currency`, `rawLine`, `quotedAt`.
- **Setting** — generic key/value (`key` PK, `value`) e.g. `zoho_baseline:YYYY-MM-DD`, `sales_copilot:last_complete_sync_at`.
- **Token** — external auth tokens: `source` (unique), `token`, `metadata` (JSON).
- **MarketingCampaign** — `name`, `type`, `provider` (waba|aisensy), `status`, `scheduleType`, `scheduledAt`, `cron`, `template*`, `mediaUrl`, `statsJson`.
- **MarketingLead** — `campaignId` FK, `phoneNumber`, `name`, `attributes` (JSON), `status`, message/error timestamps.
- **MarketingCampaignRun** — per-campaign execution: `total`, `sent`, `failed`, `skipped`, `status`.

Enums: `Priority` (low|medium|high|urgent), `TaskStatus` (PENDING|IN_PROGRESS|COMPLETED|CANCELLED).

## 7. Token storage (external service auth)

Many services (NeoDove, Zoho, Google) need rotating tokens. A central `Token` table
holds them:

1. A Playwright/IMAP script logs in, extracts the token, `POST /api/token/webhook`
   (`{ source, token, metadata }`, Bearer `SHARED_SECRET`).
2. Worker upserts by `source`.
3. Runners `GET /api/token/:source` → use it for downstream API calls.
4. Missing/expired → runner fails fast (alert) instead of silently breaking.

This avoids manual GitHub Secret rotation for frequently-expiring tokens.

## 8. Frontend (Next.js 16 static dashboard)

| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router, Static Export) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 (PostCSS), CSS custom properties (dark/light) |
| Charts | Chart.js 4 |
| Fonts | Geist |
| State | React hooks (`useState/useEffect/useMemo/useCallback`); data via `/api` |
| Persistence | LocalStorage (UI prefs) + Worker D1 (shared baseline) |
| Package manager | npm or pnpm (both `package-lock.json` and `pnpm-lock.yaml` present; no `packageManager` field) |
| Hosting | Cloudflare Pages (`founder-os-frontend`), `functions/` = Pages Functions `/api` proxy |

### 8.1 Structure
```
founder-os_frontend/src/
├── app/{layout.tsx, page.tsx, globals.css, favicon.ico}
├── api/client.ts                     # fetch wrapper (API_BASE = '/api')
├── hooks/{useEnquiryData, useTheme, useToast, useCSV, useLocalStorage, useHashRoute}.ts
├── types/index.ts  mockData.ts
└── components/
    ├── layout/{Sidebar, MobileNav}.tsx
    ├── Dashboard, Enquiry{List,Detail,Modal,RowItem}, ClientProfile, CommentNode,
    │   FilterControls, CalendarRibbon, ActivityTimeline, KpiCard, PipelineFunnel,
    │   TrendChart, SpecificationsSection, Lightbox, ToastContainer, ErrorBoundary
    ├── FounderAssistant                 # AI chat (Brain RAG)
    ├── ZohoEstimates + zoho/{EstimateCard, CommentsTimeline, DailyMovementTracker,
    │   CallingPriorityChecklist, ActiveFilters, KpiCards, ZohoEstimatesHeader, types, utils}
    ├── WhatsAppDashboard, WhatsAppMarketingDashboard
    ├── WaEngineDashboard, NeodoveTelecallerDashboard
    ├── DppPricesDashboard, EnterpriseOperationsDashboard, SheetAnalysisDashboard
    └── Automations                      # automation registry viewer
```

`page.tsx` is the shell: `<Sidebar>|<MobileNav>` + view switch wrapped in
`<ErrorBoundary>`, with `<EnquiryModal>`, `<Lightbox>`, `<ToastContainer>` overlays.
Views like `ZohoEstimates`, `FounderAssistant`, `WhatsAppDashboard` call the API
directly via `fetch()`. The Pages Functions proxy (`functions/api/[[path]].ts`) forwards
`/api/*` to `env.API_WORKER_URL`; runner endpoints are never called from the browser.

### 8.2 Build & deploy
```
cd founder-os_frontend
npm run build                  # static export → out/
wrangler pages deploy out --project-name founder-os-frontend
```
The `functions/` dir is excluded from Next typecheck (Pages Functions types come from
`@cloudflare/workers-types`).

## 9. Deployment

| Component | Target | How |
|-----------|--------|-----|
| founder-os-worker | Cloudflare Workers (**live API**) | `node scripts/build-worker.mjs` → `npx wrangler deploy` (D1 `DB`, `EVENT_HUB` DO) |
| Cron/AI | GitHub Actions (**live execution**) | `.github/workflows/cron-*.yml` → `scripts/*-runner.js` |
| waba-worker | Cloudflare Workers | `cd waba-worker && wrangler deploy` (D1 `waba-worker`) |
| Express backend | Docker / host (alt/local) | `pnpm build` (tsc) → `node dist/server.js`; `Dockerfile` + `docker-compose.yml` |
| Frontend | Cloudflare Pages | `npm run build` → `wrangler pages deploy out` |
| webhook-relay / local-runner | host/process | `node webhook-relay/relay.js`, `node local-runner.js` |

Secrets: `SHARED_SECRET` (Worker + GH Actions + waba-worker), `DATABASE_URL` (Express),
`WA_ENGINE_API_KEY`, `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL` (Omniroute),
`GOOGLE_SERVICE_ACCOUNT_JSON`.

### 9.1 Verification
- Worker: `node scripts/smoke-worker.mjs` (asserts public 200s, auth 401s, heavy-slug behaviour).
- Express: `node dist/server.js` + `curl /api/status`.
- Frontend: `curl https://<pages>/api/estimates/baseline` confirms the Pages `/api` proxy.

## 10. Extension guidelines

### 10.1 New automation
1. Copy `src/automations/_template/` → `src/automations/<slug>/` with `README.md` + `index.ts`.
2. Export an `AutomationModule` (`register`/`handler`). For rules, add `rule.json`.
3. Express: auto-discovered by `AutomationRegistry` (node-cron wired on boot).
   Worker: add the static import to `registry-worker.ts`.

### 10.2 New GH Actions runner
1. Add `scripts/<name>-runner.js`, reuse `runner-lib.js` (`workerRequest`, `omnirouteJson`).
2. Add a job to the matching workflow with `env: { WORKER_URL, SHARED_SECRET, OMNIROUTE_* }`.

### 10.3 New Worker/Express endpoint
- Express: add a handler in `server.ts` or a router in `src/routes/`.
- Worker: add to `worker.ts` (mirror the Express route). Keep handlers thin; heavy work → runner.
- Build/verify: `node scripts/build-worker.mjs && node scripts/smoke-worker.mjs`.

### 10.4 New model
1. Edit `prisma/schema.prisma`, run `prisma migrate` / add a `migrations/*.sql`.
2. Add the corresponding storage access via `modules/storage/repository.ts`.

### 10.5 Conventions
- One component / automation / module per folder. Props/interfaces co-located.
- Shared types in `types/`. Use `@/` alias in the frontend.
- Runners: pure ESM Node, no build step. Worker: one route per domain, instant only.
- `node --check` on every script before commit; `pnpm build` + `tsc --noEmit` for backend/frontend.



