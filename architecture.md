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
| **GitHub Actions runners** (`scripts/*-runner.js`) | `.github/workflows/cron-*.yml` (cPanel cron dispatch) | — (call Worker) | **Where all heavy processing & cron actually happens** (digest, brief, summary, zoho, email, neodove). |
| **waba-worker** (`waba-worker/src/index.ts`) | `wrangler deploy` → `waba-worker` | D1 (`waba-worker`) | Dedicated WhatsApp webhook ingress + durable processing queue. Raw payloads stored in D1, drained by `local-runner.js` (polls `/api/logs`, writes `/api/update`). |
| **Express server** (`founder-os_backend/src/server.ts`) | `pnpm dev` / `node dist/server.js` | PostgreSQL (Prisma) | Alternate/local runtime. Same route surface + modules; *can* run automations in-process via `node-cron` + BullMQ/Redis, but not the live operational path. |
| **webhook-relay** (`webhook-relay/relay.js`) | `node relay.js` | disk WAL | Zero-dep buffer between WA Engine Pro and the Express backend; acks instantly, forwards with backoff. |
| **local-runner.js** | `node local-runner.js` | (reads waba-worker D1) | Local AI processing loop: polls the waba-worker queue, classifies each message (deterministic rules + LLM fallback), writes results back. |
| **Frontend** (`founder-os_frontend`) | `next build` → Cloudflare Pages | — | Static Next.js dashboard; talks to the Worker/Express API via Pages Functions `/api` proxy. **PWA**: manifest + `sw.js` (build-time precache of all assets) for "Add to Home Screen" + offline shell. |
| **cPanel cron dispatcher** (`216.10.246.39`, user `brindwqj`) | user crontab → `~/gh-trigger.sh` | — | Replaces cron-job.org: fires `workflow_dispatch` to GitHub Actions on schedule (no Node needed). Also runs the nightly D1 backup (`~/d1-backup.sh` → Cloudflare D1 export API → SQL dump in `~/d1-backups/`, 14-day retention). |

### Key principles
- **Dual runtime, shared modules:** `founder-os_backend/src/modules/*` and `src/automations/*`
  are imported by both the Express server and the Cloudflare Worker. The Worker build
  (`scripts/build-worker.mjs`) bundles `worker.ts`; the server runs `server.ts` via ts-node.
- **Strategy pattern for storage:** `src/storage/*` defines a `StorageProvider` interface with
  `prisma-provider` (Postgres), `d1-provider` (D1), and `in-memory-provider` (fallback).
- **Pluggable automations:** Each automation is a folder under `src/automations/<slug>/` with an
  `index.ts` (and required `README.md`). An `AutomationEngine` runs rule/handler automations.
- **Heavy AI / cron off the request path — done by GitHub Actions:** All heavy jobs run as
  standalone `scripts/*-runner.js` scripts in GH Actions (fired on schedule by a cPanel cron
  dispatcher — see §5.1), calling the Worker's `/api/runner/*`. The Express server *can* run
  the same automations in-process via `node-cron`, but that is not the live operational path.
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
│   │   ├── modules/                     # ai, automation, brain, whatsapp, waba, email, auth, chat, ...
│   │   ├── automations/                 # 18 automation folders + _template
│   │   ├── storage/ shared/ middleware/ durable/ utils/ types/
│   │   ├── live.ts                      # canonical LiveEvent catalog + broadcastLive helper
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
│   └── trigger-workflows.sh            # manual workflow_dispatch helper (cron dispatcher)
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
| `auth` | `types/service/store/…` — Google OAuth + session + **role-based** permissions |
| `chat` | `store.ts` / `store-prisma.ts` / `routes.ts` — team chat (channels + DMs + messages + KV attachments) |
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
 - **SSE** (`/api/whatsapp/events`): real-time push for WhatsApp activity; in-memory on
   Express. (Distinct from the general live-update hub below.)
 - **Live-update hub** (`/api/events`): a **WebSocket** fan-out backed by the
   `durable/event-hub.ts` EventHub Durable Object (singleton, `idFromName('global')`).
   Every data-write endpoint broadcasts a typed event; all dashboards subscribe and
   refetch instantly. See **§11 Real-time live updates**.


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
 - `/api/audit*`, `/api/events` (WebSocket live hub; see §11)

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

