# Founder OS — Architecture

Founder OS (repository `ai_pa`) is the operating system for Brindavan Udyog: WhatsApp conversations, Zoho Books estimates, the telecalling and dispatch CRM, debtors, procurement, HR/organisation and the company brain, behind one static dashboard.

**How to read this document.** It is the present-tense structural reference: runtimes, data boundaries, request paths and invariants. It is deliberately not a changelog — historical context lives in `docs/rewrite-log.md`, and rules plus dated founder decisions are owned by `AGENTS.md` (where a business rule conflicts, `AGENTS.md` wins). Every path, binding and guard named below exists in the repository.

---

## 1. System Overview & Runtime Topology

### 1.1 Runtime diagram

```text
browser / PWA (Next.js static export, Cloudflare Pages)
        │  same-origin /api/*  +  WS upgrade on /api/events
        ▼
Pages Function  functions/api/[[path]].ts ──proxy──►  founder-os-worker
                                                      (Hono, D1)
   ┌──────────────────────────────────────────────────────┤
   │  D1 (waba-worker)   KV: CACHE_KV · CHAT_FILES        │
   │  R2: CALL_RECORDINGS   DOs: EventHub · AsyncTaskRunner · ChatRoomDO
   │                                                      │
   │  scheduled() every minute                            │
   └──► workflow_dispatch ──► GitHub Actions runners (scripts/*-runner.js)
                               │  Bearer SHARED_SECRET
                               ├── /api/runner/*      (D1 reads/writes)
                               └── /api/ai/complete   (the only AI egress)

WhatsApp providers ──► POST /webhook  (merged waba path, raw row in `waba_payloads`)
                  └──► POST /api/whatsapp/webhook  (WhatsAppController)
```

### 1.2 Runtimes

| Runtime | Entry | Storage | Role |
| --- | --- | --- | --- |
| Cloudflare Worker `founder-os-worker` | `founder-os_backend/src/worker.ts` → `worker/context.ts#createApp()` | D1 `waba-worker`, KV, R2, DOs | **Live data plane.** Thin JSON API, auth gate, live fan-out, cron router. |
| Cloudflare Pages `founder-os-frontend` | `founder-os_frontend/src/app/page.tsx` + `public/_redirects` | static `out/` | Static export dashboard; all views are client-side History-API paths. |
| Pages Function | `founder-os_frontend/functions/api/[[path]].ts` | — | Proxies `/api/*` to `API_WORKER_URL`; passes a WebSocket `101` through verbatim. |
| Durable Objects | `src/durable/event-hub.ts`, `async-task-runner.ts`, `chat-room.ts` | DO storage | Live event fan-out, background task runner, chat presence/typing. |
| GitHub Actions | `.github/workflows/cron-*.yml` → `scripts/*-runner.js` | calls the Worker | Heavy AI + Zoho/NeoDove/linkedin jobs; dispatched by the Worker only. |
| `waba-worker` (separate Worker) | `waba-worker/src/index.ts` | same D1 database | Standalone WhatsApp ingress buffer (`/webhook`, `/api/logs`, `/api/update`, `/dashboard`). The main Worker mirrors these endpoints for compatibility. |
| Express/PostgreSQL (alt/local) | `founder-os_backend/src/server.ts` | PostgreSQL via Prisma | Shares `src/modules/*` + `src/automations/*`; **not production**. `src/routes/` is frozen. |
| `local-runner.js` (root) | `node local-runner.js` | reads `waba-worker` queue | Local AI classification loop; no cron workflow drains `waba-worker`. |

### 1.3 Bindings & secrets

| Binding | Kind | Resource | Used for |
| --- | --- | --- | --- |
| `DB` | D1 | database `waba-worker` | Everything (core + helper tables). |
| `CACHE_KV` | KV | — | Read-through payload cache (`kvx:` keys), gateway usage counters (`ai:usage:`), integration ingest tokens (`integration:secret:`). |
| `CHAT_FILES` | KV | — | Chat/enquiry/dispatch attachments, product media, HR documents (20 MB per document). |
| `CALL_RECORDINGS` | R2 | `founder-os-call-recordings` | Device call recordings under `calls/`, lifecycle rule `calls-90d`. |
| `EVENT_HUB` | DO | class `EventHub` | One global instance (`idFromName("global")`) fanning live events to every tab. |
| `ASYNC_RUNNER` | DO | class `AsyncTaskRunner` | Long-running background work off the request path. |
| `CHAT_ROOM` | DO | class `ChatRoomDO` | Chat typing/presence fan-out. |

