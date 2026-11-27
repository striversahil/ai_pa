# Founder OS — Architecture Document

> **Status of this doc:** rewritten against the current code on `main` (Aug 2026); drift-corrected
> 2026-11-12 (cron dispatch, telecalling retirements, route inventory) and extended with §16–§18
> (automations vs session, ERP core, code organisation + duplication control).
> **Doc roles:** `AGENTS.md` = rules, gotchas, founder decisions (terse). This file = how the system
> works. `ERP_TRANSITION_PLAN.md` = the ERP roadmap. `docs/REUSABLE_COMPONENTS.md` = generated catalog
> of reusable modules. A behavior change updates the matching section here in the same commit.
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
| **Cloudflare Worker** (`founder-os_backend/src/worker.ts`) | `wrangler deploy` → `founder-os-worker` | D1 (SQLite) | **Live API + cron router.** Thin JSON API over D1; heavy AI/cron delegated to GH Actions runners via `/api/runner/*`. A single `* * * * *` Cron Trigger runs every minute and routes `workflow_dispatch` by UTC minute alignment — no external dispatcher needed. |
| **GitHub Actions runners** (`scripts/*-runner.js`) | `.github/workflows/cron-*.yml` (dispatched by the Worker cron router) | — (call Worker) | **Where all heavy processing actually happens** (digest, brief, summary, zoho, email, neodove). |
| **waba-worker** (`waba-worker/src/index.ts`) | `wrangler deploy` → `waba-worker` | D1 (`waba-worker`) | Dedicated WhatsApp webhook ingress + durable processing queue. Raw payloads stored in D1, drained by `local-runner.js` (polls `/api/logs`, writes `/api/update`). |
| **Express server** (`founder-os_backend/src/server.ts`) | `pnpm dev` / `node dist/server.js` | PostgreSQL (Prisma) | Alternate/local runtime. Same route surface + modules; *can* run automations in-process via `node-cron` + BullMQ/Redis, but not the live operational path. |
| **webhook-relay** (`webhook-relay/relay.js`) | `node relay.js` | disk WAL | Zero-dep buffer between WA Engine Pro and the Express backend; acks instantly, forwards with backoff. |
| **local-runner.js** | `node local-runner.js` | (reads waba-worker D1) | Local AI processing loop: polls the waba-worker queue, classifies each message (deterministic rules + LLM fallback), writes results back. |
| **Frontend** (`founder-os_frontend`) | `next build` → Cloudflare Pages | — | Static Next.js dashboard; talks to the Worker/Express API via Pages Functions `/api` proxy. **PWA**: manifest + `sw.js` (build-time precache of all assets) for "Add to Home Screen" + offline shell. |
| **cPanel host** (`216.10.246.39`, user `brindwqj`) | user crontab (d1-backup + health ping only) | — | Legacy workflow-dispatch cron lines are disabled (`#DISABLED-CF-WORKER-CRON`); dispatch is now handled by the Worker's Cron Triggers. Still runs the nightly D1 backup (`~/d1-backup.sh` → Cloudflare D1 export API → SQL dump in `~/d1-backups/`, 14-day retention) and a 15-min health ping. |

### Key principles
- **Dual runtime, shared modules:** `founder-os_backend/src/modules/*` and `src/automations/*`
  are imported by both the Express server and the Cloudflare Worker. The Worker build
  (`scripts/build-worker.mjs`) bundles `worker.ts`; the server runs `server.ts` via ts-node.
- **Strategy pattern for storage:** `src/storage/*` defines a `StorageProvider` interface with
  `prisma-provider` (Postgres), `d1-provider` (D1), and `in-memory-provider` (fallback).
- **Pluggable automations:** Each automation is a folder under `src/automations/<slug>/` with an
  `index.ts` (and required `README.md`). An `AutomationEngine` runs rule/handler automations.
- **Heavy AI / cron off the request path — done by GitHub Actions:** All heavy jobs run as
  standalone `scripts/*-runner.js` scripts in GH Actions, calling the Worker's `/api/runner/*`.
  Workflow **dispatch** is handled by a single `* * * * *` Worker Cron Trigger that routes to the
  right cadence — the Worker fires `workflow_dispatch`, and heavy AI still runs on the runner.
  The Express server *can* run the same automations in-process via `node-cron`, but that is not
  the live operational path.
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
│   │   ├── worker.ts                    # Cloudflare Worker entrypoint — THIN: wires route modules + cron
│   │   ├── worker/                      # Worker codebase (split from the old monolithic worker.ts):
│   │   │   ├── context.ts               # Bindings type, bootstrapEnv, deps(), boot, auth guards, live broadcast, shared helpers, app factory (middleware)
│   │   │   ├── cron.ts                  # * * * * * cron router (neodove-refresh + GH workflow_dispatch dispatcher)
│   │   │   ├── http.ts / viewer.ts      # shared request helpers: readBody(c), getViewer(c)/getViewerMe(c)
│   │   │   ├── workspace-data.ts        # serves /api/session/workspaces/:slug/data (see §16)
│   │   │   └── routes/                  # one module per API domain (~40; the register* list in
│   │   │                                #   src/worker.ts is the authoritative inventory)
│   │   ├── config/ config-worker.ts    # env validation (server / worker variants)
│   │   ├── routes/                      # Express routers (whatsapp-webhook, health, triggers, ...)
│   │   ├── modules/                     # ai, automation, brain, whatsapp, waba, email, auth, chat, ...
│   │   ├── automations/                 # 18 automation folders + _template
│   │   ├── storage/ shared/ middleware/ durable/ utils/ types/
│   │   ├── live.ts                      # canonical LiveEvent catalog + broadcastLive helper
│   │   └── scripts/                     # build-worker.mjs, smoke-worker.mjs, d1-mock.mjs
│   ├── wrangler.toml                    # founder-os-worker config (D1 + CACHE_KV + EventHub DO)
│   └── dist-worker/ dist/               # build outputs
├── waba-worker/                        # separate Cloudflare Worker (WhatsApp ingress + D1 queue)
│   ├── src/index.ts  schema.sql  wrangler.toml
├── webhook-relay/relay.js              # Node WAL buffer → Express backend
├── local-runner.js                     # local AI classification loop (drains waba-worker)
├── scripts/                            # GH Actions file-based runners (heavy AI runs HERE)
│   ├── runner-lib.js                   # shared helpers (workerRequest, groq/groqJson direct-Groq primary + omniroute fallback, extractJson)
│   ├── zoho-sync/                      # zoho-sent-runner split: fetch.js (Zoho reads) / diff.js (pure change detection, re-export shim of sync-core) / persist.js (worker writes) / analyze.js (only AI spender) — see its README
│   ├── whatsapp-digest-runner.js
│   ├── morning-brief-runner.js
│   ├── eod-summary-runner.js
│   ├── zoho-sent-runner.js             # Zoho sync + LLM classification + comments
│   ├── email-brain-index-runner.js
│   ├── neodove-report-runner.js        # NeoDove telecaller report (today + backfill)
│   └── set-ai-keys.sh                  # push GROQ_API_KEYS to GH + Worker secrets (keys never touch disk/git)
├── founder-os_frontend/               # Next.js 16 static dashboard (Cloudflare Pages)
├── .github/workflows/                 # cron-every-{5,10,15,30}min.yml + cron-daily-ist.yml + guards.yml (CI)
├── scripts/guards/                    # zero-dep `node --test` guard suite (mirrors, parity, ratchet) — §18
├── scripts/dup-audit.mjs              # duplication/boundary metrics behind the ratchet — §18
├── docs/                              # REUSABLE_COMPONENTS.md, rewrite-log.md, core-change-requests/
├── .claude/skills/                    # agent rulebooks (ai-pa-code-discipline)
├── ERP_TRANSITION_PLAN.md             # ERP core roadmap — §17
├── founder-os_backend/zoho_sent/        # Zoho Books cURL export (sent_estimates.txt)
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
| LLM | Unified **AI gateway** (`src/shared/ai-gateway.ts` on Worker/Express; GH runners call `POST /api/ai/complete`) → OpenAI-compatible endpoints configured ONLY in Setting `ai:providers` |
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
| `eod-summary` | handler | `0 19 * * *` (7 PM IST) | End-of-day summary |
| `morning-queue-drain` | handler | `*` | Send due deferred WhatsApp messages (Redis) |
| `neodove-telecaller-report` | handler | `*/5` (native in-worker) | Per-agent NeoDove call perf (native refresh writes TODAY; GH runner kept as fallback) |
| `notification-batcher` | handler | `*/15 * * * *` | Flush grouped alerts to WhatsApp |
| `orphaned-message-recovery` | handler | `*/2 * * * *` | Re-enqueue saved-but-unclassified messages |
| `outbound-intent-recovery` | handler | `*` | Re-defer persisted outbound intents once Redis back |
| `sla-monitor` | handler | `*` | Flag SLA breaches → Slack |
| `telecalling` | handler | **production-live via `cron-daily-ist.yml` 02:30 UTC slot (08:00 IST)** | Sales Leaderboard data provider. **Deterministic — no LLM.** `runLeadConversion()` (service.ts) = daily region sweep + NeoDove attribution; estimates are owned by `Estimate.region` (R1–R4), close credit split 20% generator (automatic) / 80% closer (sales-head pick). The 21:00 EOD deduction, effort-sync, snatch/cover/bulk-assign machinery are **retired (2026-10-22)** — those routes return `{retired:true}`. Headless provider for the unified Sales workspace (see AGENTS.md "Domain quirks"). Triggered by `POST /api/trigger/telecalling` (secret-gated), NOT by in-worker node-cron. |
| `telecalling-agent-analysis` | handler | `*/30 * * * *` | Read Telecalling Agents sheet → per-agent metrics |
| `telecalling-enquiry-to-dpp` | rule | event+scan | Enquiry messages → DPP |
| `wa-engine-monitor` | handler | `*` | WA Engine session/health monitor + dashboard |
| `whatsapp-digest` | handler | event+scan | WhatsApp → AI digest (`process.ts`) |
| `whatsapp-marketing` | handler | scheduled/recurring | Campaign send via WABA/AiSensy |
| `zoho-sent-analyzer` | handler | `*/5` (GH) | Zoho sync + AI classification. Dashboard retired 2026-11-14 — renders as the Analyzer tab inside Sales (migration 0143 renames the automation to `Analyzer`) |
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
- `/api/neodove/report`, `/api/estimates/classify`, `/api/estimates/bulk-upsert`, `/api/estimates/movement` (Analyzer range SO counts; login-gated)
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
| GET | `/api/runner/crm/state` | Floor working set (SO rows, item counts) — drives the item backfill + deletion re-verify |
| POST | `/api/runner/crm/orders/sync` | **The only writer of CRM rows**: insert/update/self-heal orders, upsert items, flag `deleted_source`, score stage moves |

### 3.2a CRM dispatch floor (D1 rows, not a KV blob)
The CRM dashboard is a **scheduling floor**, not a read-only pipeline view. Zoho Books
stays **read-only**; the floor lives in D1 (migration `0097`):

| Table | Role |
|---|---|
| `CrmSalesOrder` | one row per `org + soNumber` — Zoho fields, client billing/shipping address, EST no. (`referenceNumber`), derived `lifecycle`, `sourceState` (`active`/`deleted_source`), miss counter |
| `CrmSoItem` | one row per line item — **the unit of scheduling**: tentative date, dispatch state, delay reason, dispatched qty |
| `CrmScheduleEvent` | append-only audit of every promise, slip and dispatch |

Lifecycle (derived from items, never set by hand):
`unscheduled → partially_scheduled → scheduled → partially_dispatched → dispatched`, plus
`cancelled` for Zoho `cancelled`/`void` (out of the queues, kept for audit). A committed
date that passes undispatched makes the item **overdue**, and the floor forces the
reschedule dialog (comprehensive reason) before it can move on.

Tab membership is **per item**, not per lifecycle bucket: an order with one dispatched,
one dated and one undated item shows under Dispatched, Scheduled and Schedule alike (a
`partially_dispatched` order with undated items used to hide from Schedule). Rows whose
items are not captured yet count as unscheduled; `cancelled` is out of every working tab;
every tab reads newest-first (created date desc, SO number desc). The detail pass captures
line items **and** the client addresses (billing/shipping) in one Zoho call, 80 orders per
tick; "Packaging & Forwarding" is a standing charge and is dropped at sync.

Rules exist once per runtime — backend `modules/crm/scheduling.ts` + `queues.ts`,
frontend `src/crm/lifecycle.ts` + `queue.ts` — and `scripts/guards/crm-lifecycle.test.mjs`
fails on any disagreement (state machine, overdue verdict, tab membership, validation).

The invoice-PDF proof gate (2026-11-04) is a **runtime switch**, not a constant:
Setting `crm:invoice_gate` = `enforce` (default) | `off`, toggled root-only in Settings
(`PUT /api/settings/crm:invoice_gate`, live event, no deploy). With `off` the floor may
dispatch without an invoice and the batch still writes its `CrmDispatchProof` row, with
`invoiceId = 'no-invoice:<uuid>'` standing in for the file — both `CrmDispatchProof.invoiceId`
and the core mirror's `core_dispatch_proof.invoiceId` are NOT NULL + UNIQUE, and a nullable
column would make the mirror's `INSERT OR IGNORE` drop those rows silently. Exactly two
points enforce the gate — `validateDispatch({ requireInvoice })` and
`verifyDispatchProof(…, requireInvoice)` (mirrored in the FE validator) — and it never
relaxes the scheduled-only / removed-line / quantity / already-dispatched rules; an invoice
that IS supplied is still verified, burned and never reusable. Readers expose such batches as
`noInvoice` (`files.invoice` null), so the panel says "no invoice" instead of drawing an
inert tile from the sentinel; accounts can audit with `WHERE invoiceId LIKE 'no-invoice:%'`.

**Dispatch cash lives on the floor (2026-11-26).** The in/out ledger that used to sit behind
`/api/accounts/cash` and an Accounts → "Dispatch cash" tab is now the floor's own surface:
`worker/routes/crm-cash.ts` serves `GET/POST/PATCH/DELETE /api/crm/cash` over the unchanged core
(`automations/accounts/cash.ts`), and the panel moved to `src/crm/DispatchCash.tsx` (mounted
through `components/CrmCashPanel.tsx` + `crm/hooks.ts#useCrmCash`, so the ledger is fetched only
while its tab is open, live on the `accounts` event). One gate for every verb — root/admin, `crm`,
`dispatch`, `accounts` — because the person who types an entry on a busy morning is the person
who must be able to correct or void it; the old "edits are accounts-only, so history can't be
rewritten from the floor" rule is retired with the move. Accounts lost the routes, the tab and
the `cashEntries`/`cashSummary` payload fields (the ledger no longer rides the accounts payload).
The same change adds `viewerMeta.canSchedule` = root + `crm`: the scheduling queue belongs to the
CRM desk, so a dispatch-only login gets the floor tabs without "To Schedule", and the scheduling
entry points vanish with it (card action hidden, panel mode filtered, a deep-linked `schedule`
mode falls back to Items). This is **visibility only** — `/api/crm/orders/:id/schedule` keeps the
same floor write gate. Guard `crm-cash`.