### 5.1 External dispatch (cPanel cron → workflow_dispatch)
GitHub's native `schedule:` is unreliable (observed 1–6 h drift, far worse than the
30–40 min originally seen), so all workflows are triggered externally. cron-job.org
was the original dispatcher but **stopped firing** (silent; the PAT must live under
`extendedData.headers`, which the API ignores if set as `requestHeaders`). It has been
**replaced by a cPanel cron job** on the team's shared host (`216.10.246.39`):

```
cPanel crontab (user brindwqj) every 5/10/15/30 min + daily
  └─ ~/gh-trigger.sh <every-5min|every-10min|every-15min|every-30min|daily>
       └─ curl POST https://api.github.com/repos/striversahil/ai_pa/actions/workflows/<wf>/dispatches
            └─ GitHub Actions runs the workflow on demand
```

- `~/gh-trigger.sh` embeds the GitHub PAT (from `GITHUB_ACCESS_TOKEN` in `.env`) and
  fires `workflow_dispatch`; it logs HTTP codes to `~/gh-trigger.log`.
- Schedules: every-5min `*/5`, every-10min `*/10`, every-15min `*/15` (body
  `{"ref":"main","inputs":{"force":"true"}}`), every-30min `*/30`, daily
  `30 2,3,13,21 * * *` (UTC; IST 08:00/08:30/18:30/03:00).
- Manual equivalent: `GITHUB_PAT=... ./scripts/trigger-workflows.sh <target>`.

### 5.2 Runner / worker hardening (Aug 2026)
Several runner failures were diagnosed and fixed; runs that previously failed now
succeed end-to-end (verified via `workflow_dispatch`):

| Workflow | Symptom | Root cause | Fix |
|----------|---------|-----------|-----|
| every-5min (`whatsapp-autopilot`) | `tasks/create` → HTTP 500, "200 failures, processed=0" | `WaTaskHistory.occurredAt` is `NOT NULL` in D1 but no create set it; the D1 shim only auto-fills `createdAt`/`updatedAt` | pass `occurredAt` in all `waTaskHistory.create` calls; add `$transaction` to the D1 shim |
| every-30min (`email-brain-index`) | `brain/context` → HTTP 503, CF 1102 "exceeded resource limits" | per-row D1 `upsert` loop (find→write × rows) blew the CPU budget | rewrite with a single `DB.batch()` of `INSERT … ON CONFLICT(source, sourceId) DO UPDATE` |
| daily (`morning-brief`) | "Context too large (14,752 > 5000)" → exit 1 | runner **threw** when context exceeded the token budget instead of trimming | trim every context section; never hard-fail |

Operational notes:
- The autopilot worker was failing for days, so its `autopilot:message_watermark`
  (a `Setting` row) never advanced — the runner re-fetched the same old backlog and,
  once the 500 was fixed, ground through the 582-message history one LLM call at a
  time (a run stayed `in_progress` for hours). Fix: cancel the stuck run and set the
  watermark to "now" so only new messages are processed. Drain the historical backlog
  in batches by temporarily rewinding the watermark if ever needed.
- Automation boot is **lazy** in the worker (only kicked on `/api/automations` /
  `/api/trigger`); `/api/status` reporting `automationsLoaded: 0` before such a
  request is expected, not an error.
- Secrets used by the cron dispatcher and runners: `GITHUB_ACCESS_TOKEN`, `WORKER_URL`,
  `SHARED_SECRET`, `OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY`, `OMNIROUTE_MODEL`.
  Zoho creds are inferred at runtime from `zoho_sent/sent_estimates.txt`.