Secrets are Worker/GH secrets, never repository files: `SHARED_SECRET` (runner + webhook bearer), `GITHUB_ACCESS_TOKEN` (workflow dispatch), `WA_ENGINE_API_KEY`, `TOKEN_WEBHOOK_KEY` (limited NeoDove token overwrite), Zoho Books (`ZOHO_BOOKS_SENT_URL`, `ZOHO_BOOKS_AUTH_TOKEN`), Google OAuth/Sheets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`), `ANDROID_DEBUG_KEYSTORE_BASE64` (stable device ids), `PUBLIC_ORIGIN`, `ALLOWED_ORIGINS`, and the Pages `API_WORKER_URL`.

**AI keys are not environment variables.** The pool lives only in Setting `ai:providers` (see §4.1); `AI_KEYS`, `GROQ_*`, `OPENROUTER_*`, `REQUESTLY_*` and `LLM_*` env keys are ignored by the gateway even though older `Bindings` fields still exist.

### 1.4 Repository tree

```text
ai_pa/
├── founder-os_backend/            # Worker (live) + Express (alt) + shared domain modules
│   ├── src/worker.ts              # Worker entry: registers every route module + DOs
│   ├── src/server.ts              # Express entry (PostgreSQL, frozen src/routes/)
│   ├── src/worker/                # context.ts · cron.ts · viewer.ts · http.ts · workspace-data.ts
│   ├── src/worker/routes/         # 65 API modules, one per domain (578 endpoints)
│   ├── src/modules/               # 36 domain cores (enquiries, crm, core, auth, ingestion, integrations, …)
│   ├── src/automations/           # 40+ engine units (accounts, crm, hr, whatsapp-*, …)
│   ├── src/shared/                # ai-gateway, cache, paging, prisma-d1 shim, ist-time, …
│   ├── src/durable/               # EventHub · AsyncTaskRunner · ChatRoomDO
│   ├── prisma/schema.prisma       # 118 business models (live via the D1 shim)
│   ├── prisma/core/*.prisma       # 44 locked core_* models (8 files) + core.lock
│   ├── migrations/                # 204 numbered SQL files, latest 0183
│   └── scripts/                   # build-worker, smoke-worker, core-guard, gen-*, deploy helpers
├── founder-os_frontend/
│   ├── src/app/page.tsx           # the single static route + view switch
│   ├── src/components/            # UI (layout, dashboards, ui/, domain widgets)
│   ├── src/{sales,crm,enquiry,hr,…}  # domain hooks, mirrors and API clients
│   ├── src/hooks/                 # useLiveData (live + optimistic), usePagedQuery, …
│   ├── functions/api/[[path]].ts  # Pages proxy to the Worker
│   └── scripts/                   # prebuild, postbuild (PWA), deploy + verification
├── waba-worker/                   # standalone WhatsApp ingress Worker + schema.sql
├── android/Auto-Dialer/           # Kotlin app: pairing, dialer queue, call state, recordings
├── resources/json/                # organization.json, kyp/ (KYP v2 schema), master data seeds
├── scripts/                       # runners + runner-lib.js, guards/, dup-audit.mjs, e2e/
├── docs/                          # rewrite-log.md, REUSABLE_COMPONENTS.md, core-change-requests/
├── .github/workflows/             # 5 cron + guards + android apk + ops intake + crm backfill
├── local-runner.js                # local waba queue drain (not deployed)
└── architecture.md                # this document
```

---

### 1.5 Request lifecycle (Worker)

`createApp()` installs the whole chain in this order; a route handler only sees a request that survived all of it.

| # | Middleware | Behaviour |
| --- | --- | --- |
| 1 | CORS | Reflects `*.pages.dev`, `*.neodove.com`, `localhost`/`127.0.0.1`, plus `ALLOWED_ORIGINS`; `credentials: true`; headers include `X-Api-Key`, `Authorization`, `Cookie`. Never `*` on an authenticated API. |
| 2 | Auth rate limit | 30 requests/minute per IP on `/api/auth/*` (per isolate, in-memory) → `429`. |
| 3 | Cache-Control | `/api/status`, `/api/health`, `/health` get `public, s-maxage=60`; everything else `no-store`. |
| 4 | Boot | `bootstrapEnv(c.env)` then opportunistic `ensureBoot()`; trigger routes wait for the registry, dashboards never block. |
| 5 | Auth gate | Skipped for `AUTH_EXEMPT`; otherwise `getViewerMe` → `401 {error}` (a WS upgrade gets a bare `401`). |
| 6 | View-as | With `fos_view_as` set, every non-`GET`/`HEAD`/`OPTIONS` is refused `403 VIEW_AS_READONLY` (enter/exit exempt). |
| 7 | Handler | `readBody` → scope check → module logic → store → `broadcastLive`. |
| 8 | Auto-live | Any successful mutating `/api/*` write broadcasts `data-changed` unless the handler emitted a typed event or the path is in `LIVE_NO_AUTO`. |
| 9 | `onError` | One JSON error contract `{error, requestId}` + a single `console.error` line; never Hono's plain-text 500. |

## 2. Database Architecture & ERP Core Lock

### 2.1 Three tiers

| Tier | Tables | Change policy |
| --- | --- | --- |
| **Core** | 44 `core_*` tables modelled in `prisma/core/*.prisma` | Locked. Only `src/modules/core/` may write them. Hash-pinned in `prisma/core.lock`; changes need a human `--sign` after review. |
| **Business / helper** | 116 models in `prisma/schema.prisma` (`CrmSalesOrder`, `Enquiry`, `HumanResourcesMember`, `DebtorInvoice`, …) | Free to evolve. Reference core rows **by id only** and never duplicate a core business fact. |
| **Sidecars** | `hlp_notification_rule` / `_delivery` / `_state`, `hlp_view_as`, `hlp_dashboard`, `hlp_widget`, `hlp_cursor`, `hlp_flag` (raw SQL, no Prisma model) | Free to evolve; they annotate core rows, never replace them. |

### 2.2 Core entity groups

| File | Models |
| --- | --- |
| `01-platform.prisma` | `CoreDomainEvent`, `CoreRowChange`, `CoreAuditEvent`, `CoreAccessLog`, `CoreZohoLink` |
| `02-identity.prisma` | `CoreDepartment`, `CorePosition`, `CoreTeam`, `CoreRegion`, `CoreEmployee`, `CoreEmpDept/Position/Region`, `CoreTeamMember`, `CoreReportLine`, `CoreUserLink`, `CoreServiceAccount`, `CoreRole`, `CorePositionRole`, `CoreEmpRole`, `CorePermRule`, `CoreAccessConfig`, `CoreFieldPolicy`, `CoreSeries` |
| `03-customer.prisma` | `CoreCustomer` |
| `04-sales.prisma` | `CoreSale`, `CoreEnquiry`, `CoreCredit` |
| `05-order.prisma` | `CoreSalesOrder`, `CoreSoLine`, `CoreStageEvent`, `CoreDispatchProof`, `CoreAttachment`, `CoreStockEntry`, `CoreReservation`, `CoreWarehouse` |
| `06-finance.prisma` | `CorePromise`, `CoreReceipt` |
| `07-work.prisma` | `CoreAction`, `CoreActionEvent`, `CoreNotification`, `CoreNotificationPref`, `CoreNotificationTemplate`, `CoreSystemJob` |
| `08-leads.prisma` | `CoreLead` |

Locked paths (hashed in `prisma/core.lock`): `migrations/0125_core_foundation.sql`, `migrations/0126_core_identity.sql`, `prisma/core/`, `src/modules/core/`, `src/worker/routes/work.ts`, `scripts/core-guard.mjs`.

### 2.3 D1 access, shim and migrations

- The Worker never runs the real Prisma client: `src/shared/prisma-d1.ts` (and `d1-prisma.ts`) translate model calls to D1 SQL. After editing `prisma/schema.prisma` you must run `npx prisma generate` **and** register new fields/models in the shim's `BOOL_FIELDS` / `DATE_FIELDS` / `ID_FIELDS` / `UNIQUE_FIELDS` / `RELATIONS`; guard `d1-parity` fails on drift (its allowlist documents the known `Core*` gap).
- Migrations are plain numbered SQL in `founder-os_backend/migrations/` (4 digits, monotonic; 203 files, latest `0182`). Apply with `npx wrangler d1 execute waba-worker --remote --file migrations/NNNN_x.sql`. A fresh database must re-run seeds in order (e.g. `0154` after `0046`).
- Bulk work uses prepared statements in `db.batch()` chunks (~50 statements) instead of per-row `create`/`update`, which cost a write **plus** a read-back each. Never loop `INSERT` in a request handler (see §4.4).

### 2.4 Operational tables by domain (representative)

| Domain | Tables |
| --- | --- |
| Estimates / sales | `Estimate`, `EstimateAssignment`, `TelecallerScoreEvent`, `SalesHoliday`, `HumanResourcesRegion` |
| Enquiries | `Enquiry`, `EnquiryComment`, `EnquiryThread` (+ attachments in `CHAT_FILES`) |
| CRM floor | `CrmSalesOrder`, `CrmSoItem`, `CrmScheduleEvent`, `CrmDispatchProof`, `CrmOrderAction`, `SoAttachment`, `DispatchCashEntry` |
| Product line | `ProductItem`, `KypGuide`, `Vendor`, `VendorRate`, `VendorRateSpec`, `RateBatch` |
| Debtors | `DebtorInvoice`, `DebtorInvoiceReceivedEvent`, `PaymentCollection`, `DebtorsTopPick`, `PaymentReminder` |
| Accounts | `AccountsTaskTemplate`, `AccountsTaskLog`, `AccountsTaskAttachment` |
| HR / org | `HumanResourcesMember`, `…SalaryComponent/Template/Slip`, `…Attendance/Leave/Holiday`, `…Task/Log`, `…Expense/FundTxn/Inventory`, `…DocumentType/MemberDocument`, `…AssetType/Asset/PositionAsset`, `…HiringPosition/PositionDoc`, `OrgChartPosition` |
| Dialer | `DeviceRegistration`, `DevicePairCode`, `DeviceCall`, `ManualCallLog`, `FieldVisit`, `FieldExpense` |
| Chat / brain | `ChatChannel`, `ChatMessage`, `ChatMember`, `ChatReadState`, `BrainContext`, `ChatPendingItem` |
| Notifications | `core_notification` (inbox/audit) + `hlp_notification_*` (rule, delivery, state) |
| Platform | `Setting`, `Token`, `AuditLog`, `Automation`, `AutomationRun`, `AuthUser`, `AuthSession`, `AuthScope`, `AuthRole`, `AuthUserRole`, `AuthRoleScope` |

### 2.5 Invariants

- `core-guard.mjs` checks three things: locked file hashes match `core.lock`; no `INSERT/UPDATE/DELETE` against `core_*` outside `src/modules/core/`; `routes/work.ts` stays thin. The pre-commit hook runs it and must never be bypassed.
- Core changes are **proposed**, not patched: write the rationale in `docs/core-change-requests/` and let a human edit + re-sign.
- The core inbox is the only notification sink (`core_notification` via `modules/core/notify.ts#notifyUsers`); product code writes sidecars, never its own inbox table.
- Helper tables may cache a core figure but never become its home. Mirrors are one-way: helper → core service, never a second writable copy.

---

## 3. Authentication, RBAC & “View As” Impersonation

### 3.1 Sign-in flow

1. `GET /api/auth/google` builds the Google consent URL from the Worker's OAuth client (`AUTH_PUBLIC_ORIGIN` decides the redirect base) and responds with the redirect.
2. Google returns to `GET /api/auth/google/callback`; the handler verifies the identity, then upserts `AuthUser` by email. `ROOT_EMAIL` is the only account that is created with `isRoot`.
3. A row is written to `AuthSession` and the response sets `fos_session` — `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` on HTTPS.
4. Every later request resolves that cookie in `worker/viewer.ts#getViewerMe` (memoised per request) into the viewer: user, roles, effective scopes, `isRoot`/`isAdmin`, and `actingAs` while impersonating.
5. `POST /api/auth/logout` deletes the session row and clears the cookie.

Only approved logins get a viewer; an authenticated but unapproved account sees the pending screen. When Google OAuth is not configured (`authEnabled(env) === false`) the gate is bypassed entirely, which is what local development and the Express runtime use.

### 3.2 Tables

| Table | Holds |
| --- | --- |
| `AuthUser` | Email, display-name override, `isRoot`, approval. |
| `AuthSession` | Session id ↔ user; the cookie carries only the id. |
| `AuthScope` | Permission keys (catalog). |
| `AuthRole` | Named bundle + `position` (one chart title per role). |
| `AuthRoleScope` / `AuthUserRole` / `AuthUserScope` | Role→scopes, user→roles, direct user grants. |

### 3.3 Scopes, roles and delegation

- A **scope** is a permission key (`crm`, `accounts`, `human-resources`, `sales-head`, `product-line`, …). A **role** is a named bundle of scopes tied to exactly one chart title (`AuthRole.position`; root-only `PUT /api/auth/roles/:key`). Users are assigned roles, not ad-hoc powers, in the Users tab.
- Effective scopes = direct grants + role scopes + the implied bundle, expanded **server-side** in `modules/auth/implied.ts#expandScopes` (via `worker/viewer.ts#toViewer`). The frontend mirror `auth/permissions.ts#IMPLIED_SCOPES` is display-only and guard-compared.
- Implied bundle:

```text
sales       → enquiry-tracker
sales-head  → telecalling, enquiry-tracker, zoho, debtors-tracker
dispatch    → crm
accounts    → debtors-tracker
```

- Delegation is top-down and hidden: a non-root viewer lists only the users/scopes it could itself grant, and `/api/automations` is trimmed server-side (role names masked to counts).
- Write guardrails: `PUT /api/auth/users/:id/roles` is delta-checked — granting beyond your own power is `403`, and roles managed by root are force-kept. The root user is never editable or deletable. `admin` and `user-admin` are root-grantable only. All role/scope writes use `ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE` (which cascade-wipes assignments).
- **Users & Permissions** (root + `user-admin`) owns Users / Roles / Scopes / Orphans. The Orphans tab is the only backfill path for roster-without-login and login-without-employee.
- Employment facts belong to the HR register (`PUT /api/org/people/:id`); the auth manage drawer only overrides the display name (`PUT /api/auth/users/:id/profile`, never overwritten by Google sign-in).

### 3.4 `AUTH_EXEMPT` surface

`worker/context.ts#AUTH_EXEMPT` is a prefix list. Each entry is an explicit decision, not a convenience:

| Prefix | Why it is session-free |
| --- | --- |
| `/api/debug/` | Diagnostics (dev/intake debugging). |
| `/api/auth/` | Sign-in must run before a session exists; the auth routes rate-limit themselves. |
| `/api/runner/` | GitHub runners authenticate with `Bearer SHARED_SECRET` in-handler (`requireSecret`). |
| `/api/trigger/` | Manual/automation triggers, same secret gate. |
| `/api/health`, `/health`, `/api/status` | Liveness/status snapshots. |
| `/webhook`, `/dashboard` | Merged `waba` ingress + its tiny dashboard; `X-Api-Key` checked when `WA_ENGINE_API_KEY` is set. |
| `/api/automations/<public>/data`, `/api/session/workspaces/<public>/data` | Derived from catalog `publicData: true` — only `telecalling` and `neodove-telecaller-report`. |
| `/api/linkedin/image/` | Public marketing diagrams served into `<img>` tags (UUID ids). |
| `/api/enquiries/files/`, `/api/crm/files/` | Byte-serving for unguessable ids shared with customers/transporters and fetched by vision providers; upload/list/delete stay gated. |
| `/api/email/oauth/callback` | Google redirect before a session exists; KV state token is the CSRF guard. |
| `/api/token/` | NeoDove token extractor: full `SHARED_SECRET` or the limited `TOKEN_WEBHOOK_KEY` (neodove source only). |
| `/api/ai/` | `POST /api/ai/complete` accepts a runner secret **or** a viewer session in-handler. |
| `/api/estimates/bulk-upsert`, `/api/neodove/report` | Runner writes, secret-gated in-handler. |
| `/api/ingest/` | External portals post with a path token (only its SHA-256 in D1) plus optional HMAC. |
| `/api/android/` | Devices authenticate with a per-device bearer token (`requireDevice`). |

### 3.5 Root “view as” (read-only impersonation)

Impersonation is a **cookie overlay, never a session swap**:

- `POST /api/auth/view-as {userId}` (root only, never root→root, never self) sets `fos_view_as` — HttpOnly, 2 h. `DELETE`/exit clears it. Enter/exit are exempt from the read-only gate.
- `worker/viewer.ts#getViewerMe` is the **only** overlay point, so the sidebar, `/api/session/workspaces`, the bell count and chat unread all scope themselves exactly like the target, and `actingAs` names the real root.
- The whole session is **read-only** while the cookie is set: `createApp()` refuses every non-`GET`/`HEAD`/`OPTIONS` with `403 {code: "VIEW_AS_READONLY"}` (verified against the cookie, so it also covers exempt paths). Nothing can be saved as, or attributed to, the target.
- `GET /api/auth/view-as` and `hlp_view_as` are the audit trail (who impersonated whom, when, from where). A stale/bogus cookie falls back to the real identity rather than erroring.
- Frontend: amber `ViewAsBanner`, `actingAs` mirrored in `auth/AuthContext`, and an identity `key` on the app shell so no target state leaks across a switch. Launcher: Users & Permissions → **View as**.

Guards: `view-as` (impersonation rules), `no-mis-role` (retired MIS powers stay dead), `org-access` (scope/implied parity), `chat-root` (root is never a chat participant).

---

## 4. Shared Backend Infrastructure

Four primitives carry every domain: the AI gateway, the KV cache, the live event hub, and the paging/bulk-write contract. Nothing else is allowed to grow its own version.

### 4.1 AI gateway — `POST /api/ai/complete`

One gateway serves the Worker, every GitHub runner, the playground and the copilots. Runners hold **no** AI credentials; `scripts/ai-gateway.js` is only a helper/pool port for local scripts.

**Pool source of truth.** Only Setting `ai:providers` (BYOK JSON, root-edited, never echoed):

```json
{ "providers": [ { "id": "openrouter", "baseURL": "https://openrouter.ai/api/v1",
                    "model": "vendor/model", "enabled": true,
                    "keys": [ { "key": "sk-…", "label": "or-1", "enabled": true } ] } ] }
```

- Environment variables (`AI_KEYS`, `GROQ_*`, `OPENROUTER_*`, `REQUESTLY_*`, `LLM_*`) are **ignored**; an empty Setting means an empty pool. Groq keys are never loaded.
- `providers[].enabled` and `keys[].enabled` are persisted operator filters; a runtime `401/403` disables the key for the isolate.

**Selection and failover.**

- Global strategy is Setting `ai:strategy` = `least-used-first` (default) or `round-robin`; a `sessionKey` pins a conversation to one key (used once, never retried).
- Attempts: 3 tries per provider leg, 6 pool-wide. Rotation is immediate — never a backoff sleep.
- `429` → cool that key and rotate; `401/403` → disable the key; `404` → quarantine the whole provider for 5 min; `1015` → cool + rotate; a hang → first-token deadline 20 s / first-byte 30 s, then rotate.
- Budgets: 120 s per streamed leg; buffered callers 60 s; the playground stream caps at 120 s (5 min max). Timeouts are per-attempt, not per-request.
- **No request ever sends `max_tokens`** (founder rule). `req.maxTokens` is accepted and deliberately ignored; the model's own maximum applies.
- JSON callers stream (`completeJsonStream`): a buffered completion only emits its first byte when the whole answer is ready, which the first-byte deadline would kill. When a provider refuses streaming (`503 service is busy`), the gateway falls back to the buffered call.
- Failover happens on any failure or deadline breach, but never after a delta has been delivered (the consumer must retry) and never blamed on the caller's abort.

**Key health.** Every call writes one `AiKeyCall` row (fingerprint id, no secret) through the `createApp()` sink + `waitUntil`. The native 5-min cron sweeps a 24 h / minimum-5-sample window and scores `0.5·reliability + 0.3·TTFT + 0.2·TPS`; thresholds live in Setting `ai:health` (defaults `threshold 40`, `atRisk 60`, `minSamples 5`, `tpsTarget 40`, `ttftGoodMs 800`, `ttftBadMs 5000`, `autoDisable true`). A key below `threshold` is auto-disabled (persisted); manual re-enable stamps `healthResetAt` and never auto-recovers. `source='playground'` calls are excluded from scoring.

**Endpoints.**

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `POST /api/ai/complete` | runner secret **or** viewer | The only completion door (JSON or SSE). |
| `GET /api/ai/health` | public | Pool health summary (no key material). |
| `GET /api/ai/providers` | root | Providers, masked keys, masked health. |
| `PATCH /api/ai/providers/:id`, `PATCH /api/ai/providers/:id/keys/:kid` | root | Enable/disable provider or key; re-enable resets health. |
| `GET /api/ai/key-calls` | root | Recent ledger rows. |
| `POST /api/ai/test`, `POST /api/ai/test/stream` | root | Pinned playground (SSE `meta·delta·done·error`). |

### 4.2 KV cache — `src/shared/cache.ts`

| API | Behaviour |
| --- | --- |
| `cached(key, ttl, compute)` | Read-through with **single-flight** (concurrent callers share one compute) and **stale-on-error** (a failed compute serves the previous value instead of failing the page). JSON values under the `kvx:` namespace. |
| `cacheGet` / `cacheSet` / `cacheDel` / `cacheDelPrefix` | Raw access; prefix delete is a last resort. |
| `cacheRev` / `cacheRevs` / `bumpRev` | Revision counters folded into hot keys, so one write invalidates a whole family without scanning KV. |
| `cacheKeys` | Key builders, so no module hand-writes `kvx:` strings. |

- Revisions in use: `est` (estimates/attribution taxonomy), `neo` (NeoDove), `debtors`. The sales board folds `cacheRevs(['est','neo'])`; a write calls `bumpRev`, never `cacheDelPrefix`.
- Where a revision is overkill, the write path deletes the exact key (`invalidateDerivedEstimateCaches`, `invalidateRiskCache`, `invalidateNeodoveCache`). Every write path must call its invalidator or the dashboard is stale until TTL.
- Hot dashboard payloads use short TTLs (60 s for the sales board and drills); warmers (NeoDove today/week/month) pre-compute the expensive ones so a page load never eats a cold aggregation.
- Never cache a viewer-scoped payload under a viewer-independent key: scope/subject is part of the key, or the payload is not cached.

### 4.3 Live transport — EventHub Durable Object

```text
write handler ──broadcastLive(env, type, data)──► EventHub (idFromName("global"))
                                                   │  WebSocket Hibernation
browser ◄── GET /api/events (101 + socket) ◄───────┘  /stream · /broadcast
```

- One global instance fans a typed event to every connected tab. Clients receive `{type, data, ts}`; the browser reopens with backoff.
- Server helpers: `broadcastLive` (in `context.ts`, re-exported from `live.ts`), `notifyLive`, and the `LiveEvent` reference catalog (`estimates`, `crm`, `enquiries`, `chat`, `notifications`, `debtors`, `product-line`, `accounts`, `settings`, `data-changed`, …). Adding a type is a compile-time constant plus one frontend subscription.
- **Auto-live**: after any successful mutating `/api/*` request the app broadcasts `data-changed`, unless the handler already emitted a typed event (`hasLiveBroadcasted`) or the path is in `LIVE_NO_AUTO` (auth, token, file/byte routes, runner-only paths). New endpoints are live by default; a handler that needs a narrow event must broadcast it explicitly.
- **Transport law**: the Pages Function must return the upgrade verbatim — `new Response(null, { status: 101, webSocket: res.webSocket })`. Rebuilding a `101` as `new Response(body, {status})` throws (the constructor only accepts 200–599) and every live view silently degrades to fetch-once. Guard `live-transport`.
- Frontend: `useLiveQuery` (refetch on matching events, coalesced), `useLiveDashboard`, `useLiveEvent`, `useOptimisticMutation` (paint first, roll back on error). Surfaces without a local echo keep a 60 s `pollMs` safety net; the notification panel keeps a 30 s poll because an end-to-end WS upgrade is not guaranteed.

### 4.4 Paging and bulk D1 writes

**Paged lists** are the founder standard: page numbers, **50 rows/page** (maximum 100), whole-table server search, `COUNT(*)` totals, and a “N new changes” banner instead of a reload under the user's cursor.

- Backend: `shared/paging.ts` — `parsePageQuery` (clamps), `searchClause` (parameterised `LIKE`, never raw SQL), `pagedQuery` (page + total in one call).
- Frontend: `hooks/usePagedQuery` + `lib/paging` + `components/ui/Pager` + `ChangesBanner`. Never use `rows.length` as a total, never a capped `take:` slice pretending to be a page.
- Exceptions (deliberately unpaged, with a scope that keeps them bounded): Management Active/Unprocessed, today's dispatches, overdue, procurement pending.
- `RATES_PAGE_MAX = 500` for the product-line rate sheet; it is the one list allowed a larger page.
- Guard `list-paging` locks the standard and the done surfaces (product line, customer master, dispatch).

**Bulk writes** never loop single-row `create`/`update` — each of those is a write plus a read-back `SELECT`. Instead: one prepared statement per mutated row, flushed in `db.batch()` chunks of ~50 (`IMPORT_ROWS_PER_CALL` = 1,500 rows per request for the debtors paste, which then re-posts with a `cursor`; product-line rate import ships ~50 statements per batch; master-data imports batch 20 rows per D1 call). Upserts use `ON CONFLICT DO UPDATE` so a repeat is idempotent without a read-back, and anything expensive outside the user's request (e.g. the core receivable mirror) runs once per paste behind `waitUntil` on the last slice.

---

## 5. Domain Modules

Each domain below is a `src/modules/<name>/` core (types · pure · store · service · routes) plus one `src/worker/routes/<name>.ts` binding, plus a frontend mirror where behaviour must match byte-for-byte. Route files stay thin: parse → scope → call the module → store → broadcast.

### 5.1 Sales, Estimates & Enquiry Threads

- `sales` is the workspace for `telecalling` holders and mounts one tab bar: Leaderboard · Analyzer · Enquiries · Master · Dispatch · Field · Objections · Controller. `telecalling` and `master-data` stay **headless** data providers; `enquiry-tracker` is retired and only redirects.
- The board loads in **one request** — `GET /api/estimates?period=…&follow_ups=1` carries the board plus every region's pipeline; region drills are `service-parts/drill.ts` with their own 60 s cache and only that region's sent estimates. The cache key is folded with `cacheRevs(['est','neo'])`.
- Custom ranges: `pure.ts#resolvePeriod` is the only validator (swaps reversed ends, `to` never future, span ≤ `MAX_CUSTOM_RANGE_DAYS = 93`), and the cache key is built from the resolved dates (`periodToken`), never raw client strings. `meta.periodKind` / `periodClamped` echo what the server actually applied.
- Attribution is derived per tick from `referenceNumber` → `Estimate.region`; `masterHomeRegions` is the fourth fallback and writes back only on a manual override or exact match (`pickWritebackRegion`). Unmapped rows land in an explicit bucket; the Controller re-homes them via `PUT /api/estimates/:id/region`. An agent is locked to their own region and may `PATCH` a promise only.
- Leaderboard: `tlLevel` + region (R1–R4), slabs 50/75/100/200 split 20/80, `SalesHoliday` accrues ₹0 like Sundays, reset deletes close rows and bumps `salesboard:epoch`. `TelecallerScoreEvent` **became** `core_credit` (no mirror, no flip flag); guard `ledger-collapse-parity` keeps it that way.
- Enquiries: decided-means-done (`normalizeItemWrites` auto-resolves answered lines), Management Review is scope-gated (`management-access`), sales payloads are vendor-stripped (`stripMarginFields`, `sales-redaction`), the known-rates picker is privileged-only (`enquiry-known-rates`), and Zoho risk always reads `dateFormatted` (+05:30), never `date`.
- Threads live in `EnquiryThread`, never in item JSON. Channel `sales` = sales↔management; `internal` = management↔procurement and is never served to sales — every call names its `desk`, the server checks `deskAllowed` and filters by channel (list, inbox and by-id 404).
- Thread categories: `product_query` may be opened **only by sales** and is shared with procurement from the moment it is raised (procurement replies in the same thread and reaches sales as *Management*: true author stored, name/desk/vendor scrubbed into `salesText`/`salesName`); `rate_negotiation` is sales↔management only. Legacy rows keep `category = NULL` and the pre-category behaviour.
- Messages carry up to 6 photo/video/PDF attachments, uploaded to the enquiry file locker first and stored only as `/api/enquiries/files/enq/…` URLs (`cleanAttachments` drops data-URIs and outside links); text is optional when a file is attached. Either side may resolve.
- Guards: `sales-range` · `sales-board-cache` · `sales-redaction` · `estimates-movement` · `queue-mirror` · `ledger-collapse-parity` · `management-access` · `customer-district` · `enquiry-{sources,threads,known-rates,rates-union,procurement-ownership,region-writeback,agent-resolve,sent-revision,query-bypass,media-removal,loop-ask-kinds}`.

### 5.2 CRM dispatch floor

- The floor is `CrmSalesOrder` + `CrmSoItem` line lifecycle (`pending → scheduled → dispatched`, plus soft `removedAt`). `GET /api/crm/orders` pages in memory over the uncapped cached floor scan (`modules/crm/list-page.ts`); today's dispatches stay unpaged.
- `dispatchSummary` counts the floor with `queues.ts#floorRowFlags` (frontend mirror `crm/queue.ts`) — **one** source for the Due today / Overdue cards and the badge. Removed lines never count; `dueToday` and `overdue` are different **lines** of one order, so the badge is `counts.tabFloor` (the union the list renders), never `floorToday + overdue`. Lifecycle buckets overlap by design and never back a card.
- Dispatch validation is one shared rule set (`validateDispatch` / `verifyDispatchProof`, mirrored in `crm/lifecycle.ts`): scheduled-only, no removed line, quantity within the remainder, invoice verified and burned when the gate is on.
- **Invoice gate**: Setting `crm:invoice_gate` = `enforce` (default) or `off`, toggled by root in Settings → CRM dispatch floor with no deploy. `off` writes the sentinel `invoiceId = 'no-invoice:<uuid>'` — never a file — because `CrmDispatchProof.invoiceId` and the core mirror's `core_dispatch_proof.invoiceId` are both `NOT NULL UNIQUE` (a nullable column would make the mirror's `INSERT OR IGNORE` drop real rows). Read-back sets `noInvoice`. Audit with `WHERE invoiceId LIKE 'no-invoice:%'`.
- **Dispatch cash** is a floor surface: `GET/POST/PATCH/DELETE /api/crm/cash` (core unchanged) rendered as the floor's *Dispatch cash* tab. Every verb is gated root/admin + `crm` + `dispatch` + `accounts`, and the Accounts dashboard no longer carries the ledger. `viewerMeta.canSchedule` (root + `crm`) hides “To Schedule” for dispatch-only logins — visibility only, the scheduling endpoint is unchanged.
- Scheduling writes `CrmScheduleEvent`; proofs write `CrmDispatchProof` with bytes in `CHAT_FILES` served from `/api/crm/files/`. Every cached floor row must stay JSON-safe — a `Map` serialised to `{}` in KV is the incident behind guard `crm-cache-shape`.
- Guards: `crm-lifecycle` · `crm-cash` · `crm-cache-shape` · `list-paging`.

### 5.3 Procurement & Product Line (KYP v2)

- `resources/json/kyp/bui_milling_vendor_kyp_schema_v2.json` is the **sole truth** for products (103), categories (11), aliases (394) and the spec-ask. `scripts/gen-kyp-catalog.mjs` compiles it into `product-line/kyp-catalog.ts` plus `migrations/0156_kyp_catalog_v2_seed.sql` (ids `pi_<key>` / `kg_<key>_<attr>`). Never hand-edit that generated pair; guard `kyp-schema` runs `--check` and locks the JSON invariants.
- The live catalogue is editable in D1 (`product-line/catalog-live.ts`, KV `product-line:catalog:v1`) and is what rate writes typecheck against and what `GET /api/product-line/schema.json` exports as KYP v2 JSON. `attrKey` is immutable; deleting a spec that live quotes answer is blocked with the count.
- Specs are **one JSON column** (`VendorRate.attrValues`). `brand`, `material` and `machine_make_model` live inside it (`EXTRA_SPEC_KEYS`, no columns); `baseRate` stays derived `price × (1 − disc/100)`; media are KV paths (`imageUrl`, `videoUrl`). Writes typecheck via `validateSpecs` — a schema violation is a `400`, a missing required value is recorded in `missingSpecs`, never invented.
- Fast spec queries ride the typed mirror `VendorRateSpec` (indexed `(attrKey, valueNum)` / `(attrKey, valueText)`, written in the same batch): `GET /api/product-line/rates?spec=brand:PIX&spec=width_mm:>=1000`. The rate sheet pages up to **500** rows (`RATES_PAGE_MAX`) with all filters server-side.
- A bulk paste is a traceable **two-phase** batch: `POST /rates/import/preview` resolves and typechecks every row and names the vendors that would be created (writes nothing), then `POST /rates/import` lands it with explicit `vendors:[{name, action: create|map|skip}]` decisions — no vendor is ever auto-created. `RateBatch` + `VendorRate.batchId` let a batch be reviewed (failures included) and undone exactly (`DELETE /batches/:id` deletes its quotes; the log row stays `deleted`).
- The write itself is planned as plain `INSERT` statements (one `VendorRate` + one `VendorRateSpec` per answer, no read-back) and shipped in `db.batch()` chunks of ~50. One `touchedMany` cache wave per distinct product.
- **Procurement owns an enquiry until they conclude it**: `isProcurementPendingEnquiry` = has items + not a Zoho-closed status + not `procurementSubmittedAt` (the “Enquiry Concluded” click). `rateStatus` (`rates_received` / `finalized` / `sent`) and Zoho draft/approved never move a row to History and never lock the card, so procurement keeps adding quotes until that click; a late quote on a finalized row reopens the decision (`applyLateQuoteReopen`), and the conclude gate refuses while any procurement-held loop is open.
- Sales sees an **order brief** under the spec (amber “order this spec” with `specDiff`, emerald “Note from Management” with `salesNote`) that survives `rateStatus = 'sent'`. Rows sales may render go out **vendor-stripped with `anonymous: true`**, and the frontend normaliser keys on that marker — never on `vendor.trim()`, which no sales payload satisfies.
- Guards: `kyp-schema` · `enquiry-procurement-ownership` · `enquiry-known-rates` · `queue-mirror` · `list-paging`.

### 5.4 Debtors & Accounts

- Debtors is built from **dated rows**, not mutable totals: invoices by `invoiceDate`, receipts by `collectionDate` (`DebtorInvoiceReceivedEvent` stores dated deltas), buckets re-aged at the requested date. `?asOf=&from=` rebuilds the whole dashboard at that date and adds a then/now comparison; no params = today, byte-identical.
- Historical views are **read-only** (imports, edits, pins and reminders disabled, banner states the limits); region, situation and promises are current-only. `deletedAt` keeps bills that were deleted after the as-of date visible.
- Paste imports are bulk and resumable: one prepared statement per mutated row flushed 50 per `db.batch()` (`debtors-tracker/batch-write.ts`), upserts on the existing unique keys so re-pasting is idempotent with no read-back. The route applies ≤ `IMPORT_ROWS_PER_CALL` (1,500) rows and returns `report.{cursor,total,done}`; the modal re-posts the same text until `done`. The core receivable mirror runs once per paste on the last slice behind `waitUntil` — never in the request path.
- Invoice-number sort is `multi-sort.ts#compareInvoiceNo`: the trailing `/` segment cast to Number (`BUI/26-27/751` → 751), numeric serials first, finite fallback so a stacked sub-level can never be killed by `NaN`. Clicking a new column appends under the active sort; `Reset` restores the default. The historical snapshot has its own empty state.
- `DebtorsTopPick` is a temporary manual pin, not a ranking; the daily reminder job is a **dry run** at 04:30 UTC (10:00 IST) that logs one preview per eligible customer. Live sending stays disabled until a WABA template and opt-in are provisioned.
- **Accounts task threads**: the taskbar is one row per task × lane, not a card per day. `AccountsTaskLog` is the thread entry (`entryKind = instance|auto_miss`, `lateNote/By/At`, `UNIQUE(templateId, dueDate, slot)`); the window is the **Indian FY** (1 Apr → 31 Mar). `runThreadMaintenance` instantiates due days and writes `not_done` for a past day nobody logged, natively at the 02:30 UTC (08:00 IST) slot plus a 14-day repair on every payload compute.
- A missed day **stays Not done forever**: `lateNote` is the resolution audit trail and never flips status; the label “Task not done on <date>” is rendered (`missLabel`), never stored. Payload `threads` (counts + `completionPct`, cache `accounts:dashboard:v3:`) backs the UI; export defaults to `shape=thread` (`shape=daily` kept).
- Dues projection stays signature-gated (`accounts:dues:sig`, 30-min self-heal); the payment calendar clamps month length via `statementDateFor`.
- Guards: `debtors-as-of` · `debtors-import-batch` · `debtors-invoice-sort` · `debtors-top-picks` · `accounts-thread` · `format-canonical` · `list-paging`.

### 5.5 HR, Organisation & Auto Dialer

- **One employee master**: `HumanResourcesMember` carries the person, their chart seat and their sales profile (`salesType`, `salesRegions` as a JSON array of 0..N regions, `salesTeamLeadId`, follow-ups, WhatsApp, NeoDove ids). There is no roster table: `Telecaller` is a read-only view over those columns, so leaderboards, drills and history re-point to the employee id.
- `HumanResourcesRegion` (codes fixed R1–R4 because `Estimate.region` and `ClientClass.masterRegion` store them; name, `tlLevel`, `states`, `order`, `active` editable) is **sales-head/root only** via `GET/PATCH /api/sales/regions[/:code]` (`requireSalesManager`). HR has no region editor; forms read `GET /api/org/regions`.
- The org chart is one graph with one save: `OrgChartPosition` in D1, seeded lazily from `organization.json` (kept equal by `org-chart-parity`), read by `GET /api/org/chart`, written by HR/root/admin. The top cannot be renamed or deleted, a head must report to the top, and cycles, active seats, role titles and position standards block edits. `loginPosition` is a display suggestion only, never an access grant.
- Employee form designation is **free text** (picking a chart position is the optional seating shortcut); `PUT /api/org/people/:id` writes the employee master plus the sales profile and never touches access. `canManagePerson`: root/admin all, `human-resources` all, `sales-head` Sales only, department scopes their own department.
- Leave (`/leave`) is available to every approved login: `full_day` / `half_day` / `short` on any date with a mandatory purpose. HR decides in HR → Leaves & holidays; a rejection needs a note the employee sees; nobody decides their own request (root excepted). Only `approved` rows count in attendance and payroll (half day = 0.5, short = recorded only).
- Delegation is one UI for the HR tab and `/delegation` (`TaskBoard` + `TaskCard`): tab filters, default Open, explicit Save (no blur autosave), reopen requires a reason, 30-minute grace on the timing chip, done-30d keys on the completion day.
- HR controller lists own documents / expense categories / asset types; document bytes live in KV `hrdocs/emp/<uuid>.<ext>` (PDF/JPEG/PNG/WebP, 20 MB); an expense `POST` requires a `categoryId` and `PATCH` cannot clear it; assets are employee-held metadata plus role standards; the hiring kit is any number of JD/SOP/questionnaire PDFs plus one `videoUrl` (completeness = three kinds + link).
- Display names use `employeeDisplayName()` = “Character Name (Legal Name)” on every surface (HR, org, payroll screen, leave/task audit, leaderboard, notifications, chat); the legal `name` stays for payroll and statutory snapshots.
- **Auto Dialer** (`android/Auto-Dialer`): a phone pairs with a 6-digit code the sales head approves in Controller → Auto Dialer; one active phone per agent. `DevicePairCode` → SHA-256 token on `DeviceRegistration`; the app polls `/api/android/dialer/{config,queue,sync}` and the controller uses `/api/dialer/*` behind `requireCallManager`.
- Config lives in Setting `dialer:config`: dispositions, break reasons with limits, timer, shift, retry 2 h × 3, `connectedMinSec`, `trackPhoneCalls`. Call state comes from the phone (`TelephonyManager`; off-hook = live, back on-hook = disposition, a dial that never left the hook = `NotPlaced`), never from the app resuming, and a connected call is never re-dialed. The queue marks an item done only on a server `accepted*`; the retry cap moves it to `unreachable`; scheduled IST break windows lock the phone's dialer.
- Recordings go to R2 `CALL_RECORDINGS` (lifecycle `calls-90d`) and are served through `/api/call-log/recording/:id`; metadata expires 90 days after upload in the 21:35 UTC cron pass. Recordings keep the phone's real format (AMR is not browser-playable → download).
- Guards: `sales-staff-single-master` · `org-access` · `org-chart-parity` · `org-chart-edit` · `org-sales-head-anchor` · `employee-display-name` · `hiring-kit` · `position-workspace` · `no-mis-role`.

### 5.6 WhatsApp, Chat & Brain

- Ingress has one raw sink and one controller: `POST /webhook` (merged `waba` path, `X-Api-Key` against `WA_ENGINE_API_KEY`, writes `waba_payloads`, enriches media) and `POST /api/whatsapp/webhook` (WA Engine Pro payload → `WhatsAppController.handleWebhook` under `waitUntil`). `waba-worker` buffers the free-tier queue; `local-runner.js` drains it locally.
- Tokens are rows in `Token` (`/api/token/:source`, `/api/token`), never files. Sends go through `/api/whatsapp/send` and `/api/whatsapp-proxy/send`; contacts, messages, picture, note and summarize live on the same route module. Pending items are `/api/pending-items*` (sales follow-up prompts derived from threads).
- Automations: `whatsapp-digest`, `whatsapp-autopilot` (rule-driven replies) and WhatsApp marketing campaigns (`MarketingCampaign` / `MarketingLead`). Campaign pushes use per-agent NeoDove URLs (secret names only, SSRF-validated `*.neodove.com`), `single` / `split` routing on a **stable** mobile hash (never migrates), fail-closed behaviour, an append-only ledger and the `NEODOVE_CAMPAIGN_LIVE=1` switch. NeoDove userIds recycle across staff, so a hand-link via the roster picker is authoritative and auto-sync never overwrites it.
- Chat: `ChatChannel` / `ChatMessage` / `ChatMember` / `ChatReadState`, with `ChatRoomDO` for typing and presence. Root (`auth_user.isRoot`) is filtered from members, DMs and root-authored messages/typing/reactions; names resolve through the same employee index; DMs are `senior` | `junior` (legacy `manager` → Senior). Unread counts feed the sidebar badge.
- Brain: `BrainContext` rows plus `POST /api/brain/query` (and `/api/ask-founder-ai`) / `GET /api/brain/stats`, and the 30-minute email brain index runner (`/api/runner/brain/sources`, `/api/runner/brain/context`). Ingestion is append-only and retrieval is scoped to the requesting desk; the runner never writes embeddings to env.
- Guards: `chat-root` · `live-transport` · `enquiry-threads` (shared attachment rules).

### 5.7 Notifications

- Rules are data: `hlp_notification_rule` = audience (chart position / department / region / roster type / role / person) + cadence (hourly · everyNMin · daily · weekly · manual, IST windows) + one read-only SELECT with the row contract `telecaller_id` **or** `employee_key`, `value`, `level` 1–5 (+ any alias as a template token) + mustache title/body.
- Delivery goes only through `modules/core/notify.ts#notifyUsers` (the core lock keeps `core_notification` the inbox/audit), plus an `hlp_notification_delivery` sidecar carrying level, colour and metrics, deduped by `UNIQUE(ruleKey, employeeKey, windowKey)`.
- `runNotificationSweep` runs natively in the every-minute cron — no GitHub dispatch, no LLM, and **no quiet-hours gate**. Level 1 = Normal/Resolved: logged, never toasted (an opt-in recovery notice exists).
- `GET /api/notifications` returns the viewer's newest 200 with level colours overlaid from Setting `notifications:levels`. The bell, toasts and panel share one `NotificationProvider` (live on `notifications` plus a 30 s poll).
- The authoring console is the **Notifications dashboard** at `/notifications` (root/admin): Rules · Deliveries · Levels & caps · AI assist. Rules filter by position and live/paused with a per-position summary, every audience selector is the shared searchable `SearchSelect` (never chips), and Test/Run sit under the SQL editor so a dry run returns the query's rows before a rule goes live.
- Guards: `notifications` · `notifications-dashboard`.

---

## 6. Scheduled Execution & GitHub Actions Runners

### 6.1 The router

There is exactly one Cloudflare Cron Trigger, `* * * * *`, handled by `scheduled()` in `src/worker/cron.ts`. It does two things:

1. **Native work** — small, deterministic D1 jobs run inside the Worker with `ctx.waitUntil`.
2. **Dispatch** — `workflow_dispatch` to GitHub Actions for the heavy AI/Zoho/NeoDove jobs, chosen by UTC minute alignment.

- Every gate uses `event.scheduledTime`, **never** `new Date()`: delivery can lag 1–2 minutes and a minute-aligned gate would drift or skip a slot.
- Workflow files have **no `schedule:`** of their own; the Worker is the only clock. `inputs.slot` tells a workflow which daily job family fired, and a manual run defaults to `all`.
- `GITHUB_ACCESS_TOKEN` missing = dispatcher disabled (logged, native jobs still run). Dispatch sends `User-Agent` (GitHub rejects without it) and never waits for completion.

### 6.2 Native jobs

| Job | Fires | Quiet hours (21:00–09:00 IST) |
| --- | --- | --- |
| Notification sweep (`runNotificationSweep`) | every tick; no-op = one indexed read | runs — round-the-clock escalation |
| NeoDove campaign drain (`drainPendingPushes`) | every tick, 3 batches × 20 leads; only when the live switch is set | runs — a manager started the push |
| Email outbox (`processDueEmails`) | every tick, CAS-claimed, 10/tick, 5 attempts then dead | runs — sales/ops mail, no Zoho |
| AI key health sweep | `min % 5 === 0` | runs — telemetry must not sleep |
| NeoDove refresh + dashboard warmer | `min % 5 === 0` | **paused** — Zoho/NeoDove source |
| Intake retry sweeper (`sweepStuckIntake`) | `min % 15 === 0`, last 24 h, ≤3 intakes/tick | runs — LLM only |
| Accounts thread maintenance | `02:30` UTC (08:00 IST) | runs — D1 only |
| Debtors reminder dry-run | `04:30` UTC (10:00 IST) | runs — D1 only |
| Device-call retention (`expireRecordings`) | `21:35` UTC | runs — D1 only |

The intake sweeper and the GH intake runner share the same claim keys (`enquiry:intake:claim:<id>` / `enquiry:intake:done:<id>`), so the two can never double-process an enquiry; a run that exits before writing a marker is exactly what the sweeper heals.

### 6.3 Dispatched workflows

| Workflow | Fires when | Jobs |
| --- | --- | --- |
| `cron-every-5min.yml` | `min % 5` (all hours) | `whatsapp-digest`, `whatsapp-autopilot`, `light-triggers` |
| `cron-every-10min.yml` | `min % 10`, ops window only | `neodove-today` |
| `cron-every-15min.yml` | `min % 15`, ops window only | `crm`, `zoho-sent-analyzer` |
| `cron-every-30min.yml` | `min % 30` (all hours) | `email-brain-index`, `enquiry-intake-backstop`, `light-triggers` |
| `cron-daily-ist.yml` | 02:30 / 13:30 / 19:30 / 21:30 UTC | `baseline-freeze`, `data-retention`, `telecalling-distribution`, `morning-brief`, `eod-summary`, `neodove-report`, `linkedin-daily` |

Daily slots in UTC → IST:

| Slot | IST | Job family |
| --- | --- | --- |
| `02:30` | 08:00 | telecalling distribution + morning brief (and the NeoDove backfill) |
| `13:30` | 19:00 | EOD summary |
| `19:30` | 01:00 | baseline freeze |
| `21:30` | 03:00 | data retention + LinkedIn daily (5 founder drafts) |

The former `15:30` (21:00 IST) telecalling deduction slot is retired: the region model has no individual holds, so there is no EOD deduction machinery. Starter stubs still answer `{retired:true}`.

Quiet hours (21:00–09:00 IST, `isOpsWindow`) skip the 10- and 15-minute dispatches (pure Zoho/NeoDove analysis), still fire the 5- and 30-minute ones (WhatsApp, light triggers, email index, intake backstop), and fire the daily workflow with `run_neodove=false`.

Two ingestion jobs ride this dispatch: `ingestion-batch` in the 5-minute workflow (processes staged `batch` rows) and `portal-poller` in the 15-minute one (pulls portal feeds). Both are serial per job and never ping Zoho themselves (see §9.4).

### 6.4 Runner conventions

- Every runner is `scripts/<job>-runner.js` and imports `scripts/runner-lib.js`: env validation, `workerRequest(path, {method, body, timeoutMs})` with `Authorization: Bearer ${SHARED_SECRET}` (default 90 s), and AI access **only** through `POST /api/ai/complete`. No runner holds an AI key.
- Runners write through `/api/runner/*` only. That surface is 27 secret-gated endpoints (the three ingestion ones live in `worker/routes/integrations-runner.ts`); adding one means adding it to a runner route module, not opening a new public path.
- Long jobs are resumable/idempotent: marker rows or `Setting` claim keys, one row per unit, and a re-run must not duplicate.
- A failed run must exit non-zero so GitHub marks it red; swallow-logging a failure is how a silent stall happens.

---

## 7. Frontend Architecture

### 7.1 Shell and routing

- One static route: `src/app/page.tsx`. Every view is a History-API path parsed by `hooks/useHashRoute` (`/session`, `/session/<slug>`, `/automations`, `/leave`, …), so the export never needs a page per view.
- `components/layout/nav.tsx` is the single nav list (`NAV_ITEMS`, 13 entries: session, workspace, automations, notifications, integrations, delegation, leave, chat, briefing, whatsapp, email, settings, admin). `VIEW_TYPES` drives the `page.tsx` switch, and guard `view-wiring` fails if the two lists disagree — a nav entry without a rendered branch and a default export is a blank page, not an error.
- `auth/permissions.ts#canView` is fail-closed (unknown view = denied) with a slug→scope fallback; the server remains the authority. An unknown path lands on `/automations`; a viewer denied the current view is moved to the first accessible one, and only a viewer with nothing granted sees “Access pending”. Admins land on `/automations`, everyone else on `/session`.
- Legacy `/automations/<slug>` and absorbed slugs redirect once with `replace` to `/session/<canonical>` — no back-button trap. `ViewAsBanner` and an identity `key` on the shell make impersonation visibly read-only.

### 7.2 Workspaces

- `GET /api/session/workspaces` returns the viewer's catalog (server-filtered, ordered). The catalog is `modules/workspaces/catalog.ts` (23 slugs; 21 render, 2 headless providers: `telecalling`, `master-data`); `workspaces/aliases.ts` mirrors the alias table and guard `workspace-catalog` fails on drift.
- Rendering: `workspaces/registry.tsx` maps slug → lazy `dynamic()` component; any slug without an entry falls back to the generic `SheetAnalysisDashboard`, so a new automation with `data()` returning `{meta:{analysis:'sheet'}}` gets a dashboard for free. A new dashboard = one catalog entry + one `dynamic()` line + one `RENDERERS` entry.
- Dashboards are host-agnostic: they fetch through `workspaceDataUrl(slug)` and navigate through `useWorkspaceHost().navigate`, never a prop chain or a hardcoded `/api/automations/...` URL. The same component mounts under `/session` and the `/automations` registry console.
- Scoping is server-owned (`modules/workspaces/scoping.ts` + `resolvers.ts`); routes never branch on `if (slug === …)`. Public data is `telecalling` + `neodove-telecaller-report` only.
- Known gap (documented, unchanged): the generic workspace data route has no per-slug permission check for the remaining providers, so any signed-in user can read another provider's payload. The Samarth/Sahil overviews depend on that today; tightening it needs a server-side overview aggregator first.

### 7.3 Data, live updates and UI primitives

- All HTTP goes through `api/client.ts` and per-domain hooks (`src/<domain>/api.ts`, `hooks/use*`). Components never call `fetch` directly; the `fe.raw_fetch_api` count is ratcheted down, never up.
- Live data: `hooks/useLiveData.ts` exports `useLiveQuery`, `useLiveDashboard`, `useLiveEvent`, `mapRowInLists`, `patchRowInLists` and `useOptimisticMutation` (paint the optimistic row, roll back on error). `loading` renders a skeleton; `refreshing` never blanks an existing list. A `deps` change keeps the old payload until the new one arrives, with a `seq` guard so only the newest response paints.
- Lists use `hooks/usePagedQuery` + `lib/paging` + `components/ui/Pager` + `ChangesBanner`; a live write surfaces as “N new changes”, never a reload under the cursor.
- Shared primitives are mandatory first stops: `components/ui/*` (Modal, ConfirmDialog, Drawer, Popover, SearchSelect, DateRangePicker, Pager), `lib/format.ts` (one money/date formatter home, guard `format-canonical`), `workspaces/*`, `hooks/*`.
- Domain mirrors: `frontend/src/<domain>/{queue,lifecycle,normalize,pricing,filters}.ts` mirror backend predicates and **must** reference the backend path in a `mirror:` comment; each has a guard. Money math mirrors come first.

### 7.4 Build, export and deploy artifacts

- `next.config.ts` uses `output: "export"` in production (`images.unoptimized`), and rewrites to `localhost:5000` only in dev. Production and dev builds MUST use webpack (`next build --webpack`); Turbopack drops nested dynamic chunks and OOMs in dev.
- `scripts/prebuild.mjs` clears `out/`. `scripts/postbuild.mjs` then: removes `out/404.html` (its presence disables the Pages SPA fallback) and fails if it survived, fails if `out/index.html` is missing, fails if any asset `index.html` references is absent, fails if more than one `webpack-*.js` runtime exists, and generates `out/sw.js` with a content-hash `VERSION` (never a timestamp).
- `public/_redirects` ends with `/*    /index.html   200`, so a refresh on any deep link serves the shell while `/api/*` still reaches the Pages Function. Guard `pages-spa`.
- `scripts/deploy.mjs` builds, publishes with `wrangler pages deploy out --project-name founder-os-frontend`, then asserts `/`, `/automations`, `/leave`, `/session/leaderboard`, `/crm` return the shell, `/api/status` returns JSON, and `/404.html` is not Next's page. Never publish `out/` by hand.

### 7.5 Frontend invariants

- A view is reachable only if `canView` allows it **and** the server serves its data; client-side gating is UX, never security.
- New UI reuses `components/ui` and `lib/format`; no forked per-department boards (the Accounts↔Digital-Marketing task boards are the known debt to generalise, not copy).
- Components hold staged state and render; data fetching and mutations live in hooks; no business predicate is re-derived inline when a mirror module exists.

---

## 8. Code Discipline, Guards & Deployment

### 8.1 Layering and file discipline

- **One file, one job, ≤400 lines.** Split before growing. The module shape is `types` · `parse` · `queues` · `scopes` · `redaction` · `update` · `routes` · `store`; `src/modules/enquiries/` is the reference.
- `pure.ts` is synchronous and I/O-free (importable without a DB or network); `io.ts` owns DB/cache/network. Split by extraction + re-export, never by rewrite.
- Route handlers are thin: `readBody` → viewer/scope → module call → store → broadcast. Business logic lives in `src/modules/*` or `src/automations/*` so both runtimes share it.
- `src/routes/` (Express) is **frozen**. New endpoints are Worker-only. Shared modules stay dual-runtime; `scripts/build-worker.mjs` redirects Node-only imports to `*-worker.ts` twins (`config`, `logger`, `prisma`, `sse`, queue service, automation registry, rate-limit store, sheets, scheduler, WhatsApp controller, `crypto`, `fs`, `path`). A shared module that imports `fs`/`crypto` directly breaks the Worker build.
- Mirrors are named, commented (`mirror:` + backend path) and guarded. A mirror without a guard is a future divergence.
- One change = one concern. Docs move with code: an `AGENTS.md` line and the matching `architecture.md` section in the same commit.

### 8.2 Duplication ratchet

`node scripts/dup-audit.mjs .` reports cross-file clone counts. `scripts/guards/rewrite-ratchet.test.mjs` compares them to `scripts/guards/rewrite-baseline.json` and fails on regression. When a change removes duplication, lower the baseline in the same commit and record it in `docs/rewrite-log.md`; the ratchet never goes up.

### 8.3 Guards (one table; names are the test file stems in `scripts/guards/`)

| Guard | Locks |
| --- | --- |
| `accounts-thread` | FY window; one row per task × lane; a missed day stays Not done; 02:30 UTC maintenance. |
| `ai-pool-controls` | Persisted `enabled` filters and health thresholds; auto-disable never auto-recovers. |
| `api-errors` | One JSON `onError` contract; the frontend names the HTTP status when the body is not JSON. |
| `chat-root` | Root is filtered from members/DMs/messages; one shared name index. |
| `crm-cache-shape` | Cached floor rows stay JSON-safe (the `Map` → `{}` incident). |
| `crm-cash` | Cash ledger is floor-only; every verb gated root/admin + `crm` + `dispatch` + `accounts`. |
| `crm-lifecycle` | Dispatch-floor counters/validators, both invoice-gate states. |
| `customer-district` | District column, state-aware filters, drill path. |
| `d1-parity` | The D1 shim registries cover every Prisma model (the `Core*` allowlist is the documented gap). |
| `debtors-as-of` | Point-in-time rebuild maths; historical is read-only. |
| `debtors-import-batch` | Bulk `db.batch()` writes, idempotent upserts, resumable cursor. |
| `debtors-invoice-sort` | Trailing-segment numeric compare; stacking appends; finite result. |
| `debtors-top-picks` | Temporary manual pin contract. |
| `employee-display-name` | `Character Name (Legal Name)` on every surface, one rule. |
| `enquiry-agent-resolve` | Lead chips resolve through the roster view and the HR second pass. |
| `enquiry-known-rates` | Privileged known-rates picker and `product-rates` payload shape. |
| `enquiry-loop-ask-kinds` | Which desk may raise which ask kind. |
| `enquiry-media-removal` | Removal markers survive write scrubbing. |
| `enquiry-procurement-ownership` | Pending predicate until “Enquiry Concluded”; late-quote reopen; anonymous sales brief. |
| `enquiry-query-bypass` | A bypassed item never holds a loop open. |
| `enquiry-rates-union` | Decided-means-done normalisation. |
| `enquiry-region-writeback` | Attribution writes back only on manual override or exact match. |
| `enquiry-sent-revision` | Appending work to a sent/concluded row reopens it. |
| `enquiry-sources` | Source list parity; a marketing lead needs a channel. |
| `enquiry-threads` | Desk/channel/category visibility, inbox lenses, attachment rules. |
| `estimates-movement` | Range normalisation, `R1–R4`-only buckets, aggregation windows. |
| `format-canonical` | One money/date formatter home; legacy copies stay byte-equal. |
| `gateway-js-parity` | `scripts/ai-gateway.js` keeps the shared pool semantics. |
| `gateway-pool` | Pool parsing, strategy rotation, sticky pin, 429/401 handling. |
| `hiring-kit` | Three document kinds + one cleaned video URL. |
| `integrations` | Connector catalog, hashed tokens, optional HMAC, mapping-as-data, dedupe. |
| `kyp-schema` | Generated catalog pair, JSON invariants, spec validator, preview/confirm/batch titles. |
| `ledger-collapse-parity` | `TelecallerScoreEvent` became `core_credit`; no second table, no flip flag. |
| `list-paging` | 50/page standard, server totals, the documented unpaged exceptions. |
| `live-transport` | The Pages Function returns a `101` upgrade verbatim. |
| `management-access` | Management Review scope gate. |
| `master-data-core-parity` | `MasterCustomer` became `core_customer`; single-table reads + tombstone writes. |
| `no-mis-role` | MIS stays retired; ex-MIS endpoints are root-only. |
| `notifications` | Rule contract, dedupe key, levels, core-only delivery. |
| `notifications-dashboard` | Console shape, gates and selector rules. |
| `org-access` | `canManagePerson` rules and the implied-scope bundle parity. |
| `org-chart-edit` | Top/head rules, cycle and seat checks, position standards. |
| `org-chart-parity` | The D1 chart seed equals `organization.json`. |
| `org-sales-head-anchor` | The sales-head anchor seat stays where the chart says. |
| `pages-spa` | No `out/404.html`, one webpack runtime, every referenced asset present, `_redirects` intact. |
| `position-workspace` | `/workspace` + `/session` person previews stay root/dev-only; staff sheets unchanged. |
| `queue-mirror` | Backend ↔ frontend queue predicates agree on a shared fixture corpus. |
| `rewrite-ratchet` | Duplication never exceeds the baseline. |
| `sales-board-cache` | Board cache key, revisions, drill isolation. |
| `sales-range` | Custom range validation and the resolved-period cache token. |
| `sales-redaction` | Sales never receives vendor or margin fields. |
| `sales-staff-single-master` | The HR employee row is the sales profile; `Telecaller` is a view. |
| `view-as` | Root-only, never root→root/self, read-only, single overlay point, audit row. |
| `view-wiring` | Every `NAV_ITEMS` view has a mounted branch with a default export. |
| `workspace-catalog` | Catalog, aliases and derived slugs match the frontend mirror. |
| `workspace-scoping` | Per-workspace scoping lives in `scoping.ts`, never in a route. |

### 8.4 Verification

| Check | Command |
| --- | --- |
| Guards (CI) | `node --test "scripts/guards/*.test.mjs"` |
| Core lock | `node founder-os_backend/scripts/core-guard.mjs` |
| Worker build | `cd founder-os_backend && node scripts/build-worker.mjs` |
| Smoke (no DB/AI) | `cd founder-os_backend && node scripts/smoke-worker.mjs` |
| Backend types | `cd founder-os_backend && npx tsc --noEmit` — gate is **no new** errors |
| Frontend types | `cd founder-os_frontend && npx tsc --noEmit` |
| Frontend build | `cd founder-os_frontend && next build --webpack` |
| Duplication | `node scripts/dup-audit.mjs .` |
| Data parity | `scripts/workspace-parity.mjs`, `scripts/route-parity.mjs`, `scripts/session-e2e.mjs` |
| Browser | `scripts/e2e/` |

Guard CI (`.github/workflows/guards.yml`) also runs the Worker build on every push/PR, so a Node-only import in a shared module fails before deploy.

### 8.5 Deploy (standing policy: deploy immediately, backend first)

1. Run the checks above; the pre-commit hook runs `core-guard.mjs` and is never bypassed (`--no-verify` is forbidden).
2. Backend: `cd founder-os_backend && node scripts/build-worker.mjs && node scripts/smoke-worker.mjs && npx wrangler deploy`.
3. Frontend, only after the backend is serving: `cd founder-os_frontend && node scripts/deploy.mjs` (build → publish → deep-link assertions).
4. Live check: `curl -s https://<worker>/health` and `/api/status`; open the affected view and confirm the write took.
5. Never `source ../.env`; read only the variables a command needs (`grep`/`cut`), because the file's shell content is not safe to execute.

Migration order matters: apply the SQL before deploying code that reads the new column, and never edit an applied migration — add the next number (the commit relies on the numbering, the lock and the review trail).

### 8.6 Reporting a change

Every task ends with: `Reused · Added (why) · Removed · Moved to shared · Verified by · Deployed · Follow-ups`. Removed items must be gone from `rg`; a follow-up that needs a founder decision (money, access, data deletion) is stated, not silently taken.

Core changes take the slow path: propose in `docs/core-change-requests/<date>-<topic>.md`, get human review, then `node scripts/core-guard.mjs --sign` **by a human** (the signature records `signedBy`, `signedAt` and the file hashes).

---

## 9. Unified integration gateway & ingestion (mig 0183)

Before this, every outside service had its own door and its own credential story (`sent_estimates.txt` + a coupled Zoho analyzer, a per-portal script, a WABA client reading env). §9 replaces that with **two** primitives: one outbound facade, one inbound staging table. Migration `0183_integrations_and_ingestion.sql` creates `hlp_integration_instance` and `hlp_ingested_data`; the hub from mig 0180 (§5) keeps its own nouns (`IntegrationConnector`/`IntegrationSource`/`IntegrationEvent`) and is **not** replaced — the new console is `/settings`, the old hub console stays `/integrations`.

### 9.1 Outbound: `call(provider, { instanceKey })`

```ts
const zoho = await call('zoho', { instanceKey: 'dpg' });   // named account
const wa   = await call('whatsapp');                         // the default account
const ai   = await call('openai');                           // thin adapter over §4.1
```

- **Address** = `(provider, instanceKey)`; `hlp_integration_instance` is UNIQUE on that pair and holds `isDefault`, `enabled`, `deliveryMode`, `baseUrl`, `configJson` and `encryptedSecrets` (AES-256-GCM, `VAULT_KEY`, falls back to `SHARED_SECRET` with one warning). Secret values are never returned by any route — the console sees only `secretKeys`.
- **Providers are data**: `modules/integrations/manifest.json` (v2.0.0) is the ONLY provider list — 19 providers with `category`, `direction`, `configFields`/`secretFields` (`type`, `required`, `requiredWhen`, `options`, `defaultValue`), `outbound.operations` and `inbound` (`methods`, `challengeGet`, `verification`, `idempotencyKey`, `fieldMap`, `poll`, `liveEvent`, `quietHoursIst`). `manifest.ts` imports the JSON and hydrates it (flat legacy `fields`, `supportsWebhook`, `webhookPath`, `defaultDeliveryMode`); adding a provider = JSON entry + adapter registration, never an edit to a list. `openai` is a facade over §4.1 (`instanceRequired: false`, falls back to the global pool).
- **Resolution** = manifest → cached row (`int:inst:<provider>:<key>:<rev>`, 300 s, `cacheRevs(['integrations'])`) → decrypt → `adapter.connect(instance)`. Missing/disabled instance throws `IntegrationError` (409); unknown provider 400.
- **Auth per provider**: Zoho OAuth2 (cached `Token` `source = zoho:<instanceKey>`, refresh on expiry/401) OR `authMode: raw_headers_bridge` (parses `secrets.rawCurlHeaders` — JSON, `-H 'k: v'` lines or `k: v` — and sends them verbatim); Gmail OAuth2 cached `gmail:<instanceKey>`; WhatsApp wraps the WABA client with `config.phoneNumberId`/`secrets.accessToken`; OpenAI rotates `secrets.apiKeys` (comma/newline separated) against `config.baseUrl`/`config.model` with `embed()`; Google Maps uses `X-Goog-Api-Key` + per-call `X-Goog-FieldMask` (`places:searchText`, Routes `directions/v2:computeRoutes`); Google Search uses `key`+`cx` with optional `config.baseUrlOverride`; `custom` + portals support `bearer|custom_header|basic|query_param|none`. Runners never see client secrets — `GET /api/runner/integrations/resolve?provider=zoho` returns a fresh token.
- **Webhook URL** comes from `resolveWebhookUrl(origin, provider, instanceKey)` (manifest path + default key); the console prints it.

### 9.2 Inbound: one door, one staging table

| Provider | Path |
| --- | --- |
| any `inbound.supported` provider (Zoho, WhatsApp, Tally, Gmail, portals, Meta/LinkedIn/Telegram, Google Forms, NeoDove, custom) | `POST /api/webhooks/<source>[/<instanceKey>]` |
| providers with `inbound.challengeGet` (Meta handshake) | `GET /api/webhooks/<source>?hub.mode=subscribe…` (echoes `hub.challenge` when `hub.verify_token` matches `config.verifyToken`/`secrets.webhookVerifyToken`) |
| GET-only portals with `normalizeQueryToBodyOnGet` | the query string is normalized to a JSON body before verification |

Order is fixed and guarded: manifest lookup (404 when the provider is not an inbound provider) → resolve instance (409/404 if absent) → `verifyInbound(provider, …)` over the **RAW body** (401; `hmac` = `x-hub-signature-256`/`tally-signature`/`x-ingest-signature`, bare hex/base64/sha1 accepted; `field_match` = e.g. Justdial `parentid`; `optional_header_token` = Zoho/Gmail push tokens; `none`) → `INSERT OR IGNORE` into `hlp_ingested_data` → 202.

- `deliveryMode` is the **instance's** choice. `realtime` processes in `executionCtx.waitUntil` and broadcasts `enquiries` + `integrations`; `batch` leaves the row `pending` for the 5-minute runner. Both answer `202` in milliseconds, so a slow mapper can never make a provider retry a row already stored.
- Dedupe is the partial UNIQUE `(source, externalEventId) WHERE externalEventId IS NOT NULL`; `extractIdempotencyKey` reads the manifest (`path` e.g. WhatsApp `messages.0.id`, `composite` e.g. Zoho `estimate_id`+`last_modified_time`, `config_path`, with optional prefixes). A duplicate answers `duplicate: true` and is **not** reprocessed. `eventType`/`liveEvent` also come from the manifest.
- `status` lifecycle: `pending → processing → processed | pending(retry) → dead_letter` after 3 attempts. A `processing` row older than 15 minutes is reclaimable (a Worker that died mid-flight). `replay` on the console resets a row and re-runs it immediately.
- Raw body is capped at 256 KB (413), stored verbatim in `rawPayload`; `Authorization`/`Cookie` headers are stripped from `headersJson`.

### 9.3 Processing (the only writer)

`modules/ingestion/processor.ts` maps + routes a staged row; `mappers/` is pure. `mapperFor(source)` picks the specialized mapper (`whatsapp`, `zoho-estimate`, `tally`, `gmail`) and otherwise falls back to `genericMapper(provider)` — a manifest-driven lead/message mapper (flat / `data.*` / `fields[{label,value}]` / Meta `entry[].changes[]` shapes, `fieldMap` first then fuzzy aliases). Every `inbound.supported` provider therefore has a mapper by construction.

| Canonical | Destination | Rule |
| --- | --- | --- |
| `lead` (portals, forms, Gmail, social lead ads, Tally, custom) | `Enquiry` via `enquiryCreate` | Server-side intake, never a core write. Dedupes by `contactPhone` (normalized `+91…` or bare 10 digits) → links the existing enquiry instead of duplicating. `source='B2B'`, `sourceLead='<provider>[:key]'`. |
| `message` (WhatsApp, Messenger/Instagram DM, Telegram) | `Message` | `wahaMessageId = 'wa:<wamid>'` (or the channel's event id) is UNIQUE, so a provider retry is a duplicate success, not a dead letter. |
| `estimate` (Zoho/Tally) | link only | Normalized into `normalizedJson`, `coreRefId = estimateNumber || externalId`. The `Estimate` row itself stays owned by `scripts/zoho-sync/persist.js` — one writer for org/status rules (core lock intact). |
| status callbacks / pings | none | `processed` with no `coreRefId`; never routed to a domain table. |

### 9.4 Runners & schedules

- `scripts/ingestion-batch-runner.js` (job `ingestion-batch`, 5-min workflow, serial group): `POST /api/runner/ingestion/claim {mode:'batch'}` → rows, then `POST /api/runner/ingestion/ack {results:[{id}]}`. The **ack** runs `processIngestedRow` server-side, so the mapper never leaves the Worker. A runner that dies leaves `processing` rows that the 15-minute stale rule reclaims.
- `scripts/portal-poller-runner.js` (job `portal-poller`, 15-min workflow): the provider list is `manifest.providers` where `inbound.poll.supported`; an instance with `config.pollUrl`/`config.pullUrl` is fetched and each item replayed through the HMAC-signed webhook door (`X-Ingest-Signature`), so dedupe/mapping stay in one place. Push-only providers are skipped. `claimBatch` skips providers whose `inbound.quietHoursIst` window (IST) is active.
- `scripts/zoho-sync/credentials.js` resolves the Zoho session from the gateway (`/api/runner/integrations/resolve`); `fetch.js` uses it for headers/orgs/API base and only falls back to `zoho_sent/sent_estimates.txt` when the Worker has no Zoho instance or is unreachable. The file is now the emergency path, not the source of truth.

### 9.5 Console (root-only)

`Settings → Third-party providers` (`components/settings/integrations/`): providers grouped by manifest `category`, dynamic field inputs (`text|textarea|number|boolean|select|json`, `requiredWhen` visibility, `defaultValue`), Test/Delete, webhook path, delivery mode, default flag, plus the ingested log (filters, pager, Replay) with an **inspector Drawer** showing raw vs normalized JSON + headers. The FE mirrors `manifest.ts#validateInstancePayload` client-side; the server re-validates `required`+`requiredWhen` on every save.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/integrations/manifest` | provider manifests (fields, secret names, webhook path) |
| `GET/POST /api/integrations/instances` · `PATCH/DELETE /api/integrations/instances/:id` | list/upsert/delete (secrets merged; `''` clears a stored key) |
| `POST /api/integrations/instances/:id/test` | adapter health probe |
| `GET /api/integrations/ingested[/stats]` · `GET /api/integrations/ingested/:id` | paged staging log + counts + one raw/normalized row |
| `POST /api/integrations/ingested/:id/replay` | re-stage + reprocess |
| `GET /api/runner/integrations/resolve` · `POST /api/runner/ingestion/claim` · `POST /api/runner/ingestion/ack` | runner surface (`requireSecret`) |

All console paths are root-gated (`adminGuard`); `/api/webhooks/` is in `AUTH_EXEMPT` (the HMAC is the credential) and in `LIVE_NO_AUTO` (the door broadcasts typed events, never a generic `data-changed`).

**Ops.** Apply before deploying: `wrangler d1 execute waba-worker --remote --file migrations/0183_integrations_and_ingestion.sql`. Rotating `VAULT_KEY` makes existing ciphertext undecryptable — re-enter the instance secrets afterwards.

Guard: `scripts/guards/integrations-ingestion.test.mjs` (tables/indexes, shim registration, manifest v2 schema + adapter/mapper parity, verify-before-stage, processor never writes `core_*`, quiet hours, runner/workflow wiring, console mount).

**Manifest provenance.** The replacement implementation's original v2.0.0 payload was not in version control (the file was deleted before the first commit and `prompt.md` carried a paste placeholder). The checked-in `manifest.json` is a reconstruction from the written spec; the loader validates generically, so swapping in the founder's canonical JSON needs no code change — run the guard afterwards.

---

_Historical context, retired behaviour and the reasoning behind past decisions live in `docs/rewrite-log.md`. Rules and dated founder decisions live in `AGENTS.md`._