Sync: `scripts/crm-runner.js` pages Zoho and POSTs only the **in-window** slice
(`FLOOR_WINDOW_DAYS = 30`, mirrored in the store — Zoho reports 5,000+ open SOs and the
rate-limited per-order item fetch could never catch up on the backlog). Per-order
fingerprints skip unchanged writes; a row missing from the scan gets `missCount++` and is
flagged `deleted_source` at 2 (immediately on a re-verified 404), self-healing if it
reappears; a human confirms the removal and the row is purged with the audit kept.
Department points are scored from the status moves during sync — **dispatch +50 full /
+25 partial once per SO**, with the Zoho ship credit suppressed when the floor already
scored it so one shipment never scores twice.

### 3.2b Enquiry threads — three-desk Conversations (2026-11-20, migration 0148)

Per-item conversations between Sales, Procurement and Management, stored in D1 `EnquiryThread`
(one row per thread, `messages` JSON). Deliberately NOT in the enquiry `items` blob: items are
served by many paths (lists, queues, redacted procurement view, live summaries, Copilot AI
tools), and keeping threads out of them means none of those paths can leak a private thread.

- **Channels**: `sales` (sales ↔ management) and `internal` (management ↔ procurement). Sales and
  procurement never talk directly (`channelBetween` → null).
- **Visibility (founder rule)**: anything between procurement and management is never visible to
  sales. Every request names the acting `desk`; `service.ts` checks `deskAllowed(me, desk)`
  (management = `canManageRates`, procurement = `procurement` scope, sales = sales scopes;
  management access covers any desk) and serves only `channelsFor(desk)` — list, inbox and by-id
  (invisible ids 404). Live events carry ids only.
- **Flow**: either party replies (turn passes to whichever side owes the next move), either party
  resolves/reopens. A sales-facing query carries a **category** (founder decision 2026-11-21):
  `product_query` is ONE conversation shared by sales + management + procurement from the moment it
  is raised (no forwarding step) — procurement replies inline and, for sales, that reply reads as
  **Management**: the true author stays in the row, and the reply's sales-facing copy (`salesText`,
  plus `salesName` on attachments) has every vendor name replaced before it can be served. Sales is
  never given a marker, a name or the desk. `rate_negotiation` stays sales↔management — procurement
  gets 404 on list, inbox and by id. Legacy rows (`category` NULL) keep the pre-category behaviour:
  no backfill (founder 2026-11-21). `POST …/:id/forward` is retired (`{retired:true}`) because there
  is nothing left to send over. Index: migration `0151`; column: migration `0152`.
- **Only SALES can open a product query (founder rule 2026-11-23)**: the category is stored only
  when the thread is raised BY the sales desk — a question *management* asks sales ("does the client
  require rubber or rexene bag?") is private to those two desks, and `createThread` stores
  `category = null` for it. Procurement visibility therefore needs **both**
  `category='product_query'` AND `openedBy='sales'` (`pure.canSee` + the `visibility()` SQL mirror in
  `store.ts`), so a stray row can never leak into the procurement inbox even before a backfill runs.
  Migration `0162` cleared the two such rows that existed (management-opened queries on Enquiry No 7
  - 23 NOV TL); the FE composer shows the category picker for sales only and labels a
  management→sales query "Private with Sales — Procurement never sees this".
- **API** (`worker/routes/enquiry-threads.ts`): `GET /api/enquiry-threads?desk&enquiryId`,
  `GET …/inbox?desk&status`, `GET …/counts?desk`, `POST /api/enquiry-threads`,
  `POST …/:id/{reply,resolve,reopen,forward}`.
- **UI**: `components/enquiry-threads/` — `ItemQueries` ("Ask a query" button + that item's
  threads, inside every item card: Sales `SpecificationsSection`, `ProcurementItemCard`,
  `ManagementRatesPanel`), fed by one `EnquiryThreadsProvider` per open enquiry (one fetch, not
  one per item), and `ThreadInbox` (Open | Resolved per desk: Sales board "Queries" view,
  Procurement + Management "Queries" tab).
- Replaces the sales loop `query` ask ("Request info / alternate") and its 2026-11-19 post-rate
  gate. Since 2026-11-21 the Sales "Ask a query" button shows on every item once the estimate is
  marked sent (`enquiryRateState().sent`); before that only on items whose rate management has
  given (`finalRate` set), never on rate-available items; existing threads always show.
  Guard: `scripts/guards/enquiry-threads.test.mjs` (+ gate in `enquiry-loop-ask-kinds`).

### 3.2c HR leave applications — employee-applied, HR-decided (2026-11-22, migration 0153)

The HR leave register became a **request lifecycle on the same table**, so attendance and
payroll keep exactly one source of truth (`HumanResourcesLeave`); no second table, no mirror.

- **Employee surface**: sidebar **Leave** (`/leave`, `components/my-leave/`) — every approved
  login. `GET /api/leave/mine` resolves the caller's roster member (`resolveSelfHumanResourcesMember`
  cascade: `?as=` → `loginEmail` → contact `email` → unique name match) and returns **only their
  own** applications; an unlinked login gets `linked:false` plus the "ask HR to link your login"
  hint. Applying (`POST /api/leave/requests`) is `full_day` | `half_day` (0.5 working day) |
  `short` (a recorded `fromTime`–`toTime` window; no pay effect), any date, **purpose mandatory**;
  the member is always the caller (never the body), the date window is −30…+90 days, half/short
  must be a single date, and overlapping non-rejected leave is refused (`leave-requests-parse.ts`
  holds every pure rule — day maths is server-only so there is no FE mirror to guard).
- **HR surface**: HR → Leaves & holidays now leads with **Requests** — the tab carries the pending
  count (`TabBar` count with `tone:"danger"`, the same number pill the Accounts payment-reminder
  tabs use), fed by the dashboard payload (`leaves.pendingCount`, `isAdmin` only, so a self-scoped
  viewer never receives another person's leave). `GET /api/human-resources/leave-requests?status=`
  is month-free on purpose (pending work must not hide in another month);
  `POST …/:id/decide {action,note}` approves or rejects — **a rejection requires a note** the
  employee reads on their Leave page, only `pending` rows can be decided, and nobody decides their
  own request (`isRoot` excepted). Employees can withdraw their own still-pending request.
- **Consumers read `approved` only**: `attendance.ts` (auto-marked leave on the day view),
  `payroll.ts#computeStats` (full day = 1, half day = 0.5, short = present — the person worked),
  and `attendanceSummary.leaveDays`. HR's "Record leave" path still creates the row already
  `approved`, and migration 0153 defaults every pre-existing row to `status='approved'` /
  `durationType='full_day'`, so historical data behaves exactly as before.
- Live: every write broadcasts the existing `human-resources` event (no new event name);
  `invalidateHumanResourcesCache()` keeps the 5-min dashboard cache honest.

**Character / working names (2026-11-26, migration 0169).** `HumanResourcesMember` carries
`characterName` + `useCharacterName`; the legal `name` is never rewritten. Every
display surface (HR cards, org chart, payroll screen, leave/task audit labels, sales
leaderboard, notifications, chat) renders `employeeDisplayName()` =
`Character Name (Legal Name)`, or the legal name when the switch is off/blank. Backend
truth `shared/employee-name.ts` ↔ frontend mirror `hr/display.ts`; guard
`employee-display-name`. Payroll snapshots/PDFs and identity matching keep the legal name.

**Hiring kit (2026-11-26, migration 0170).** Each position holds any number of JD / SOP /
questionnaire PDFs (`HumanResourcesPositionDoc.kind` is plain TEXT; bytes live in `CHAT_FILES`
KV under `hrdocs/`) plus one optional `videoUrl`. `PATCH /api/human-resources/hiring-positions/:id`
accepts `name` and/or `videoUrl`; backend `cleanVideoUrl` and the FE mirror both add `https://` to
bare hosts and reject every non-http(s) scheme before saving. The tab renders a third questionnaire
slot plus an inline walkthrough paste/open/remove row; completeness = all three PDF kinds + a link.
Guard `hiring-kit`.

### 3.2d Procurement queue ownership — manual conclude only (2026-11-21)

The sourcing queue is the procurement desk's own worklist, not a mirror of the estimate lifecycle.

- **Active** = has items AND the requirement is not dead in Zoho AND `procurementSubmittedAt` is
  empty. **History** is the exact complement, so every row is in exactly one tab
  (`isProcurementPendingEnquiry` / `isProcurementHistoryEnquiry`, backend
  `modules/enquiries/queues.ts` ↔ frontend `src/enquiry/queue.ts`, guard `queue-mirror`).
- **Nothing else closes a row.** `rateStatus` (`rates_received` / `finalized` / `sent`) and Zoho's
  draft/approved state are not gates: both auto-conclude paths are gone —
  `routes/enquiries.ts#maybePromoteEnquiriesSent` now stamps only dead rows
  (`isZohoClosedStatus`) and auto-answers their open loops, and
  `update-parts/pure.ts#applyRateLifecycles` still answers sent spec asks but never stamps the
  handoff. This supersedes the 2026-09-23/09-25 "Zoho not draft → procurement done" rule.
- **Late quotes still work**: a new vendor quote on a finalized row runs `applyLateQuoteReopen` and
  reopens the decision for management; the item card has no `finalRate`/`submitted` lock (only
  `notAvailable` / an open `not_available` ask read as read-only).
- **Repeats are first class**: one vendor may carry several quotes for the same product (different
  size, spec or terms). Merge identity stays `vendor|rate` with the twin-preserving greedy match,
  the decision persists the exact row via `selectedRateIdx`, and procurement re-seeds a repeat with
  the `+` affordance on a rate row (repeat rows are numbered `#n`).
- **Sales order brief**: under each item's spec the sales view shows an amber "⚠ Order this spec —
  not the client's original" block (`specSame === false` → `specDiff`) and an emerald "Note from
  Management" block (`salesNote`), plus matching header chips. It is deliberately **not** gated on
  `rateStatus`, because the order is placed *after* the estimate is sent. Vendor identity stays
  hidden — only the differing spec text and the note go out.
- **The brief must survive the client normalizer**: the decided and shared quote rows are served
  vendor-stripped with `anonymous: true` (`stripMarginFields`), and
  `frontend/src/enquiry/normalize.ts` keys on that marker. Filtering quote rows on a vendor name
  (the old rule) dropped the entire `rates` array for every non-root login: the item still showed
  "Rate Received" (that reads `finalRate`, never stripped) while the ORDER BRIEF and its chips
  stayed invisible — root kept the vendor name, so root alone saw them. A non-privileged write
  never merges a vendor-less rate row (`normalizeItemWrites`), so an anonymized echo cannot create
  a phantom quote. Guard `sales-redaction` pins the server marker + all three client outcomes.
- Chat composers send on plain **Enter** (`Shift+Enter` = newline) in `ThreadCard` and
  `NewThreadForm`. Guard `enquiry-procurement-ownership` pins all of the above.

### 3.2e Accounts task threads — one task, not one card per day (2026-11-25, migration 0166)

The accounts taskbar used to render a fresh card for every due day, so a task that repeats on the
15th and 30th was two unrelated cards and a day nobody opened the dashboard produced **no row at
all** (`ensureInstances(today)` only ran inside the dashboard request). `AccountsTaskLog` was
already shaped like a thread entry — `UNIQUE(templateId, dueDate, slot)` — so the model was
extended, not rebuilt:

- **Entry columns** — `entryKind` (`instance` | `auto_miss`), `lateNote`, `lateNoteBy`,
  `lateNoteAt`; template gains `dueTime` (HH:mm IST) and `shortTitle` (the sheet titles are 60+
  characters).
- **Window** — the Indian financial year (1 Apr → 31 Mar), `service-parts/thread.ts#threadWindow`.
  A window rule's span is its deadline: `isMissable` only lets the LAST day of
  `day_range`/`week_of_month`/`month_day_range` become a miss, inner days are grace.
- **Engine** — `thread-io.ts#runThreadMaintenance` instantiates every due day of the window and
  writes `status='not_done', entryKind='auto_miss'` for a past due day with no human entry. The
  sentence "Task not done on 15 Nov 2026" is rendered from the date (`missLabel`), never stored.
  It runs natively in `worker/cron.ts` at the 02:30 UTC slot (08:00 IST) — deterministic, no LLM,
  no GitHub dispatch, and quiet hours don't apply (nothing pings Zoho). The same 14-day repair also
  runs on read inside `computeDashboard`, so a cron hiccup can never hide a due day.
- **Resolution semantics (founder rule)** — a missed day stays `not_done` forever. Writing a
  `lateNote` ("what was done late, and when") is the resolution *audit trail* and changes nothing
  else; marking Done is a separate explicit action. A human "Not done" with a remark is a valid
  negligence record for that day.
- **Buckets** — `bucketOf` → `done` · `not_done` · `late` (missed + note, still not done) ·
  `missed` (auto, no note = unexplained) · `pending`. `unresolved = missed + not_done`.
- **API** — the workspace payload adds `threads` (one row per template × lane, counts per slot +
  `completionPct`, cache prefix `accounts:dashboard:v3:`); `GET
  /api/accounts/tasks/:templateId/thread?slot&from&to` opens one thread; root
  `POST /api/accounts/threads/sync` backfills a year; `GET /api/accounts/export?shape=thread`
  (default) emits one row per task × lane with the window's entries inlined, `shape=daily` keeps
  the cell grid for audit. File/upload handlers moved to `routes/accounts-files.ts`.
- **UI** — `components/accounts-dashboard/ThreadList.tsx` + `TaskThreadRow.tsx` +
  `ThreadEntryRow.tsx`: today's open tasks render expanded (logging unchanged, one remark input per
  day), everything else collapsed, with search / frequency / "unexplained only" and a root
  "Sync year" button. Rows are keyed `templateId::slot`, which also fixes the duplicate-key and
  cross-lane remark bugs of the old grid. Guard `accounts-thread`.

### 3.2f Debtors Tracker point-in-time views (2026-11-24, migrations 0161/0162)