## 6. Data Models (PostgreSQL via Prisma — 22+ models)

`founder-os_backend/prisma/schema.prisma` is the source of truth. The Worker uses a
D1-compatible subset. Migrations live in `prisma/` and `d1/schema.sql` /
`migrations/*.sql` (0003 auth, 0004 chat, 0005 chat attachments, 0006 chat DMs,
0007 contact picture).

- **Contact** — WhatsApp contact/chat: `chatId` (unique), `name`, `phoneNumber`, `isGroup`, `picture`, `unreadCount`, `hasInbound`, `lastMessage*`. `picture` (set via `PUT /api/whatsapp/contacts/:uid/picture`) drives the chat/contact avatar.
- **Message** — `wahaMessageId` (unique), `chatId`, `sender`, `body`, `timestamp`, `processed`, `isHistorical`, quote fields, `classification`, `classificationReason`, `classifiedAt`, `slaDeadline`. Fetched with **cursor pagination** (`?limit=50&before=<timestamp>`); the WhatsApp frontend caches each chat locally and loads older pages on scroll-up.
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

**Auth (Google OAuth + roles):**
- **AuthUser** — `email` (unique), `name`, `picture`, `isRoot` (derived from `striversahil@gmail.com`).
- **AuthSession** — 30-day HttpOnly cookie session.
- **AuthScope** — assignable permission categories (`dashboard`, `whatsapp`, `automations`, `zoho`, …).
- **AuthRole** — **bundles automation-dashboard scopes only** (`DASHBOARD_SCOPES` allowlist): `key`, `label`, `description`, `scopeKeys`. A user's effective scopes = direct scopes ∪ their roles' scopes. Roles are the primary way founders grant access (e.g. `mis` → `zoho`); the admin panel assigns roles to users instead of ticking every scope checkbox.
- **AuthUserRole / AuthRoleScope** — join tables.

**Team chat (Discord-style):**
- **ChatChannel** — `name`, `description`, `category`, `type` (`channel` | `dm`), `createdBy`.
- **ChatMessage** — `channelId` FK, `senderId` FK, `body`, `attachments` (JSON), `editedAt`, `deletedAt`; sequential integer `id` for cheap cursor pagination (`before=<id>&limit=50`).
- **ChatMember** — per-DM membership (`channelId`+`userId`); public channels are visible to every approved member.
- **ChatAttachment metadata** — files live in Workers **KV** (`CHAT_FILES`, up to 20 MB); the message stores `{ key, name, size, type }` JSON and files are served at `GET /api/chat/files/:key` behind the auth gate (images/PDF/audio/video inline, others download).

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
 ├── hooks/{useEnquiryData, useTheme, useToast, useCSV, useLocalStorage, useHashRoute, useLiveEvents}.ts
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
| founder-os-worker | Cloudflare Workers (**live API**) | `node scripts/build-worker.mjs` → `npx wrangler deploy` (D1 `DB`, `EVENT_HUB` DO, `CHAT_FILES` KV) |
| Cron/AI dispatch | cPanel cron (`216.10.246.39`) | user crontab → `~/gh-trigger.sh` → `workflow_dispatch` |
| Cron/AI | GitHub Actions (**live execution**) | `.github/workflows/cron-*.yml` → `scripts/*-runner.js` |
| **D1 nightly backup** | cPanel cron (`216.10.246.39`) | `30 2 * * *` → `~/d1-backup.sh` → Cloudflare D1 **export API** (polling) → SQL dump in `~/d1-backups/`, 14-day retention |
| waba-worker | Cloudflare Workers | `cd waba-worker && wrangler deploy` (D1 `waba-worker`) |
| Express backend | Docker / host (alt/local) | `pnpm build` (tsc) → `node dist/server.js`; `Dockerfile` + `docker-compose.yml` |
| Frontend (+ PWA) | Cloudflare Pages | `npm run build` → `wrangler pages deploy out` |
| webhook-relay / local-runner | host/process | `node webhook-relay/relay.js`, `node local-runner.js` |

Secrets: `SHARED_SECRET` (Worker + GH Actions + waba-worker), `DATABASE_URL` (Express),
`WA_ENGINE_API_KEY`, `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL` (Omniroute),
`GOOGLE_SERVICE_ACCOUNT_JSON`, `GITHUB_ACCESS_TOKEN` (cron dispatch; also `SSH_*` for the
cPanel host in the root `.env`).

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
- If the endpoint **writes dashboard data**, call `notifyLive(c, { type: "<name>" })` so
  open tabs refresh live (see §11). Add a `useLiveRefresh` wiring in the relevant component.
- Build/verify: `node scripts/build-worker.mjs && node scripts/smoke-worker.mjs`.

### 10.4 New model
1. Edit `prisma/schema.prisma`, run `prisma migrate` / add a `migrations/*.sql`.
2. Add the corresponding storage access via `modules/storage/repository.ts`.

### 10.5 Conventions
- One component / automation / module per folder. Props/interfaces co-located.
- Shared types in `types/`. Use `@/` alias in the frontend.
- Runners: pure ESM Node, no build step. Worker: one route per domain, instant only.
- `node --check` on every script before commit; `pnpm build` + `tsc --noEmit` for backend/frontend.

## 11. Real-time live updates (WebSocket EventHub)

Dashboards update **without a manual refresh** the moment backend data changes. This
replaces the old per-dashboard `setInterval` polling (those loops are kept only as slow
safety nets).

### 11.1 Backend — EventHub Durable Object
- `src/durable/event-hub.ts` (`EventHub`): a single global instance keyed by
  `EVENT_HUB.idFromName('global')`. Clients open a **WebSocket** upgrade on
  `GET /api/events`; the Worker route forwards the upgrade straight to the DO.
- Uses the **WebSocket Hibernation API**: between messages the runtime evicts the
  object from memory, so idle connections cost ~0 duration on the Workers Free plan
  (no SSE idle-timeout risk). Clients send a `ping` every 60s to keep NAT/proxies open;
  the DO replies `pong`.
- `/broadcast` (internal, POST): iterates `state.getWebSockets()` and sends the JSON
  event to every connected client, then hibernates again.

### 11.2 Broadcast contract
Every data-write endpoint calls the `notifyLive(c, event)` helper, which fire-and-forgets
a `c.executionCtx.waitUntil(...)` POST to the hub. Event shapes:

| Event | Emitted from |
|-------|--------------|
| `{ type: "estimates" }` | `/api/estimates/bulk-upsert`, `/api/estimates/classify`, `/api/runner/zoho/status`, `/api/runner/zoho/comments`, `/api/runner/zoho/classification` |
| `{ type: "neodove" }` | `/api/runner/neodove/report` |
| `{ type: "baseline" }` | `/api/runner/estimates/baseline` (the 01:00 AM IST daily freeze) |
| `{ type: "automation", slug }` | `POST /api/trigger/:slug` (after the automation scan completes) |

### 11.3 Frontend — one modular live-data layer
There is a **single** shared layer that makes every dashboard number live. It opens **one**
WebSocket to `/api/events` for the whole app (module-level singleton in the hook) and fans
events out to every component via an in-process event bus — no per-dashboard sockets.

- `src/hooks/useLiveData.ts` (the common modular file):
  - `useLiveQuery<T>(fetcher, { events?, deps?, pollMs? })` — fetches on mount + whenever a
    matching `LiveEvent` arrives (debounced ~1.5s), plus an optional slow `pollMs` safety net.
  - `useLiveEvent(handler)` — imperative subscription for components with their own local
    state (e.g. the WhatsApp chat window).