The Debtors Tracker stores only current state, so an "as of" view is **derived, never stored**:
`GET /api/debtors-tracker/data?asOf=YYYY-MM-DD&from=YYYY-MM-DD` rebuilds the entire dashboard
(same payload shape) as it stood on `asOf`, and `from` adds a then-vs-now block. No parameters =
today, and that path is byte-identical to the pre-feature computation (guard-asserted).

- **Rules** (`automations/debtors-tracker/as-of.ts`, pure): an invoice is visible when
  `invoiceDate ≤ asOf` (else `createdAt`); a receipt when `collectionDate ≤ asOf`. Ageing is
  re-derived at `asOf` (`daysBetween(due || invoiceDate, asOf)` → the same buckets), and
  `buildLiveInvoices(rows, colls, asOf, { asOf })` applies it. Advances at that date reduce
  `netDue` exactly as today.
- **Received money** is the honest part: `receipt = Σ matched collections ≤ asOf`, and the pasted
  sheet's cumulative "Amount Received" counts only from the import that recorded it
  (`lastImportAt`), or from `DebtorInvoiceReceivedEvent` rows once they exist. `importDebtors`
  appends the **delta** on every paste (migration 0162, backfilled from `lastImportAt`), so sheet
  history is exact after the first import that shipped this. Money is never invented: before either
  stamp it is treated as unknown (higher receivable, never a fake receipt).
- **Soft deletes** stamp `deletedAt` (0161) so a bill deleted **after** `asOf` still shows at that
  date; legacy deleted rows stay invisible everywhere.
- **Comparison**: `compare = { then, now, movement, migration }` where
  `movement` reconciles exactly — `receivableChange = invoicedInRange − collectedInRange −
  sheetAdjustments` (advances reported separately because they move `netDue`, not gross), plus
  bills booked/settled, customers added/settled, aged-deeper/shallower, paid. `migration` is the
  invoice bucket transition list (then → now).
- **Read-only by design**: `meta.isHistorical` disables imports, edits, pins and the reminder run
  in the UI, and a banner states the limits. Region, CRM situation and promises are current-only
  (no history table) — the payload says so in `meta.caveats`.
- **Cache**: per-(asOf,from) variants fold `cacheRevs(['debtors'])`; every write calls
  `bumpRev('debtors')` (`invalidateDebtorsCache`) instead of a prefix delete.
- **UI**: shared `components/ui/DateRangePicker` (presets + two dates; reused by other dashboards,
  never forked), `components/debtors-tracker/RangeBar` (picker + historical banner),
  `tabs/summary-tab/ComparisonSection` (then vs now, ageing shift, movement). The customer Ledger
  endpoint takes the same `?asOf=`. Guard: `scripts/guards/debtors-as-of.test.mjs`.
- **Invoice-number sort** (2026-11-26): `debtors-tracker/multi-sort.ts#compareInvoiceNo` is the one
  comparator for the invoice column (Invoices tab, Collections tab, overdue export) — the trailing
  `/` segment cast to Number (`BUI/26-27/751` → 751), numeric serials first, numeric-aware string
  fallback, always finite (a `NaN` comparator reads as "equal" and silently disables the sort and
  every sub-level under it). A click on a new column APPENDS under the active sort instead of
  replacing a pristine default, so "Date ↓ › Invoice No. ↑" is one gesture; `Reset` restores it.
  The historical view's empty state names the date (`asOf`), never "nothing was ever imported".
  Guard: `scripts/guards/debtors-invoice-sort.test.mjs`.

### 3.2g HR documents, controller lists, assets and the editable org chart (migrations 0171–0173)

Four HR gaps were closed without changing the frozen Express routes; every endpoint below is
Worker-only and writes broadcast the existing `human-resources` event.

- **Employee documents** — HR owns the checklist (`HumanResourcesDocumentType`: name, required,
  order, active) and uploads one file per type per employee (`HumanResourcesMemberDocument`).
  `GET/POST /api/human-resources/members/:id/documents` lists/uploads (multipart
  `documentTypeId`, optional `title`, `file`), `DELETE /api/human-resources/member-docs/:id`
  soft-deletes, `GET …/:id/file` streams from KV `hrdocs/emp/<uuid>.<ext>`. Limits: 20 MB,
  PDF/JPEG/PNG/WebP. The list returns the types in order with their files and a required
  completeness count; an upload is rejected when the type is archived.
- **Expense categories** — controller-owned `HumanResourcesExpenseCategory` instead of free text.
  `HumanResourcesExpense.categoryId` is nullable for historical rows and is backfilled by
  `lower(trim(category))` in 0171; new/edited expenses must resolve an **active** category
  (`lookups.ts#resolveExpenseCategory`). The old `category` text column stays as the display/legacy
  value, so reports that read it keep working.
- **Assets** — `HumanResourcesAsset` is the thing an employee holds (type, label, identifier,
  specs, status, dates, notes); `HumanResourcesAssetType` is controller-owned. Role standards are
  `HumanResourcesPositionAsset` (chart position + type, quantity, required, spec note; unique
  pair). `GET/POST/PATCH/DELETE /api/human-resources/assets` and
  `/api/human-resources/position-assets`. This is deliberately separate from office Inventory.