- Backend `src/live.ts` defines `LiveEvent` (canonical type names) and `broadcastLive(c, type,
  extra?)`, which `notifyLive` now delegates to. **Every data-write path calls `broadcastLive`**:
  runner writes (`/api/runner/digests`, `tasks`, `pending-items`, `messages/mark-processed`,
  `founder-notes`, `emails`, `brain/context`), interactive writes (`/api/whatsapp/send`, the
  inbound `/api/whatsapp/webhook`, contact-note PUT, pending-item resolve/cancel), and the
  existing `estimates` / `baseline` / `neodove` / `automation` paths.

**Live coverage (every number updates without a refresh):**
- `FounderAssistant` → `briefing` (via `founder-notes`/`digests`/`tasks`/`estimates`/`neodove`), `digests`, `tasks`
- `ZohoEstimates` → `estimates` / `baseline` / `automation`
- `NeodoveTelecallerDashboard` → `neodove`
- `DppPricesDashboard` → `automation: dpp-prices-dashboard`
- `EnterpriseOperationsDashboard` → `automation: enterprise-operations-analytics`
- `WaEngineDashboard` → `automation: wa-engine-monitor`
- `WhatsAppMarketingDashboard` → `automation: whatsapp-marketing`
- `SheetAnalysisDashboard` → `automation: <its slug>`
- `WhatsAppDashboard` → `messages` / `contacts` / `digests` / `pending-items` (also SSE for live chat append)
- `Automations` → `automation` (runs) — registry list re-fetches on every run

**Live coverage note:** the **Enquiry Tracker** is now live (stored in D1/Postgres, broadcast via
`LiveEvent.Enquiries`) and mounted as the `enquiry-tracker` automation dashboard — no more
mockData/localStorage. Every create/edit triggers a background **Groq LLM extraction**
(`src/modules/enquiries/extract.ts`) that auto-fills empty structured fields (title, company,
contact, assigned sales agent) from the freeform description, keeping the client's wording verbatim.

### 11.4 Cost & limits
- **Free tier:** one EventHub instance held 24/7 ≈ 10,800 GB-s/day vs the 13,000 GB-s/day
  free quota (hibernation keeps it near-zero in practice); 100k DO requests/day is nowhere
  near hit for an internal dashboard. Workers Paid ($5/mo) includes 400k GB-s/month.
 - Data still only *changes* on the upstream Zoho/NeoDove sync cadence (every 5–10 min via
   GH Actions); the hub delivers those changes to open tabs within ~2s instead of on a
   poll tick. True sub-minute freshness would require Zoho webhooks → worker.

## 12. Authentication & granular permissions (Google OAuth)

Founder OS uses **Google Sign-In** with one root account (`striversahil@gmail.com`) and
**open signup** for any Google user. Access to each view/category is gated by assignable
**permission categories (scopes)** managed by the root from an in-app Admin panel. Sessions
are persisted in an **HttpOnly cookie valid for 30 days**.

### 12.1 Design decisions
- **Root:** `striversahil@gmail.com` (matched by email) gets `isRoot` + the `admin` scope
  (which implicitly grants every view/category). Root is not a stored flag per se — it is
  derived from the email at login and the `admin` scope is granted on first login.
- **Open signup + later assignment:** anyone with a Google account can log in; a new user
  has no categories until root grants them. Views the user lacks show an "Access pending"
  panel rather than a redirect loop.
- **Category/role-based permissions:** a *category* (e.g. `enquiries`, `whatsapp`,
  `automations`, `zoho`, `dpp`, `wa-engine`, `neodove`, `enterprise-ops`, `whatsapp-marketing`,
  `sheet-analysis`, `founder-ai`, `brain`) maps to one or more UI views. A user holding a
  category can open every view that requires it. This is the "role" abstraction — root forms
  categories and assigns them per user from the Admin UI.
- **Persistent 30-day cookie:** `fos_session` is HttpOnly, `SameSite=Lax`, `Path=/`, max-age
  30 days, `Secure` when served over HTTPS. No token is ever exposed to the browser JS.

### 12.2 Modules (`src/modules/auth/`)
- `types.ts` — `AuthUser`, `AuthScope`, `Session`, `MeResponse`, `AuthError`, `ROOT_EMAIL`.
- `store.ts` — `AuthStore` interface + `MemoryAuthStore` (dev fallback) + `D1AuthStore`
  (Cloudflare D1, used by the Worker). `createAuthStore(env)` picks D1 when `env.DB` exists.
- `store-prisma.ts` — `PrismaAuthStore` (Postgres via Prisma, used by the Express runtime).
  Kept in a separate file so the Prisma client never enters the Worker bundle.
- `google.ts` — `buildGoogleAuthUrl` + `exchangeGoogleCode` (pure `fetch`, no Node deps).
- `session.ts` — `SESSION_COOKIE`, `SESSION_MAX_AGE` (30d), cookie header builders/reader.
- `service.ts` — core logic: `DEFAULT_SCOPES`, `DEFAULT_ROLES`, `DASHBOARD_SCOPES`
  (roles may only grant automation-dashboard scopes), `authEnabled`, `startLogin`,
  `completeLogin`, `getMe`, `requireUser`, `requireScope`, `isApproved`, `listUsers`,
  `listScopes`, `listRoles`, `createScope`, `createRole`, `deleteScope`, `deleteRole`,
  `setUserScopes`, `setUserRoles`. `ensureScopesSeeded` / `ensureRolesSeeded` create the
  defaults on login. `getMe` resolves effective scopes = direct scopes ∪ role scopes.
- `routes.ts` — framework-agnostic handlers returning `AuthResult {status, body?, setCookie?,
  redirect?}`: `authLogin`, `authCallback`, `authMe`, `authLogout`, `authListUsers`,
  `authListScopes`, `authCreateScope`, `authDeleteScope`, `authSetUserScopes`, plus
  `authListRoles`, `authCreateRole`, `authDeleteRole`, `authSetUserRoles`. Management
  endpoints are root-only (email/`isRoot` check inside the service). Role endpoints:
  `GET/POST /api/auth/roles`, `DELETE /api/auth/roles/:key`,
  `PUT /api/auth/users/:id/roles`.

### 12.3 Runtime wiring
- **Worker (prod):** `authStore(c)` (D1), login-gate `app.use('*')` middleware protects all
  `/api/*` except `AUTH_EXEMPT` (`/api/auth/`, `/api/runner/`, `/api/trigger/`, health,
  `/webhook`, `/dashboard`). WebSocket `/api/events` is protected. Google redirect URI =
  `${AUTH_PUBLIC_ORIGIN}/api/auth/google/callback` (env `AUTH_PUBLIC_ORIGIN` required in prod
  because the Pages proxy origin differs from the worker origin; falls back to request origin
  locally).
- **Express (local):** same routes/store (Postgres) + same gate middleware via `authEnabled`.
- **Frontend:** `src/auth/permissions.ts` (`VIEW_SCOPE` map: nav view / automation slug →
  required category, `canView()` — **fail-closed**: unrecognized views are denied; the `chat`
  view is available to every approved member), `src/auth/AuthContext.tsx` (`useAuth` — fetches
  `/api/auth/me`, `login()`, `logout()`, `canView`, `refresh`), `src/components/LoginScreen.tsx`
  (Google sign-in), `src/components/UserAdmin.tsx` (root panel: define **roles** + assign them
  to users, create/delete categories). `src/app/page.tsx` wraps the app in `AuthProvider`, shows
  the login screen when unauthenticated, filters `Sidebar`/`MobileNav`/`MobileDrawer` by
  `canView`, auto-redirects a denied user to their first accessible view, renders `UserAdmin`
  at `#/admin` for root, and shows an "Access pending" panel only when the user has no access.
- **Pages proxy** (`founder-os_frontend/functions/api/[[path]].ts`) forwards the `Cookie`
  header and preserves `Set-Cookie`, so the session cookie works same-origin through the proxy.