- **Editable org chart** — `OrgChartPosition` (0172) replaces the read-only JSON as the runtime
  chart; `organization.json`/frontend `ORG_CHART_JSON` remain the verbatim seed/fallback
  (`org-chart-parity` + `org-chart-edit` guards). Lazy seed `modules/org/chart/seed.ts` inserts the
  top first then the rest in 5-row chunks (`skipDuplicates`, below D1's bound-parameter cap). `GET /api/org/chart` is viewer-open; writes
  (`POST/PATCH/DELETE /api/org/chart/positions`) require root/admin or the `human-resources`
  scope. Writes validate title uniqueness, known `loginPosition`, wing/department, cycle-free
  reporting, head→top, and block deleting the top, renaming/deleting a position with children,
  active seats, role mappings or position standards. `loginPosition` only drives suggestions in
  the employee picker; access remains in Users & Permissions. The frontend selector and graph
  consume the live rows and fall back to the bundled chart when the table is unavailable.
- **Sales regions + team-lead hierarchy (0175)** — owned by the **Sales Controller** (sales-head/root), not HR: the taxonomies that used to be hard-coded in
  `automations/telecalling/regions.ts` are HR master data. `HumanResourcesRegion` keeps the code
  fixed (`R1`–`R4`: `Estimate.region`, `ClientClass.masterRegion`, holidays, targets and the
  board's region buckets all store it) and makes `name`, `tlLevel`, `states`, `order` and
  `active` editable; `HumanResourcesPositionRegion` allots regions to a chart seat (unique
  `positionId+regionCode`, **no rows = every active region**, so adding the table never
  invalidates existing seats). There is no second roster: `GET /api/org/people` + the one
  `PUT /api/org/people/:id` save is the only writer, and `modules/org/regions.ts#validateSalesPosting`
  decides from the seat title: a telecaller/field-staff seat takes exactly one active, allotted
  region; a team-lead seat takes **exactly two different** ones and may omit `tlLevel` (inferred
  when both regions share a tier, otherwise the form must ask). Reads: `GET /api/org/regions`
  (viewer-open, used by the person drawer) and `GET /api/sales/regions` (`requireSalesManager`, adds
  seat counts + chart positions for the allotment matrix). Writes: `PATCH
  /api/sales/regions/:code` (sales-head/root; bumps the `est` rev because the board payload caches
  the taxonomy) and `PUT /api/sales/position-regions/:positionId` (refuses to drop a region an
  active seated employee still holds → 409). The Sales mount of the chart passes
  `chartEditable={false}`: seats are edited, positions are not — HR keeps add/edit/delete. The telecalling board
  overlays the DB rows onto its bundled fallback (`loadSalesRegions`), so a fresh DB and a renamed
  region behave the same.

### 3.3 Trigger dispatch
`POST /api/trigger/:slug` runs the matching automation (auth required). On the Worker,
cron-driven automations are reached via GitHub Actions → `curl /api/trigger/:slug`.

### 3.4 KV cache layer (`CACHE_KV`)

A dedicated Cloudflare KV namespace **`CACHE_KV`** (`wrangler.toml` binding) caches
expensive **network calls and D1/Postgres reads** across the app so the GitHub Actions
runners and dashboards never hammer the database on every broadcast.

**Reusable module — `src/shared/cache.ts`:**
- `cacheGet<T>(key, ttlMs)` → cached value, `null` when absent or stale.
- `cacheSet<T>(key, value, ttlMs)` → write payload + `computedAt`, with a 5-min grace
  window so stale-on-error fallback still works.
- `cached<T>(key, ttlMs, compute)` → **read-through helper** every route should use:
  fresh → serve; stale/absent → compute → store → return; compute fails → serve stale.
- `cacheDel(key)` / `cacheDelPrefix(prefix)` → explicit invalidation the moment
  underlying data changes.
- **Local fallback:** non-Worker runtimes (Express) have no KV binding, so the module
  falls back to an in-memory map with the same TTL contract — identical code paths.
- Keys are namespaced (`kvx:<key>`) so they can't collide with chat files.

**Migrated caches (Setting-table → KV):**
| Cache | Key | TTL | Invalidation |
|-------|-----|-----|--------------|
| Zoho estimates payload | `sales_copilot:estimates_cache` | 5 min | on bulk-upsert / comment / status / classification runner writes |
| Telecalling risk model | `telecalling:risk_cache` | 15 min | on estimate mutations + after each assignment-engine run |
| NeoDove KRA attribution | `neodove:kra_cache` | 10 min | on NeoDove report writes |
| NeoDove report range reads | `neodove:report_range:<from>:<to>` | 5 min | on NeoDove report writes |
| WA Engine snapshot | `wa-engine:snapshot` | 6 min | TTL only (monitor cron refreshes) |

**Invalidation wiring:** the runner endpoints that mutate data (`/api/estimates/bulk-upsert`,
`/api/runner/zoho/comments`, `/api/runner/zoho/status`, `/api/runner/zoho/classification`,
`/api/runner/neodove/report`, `neodove-refresh`) explicitly invalidate the affected caches via
`invalidateDerivedEstimateCaches()`, `invalidateNeodoveCache()`, and `invalidateRiskCache()`,
so the next dashboard read is fresh. `initCache(env)` is bootstrapped in `bootstrapEnv()`.

### 3.5 Zoho analyzer no-change fast path (fingerprint)

The 15-min `zoho-sent-analyzer` runner previously re-scanned **every estimate + comment row in
D1** on every tick just to *detect* whether anything changed — burning thousands of row reads
even when Zoho was quiet (the actual cause of D1 row-read limits, not AI). Now both analyzer
paths compute a **fingerprint** of the Zoho payload from their own network fetch and skip ALL
DB work when it matches the last fully-processed state:

- Fingerprint = per-estimate `estimate_id | status | total | last_modified_time | maxCommentId`
  (comments don't bump `last_modified_time`, so max comment id is included).
- Stored in KV at key `zoho:analyzer:state_fingerprint` (24h TTL; only changes on real change).
- **In-process (`SalesCopilotService.runSync`)**: fetches estimates + comments (network),
  computes fingerprint, compares via `cacheGet`; unchanged → skip `estimate.findMany`,
  `comment.groupBy`, status sync, classification. On a failure-free run → `cacheSet`.
- **GH Actions runner (`scripts/zoho-sent-runner.js`)**: fetches estimates + comments
  (network), computes the same fingerprint, checks/stores via
  `GET/POST /api/runner/zoho/fingerprint`. Unchanged → exit early with **zero DB reads**.
- Both paths share the same KV key, so they stay in sync. `ZOHO_FORCE=1` bypasses the gate.

### 3.6 CORS (browser → Worker)

The dashboard normally talks to the Worker **same-origin** via the Pages Functions
`/api` proxy (`founder-os_frontend/functions/api/[[path]].ts` → `env.API_WORKER_URL`),
so no CORS headers are needed. A browser calling the Worker **directly**
(e.g. a NeoDove token extractor running on `connect.neodove.com`, or any external
integration) triggers a preflight, and the browser blocks the response unless the
Worker returns `Access-Control-Allow-Origin`.

- `src/worker/context.ts` (`createApp()`) mounts `hono/cors` first: it reflects a
  known `Origin` (never `*`, because `credentials: true` on an authenticated API)
  and answers `OPTIONS` preflight with `204` + CORS headers automatically.
- Allowed without config: `*.pages.dev`, `localhost`/`127.0.0.1`, and
  `*.neodove.com` / `neodove.com` (token-extractor use case), plus the explicit
  `https://founder-os-frontend.pages.dev` and `https://connect.neodove.com` entries.
- Anything else goes in the `ALLOWED_ORIGINS` Worker secret/env (comma-separated
  exact origins, e.g. `https://app.example.com`):
  `printf '%s' "$VAL" | wrangler secret put ALLOWED_ORIGINS`.
  The check reads `c.env.ALLOWED_ORIGINS` per request (with the bootstrapped
  `__WORKER_ENV__` snapshot as fallback, since cors runs before `bootstrapEnv()`
  on a cold isolate).
- `allowHeaders` includes `Content-Type, Authorization, X-Api-Key, Cookie` —
  `X-Api-Key` must stay listed because WA Engine Pro webhooks send it and a
  browser preflight naming it fails otherwise. `maxAge` is 86400s (preflight cache).
- Unknown origins get **no** `ACAO` header (tight fail-closed); the fix for a
  blocked preflight is adding the caller origin to `ALLOWED_ORIGINS`, not `*`.
- Server-to-server callers (GH Actions runners, relay, local-runner) are unaffected.

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

`local-runner.js` ports `deterministicClassifier.ts` rules and calls a legacy local
endpoint for ambiguous messages; it naturally drains backlog accumulated while the
machine was off. (Local/dev path only — it is not part of the production AI pool;
production GH runners call `POST /api/ai/complete`.)

## 5. GitHub Actions — AI processing & scheduling

Heavy jobs are standalone Node scripts in repo-root `scripts/` that call the Worker's
`/api/runner/*` (D1 reads/writes) and get AI **only** through
`POST /api/ai/complete`. The pool lives in `src/shared/ai-gateway.ts` (edge-safe,
used by the Worker enquiry extractor and Express `AIService`); `scripts/ai-gateway.js`
is a small helper/KeyPool port, NOT a local gateway.

Gateway design (one place, one chain, direct egress):
- **Key pool**: `KeyPool` in the gateway owns every key with per-key health
  (`failures`, `cooldownUntil`, `enabled`, `successCount`, `lastError`).
- **Key config**: Setting `ai:providers` BYOK JSON **only** (root-only Settings UI,
  20 providers × 10 keys max, OpenAI-compatible `{id,baseUrl,model,keys,enabled}`;
  never echoed — GET/PUT redact to ids/labels/last4 + counts). Env `AI_KEYS`,
  `OPENROUTER_*`, `REQUESTLY_*`, `AGNES_*` etc. are **ignored** (founder
  decision 2026-11-27); an empty/missing Setting = an empty pool. The Setting is
  authoritative on every configure: keys deleted there are pruned from a warm
  isolate, while surviving keys keep their runtime health. Placeholders ignored.
  Deduped. `providers[].enabled=false` and `keys[].enabled=false` are **pure
  filters**: nothing is deleted, selection simply skips them; re-enabling restores.
- **Chain**: `resolveAiChain()` — the Setting list order and nothing else;
  every caller (copilot chat, enquiry extraction, vision intake, catalogue
  lookup, runners via `POST /api/ai/complete`) walks the same legs with the
  same sticky `sessionKey`. No per-task providers, no relay, no paid lane.
- **Selection**: global `ai:strategy` (`least-used-first` default: random
  inside the least-failures tier; `round-robin`: cycles the healthy tier).
  `sessionKey` still sticky-pins while healthy. A key is eligible only while
  `enabled` (runtime), `allowed` (persisted switch) and its provider is on.
- **Failure handling**: 401/403 → key disabled permanently; 404/405 → the whole
  provider is quarantined for 5 min (a retired model slug is not a key fault);
  429 → cooldown (honors `retry-after`; 1015 cools briefly) and the next key is
  tried **immediately**; 402/quota → 5-min cooldown; 5xx/network → short
  cooldown + rotate. **Immediate failover (2026-11-27)**: every attempt takes a
  fresh key, never sleeps between attempts, and is aborted at a first-byte
  deadline (30 s non-stream) or first-token deadline (20 s stream) plus a total
  attempt cap, so one dead API can never hold an enquiry. A pinned key
  (playground) is tried exactly once; a provider leg gets 3 tries, a pool-wide
  call 6, each leg budgeted at 120 s. A caller cancel is never charged to the
  key, and a stream that already delivered a delta is never retried (no
  duplicate text). Separately, the **health sweep** scores each configured key
  and auto-disables it below the threshold (or after 3 consecutive auth/quota
  failures) — see the key-health block below.
- **Providers** (all OpenAI `/chat/completions` wire format): exactly the
  Setting list — any OpenAI-compatible vendor the operator adds. Each leg serves
  its own configured model (Setting `model`). There is no built-in provider or
  default model, so adding/removing a vendor = one Settings card, no code and no
  deploy.
- **Output is uncapped (founder rule 2026-11-27)**: no gateway request ever
  sends `max_tokens`, so every call (runners, copilot, enquiry AI, playground)
  runs to the model's own maximum. `maxTokens` is still accepted on
  `CompletionRequest`/`POST /api/ai/complete` for wire compatibility but is
  ignored.
- **Surface**: `POST /api/ai/complete` (`{messages, temperature,
  model?, provider?, json?, sessionKey?, timeoutMs?}` → `{content, provider,
  model, usage}`; viewer session OR `SHARED_SECRET`) is the single endpoint;
  `gateway.complete()/completeJson()` is the same pool in-process.
  `scripts/runner-lib.js` `groq()/groqJson()/aiText()` are thin wrappers
  over the endpoint and FAIL when the Worker is unreachable — there is no local
  gateway or env-key fallback. `GET /api/ai/health` shows strategy + per-provider
  usable/total (no keys); for root it also returns the redacted provider
  config with per-key health/controls. `POST /api/ai/providers` manages the
  list merge-safely (root only, redacted responses).

**AI key health + Settings playground (2026-11-27, mig `0174`)** — the pool
measures itself instead of only reacting per request:
- **Ledger**: every provider call emits one `GatewayCallMetric` (provider,
  fingerprint key id, ok/status/error kind, latency, TTFT, tokens, streamed,
  `source`). The Worker's request middleware wires the sink in `createApp()`
  and writes to D1 `AiKeyCall` with `waitUntil` (the call never waits on D1);
  the Express path and the JS runner helpers leave the sink unset. 30-day
  retention, pruned by the sweep.
- **Buffered vs streamed JSON (2026-11-27)**: `completeJson()` is the buffered path — the provider sends nothing until the answer is complete, so its first-byte deadline (30 s) fires long before a real split lands (measured: 66 s buffered vs 6 s to first token for the same 1k-char / 20-line enquiry). `completeJsonStream()` consumes `stream()`, assembles the deltas and parses them (same `extractJson` fallback, same failover/telemetry); enquiry intake (split, KYP lookup, spec check) and field extraction use it. The write path also runs the split BEFORE extraction: the split is the sales user's visible action, and a slow enrichment pass ahead of it starved `waitUntil` on create (guard `ai-pool-controls`).
- **Score** (`shared/ai-gateway-parts/health.ts`, pure): `100 × (0.5·reliability
  + 0.3·speed + 0.2·throughput)` over the newest ≤50 non-playground calls in
  24 h. Reliability subtracts weighted failures (auth/quota 1.0, timeout/network
  0.7, bad_response 0.5, server 0.4, rate_limit 0.2); speed maps streamed TTFT
  between `ttftGoodMs`/5000 and `ttftBadMs` (neutral 70 when a key has no
  streamed sample); throughput maps tokens/sec against `tpsTarget` 40.
- **Policy** (Setting `ai:health`, defaults below): `threshold 40` = auto-disable,
  `atRisk 60` = amber, `minSamples 5`, `autoDisable true` (set false for
  observe-only). The native `* * * * *` cron runs `runAiKeyHealthSweep` every
  5 min in all hours, writes `keys[].health` back into `ai:providers`, and a
  failure path disables a key immediately on 3 consecutive auth/quota errors.
  Manual re-enable clears the disable reason and stamps `healthResetAt` so old
  samples cannot re-kill the key; there is no auto-recovery.
- **Controls**: `PATCH /api/ai/providers/:id` and
  `PATCH /api/ai/providers/:id/keys/:kid` (root, `:kid` = the public
  fingerprint id) flip the persisted switches; `GET /api/ai/key-calls?limit=`
  is the drill-down.
- **Playground**: `POST /api/ai/test` and `POST /api/ai/test/stream` (root only)
  pin an exact key and measure that key — streamed SSE events `meta|delta|done|error`
  carry TTFT/latency/TPS/tokens. Output is the model's own maximum (the gateway
  never sends `max_tokens` anywhere), and long answers get a 120 s default /
  5 min cap stream. Probes are stored `source='playground'` and are
  excluded from health, so a slow manual test can never disable a key. The UI
  is Settings → AI gateway (`components/settings/ai-gateway/`), with the live
  pool, provider/key switches, health badges, threshold editor and the chat
  playground; transcripts stay client-side.

Telecalling production status: the `telecalling` automation is **production-live and
fully deterministic (no LLM)** — `runLeadConversion()` in
`founder-os_backend/src/automations/telecalling/service.ts`. Live cadence: `cron-daily-ist.yml`
02:30 UTC slot fires `POST /api/trigger/telecalling` at 08:00 IST (region sweep + NeoDove
attribution). Estimates are region-owned (R1–R4, no individual dealing); the
`TelecallerScoreEvent` ledger uses close slabs split 20% generator / 80% closer. The 21:00 IST
EOD deduction, effort-sync runner, snatch shield and round-robin dealing were **retired
2026-10-22** (founder decision). Dashboard: the Sales Leaderboard tab of the unified Sales
workspace ← `/api/session/workspaces/telecalling/data` (legacy alias
`/api/automations/telecalling/data`) + `/api/estimates` (KV-cached, live via EventHub).
Full rules: AGENTS.md "Domain quirks".

| Workflow | Cadence (UTC) | Jobs |
|----------|---------------|------|
| `cron-every-5min.yml` | `*/5` | `whatsapp-digest-runner.js` (heavy AI), `whatsapp-autopilot-runner.js` (shadow), light-trigger curls (wa-engine-monitor, morning-queue-drain, orphaned-message-recovery, outbound-intent-recovery, sla-monitor, whatsapp-marketing, notification-batcher) — never pings Zoho |
| `cron-every-10min.yml` | `*/10` | `neodove-report-runner.js` (today, intraday overwrite — GH egress fallback; primary population is the native in-worker refresh every 5 min) |
| `cron-every-15min.yml` | `*/15` | `crm-runner.js` (dispatch-floor sync: Zoho orders → D1 rows), `zoho-sent-runner.js` (full sync + AI: All-status 2-page fetch, transitions, gated AI — see `scripts/zoho-sync/README.md`; `force` dispatch reprocesses all eligible) — serial group, one Zoho pinger at a time |
| `cron-every-30min.yml` | `*/30` | `email-brain-index-runner.js` |
| `cron-daily-ist.yml` | one slot per job family, gated on `inputs.slot` (`all` = manual): **02:30** (08:00 IST) telecalling distribution + `morning-brief-runner.js` · **13:30** (19:00 IST) `eod-summary-runner.js` + `neodove-report-runner.js` (yesterday + N-day backfill) · **19:30** (01:00 IST) baseline-freeze · **21:30** (03:00 IST) data-retention + `linkedin-daily-runner.js` | (15:30 EOD-deduction slot retired 2026-10-22) |

Secrets for runners: `WORKER_URL`, `SHARED_SECRET`. AI keys are NOT runner
secrets — they live only in Setting `ai:providers`; runner AI is
`POST /api/ai/complete`.
Zoho creds are inferred at runtime from
`founder-os_backend/zoho_sent/sent_estimates.txt` (cURL export) — no separate Zoho secrets.

### 5.1 External dispatch (Cloudflare Worker Cron Triggers → workflow_dispatch)
GitHub's native `schedule:` is unreliable (observed 1–6 h drift), so all workflows are triggered
externally. Originally cron-job.org, then a cPanel cron job (`216.10.246.39` → `~/gh-trigger.sh`),
but the shared-host cron dropped executions (75–345 min gaps — observed 1 Sep 2026), so dispatch
moved to the **Cloudflare Worker's native Cron Triggers** (free plan, ≤3 per worker; we use 2):

```
Cloudflare Cron Trigger on founder-os-worker (wrangler.toml [triggers])
  └─ * * * * *  → scheduled handler runs EVERY minute (router pattern)
       ├─ minute-aligned gates (UTC) decide what is due:
       │     every-5min  → minute % 5 == 0
       │     every-10min → minute % 10 == 0
       │     every-15min → minute % 15 == 0
       │     every-30min → minute % 30 == 0
        │     daily       → 02:30 / 13:30 / 19:30 / 21:30 UTC (one slot per
        │                     job family; workflow gates each job on inputs.slot)
       │     neodove-refresh → minute % 5 == 0 (native D1 write, ops hours only)
       │     quiet-hours gate → 21:00–09:00 IST pauses Zoho/NeoDove analysis
       │       (10/15-min skipped; 5-min fires WhatsApp + light triggers only,
       │        never pings Zoho; daily fires with run_neodove=false)
       └─ ctx.waitUntil(Promise.all(...)) fires all due workflow_dispatches
            └─ GitHub Actions runs the workflow on demand
```

- The router lives in `src/worker/cron.ts` (wired as the `scheduled` handler from `src/worker.ts`): `dueWorkflows()` computes which
  workflows are due at the current UTC minute and fires `workflow_dispatch` for each concurrently
  via `ctx.waitUntil(Promise.all(...))` so the worker never blocks on a slow endpoint. One `* * * * *`
  Cron Trigger runs every minute; the handler no-ops (cheap) when nothing is due.
- Cadence gates use `event.scheduledTime` (the slot Cloudflare intended), NOT wall-clock execution
  time — cron events are delivered 1–2 min late and time-based gates would drift/skip otherwise.
- **Quiet hours 21:00–09:00 IST** (no shop-floor operation): Zoho/NeoDove-backed analysis pauses via
  `isOpsWindow()` in `src/worker/cron.ts` — every-10min (neodove-today) and every-15min (crm +
  zoho-sent-analyzer, serial group) dispatches are skipped, every-5min keeps firing (WhatsApp
  jobs + light triggers only — it never pings Zoho), daily dispatches with `run_neodove=false` (skips `neodove-report`;
  brief / telecalling / retention / baseline read D1 and run), and the native neodove-refresh (+ warmer)
  is skipped in-worker. Manual dispatch defaults both inputs to true, so overnight manual runs work.
- Auth: `GITHUB_ACCESS_TOKEN` is a Worker secret (the `ghp_` PAT from `.env`; set via
  `printf '%s' "$GITHUB_ACCESS_TOKEN" | wrangler secret put GITHUB_ACCESS_TOKEN` — `echo` would add
  a newline). The dispatch request sends a `User-Agent` header — GitHub rejects requests without it
  (HTTP 403 with an empty body from Cloudflare egress).
- The old cPanel dispatch lines are commented out (`#DISABLED-CF-WORKER-CRON`) but left on the host
  for rollback; only the D1 backup and health ping remain active there.
- Manual equivalent: dispatch from the Actions tab, or `curl` a `workflow_dispatch`
  to the workflow file (see `src/worker/cron.ts` `dispatchGitHubWorkflow` for the exact call).

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
  `SHARED_SECRET`. AI keys are not runner secrets — the Worker Setting owns them.
   Zoho creds are inferred at runtime from `founder-os_backend/zoho_sent/sent_estimates.txt`.


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
- **AuthRole** — **bundles automation-dashboard scopes only** (`DASHBOARD_SCOPES` allowlist): `key`, `label`, `description`, `scopeKeys`. A user's effective scopes = direct scopes ∪ their roles' scopes. Roles are the primary way founders grant access (e.g. `sales-head` → `telecalling`); the admin panel assigns roles to users instead of ticking every scope checkbox. The MIS role was retired 2026-11-12 (migration 0139) — ex-MIS management endpoints are root-only.
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

`POST /api/token/webhook` also accepts a limited browser key for the NeoDove
token extractor (no login cookie in that context): `TOKEN_WEBHOOK_KEY` Worker
secret, sent as `Authorization: Bearer <key>`, `X-Webhook-Key`, `?key=`, or
`body.key`. It can only write `source: "neodove"` (any other source → `403`);
reads (`GET /api/token/*`) stay `SHARED_SECRET`-only. The value lives only as a
secret (`wrangler secret put TOKEN_WEBHOOK_KEY`), never in code.

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
├── hooks/{useEnquiryData, useTheme, useToast, useCSV, useLocalStorage, useHashRoute,
│          useLiveData, useLiveEvents}.ts
├── types/index.ts  mockData.ts
└── components/
    ├── layout/{Sidebar, MobileNav}.tsx
    ├── Automations                    # automation registry viewer (renderDashboard switch)
    ├── ZohoEstimates + zoho/{EstimateCard, CommentsTimeline, DailyMovementTracker,
    │   CallingPriorityChecklist, ActiveFilters, KpiCards, ZohoEstimatesHeader, types, utils}
    ├── TelecallingDashboard           # leaderboard + At-Risk + Lead Conversion/Generation
    │                                  #   filter = presets (?period=) OR custom ?from=&to=
    │                                  #   (pure.ts#resolvePeriod; 93-day cap; meta.periodKind)
    ├── EnquiryTracker + Enquiry{List,Detail,Modal,RowItem}  # live sales pipeline
    ├── NeodoveTelecallerDashboard, WaEngineDashboard, DppPricesDashboard
    ├── CrmDashboard                   # dispatch floor (schedule → dispatch → reschedule; D1 rows)
    ├── WhatsAppMarketingDashboard
    ├── AutopilotDashboard, WhatsAppDashboard
    ├── SheetAnalysisDashboard         # generic fallback for data()-only automations
    └── FounderAssistant               # AI chat (Brain RAG)
```

`page.tsx` is the shell: `<Sidebar>|<MobileNav>` + view switch wrapped in
`<ErrorBoundary>`. Each dashboard is a self-contained component that reads its
automation's `data()` endpoint via `/api/automations/:slug/data` (proxy → worker).
The Pages Functions proxy (`functions/api/[[path]].ts`) forwards `/api/*` to
`env.API_WORKER_URL`; runner endpoints are never called from the browser.

### 8.2 Build & deploy
```
cd founder-os_frontend
npm run build                  # static export → out/ (webpack: next build --webpack)
node scripts/deploy.mjs        # build → publish → live assertions (§9.2)
```
> **Must build with webpack.** Next 16 defaults `next build` to Turbopack, and the
> Turbopack production build drops nested dynamic-import chunks (`page →
> Automations → TelecallingDashboard`) — dashboard chips/Export vanish from the
> deployed bundle despite being in the source. `package.json` `build` runs
> `next build --webpack`; do not revert to plain `next build`.
The `functions/` dir is excluded from Next typecheck (Pages Functions types come from
`@cloudflare/workers-types`).

## 9. Deployment

| Component | Target | How |
|-----------|--------|-----|
| founder-os-worker | Cloudflare Workers (**live API**) | `node scripts/build-worker.mjs` → `npx wrangler deploy` (D1 `DB`, `EVENT_HUB` DO, `CHAT_FILES` KV) |
| Cron/AI dispatch | founder-os-worker Cron Trigger (`* * * * *`) | `src/worker/cron.ts` → GitHub `workflow_dispatch` (cPanel dispatch lines are disabled, kept only for rollback) |
| Cron/AI | GitHub Actions (**live execution**) | `.github/workflows/cron-*.yml` → `scripts/*-runner.js` |
| **D1 nightly backup** | cPanel cron (`216.10.246.39`) | `30 2 * * *` → `~/d1-backup.sh` → Cloudflare D1 **export API** (polling) → SQL dump in `~/d1-backups/`, 14-day retention |
| waba-worker | Cloudflare Workers | `cd waba-worker && wrangler deploy` (D1 `waba-worker`) |
| Express backend | Docker / host (alt/local) | `pnpm build` (tsc) → `node dist/server.js`; `Dockerfile` + `docker-compose.yml` |
| Frontend (+ PWA) | Cloudflare Pages | `node scripts/deploy.mjs` (build → deploy → live deep-link assertions) |
| webhook-relay / local-runner | host/process | `node webhook-relay/relay.js`, `node local-runner.js` |

Secrets: `SHARED_SECRET` (Worker + GH Actions + waba-worker), `DATABASE_URL` (Express),
`WA_ENGINE_API_KEY` (AI keys live only in Setting `ai:providers`),
`GOOGLE_SERVICE_ACCOUNT_JSON`, `GITHUB_ACCESS_TOKEN` (cron dispatch; also `SSH_*` for the
cPanel host in the root `.env`).

### 9.1 Verification
- Worker: `node scripts/smoke-worker.mjs` (asserts public 200s, auth 401s, heavy-slug behaviour).
- Express: `node dist/server.js` + `curl /api/status`.
- Frontend: `node scripts/deploy.mjs` asserts `/`, `/automations`, `/leave`,
  `/session/leaderboard`, `/crm` return 200 + the app shell, `/api/status` returns JSON,
  and `/404.html` is not Next's not-found page (see §9.2).

### 9.2 SPA fallback (why a refresh 404s, and how it is prevented)
The dashboard is ONE static route — `src/app/page.tsx` — and every view is a
History-API path (`useHashRoute`: `/automations`, `/leave`, `/session/<slug>`…).
A refresh or a pasted deep link therefore asks Pages for a file that was never
built. Pages serves the shell for those paths **only while the artifact contains
no `404.html`**; the moment one is present its implicit SPA fallback is off and
every deep link answers 404 (2026-11-26: production shipped an `out/` mixing two
builds — two webpack runtimes, a stale `sw.js` and a `404.html` — so the app
booted from `/` but nothing refreshed).

Layered defence, one commit:
- `public/_redirects` ends with `/*    /index.html   200` — versioned, so it does
  not depend on a build step. `/api/*` still wins: `functions/api/[[path]].ts`
  runs before static rules.
- `scripts/prebuild.mjs` (npm `prebuild`) deletes `out/`, so `next build` can
  never publish a mix of two builds.
- `scripts/postbuild.mjs` removes `out/404.html` and then FAILS the build if it
  survived, if `out/index.html` is missing, if an asset it references is absent,
  or if more than one `webpack-*.js` runtime exists.
- `scripts/deploy.mjs` builds, publishes and then fetches the deep links above.
Guard: `pages-spa`.

## 10. Extension guidelines

### 10.1 New automation
1. Copy `src/automations/_template/` → `src/automations/<slug>/` with `README.md` + `index.ts`.
2. Export an `AutomationModule` (`register`/`handler`). For rules, add `rule.json`.
3. Express: auto-discovered by `AutomationRegistry` (node-cron wired on boot).
   Worker: add the static import to `registry-worker.ts`.

### 10.2 New GH Actions runner
1. Add `scripts/<name>-runner.js`, reuse `runner-lib.js` (`workerRequest` + `groq`/`groqJson` wrappers over `POST /api/ai/complete`; helpers in `scripts/ai-gateway.js`; never hand-roll fetch rotation).
2. Add a job to the matching workflow with `env: { WORKER_URL, SHARED_SECRET }`. Do not add AI keys — the Worker's Settings pool owns them.

### 10.3 New Worker/Express endpoint
- Express: add a handler in `server.ts` or a router in `src/routes/`.
- Worker: add to `src/worker/routes/` (mirror the Express route). Keep handlers thin; heavy work → runner.
- If the endpoint **writes dashboard data**, call `notifyLive(c, { type: "<name>" })` so open tabs
  refresh live (see §11). This is optional — the auto-live middleware emits a generic
  `data-changed` event for any mutating `/api/*` write automatically. On the frontend, a new view
  uses `useLiveDashboard(fetcher)` (or `useLiveQuery` with no `events`) to refetch live with zero
  wiring. Add a `useLiveRefresh` wiring in the relevant component.
- If the endpoint **reads an expensive/aggregated payload**, wrap it in the KV cache
  read-through helper `cached(key, ttlMs, compute)` (see §3.4) — never hit D1 on every
  broadcast. When the endpoint **writes** data that other caches derive from, invalidate
  them (e.g. `invalidateDerivedEstimateCaches()`, `invalidateNeodoveCache()`,
  `invalidateRiskCache()`, or `cacheDel(key)` / `cacheDelPrefix(prefix)`).
- **Fanned-out caches: bump a revision, don't delete a prefix** (2026-11-21). A payload with
  many variants (period × user × drill) must fold `await cacheRevs([...])` into its key and be
  invalidated with `bumpRev(name)` — one small put. `cacheDelPrefix` on such a family is a KV
  `list()` plus one delete per variant on EVERY write; the Sales leaderboard ran that on every
  estimate write and every 5-minute NeoDove refresh, which kept it permanently cold.
- **A GET must never wait on a cold boot.** `SchedulerService.init()` loads the automation
  registry; the boot middleware caps that wait at 2 s for read paths (15 s for `/api/trigger/*`).
  Registry loading is ONE `automation.findMany`, not one `findUnique` per automation.
- **Never fan a dashboard out into N per-slice requests.** One payload carries every slice
  (Sales: `?follow_ups=1` returns all regions' open pipeline), and a slice endpoint must compute
  only that slice (`automations/telecalling/service-parts/drill.ts`), never the full aggregation.
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
- **The Pages Function proxy must pass the upgrade through** (`founder-os_frontend/functions/api/[[path]].ts`):
  browsers open the socket on the app's own origin, so every frame crosses that proxy.
  A 101 response carries the socket on `res.webSocket` and **cannot be rebuilt** —
  `new Response(body, { status: 101 })` throws (the constructor only accepts 200–599) and a
  101 without `webSocket` never completes the handshake. The proxy therefore returns
  `new Response(null, { status: 101, webSocket: res.webSocket })` *before* its normal
  streamed-body branch. Until 2026-11-24 it rebuilt every response, so the handshake
  threw and the entire app was fetch-once: own writes still felt instant (optimistic
  echoes) and views with a `pollMs` safety net still caught up, but a surface with no
  local echo and no poll — the enquiry **Queries** inbox — only updated on a manual
  reload. Guard: `scripts/guards/live-transport.test.mjs` (upgrade branch present *and*
  before the streamed branch, route forwards `c.req.raw`, DO answers 101, client feeds
  the shared bus, cross-desk inboxes poll).

### 11.2 Broadcast contract
Every data-write endpoint calls the `notifyLive(c, event)` helper, which fire-and-forgets
a `c.executionCtx.waitUntil(...)` POST to the hub. Event shapes:

| Event | Emitted from |
|-------|--------------|
| `{ type: "estimates" }` | `/api/estimates/bulk-upsert`, `/api/estimates/classify`, `/api/runner/zoho/status`, `/api/runner/zoho/comments`, `/api/runner/zoho/classification` |
| `{ type: "neodove" }` | `/api/runner/neodove/report` |
| `{ type: "baseline" }` | `/api/runner/estimates/baseline` (the 01:00 AM IST daily freeze) |
| `{ type: "automation", slug }` | `POST /api/trigger/:slug` (after the automation scan completes) |
| `{ type: "data-changed", path, method }` | **Automatic** — any mutating `/api/*` request whose handler did NOT already broadcast (auto-live middleware) |

### 11.2a Zero-wiring live updates for NEW dashboards/automations
To scale, live events are now **automatic** — a new dashboard/automation goes live without
wiring a new event name:

- **Backend auto-live middleware** (`createApp()` in `src/worker/context.ts`): any successful
  `POST/PUT/PATCH/DELETE` to `/api/*` that the handler did not already broadcast emits a generic
  `data-changed` event automatically. A handler suppresses the generic one by calling
  `notifyLive`/`broadcastLive` (it sets a marker on the context). Noisy non-dashboard paths are
  opted out via `LIVE_NO_AUTO` (`/api/auth/`, `/api/token/`, `/api/chat/typing`, `/api/chat/files`,
  SSE/WebSocket endpoints).
- **Frontend default**: `useLiveQuery(fetcher)` with NO `events` option refetches on **every**
  event. The convenience hook `useLiveDashboard(fetcher)` makes this the explicit default.
  → A brand-new view backed by a new write endpoint updates live with zero per-view wiring.
- For high scale, still refetch narrowly with `useLiveQuery(fetcher, { events: ["<type>"] })`
  to cut unnecessary refetches.

### 11.3 Frontend — one modular live-data layer
There is a **single** shared layer that makes every dashboard number live. It opens **one**
WebSocket to `/api/events` for the whole app (module-level singleton in the hook) and fans
events out to every component via an in-process event bus — no per-dashboard sockets.

- `src/hooks/useLiveData.ts` (the common modular file):
  - `useLiveQuery<T>(fetcher, { events?, deps?, pollMs? })` — fetches on mount + whenever a
    matching `LiveEvent` arrives (debounced ~1.5s), plus an optional slow `pollMs` safety net.
    Omit `events` to subscribe to ALL events (auto mode).
  - `useLiveDashboard<T>(fetcher)` — zero-wiring default for new views (alias of `useLiveQuery`
    without an `events` filter): refetches on every event including the automatic `data-changed`.
  - `useLiveEvent(handler)` — imperative subscription for components with their own local
    state (e.g. the WhatsApp chat window).
- **Paged lists (founder standard 2026-11-21)** — any list that can grow: `src/hooks/usePagedQuery.ts`
  (page numbers, 50/page, debounced server search, filters reset to page 1) over backend
  `src/shared/paging.ts` (`parsePageQuery` clamps 50/≤100, `searchClause` = every word in some
  column via LIKE within D1's 50-byte cap, `pagedQuery` = page + `COUNT(*)` in one `db.batch`;
  response `{rows,total,page,limit,totalPages}`). Live events do NOT reload a paged list: they
  count into `<ChangesBanner>` ("N new changes — click to refresh"); our own saves call
  `refresh()` and are muted for 4s. Footer `<Pager>` ("Showing 1–50 of N" + page numbers) from
  `@/components/ui`. Never paged: Management Active/Unprocessed, today's dispatches, overdue,
  procurement pending. Rolled out: product line (rates + product detail quotes, migration 0150);
  Customer Master (`/api/master-data/customers` paged + filtered + sorted in SQL, `/summary`
  KV-cached COUNT/GROUP BY for region tabs, KPI tiles and filter options — busted by every
  master write via `invalidateMasterSummaries`, `/duplicates` per region for the review tab
  (12 groups/page), `/export` = all filtered rows for CSV; the old whole-book payload is gone);
  Dispatch (`GET /api/crm/orders` → `modules/crm/list-page.ts#listOrdersPaged`: tab predicates
  read per-item state, so they filter the ONE cached floor scan in memory — the scan is now
  uncapped (`scanFloor`, shared with `dispatchSummary`), so search + totals cover every order;
  proof-doc chips load for the returned page only; "dispatch-floor" = today's dispatches +
  overdue returns everything on page 1, and its tab badge is `counts.tabFloor` — the
  `queues.ts#floorRowFlags` union the list renders, never `floorToday + overdue` (an order with
  both an overdue and a today line counted twice); the Unscheduled / Scheduled / Dispatched cards
  read `tab*` for the same reason (one SO sits in several tabs, so a lifecycle bucket can never be
  the number beside a list). Next Enquiries history → rest. Guard `list-paging`.
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
 - Data still only *changes* on the upstream Zoho/NeoDove sync cadence (every 5 min via
   GH Actions); the hub delivers those changes to open tabs within ~2s instead of on a
   poll tick. True sub-minute freshness would require Zoho webhooks → worker.

### 11.5 Optimistic mutations (instant-UI standard — ALL dashboards)

Live events (§11.2a–11.3) converge *other* tabs within ~2s, but the tab that made
the write must feel instant: **no dashboard write may wait for the network to
paint.** The contract, taken from the sales-enquiry tracker and modularised so
every automation gets it for free:

1. **Patch local state instantly** — surgical `setData`, never a full refetch.
2. **Send the server request in the background.**
3. **Reconcile with server truth afterwards** (background `refresh()`).
4. **On failure, resync** (`refresh()`) so the UI never sits on a lie — then alert.

**Module** — `founder-os_frontend/src/hooks/useLiveData.ts` (the same single
shared layer as the live socket):

- `useOptimisticMutation(query)` — driver over any `useLiveQuery` /
  `useLiveDashboard` result. `mutate(patch, request, { key?, reconcile? })`:
  paints via `setData`, runs `request`, refreshes to reconcile (or resync on
  error). `key` (e.g. the logId/enquiryId) serializes rapid taps on the SAME
  record into a queue — each body builds after the previous step resolved, so
  fast double-taps can't fork/overwrite each other (the enquiry `chainsRef`
  pattern); taps on different records run concurrently. Omit `key` for
  fire-and-forget writes.
- `patchRowInLists(prev, lists, idKey, id, patch)` — shallow-merge `patch` into
  the one matched row inside each named payload list (today/senior/junior/
  overdue/history…). Pure, for use inside `setData`; only the touched row
  re-renders.
- `mapRowInLists(prev, lists, idKey, id, fn)` — same but with a row transform
  (append a temp upload chip, filter a deleted file, …).

**Adopting it in a new dashboard (~5 lines):**

```tsx
const dash = useLiveDashboard(fetchMyData);
const { mutate } = useOptimisticMutation(dash);
const save = (id: string, body: unknown, patch: Record<string, unknown>) =>
  mutate(
    (prev) => patchRowInLists(prev, ["items", "mine"], "id", id, patch),
    async () => {
      const res = await fetch(`/api/my-scope/${id}`, { method: "PATCH", ... });
      if (!res.ok) throw new Error(await res.text());
    },
    { key: id },
  );
```

Creates/uploads echo with a `tmp-` id and swap in server truth on the
background refresh (enquiry comments, accounts proof files). Reference
implementations: sales enquiries (`useEnquiryData.ts` — the original pattern:
ref-mirrored state, per-enquiry write chains, temp-id comment echo, single-row
live merge) and Accounts (`AccountsDashboard.tsx` — first adopter of this
module: `saveLog`/`attachFile`/`detachFile`).

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
  `automations`, `zoho`, `dpp`, `wa-engine`, `neodove`, `crm`, `whatsapp-marketing`,
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
- **Root is not a participant:** `auth_user.isRoot` accounts are filtered out of
  `GET /api/chat/users`, channel member lists, DM pickers and DM channels. Creating a DM
  with root, sending/typing/reacting as root, and adding root to a channel are refused
  (generic 403 / stripped id); root-authored rows are also dropped on read. Nothing in the
  UI advertises the exclusion.
- **Display names:** chat resolves every sender (and reply author) through the shared
  employee-name index — HR character name first, then `auth_user.displayName`, then the
  login name. The Durable Object cache key is `messages:v2` so old raw-name rows are not
  served.

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

### 14.1 Auto Dialer (Android, 2026-11-20, migration 0147)

- **Pairing:** phone `POST /api/android/pair-request` (agent name, device) → 6-digit code +
  one-time secret; phone polls `GET /api/android/pair-status`. Sales head approves in
  Sales → Controller → Auto Dialer (`/api/dialer/pair-requests/:id/approve`), choosing the
  roster agent; approval revokes that agent's previous phone and mints the `fc_` device
  token (reuses `DeviceRegistration` + SHA-256 token hashing). Token is handed out once.
- **Queue:** `DialerQueue` (unique pending per telecaller+mobile). Filled by the push screen
  with "Send to: Founder OS Dialer" (`NeoDovePushBatch.target='dialer'`, same selection +
  ledger as NeoDove); retries (Busy/Not Answered, 2h gap, max 3) and callbacks re-enqueue.
- **Sync:** `POST /api/android/dialer/sync` takes calls, breaks and live state in one body
  and answers `acceptedCalls/rejectedCalls/acceptedBreaks/rejectedBreaks`; the phone's
  Room outbox marks rows done only on accept (offline → WorkManager retry, 15-min periodic
  safety net). Calls land in `DeviceCall` (+ disposition, remarks, callbackAt, queueId,
  manual, autoSaved). Recordings upload via `PUT /api/android/recordings/:callId` into R2
  `CALL_RECORDINGS` (`calls/<yyyy-mm>/<agent>/<callId>-<part>.<ext>`, real format kept via
  `recordingFormat`; bucket lifecycle deletes after 90 days). Controller → Auto Dialer →
  Recordings lists `/api/call-log/calls?recorded=1` for the day and streams
  `/api/call-log/recording/:id` (Range, `?download=1`). Transcription is a planned follow-up.
- **Loop (phone):** `remote/AutoDialer.kt` — countdown (`nextCallSec`) → dial → disposition
  window (`dispositionSec`, auto-save: 0 s talk = Not Answered, else NOT_DISPOSED flagged)
  → next. Callback pauses the timer. Shift hours lock auto-dial. Breaks stop the loop until
  Resume. Manual dial saves the open disposition first and is logged only (no customer).
- **Agent reset:** activity is keyed by agent, not phone, so a re-paired phone would inherit an open
  break / stale status. Approve-new-phone and Unpair close open breaks (`modules/dialer/reset.ts`
  `closeOpenBreaks`); Controller **Reset** (`POST /api/dialer/agents/:id/reset`) recalls the queue,
  closes breaks, sets status idle and, only with the explicit `wipeToday` tick, deletes today's
  DeviceCall + DialerBreak rows and their R2 recordings.
- **Controller UI:** `components/telecalling/auto-dialer/*` — pair requests, live board
  (state, break overrun red), settings (`dialer:config`), hourly report (`/api/dialer/report`).
- **App distribution:** `.github/workflows/android-apk.yml` builds the APK in GitHub Actions on
  every `android/Auto-Dialer/**` push and (for `main` / `feat/auto-dialer*`) republishes the rolling
  public release `auto-dialer-latest` (`auto-dialer.apk` + `auto-dialer.json`). `GET /api/dialer/app`
  (`modules/dialer/app-release.ts`, KV-cached 5 min) returns that version and
  `GET /api/dialer/app/download` streams the APK same-origin (the upstream GitHub URL is never sent
  to the browser); Controller `AppDownload` shows version + Download. No local Android toolchain needed.
- **Follow-ups (2026-11-21, migration 0149, app 1.2.0):**
  - *Reinstall keeps pairing:* `POST /api/android/pair-restore {deviceId}` (`pairing.ts#restoreByDevice`)
    rotates the token of the still-active registration with that ANDROID_ID; the app tries it before
    showing the code screen. ANDROID_ID is per signing key, so it needs the shared key secret
    (`ANDROID_DEBUG_KEYSTORE_BASE64`); the release JSON carries `stableKey` and the Controller warns
    when a build would need an uninstall.
  - *Phone-dialer calls:* `remote/PhoneCallSync.kt` turns call-log entries the auto dialer did not place
    into outbox `pcall:<date>` items (server id `<dev>-L<date>`, `origin:'phone'`); `sync.ts` keeps them
    when `config.trackPhoneCalls` (default on) and stamps `DeviceCall.origin='phone'`; the report counts
    them (`AgentDay.phone`). Their recordings match by time and upload against that server id. With
    tracking on, `Outbox.enqueueCall` skips non-dialer local calls so nothing counts twice.
  - *Retry cap:* `queueOutcome` returns `unreachable` when a retry disposition reaches `retryMax`
    (Controller "Stop re-queuing after N tries"); `GET /api/dialer/unreachable?days=` lists them.
  - *Scheduled breaks:* `config.scheduledBreaks` (`{id,label,start,end,agents[]}`, IST, empty agents =
    everyone); the phone config route serves only that agent's (`scheduledFor`); `AutoDialer` shows
    `State.Scheduled` (live state `break`) and blocks manual dial inside a window.
  - *Recording health:* the Dialer tab warns when calls connect but no recordings exist today (phone
    recorder off) or audio access is missing.

## 15. Deployment map (current)

| Component | Target | How |
|-----------|--------|-----|
| founder-os-worker | Cloudflare Workers (**live API**) | `node scripts/build-worker.mjs` → `npx wrangler deploy` (D1 `DB`, `EVENT_HUB`/`ASYNC_RUNNER` DOs, `CHAT_FILES` KV) |
| Cron/AI dispatch | founder-os-worker Cron Trigger (`* * * * *`) | `src/worker/cron.ts` → GitHub `workflow_dispatch` |
| D1 nightly backup | cPanel cron (`216.10.246.39`) | `~/d1-backup.sh` (the only live job left on that host, plus a health ping) |
| Cron/AI execution | GitHub Actions | `.github/workflows/cron-*.yml` → `scripts/*-runner.js` |
| waba-worker | Cloudflare Workers | `cd waba-worker && wrangler deploy` (D1 `waba-worker`) |
| Express backend | Docker / host (alt/local) | `pnpm build` → `node dist/server.js`; `Dockerfile` + `docker-compose.yml` |
| Frontend (+ PWA) | Cloudflare Pages | `npm run build` → `npx wrangler pages deploy out --project-name founder-os-frontend` |
| webhook-relay / local-runner | host/process | `node webhook-relay/relay.js`, `node local-runner.js` |

Secrets: `SHARED_SECRET`, `DATABASE_URL`, `WA_ENGINE_API_KEY`, `AI_KEYS` (unified gateway keys) /
legacy per-provider `*_API_KEYS` + `LLM_*` (merged as fallback), `GOOGLE_SERVICE_ACCOUNT_JSON`, `GITHUB_ACCESS_TOKEN` (+ `SSH_HOST`/`SSH_USER`/
`SSH_PASSWORD` for the cPanel host, stored in root `.env`).

## 16. Automations vs Session (machine vs human, 2026-11-12)

Two sibling surfaces over the same dashboards; neither imports the other.

| | `/automations` — the machine | `/session` — the human ("Workspace") |
|---|---|---|
| Frontend | `src/views/automations/AutomationsView.tsx` (admin-only registry console) | `src/views/session/SessionView.tsx` (`/session`, `/session/<slug>`) |
| Worker | `worker/routes/automations.ts` — list / detail / enable-pause / cooldown / runs | `worker/routes/session.ts` — `GET /api/session`, `/workspaces`, `/workspaces/:slug/data` (read-only) |
| Owns | registry state, scopes (`registry-worker.ts`) | viewer-scoped data (`modules/workspaces/scoping.ts`) |

- **One catalog**: `modules/workspaces/catalog.ts` lists every dashboard + legacy aliases (frontend
  mirror `src/workspaces/aliases.ts`, guard `workspace-catalog.test.mjs`). New dashboard = catalog entry
  + one line in `src/workspaces/registry.tsx`.
- Dashboard components are host-agnostic: data URL via `workspaceDataUrl`, navigation via
  `useWorkspaceHost()`; never hardcode `/automations` or `/api/automations`.
- `GET /api/automations/:slug/data` is a deprecated alias (Deprecation header) of the session data route.
- Admins land on `/automations`, everyone else on `/session`. Only `telecalling` and
  `neodove-telecaller-report` are `publicData` (founder decision).

## 17. ERP core layer (Phase 0 lock, 2026-11-12)

D1 now carries a core/helper split alongside the legacy tables:

- `core_*` tables = **source of truth** (schema in `prisma/core/01-platform … 08-leads.prisma`, logic in
  `src/modules/core/` — customers, sales, orders, finance, stock, leads, stages, audit, notify, events,
  projectors, sync). Served by `worker/routes/work.ts`. **Locked**: humans only, verified by
  `node founder-os_backend/scripts/core-guard.mjs`; agents propose changes in `docs/core-change-requests/`.
- `hlp_*` tables = helpers (dashboards, saved views, flags) — free to change, reference core by id only,
  never duplicate a business fact, never write `core_*` outside `src/modules/core/`.
- Legacy tables (`Estimate`, `CrmSalesOrder`, `Telecaller…`) keep running; Phase 7 added the `core_lead`
  intake ledger with mirrors + shadow comparison. Roadmap and phase status: `ERP_TRANSITION_PLAN.md`.

## 18. Code organisation & duplication control

The repo's main failure mode is new code being added beside existing code instead of reusing it. The
rules are in AGENTS.md "Coding practices" and the skill `.claude/skills/ai-pa-code-discipline/`; this
section describes the machinery.

### 18.1 Layers (dependency direction is one-way)
```
Frontend:  app/page.tsx → views/{automations,session} → workspaces/ + components/<Dashboard>
                         → hooks/ (useLiveData, domain hooks) → src/<domain>/ (pure: queue/normalize/pricing)
                         → api/client.ts · lib/format · components/ui
Backend:   worker.ts → worker/routes/<domain>.ts (thin) → modules/<domain>/ | automations/<slug>/
                         (types · parse · queues · scopes · update · store · pure.ts/io.ts)
                         → shared/ (cache, ai-gateway, prisma-d1) · modules/core/ (locked)
```
Never sideways between route modules or between `views/automations` and `views/session`.

### 18.2 Where reusable things live
- `docs/REUSABLE_COMPONENTS.md` — generated catalog (`scripts/refactor/gen-reusable-catalog.py`) of every
  module split out by `scripts/refactor/split-module.mjs`; old paths re-export, so imports keep working.
- Backend `pure.ts` = synchronous, no DB/cache/network (safe in tests and on both runtimes); `io.ts` = I/O.
- Shared kits: `@/components/ui`, `@/lib/format`, `@/workspaces`, `hooks/useLiveData`; backend
  `worker/http.ts`, `worker/viewer.ts`, `shared/cache.ts`, `shared/ai-gateway.ts`.

### 18.3 Guards (CI: `.github/workflows/guards.yml`, `node --test "scripts/guards/*.test.mjs"`)
| Guard | Protects |
|---|---|
| `rewrite-ratchet` + `rewrite-baseline.json` | 18 duplication/boundary metrics from `scripts/dup-audit.mjs` never grow (raw FE fetch, local INR/date formatters, ad-hoc modals, auth/body boilerplate, files > 400 lines, registry leaks) |
| `queue-mirror`, `crm-lifecycle`, `enquiry-rates-union` | backend↔frontend predicate/lifecycle mirrors stay identical |
| `sales-range` | the Sales board's custom `from→to` window: one resolver (`resolvePeriod`), cache key from the resolved dates, 93-day cap |
| `format-canonical` | one home for money/date formatting |
| `workspace-catalog`, `workspace-scoping` | the §16 catalog + viewer scoping |
| `notifications` | §20 escalation palette, BE↔FE level/template mirrors, authored-SQL firewall, IST windows |
| `notifications-dashboard` | §20 bell hook order, Test-vs-Run dispatch, rule filters, column tokens, AI prompt/schema, own nav surface, seeded rule |
| `view-as` | §21 root-only impersonation: no root→root/self, overlay is never root, write gate blocks every non-read, cookie shape, viewer/context wiring |
| `d1-parity`, `gateway-js-parity`, `gateway-pool` | D1 shim registries; TS gateway ↔ JS runner port |
| `core-guard.mjs` (not in the suite) | locked ERP core signature |

### 18.4 Duplication baseline (jscpd 4.0.5, min 6 lines / 50 tokens, 2026-11-12)
533 clones · 6,761 duplicated lines · **4.3%** of 157k lines (TS 5.9%, TSX 3.2%, JS 1.9%).

| Class | Lines | Status |
|---|---|---|
| Same-side copies | 5,479 | debt — see below |
| Backend↔frontend mirrors | 1,515 | sanctioned, but only crm / enquiry-queue / format / gateway are guarded |
| `*-worker.ts` twins | 185 | expected (esbuild redirect) |
| Express ↔ Worker | 115 | disappears with Express retirement |

Ranked debt (proposed single home):
1. Accounts ↔ Digital Marketing task-board fork, ~1.6k lines across 9 FE files + Worker/Express routes →
   one configurable task-board kit + one shared backend task lifecycle.
2. Route-handler try/notifyLive/catch boilerplate, ~500 lines (`human-resources.ts` 699 lines, `digital-
   marketing.ts`, `accounts.ts`, `debtors-tracker.ts`, `telecalling.ts`, `crm.ts`) → one helper in `worker/http.ts`.
3. Unguarded mirrors (debtors parse 360, salary-formula 205, reporting 211, …) → parity guards.
4. Smaller FE forks: Sheet/WaEngine/Dpp dashboards, CrmDashboard ↔ SalesDispatchPanel, debtors
   Collections ↔ Invoices tabs, payment ↔ expense calendar, Sidebar ↔ MobileDrawer.
5. `modules/core/*` repeated helpers (~160 lines) → core change request (locked).

Re-run the report after each cleanup and update these numbers; `dup-audit.mjs` stays the CI gate.

### 18.5 Phase 0 baseline (2026-11-13, Phase 0+1 slice) + final (2026-11-14)
- Start: `dup-audit` be.getme 2, be.autherror 5, be.json_body 4, be.files_over_400 36.
- Finish: be.autherror **5→1** (the 1 is `adminScopeError` itself, the canonical home); be.getme stays 2 (locked `work.ts` + device-call scopes — legitimate homes); json_body stays 4 (intentionally different fallbacks).
- Helpers: `writeError` + `requireViewer` (`worker/http.ts`, `viewer.ts`), `adminGuard` (`worker/context.ts`), `ScopeKeys` (`modules/auth/types.ts`).
- Rollout (handlers only, domain logic untouched): accounts, master-data, delegation, reporting-sheet, neodove-campaign, crm-attachments, sales-objections, estimates, product-line, field-staff, crm, digital-marketing, telecalling, human-resources, enquiries, debtors-tracker.
- `tsc --noEmit`: 41 pre-existing errors, file-by-file diff empty. `smoke-worker.mjs`: 63 PASS / 0 FAIL. `core-guard.mjs`: intact.
- Guards: d1-parity + fe.files 24→25 failures pre-date this work (frontend growth needs its own split — follow-up, not this slice).
- Phase 2a remainder (same slice): persistence out of routes — auth `listLoginEmails` (Memory/D1/Prisma), device-calls `findAgentName`/`findActiveAgent`/`recordConsent`, telecalling `listActiveTelecallers` (crm/enquiries/telecalling/manual-calls), automation `listAutomationDefs` (automations+session), new `modules/crm/attachments.ts`, `modules/whatsapp/tokens.ts`, `modules/whatsapp-marketing/store.ts`. Dead imports removed (8: incl. pre-existing `isApproved`/`deps`/`authStore`/`procurementSubmittable`/`getEntryOrReload`/`requireScope`).
- Explicitly not moved (route is the sole owner — needs domain design, not extraction): autopilot waTask/waAction/history CRUD, runner GH pipelines, estimates bulk-upsert/report payloads, system waba-debug SQL, `*-parts/io.ts` god halves, digital-marketing + zoho-sent-analyzer god services (prior exclusion: inference/`__dirname`).

## 19. Product Line & KYP schema v2 (2026-11-23)

The founder authors ONE file — `resources/json/kyp/bui_milling_vendor_kyp_schema_v2.json`
(Draft-07) — and it is the sole truth for **products, categories, aliases and the spec-ask**.
Nothing product-shaped is hand-typed anywhere else.

**What the file carries.** 25 envelope properties (13 required), 103 products in `definitions`,
and a root `allOf` with one branch per product that binds
`product_key → category` (const, or an enum for the dual-category `transmission_belt`),
`aliases` defaults and `specs: {$ref: "#/definitions/<key>"}` — the dispatch `specs` alone lacks.
Each definition also carries `x-category`, `x-aliases` and `x-client-ask` (1–5 prose ask
prompts). Specs are typed per product: 652 attribute slots, 366 distinct keys, 237 enums,
19 `if/then` bound rules, `additionalProperties: false`.

**Generated artifacts (never hand-edited).** `scripts/gen-kyp-catalog.mjs` compiles the JSON to
`src/automations/product-line/kyp-catalog.ts` (labels, categories, aliases, `ask`, typed props,
flattened rules) and to `migrations/0156_kyp_catalog_v2_seed.sql` (103 `ProductItem` + 652
`KypGuide` rows, deterministic ids `pi_<key>` / `kg_<key>_<attr>`). Guard `kyp-schema` reruns the
generator with `--check` and asserts the JSON's own invariants.

**Runtime typecheck.** `kyp-schema.ts` = catalog view + `validateSpecs(productKey, specs)` (type,
enum, min/max/exclusiveMinimum, required, if-then) and `validateEnvelope`. `rate-specs.ts` runs it
on every quote write (`applySpecsToData` before the D1 write) and refreshes `missingSpecs`; a
schema violation is a 400, a missing required value is recorded, never invented (founder call).

**Storage decisions.**
- `ProductItem` / `KypGuide` / `Vendor` / `VendorRate` keep their existing names — no rename.
- The spec document is ONE JSON column: `VendorRate.attrValues` (schema `specs`). `brand` (and
  `material`, `machine_make_model` where the branch does not declare them) live **inside** it —
  no per-field columns. `EXTRA_SPEC_KEYS` in `kyp-schema.ts` is the allowlist that makes that
  legal against `additionalProperties: false`.
- `baseRate` stays a stored derived value (`price × (1 − discount/100)`), with
  `pricePerUnit`/`discountPercent` stored separately; `deliveryMaxDays` (mig 0155) carries
  `delivery_time_max_days`. Media stays `imageUrl`/`videoUrl` pointing at real `CHAT_FILES` KV
  objects; `has_reference_media` is derived, not stored.
- **Spec queries** (founder ask: typechecked + millisecond): `VendorRateSpec` (mig 0155) is a
  typed mirror — one row per (quote, spec key) with `valueText` + `valueNum` and indexes on
  `(attrKey, valueNum)` / `(attrKey, valueText)`, written in the same D1 batch as the quote.
  Any key can be filtered without one index per key (366 keys × 103 products). The JSON column
  stays authoritative; the index is rebuildable. HTTP form:
  `GET /api/product-line/rates?spec=brand:PIX&spec=width_mm:>=1000&spec=material:in:ss,gi`.

**Revenue semantics (why the table is `VendorRate`).** It stores the vendor's quote, never a
selling price: `pricePerUnit` = vendor price before discount, `baseRate` = net after discount,
and the customer price is computed at read (`match.ts` → `effectivePrice` → `applyMarkup`, +25%
`SALES_MARKUP_PERCENT`), so markup changes never rewrite stored rates.

History: `0154` wiped the pre-schema data (191 products / 425 guide / 6,978 quotes, `Vendor`
master kept, `product-photo/` KV cleared); the Product Line AI agents (knowledge copilot +
"Add vendor rates" intake) were removed 2026-11-22 and `src/copilot/registry.ts` is empty.


### 19.1 Editable catalogue + rate sheet UI (2026-11-23)

D1 is the working copy of the KYP catalogue, and the dashboard owns it:

- **Editors** — `components/product-line/`: `ProductsTab` (search + category filter + New product + KYP
  download), `ProductEditor` (name, category with rename-everywhere, alias chips), `SpecsEditor` (per spec:
  label, type, enum list, min/max, required, order, add, delete), `VendorsTab` (supplier master; brands are
  NOT vendors), `RatesSheet` + `RatesFilters` + `RateDrawer` (quotes as a spreadsheet, row → full editor).
- **One contract** — `catalog-live.ts` reads `ProductItem`/`KypGuide` into the same shape as the compiled
  seed and caches it (`product-line:catalog:v1`); rate writes (`rate-specs.ts`) typecheck against it, so a
  spec edit changes validation immediately, and `schema-export.ts` rebuilds the KYP v2 JSON from it
  (`GET /api/product-line/schema.json`, downloadable). Guard `kyp-schema` covers the export round-trip.
- **Policies** — `attrKey` immutable (quotes + `VendorRateSpec` key off it); spec delete blocked while quotes
  carry a value (error names the count); category rename is a bulk value update; missing required values are
  displayed, never invented.
- **Rates sheet** — filters compile to SQL (`rates-page.ts`): `productId, vendorId, category, status,
  priceMin/Max, netMin/Max, leadMin/Max, from/to, missing=1, sort`, plus repeatable `spec=key:op:value`
  (`eq`, `in:`, `>=`, `<=`, `a..b`) answered by the indexed `VendorRateSpec` mirror. `RATES_PAGE_MAX = 500`
  per page (the rest of the app keeps the 50/≤100 standard); totals are `COUNT(*)`; loading paints sheet
  skeletons, not an empty grid.

### 19.2 Second pass: defaults, categories, prompt + pasted rates (2026-11-23)

- **Spec rows** — `SpecsEditor` owns order (HTML5 drag, optimistic: the row moves on drop, the write
  follows, a failure snaps back) and `SpecRowEditor` owns the panel. Enum members are printed on the
  collapsed row, so "is this a choice or free text" never needs a click. A spec may declare a
  **default** (`KypGuide.defaultValue`, JSON text, validated against its enum by `spec-default.ts`);
  the rate drawer seeds a new quote from it.
- **Categories** — `catalog-categories.ts`: declared list in Setting `product-line:categories`
  (`addCategory`), bulk `renameCategory` (every product + the declared entry, refusing a collision),
  `deleteCategory` only while unused. `catalog-live.ts` merges declared + derived, so a category can
  exist before its first product.
- **Prompt → paste → typed quotes** — `prompt.ts` stores an editable prompt (`product-line:rate-prompt`)
  and renders its vendor placeholder as "name — city" for active vendors only. `rate-import.ts` accepts
  the `{ create_vendors, rates: [ { product_key, vendor, unit, price_per_unit, … , specs } ] }` envelope
  (fenced or bare), resolves products by key/name/alias and vendors by name (creating them only when
  asked), then calls `createRate` — so specs, `missingSpecs` and the typed index are exactly what the
  drawer would produce. Pure parsing lives in `rate-import-parse.ts`.
- **Rates sheet** — the filter builder edits a draft and `Run query` commits it (`useRates.draft/run`),
  so a dozen range fields cost one request. `missing` filters by `any | spec | envelope`, and each row
  renders `Missing (n)` whose tooltip lists the field names; `missingFieldsFor` (backend) is mirrored by
  `filters.ts#missingFields` and the guard diffs both on the same fixture. Rows are compact (10.5px,
  one-line cells) so a 500-row page reads as a sheet. Creating a required spec, flipping `isRequired`, or
  editing a product refreshes `missingSpecs` for that product, so the filter cannot drift.

### 19.3 Batches, two-phase import and the completeness column (2026-11-23)

- **Trace** — every bulk paste opens a `RateBatch` (`rate-batch.ts`, mig 0160: source, actor, label,
  rowCount, createdCount, failedCount, vendorNames, failures JSON, status) and stamps its quotes with
  `VendorRate.batchId`. `DELETE /api/product-line/batches/:id` clears exactly those quotes plus their
  `VendorRateSpec` rows and marks the batch `deleted` — the log survives the undo. Single manual creates
  stay batch-less, so "undo that paste" never touches hand-entered data.
- **Two phases** — `POST /rates/import/preview` resolves products by key/name/alias, matches vendors by
  name, runs the same `prepareRateSpecs` typecheck the drawer runs, and returns the rows plus the
  `newVendors` candidates with whatever the sheet said about them. Nothing is written. `POST
  /rates/import` takes `vendors: [{ name, action: create|map|skip, …edited fields }]`: `create` inserts the
  vendor (name, city, contact person, both phones, address, year, type), `map` points at an existing row,
  `skip` rejects those rows. `create_vendors` in the agent payload is informational only.
- **`is_new_vendor`** — the prompt tells the model to copy the ACTIVE VENDORS name when it matches and to
  set the flag only for an unlisted supplier; the server treats a name that exists in the master as matched
  regardless, and an unknown vendor that was *not* flagged fails with an explicit message.
- **Sheet** — Completeness moved next to Vendor: green `Complete`, or `Missing (n)` whose hover/focus card
  numbers every unanswered field and says to open the row. `batchId` filters the sheet from the batch log.
- **Overlays** — one state machine in `ProductLineDashboard` (`prompt | import | batches | rate`), so
  opening a panel closes whatever was open; every delete goes through the shared `ConfirmDialog`.

### 19.4 Paste write path is batched, INSERT-only (2026-11-23)

- **Why** — `POST /rates/import` used to call `createRate()` per row. Each row cost ~13 network round
  trips (vendor read, product read, INSERT, the D1 shim's post-insert SELECT, a spec-index batch, six KV
  cache invalidations, two KV catalogue reads), so a 300-quote paste was ~3,900 sequential round trips.
- **Plan** — `rate-import-plan.ts` is the pure planner: `rateInsertStatement` (one `INSERT INTO
  VendorRate`), `specIndexInsertStatements` (one `INSERT INTO VendorRateSpec` per answer), `planRateRow`,
  `chunkPlannedRows` (chunks by STATEMENT count, `IMPORT_STATEMENT_CHUNK = 50`, never splits a quote) and
  `vendorInsertStatement`. `bindValue` coerces booleans→1/0, Dates→ISO, objects→JSON for D1 params. No
  SELECT/UPDATE/DELETE is ever planned — a paste only inserts.
- **Row body** — `rate-row.ts` owns the VendorRate column mapping (`numOrNull`, `baseRateFor`, and
  `rateRowData`, which `update.ts` now reuses), so one row and one paste cannot drift.
- **Write** — `rate-import-write.ts#writeImportRows` creates the approved vendors in one `db.batch()`
  (falling back row-by-row so a single bad vendor is attributed), validates every row through the same
  `applySpecsToData` the drawer uses against ONE preloaded `LiveCatalog`, ships the planned statements in
  chunks (a failed chunk is retried row-by-row so the reason lands on that quote), then runs ONE cache wave
  via `touchedMany` for the distinct products. `prepareRateSpecs`/`applySpecsToData` accept the preloaded
  catalogue so validation no longer costs a KV read per row.
- **Result** — a 300-quote, 8-spec paste is 2,700 statements in ~60 D1 batches: planning ~5 ms, payload
  ~570 KB, ~69 round trips instead of ~3,900. Guard `kyp-schema` asserts the plan stays INSERT-only, that
  chunking never splits a quote, and that vendor creation happens only from an explicit `create` decision.

## 20. Notifications — rule-driven, position-wise escalation (2026-11-24)

One authored rule per audience/metric replaces every ad-hoc alert. The founder writes a query in
**Settings → Notifications**; the `* * * * *` cron turns its rows into notifications, forever after.

```
RULE (hlp_notification_rule)
  audience  positions / departments / regions / rosterTypes / roles / explicit people
  cadence   hourly | everyNMin | daily | weekly | manual   (windows IST-aligned)
  sqlText   ONE read-only SELECT  (?1 window start, ?2 window end, ?3 IST day)
  template  title + body, mustache-lite {TOKEN}
            ↓ cron (src/worker/cron.ts → modules/notifications/sweep.ts, every fire, no GH dispatch)
ROW = one person = one notification
  telecaller_id | employee_key  → seat (HR member ← roster by email, never guessed)
  value                         → {VALUE} (+ any other alias as its own token)
  level 1..5                    → palette colour + severity (row column wins; thresholds fallback)
            ↓
notifyUsers()  → core_notification (the ONE inbox/audit; core lock intact)
              + hlp_notification_delivery (level/colour/metrics, UNIQUE rule+employee+window)
              + hlp_notification_state (streak, used only when the SQL returns no level)
              → EventHub `notifications` → toast + bell panel
```

**Level semantics (founder palette, Setting `notifications:levels`).** 1 = Normal / Resolved → the row is
recorded (state + audit) and **never toasted**; 2–5 dispatch with their own hex. A rule may opt into a
single level-1 "resolved" note when a breach clears (`escalation.notifyOnRecovery`).

**Reuse, not replacement.** `core_notification` already existed (Phase 6a, migration 0125) with
`core_notification_pref` / `core_notification_template`; the engine writes through
`modules/core/notify.ts#notifyUsers` and never touches `core_*` directly (core-guard enforces it). The
sidecar tables are `hlp_*` (free to change) so escalation metadata never needs a core migration.
`GET /api/notifications` in the locked `routes/work.ts` is superseded by `routes/notifications.ts`
(registered first); the old handlers stay until the next core re-sign.

**Identity.** A login maps to an HR member by email (`employeeKeyForEmail`, the same join the org module
uses), falling back to `core_user_link`. No HR row → empty inbox, never an error.

**Audience.** Position = HR `designation` (exact chart title). Regions/roster types come through the
`Telecaller` row matched by email; roles come from `auth_user_role`. A row whose person is outside the
audience is skipped and counted (`skipped`/`unmatched` in Test), so a broad query cannot notify the wrong
department.

**Safety.** The SQL is authored by root/admin only and validated single-statement read-only
(`metric-sql.ts`: SELECT/WITH, no comments, no DDL/DML/ATTACH/PRAGMA, 8k cap, 5k result cap). Test is a
dry run (writes nothing, shows rows + rendered text + unmatched keys); Run now dispatches for real. Per
person per hour a flood cap applies (`notifications:settings`), and `UNIQUE(rule, employee, window)` makes
a 5-minute sweep safe for an hourly rule.

**UI.** `NotificationProvider` (one fetch, live on `notifications` + 30 s poll because the Pages proxy
cannot forward the WS upgrade) feeds the Sidebar/mobile bell, the animated level-coloured toasts (max 3,
9 s) and the panel (newest **200**, All/Unread/level filters, mark read / mark all). The authoring console
(`components/notifications-console/`) is a Settings tab: Rules (Test/Run/pause), Deliveries (newest 200
across everyone) and Levels & caps.

**Not in v1 (deliberate).** Quiet hours are NOT applied — the founder asked for round-the-clock
escalation. Channels beyond in-app (WhatsApp/web push) stay on `core_notification_pref` for a later phase.
`latestNotificationId()` reads the just-written `core_notification` row back by (employee, title, body,
since) because the locked `notifyUsers` contract returns a count, not ids — the clean fix is a core change
request to accept an `id` in `NotifyItem`.

**Own dashboard (2026-11-24).** The console moved out of Settings into a top-level nav view
`notifications` (`/notifications`, root/admin) — `views/notifications/NotificationsDashboard.tsx` hosting
`components/notifications-console/`. Four tabs: Rules · Deliveries · Levels & caps · **AI assist**. The rules
list is filterable by search, position and live/paused, and carries a per-position `N live · M paused`
summary so the collapsed view answers “who is covered and is it on?”. Every audience selector (position,
role, department, region, roster type, specific people) is a searchable dropdown
(`components/ui/SearchSelect.tsx`) — a rule can list dozens of seats, and chips turned that into a wall.

**Test = dry run, Run now = dispatch.** `POST /notification-rules/:key/test` returns the real result headers,
every scanned row, the rendered message per person and the audience match — and stops before `notifyUsers`
(guarded). `…/run` does the real thing. The dry run also feeds **header detection**: `result.columns`
(`modules/notifications/columns.ts`) is the authored SQL's actual SELECT list, which the drawer offers as
`{TOKEN}` buttons (identity/level columns hidden — they are engine plumbing), so templates are never typed
blind.

**The preview is the query, or `null` (2026-11-24).** The dry run carries its actual output
(`result.sampleRows`, capped 50×30 — never on a cron run) which the console renders as a real table
(`ResultTable`) with a Clear button, and the message preview speaks for **row 1** of that output (with a
`1/n` stepper), not for an invented sample: `helpers.ts#renderPreview` resolves every token from the
selected row, then from engine values that are REAL for that run (`WINDOW`/`WINDOW_START`/`WINDOW_END`/
`DATE`/`RULE_NAME`, and the person behind the row via `result.sampleNames`), and renders anything else as
the literal `null` so a wrong token is visible. A row column with the same name always beats the engine
value. This is presentation-only: dispatch keeps collapsing unknown tokens to `""` (mirror guard intact).
`{EMPLOYEE_NAME}` is the one always-available default field (founder decision) — the metric SQL returns
ids, so the name can only come from the HR register, hence `sampleNames` exists.

**The schema now carries the graph.** A flat column dump let an agent invent joins and columns. The AI
block (`GET /api/notification-schema`, `modules/notifications/schema.ts`) merges four sources of
relationship truth and labels every edge by confidence:
`fk` (real `PRAGMA foreign_key_list` in the migrations) > `orm` (a join our code actually performs —
`src/shared/d1-prisma.ts#RELATIONS`) > `declared` (Prisma `@relation(fields: …, references: …)`) >
`app` (no key exists; the application matches the values — the `Telecaller.email =
HumanResourcesMember.email` seat identity, `core_notification.employeeId`, …) > `inferred` (a `xId`
column whose table exists). The code-side tiers are compiled into `modules/notifications/relations.ts` by
`scripts/gen-schema-relations.mjs` (same pattern as `gen-kyp-catalog.mjs`; `--check` fails the guard if
the schemas moved and nobody regenerated — the Worker cannot read `.prisma` at runtime). `schemaText()`
emits `-> field = Model.ref (kind)` under each table plus a separate section for the no-FK joins, and the
prompt forbids joining outside those edges. Console: per-table edges + **Copy relationships** for agents
with a tight context budget.

**AI assist.** The founder describes an escalation in words and an agent writes the rule. Two copyable
artefacts: the saved **prompt** (Setting `notifications:prompt`, default `modules/notifications/prompt.ts` —
states the row contract, the `?1/?2/?3` parameters, the level scale and the template rules) and the **live
schema** (`GET /api/notification-schema` → `sqlite_master` + `PRAGMA table_info` over the business tables
picked by `schema-catalog.ts`, KV-cached 10 min, ~45 tables). Names come from the DB, so a rename can never
make the pasted schema lie.

**Parameter binding fix.** `metric-sql#runMetricSql` now binds only the placeholders the statement uses
(`paramCount` = highest `?N` + bare `?`). Before this, the seeded rule (`?1/?2` only) failed every sweep with
D1's “Wrong number of parameter bindings” — a live rule that looked healthy and never fired.

**The first real rule.** Migration 0164 seeds `telecaller-hourly-connected-call` (DeviceCall, previous full
IST hour, `HAVING COUNT(*) >= 5` so a break/partial hour cannot grade someone); 0165 upgrades the row the
founder had already created in the console (guarded on “still the sample”), leaving their Live/Paused choice
alone. Empty windows are expected until the Auto-Dialer/phone sync writes `DeviceCall` again.

**A rule must be driven by PEOPLE, not by the fact table (2026-11-24).** The seeded query above only
produced rows for agents whose phones had synced calls in the hour, so the escalation “everyone who is not
absent gets a ping” reached two people. Migration `0167` rewrites it seat-first: `HumanResourcesMember`
(active, `designation = 'Telecaller'`) → `LEFT JOIN Telecaller` **by email (`loginEmail` first)** →
`LEFT JOIN` the hour's `DeviceCall` aggregate, so a seat with no dialer rows is a real row with `value = 0`
(level 5), not a missing row. Graded against the real target (**20 connected calls/hour**): ≥20 → 1,
15–19 → 2, 10–14 → 3, 5–9 → 4, 0–4 → 5. “Not absent that day” (`?3` = IST day) excludes approved
**full-day** leave (half-day/short leave still worked), HR attendance marked `absent`, an
`HumanResourcesHoliday` date, a `SalesHoliday` date and Sundays; windows ending outside **10:00–21:00 IST**
are not graded, so off-shift hours never fire a false “0 calls”. The update is idempotent (`instr(upper(sqlText),
'HUMANRESOURCESMEMBER') = 0`) and never touches `enabled`. Generic lesson for every future rule: whatever
the SQL does not return cannot be notified, and `HAVING` silently narrows an escalation to “people who
were already active”.

**A toast is for a NEW arrival, not for history.** `NotificationProvider` seeds its `seen` set from the first
payload, so a notification dispatched while the tab was closed (or before the page loaded) lands in the bell +
panel but never pops — by design (no backlog burst; founder decision 2026-11-24). A live toast therefore
requires the dashboard to be open when the sweep dispatches.

## 21. Root "view as" — read-only impersonation (2026-11-24)

Root can look at the platform exactly as any employee sees it: their sidebar, their dashboards, their
notification bell. Built as a **cookie overlay**, not a session swap — so the real session never leaves the
browser, nothing is ever written as the target, and exiting is one call.

```
root session (fos_session) ─┐
                            ├─► worker/viewer.ts#getViewerMe  ──► MeResponse
fos_view_as=<userId>  ──────┘        │  (only when the REAL session is root)
                                     ├─► target's scopes  → sidebar / workspaces / bell count
                                     └─► actingAs: { real root }

POST   /api/auth/view-as {userId}   → set cookie (+ hlp_view_as row)
DELETE /api/auth/view-as            → clear cookie (+ close the row)
GET    /api/auth/view-as            → last 50 views (audit)
```

**Why one cookie and not a header or a second session.** The whole app already authenticates by cookie, so
an overlay cookie makes *every* existing call resolve as the target with zero per-call plumbing: dashboards,
`/api/session/workspaces`, the notification panel, chat unread, even `<img>`. A second session would
attribute writes to the target and need cookie juggling across providers; a custom header would have to be
injected into some 200 fetch sites (and the ratchet forbids new raw fetches).

**One choke point.** `getViewerMe` is what the auth gate and every handler call, so the overlay lands in
exactly one place (~20 lines in `worker/viewer.ts` + `modules/auth/{view-as,view-as-pure}.ts`). Scoping stays
where it already is — `expandScopes`, `modules/workspaces/scoping.ts`, per-viewer queries — which is why the
sidebar and the dashboards change with no importer edits. `meFromSnapshot()` in `modules/auth/service.ts` is
the single identity assembly, so an impersonated viewer holds *exactly* the target's scopes.

**Read-only, enforced.** `worker/context.ts` refuses every non-GET/HEAD/OPTIONS request while `fos_view_as`
is present (`403 {code:'VIEW_AS_READONLY'}`), with `/api/auth/view-as` exempt so you can always leave. This
also blocks marking the target's notifications read — the founder's inbox is a read-only museum while you
are inside. The real user's own session keeps running: they still receive live notifications and toasts in
their own browser while root watches.

**Rules.** Root only; never root→root; never self; unknown/malformed cookie falls back to the real identity
(never an error, never an escalation); 2 h TTL; `hlp_view_as` records who looked at whom, when it started and
when it ended (best-effort — an audit write never blocks the view).

**UI.** `AuthContext` gained `enterViewAs`/`exitViewAs`/`isViewingAs`; `ViewAsBanner` is a sticky amber strip
on every view with the Exit button; the app shell is keyed on `me.user.id` so entering/leaving remounts and
refetches instead of leaving the previous person's data on screen. The launcher lives in
**Users & Permissions → View as**: positions (chart titles, with seated-login counts) → person (search, roles,
last login) → **Enter** → `/session`. Logins with no role are shown greyed (“grant a role first”).