## 13. Team chat (Discord-style)

Added for internal team collaboration, visible in the sidebar (main nav + mobile drawer)
for every approved member — not an automation.

- **Data:** `ChatChannel` (public, grouped by `category`) and DM channels (`type: 'dm'`,
  private to `ChatMember` pairs); `ChatMessage` with sequential integer ids for cursor
  pagination (`GET /api/chat/channels/:id/messages?limit=50&before=<id>`).
- **API** (all behind the login gate, approved members): list/create channels (create is
  admin-only), `GET/POST` messages, `PATCH/DELETE` messages (author or admin),
  `GET /api/chat/users`, `POST /api/chat/dm` (find-or-create). `chatSendMessage` /
  `chatListMessages` enforce channel membership for DMs.
- **Attachments:** files upload to Workers **KV** (`CHAT_FILES`) via `POST /api/chat/files`
  (multipart, ≤ 20 MB) and are served at `GET /api/chat/files/:key` behind auth — images /
  PDF / audio / video render or play inline (served `inline`), other documents download.
  The ChatRoom UI has drag-and-drop, inline image/video/audio renderers, a fullscreen PDF
  viewer (iframe) and image Lightbox, plus a mobile channel drawer.
- **Real-time:** every write calls `broadcastLive(c, LiveEvent.Chat, {action, channelId,
  message})` → the existing EventHub WebSocket; the frontend applies creates/updates/deletes
  instantly. Per-channel message cache makes switching chats instant (no refetch per click);
  older pages load on scroll-up.

## 14. PWA & mobile

- **PWA:** `public/manifest.webmanifest` + `public/icons/*` (generated by
  `scripts/gen-icons.mjs`) and a build-time service worker (`scripts/postbuild.mjs` scans
  `out/` and emits `out/sw.js` precaching every asset; `PwaRegister` registers `/sw.js`).
  App can be "Added to Home Screen" with an offline shell (API calls stay network-only).
- **Mobile:** responsive grids/scroll containers across all dashboards; a mobile drawer
  (`MobileDrawer.tsx`) gives the full sidebar (nav + dashboards + profile/logout) via a
  hamburger in the mobile header, complementing the bottom `MobileNav`.
- **WhatsApp chat UX:** per-chat local cache (instant switch), scroll-up cursor pagination
  (50 at a time), and contact/group profile pictures (`picture` column + `PUT …/picture`).

## 15. Deployment map (current)

| Component | Target | How |
|-----------|--------|-----|
| founder-os-worker | Cloudflare Workers (**live API**) | `node scripts/build-worker.mjs` → `npx wrangler deploy` (D1 `DB`, `EVENT_HUB`/`ASYNC_RUNNER` DOs, `CHAT_FILES` KV) |
| Cron/AI dispatch | cPanel cron (`216.10.246.39`) | user crontab → `~/gh-trigger.sh` → `workflow_dispatch` |
| Cron/AI execution | GitHub Actions | `.github/workflows/cron-*.yml` → `scripts/*-runner.js` |
| waba-worker | Cloudflare Workers | `cd waba-worker && wrangler deploy` (D1 `waba-worker`) |
| Express backend | Docker / host (alt/local) | `pnpm build` → `node dist/server.js`; `Dockerfile` + `docker-compose.yml` |
| Frontend (+ PWA) | Cloudflare Pages | `npm run build` → `npx wrangler pages deploy out --project-name founder-os-frontend` |
| webhook-relay / local-runner | host/process | `node webhook-relay/relay.js`, `node local-runner.js` |

Secrets: `SHARED_SECRET`, `DATABASE_URL`, `WA_ENGINE_API_KEY`, `LLM_API_KEY`/`LLM_BASE_URL`/
`LLM_MODEL`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GITHUB_ACCESS_TOKEN` (+ `SSH_HOST`/`SSH_USER`/
`SSH_PASSWORD` for the cPanel host, stored in root `.env`).





