# Founder OS — Architecture Document

## 1. System Overview

Founder OS is a modular executive assistant platform for Brindavan Udyog (India), a B2B industrial manufacturing company. It comprises a **Cloudflare Worker backend** (D1 SQLite) with a **Next.js static frontend** on Cloudflare Pages, a **WhatsApp automation layer**, and supporting AI proxy tooling.

### Key Principles
- **Separation of concerns**: Routes, services, storage, and middleware are decoupled.
- **Instant API, heavy AI on CI**: The Cloudflare Worker serves only fast D1 reads/writes; all heavy AI and cron processing runs as file-based Node scripts inside GitHub Actions.
- **Strategy pattern for storage**: Storage operations delegate to interchangeable providers (Prisma/D1 or in-memory).
- **Pluggable engines**: Domain modules (WhatsApp, Email, Sales, Brain) implement the `AnalysisEngine` interface.
- **Graceful degradation**: Falls back to in-memory mock data when the database is unavailable.

### Repository Structure
```
/ai_pa
├── architecture.md
├── docker-compose.yml
├── founder-os_backend/          # Cloudflare Worker (Hono + D1) — built from src/worker.ts
├── founder-os_frontend/         # Next.js 16 static dashboard (Cloudflare Pages)
├── scripts/                     # GH Actions file-based runners (heavy AI runs HERE)
│   ├── runner-lib.js            # Shared helpers (workerRequest, omniroute, extractJson)
│   ├── whatsapp-digest-runner.js
│   ├── morning-brief-runner.js
│   ├── eod-summary-runner.js
│   ├── zoho-sent-runner.js      # Zoho sync + LLM classification + comments
│   └── email-brain-index-runner.js
├── whatsapp_receiver/           # WhatsApp bot + React PA dashboard
├── prospect_research/           # ProspectAI Pro lead enrichment
├── zoho_sent/                   # Zoho Books cURL credentials (sent_estimates.txt)
├── random_dump/                 # Design docs, n8n workflows
├── litellm-config.yaml          # LiteLLM proxy config
├── ttft_fallback.py             # TTFT-based LLM fallback
├── ttft_proxy.py                # FastAPI TTFT proxy
├── test_ttft_fallback.py        # TTFT test suite
├── Dockerfile                   # Multi-stage Docker build
├── deploy.sh                    # Docker deployment script
└── start.sh                     # Local dev startup
```

---

## 2. Backend Architecture

### 2.1 Tech Stack
| Component | Technology |
|-----------|-----------|
| Runtime | Cloudflare Workers (V8 isolates, global edge) |
| Framework | Hono |
| ORM | Prisma-style D1 adapter (`shared/prisma-d1.ts`) |
| Database | Cloudflare D1 (SQLite, single-region for consistency) |
| LLM | Omniroute (OpenAI-compatible) — called from GH Actions runners, not the Worker |
| Embeddings | HuggingFace Router API (384-dim), stored as JSON in D1 |
| Validation | Zod 4 |
| Logging | Pino (`pino/worker`) |
| Scheduler | GitHub Actions cron (5/15/30 min + daily IST) |
| Package Manager | pnpm 10 |
| Deploy | `wrangler deploy` (wrangler.toml + secrets) |

### 2.2 The Shift: Monolith → Worker + GH Actions

All heavy AI work and cron jobs were moved **off the request path** onto GitHub Actions runners, which run standalone Node scripts (`scripts/*-runner.js`) that call the Worker only for instant D1 reads/writes:

```
GitHub Actions (cron)                    Cloudflare Worker (public API)
─────────────────────                    ─────────────────────────────
node scripts/whatsapp-digest-runner ─┐   GET  /api/runner/messages/unprocessed
node scripts/zoho-sent-runner ───────┼→  GET  /api/runner/zoho/state
node scripts/morning-brief-runner ───┤   POST /api/runner/zoho/classification
node scripts/eod-summary-runner ─────┤   POST /api/runner/zoho/comments
node scripts/email-brain-index ──────┘   POST /api/runner/brain/context
    │                                       │
    │  LLM calls (Omniroute)                │  D1 SQLite
    ▼                                       ▼
  omniRoute API                          Cloudflare D1
```

- **Worker** = thin JSON API over D1. Every heavy route was removed: `/api/trigger/digest`, `email-sync`, `briefing`, `summary`, `brain-index`, `sales-sync`, and the heavy automations (whatsapp-digest, email-brain-index, morning-brief, eod-summary, zoho-sent-analyzer) were dropped from the worker automation registry so `/api/trigger/:slug` 404s them.
- **Runners** = the source of truth for processing. They own change detection, watermarks (`sales_copilot:last_complete_sync_at`), comment extraction, deterministic + LLM classification, and brain indexing.
- Secrets for the runner live in GitHub Actions (`WORKER_URL`, `SHARED_SECRET`, `OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY`, `OMNIROUTE_MODEL`). Zoho credentials are inferred at runtime from `zoho_sent/sent_estimates.txt` (cURL export) — no separate Zoho secrets are stored.

### 2.2b Directory Structure
```
founder-os_backend/
├── prisma/
│   └── schema.prisma              # Database schema (9 models) — D1-compatible DDL
├── src/
│   ├── worker.ts                  # Entry point — Hono Worker: routes, auth, D1 writes
│   ├── config-worker.ts           # Zod env validation for the Worker
│   ├── modules/
│   │   ├── automation/
│   │   │   ├── engine.ts          # AutomationEngine — /api/trigger/:slug dispatch
│   │   │   └── registry-worker.ts # Worker-side automation registry (light automations only)
│   │   ├── brain/
│   │   │   └── service.ts         # Company Brain RAG (query reads via Worker /api/brain/*)
│   │   └── ...
│   ├── shared/
│   │   ├── prisma-d1.ts           # Prisma-client-compatible adapter over D1
│   │   ├── sse-worker.ts          # SSE for /api/whatsapp/events
│   │   └── ...
│   └── automations/               # Light automations kept on the Worker (curl-triggered)
│       ├── wa-engine-monitor.ts
│       ├── sla-monitor.ts
│       ├── notification-batcher.ts
│       ├── data-retention.ts
│       ├── morning-queue-drain.ts
│       ├── orphaned-message-recovery.ts
│       ├── outbound-intent-recovery.ts
│       ├── whatsapp-marketing.ts
│       ├── telecalling-agent-analysis.ts
│       ├── telecalling-enquiry-to-dpp.ts
│       ├── dpp-prices-dashboard.ts
│       └── enterprise-operations-analytics.ts
├── scripts/
│   ├── build-worker.mjs           # esbuild bundle → dist-worker/worker.js
│   ├── smoke-worker.mjs           # Local smoke tests against the bundle
│   └── (backend runner helpers not needed — runners live at repo /scripts)
├── wrangler.toml                  # Worker name, D1 binding, routes
└── dist-worker/                   # Build output (esbuild bundle)
```

### 2.3 API Endpoints

#### System & Data
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/status | DB & LLM connection diagnostics |
| GET | /api/brief/latest | Latest morning brief / EOD summary |
| GET | /api/digests | WhatsApp conversation digests (read-only — no lazy AI trigger) |
| GET | /api/tasks | Extracted action items |
| GET | /api/messages/:chatId | Raw WhatsApp messages for a chat |
| GET | /api/sheet-data | Google Sheet data |
| GET | /api/estimates | Zoho estimates with classifications & comments |
| GET | /api/estimates/baseline | Today's frozen baseline snapshot (shared by all viewers) |
| POST | /api/runner/estimates/baseline | Freeze today's baseline (auth; called by daily GH job) |

#### Runner API (D1 reads/writes consumed by GH Actions scripts — all Bearer SHARED_SECRET)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/runner/messages/unprocessed | Unprocessed WhatsApp messages for digest runner |
| GET | /api/runner/digests/latest | Latest digest per chat |
| GET | /api/runner/chat-notes | Chat notes for briefing context |
| POST | /api/runner/digests | Persist generated digests |
| POST | /api/runner/tasks | Persist extracted action items |
| POST | /api/runner/pending-items | Persist founder pending items |
| POST | /api/runner/messages/mark-processed | Mark messages processed |
| GET | /api/runner/brief-data | Brief context data (aggregate reads) |
| POST | /api/runner/founder-notes | Save founder note |
| GET | /api/runner/zoho/state | Estimates + max comment id + watermark |
| POST | /api/runner/zoho/comments | Upsert Zoho comments |
| POST | /api/runner/zoho/status | Sync closed estimate statuses |
| POST | /api/runner/zoho/classification | Upsert AI classification (flags via toYN()) |
| POST | /api/runner/emails | Upsert synced emails |
| GET | /api/runner/brain/sources | Brain source list |
| POST | /api/runner/brain/context | Upsert brain context rows |

#### Company Brain
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/brain/query | RAG query across all indexed data |
| POST | /api/ask-founder-ai | Backward-compatible alias for /api/brain/query |
| GET | /api/brain/stats | Brain indexing statistics |

#### Manual Triggers
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/trigger/digest | Process unread WhatsApp messages |
| POST | /api/trigger/email-sync | Sync unread emails |
| POST | /api/trigger/briefing | Generate morning briefing |
| POST | /api/trigger/summary | Generate EOD summary |
| POST | /api/trigger/sales-sync | Sales Copilot analysis (backward-compatible alias) |
| POST | /api/trigger/brain-index | Re-index all data into Company Brain |

#### WhatsApp
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/whatsapp/webhook | Webhook receiver from WhatsApp bot |
| GET | /api/whatsapp/events | SSE stream for real-time UI updates |
| GET | /api/whatsapp/contacts | WA Engine contacts list |
| GET | /api/whatsapp/campaigns | Campaign list |
| POST | /api/whatsapp/campaigns/create | Create campaign |
| GET | /api/whatsapp/groups | Contact groups |
| POST | /api/whatsapp/groups/create | Create group |
| GET | /api/whatsapp/templates | Approved message templates |
| POST | /api/whatsapp/send | Send text message |
| GET | /api/whatsapp/contacts/:uid/messages | Merged local + cloud message history |
| POST | /api/whatsapp/contacts/:uid/summarize | On-demand AI digest |

### 2.4 Worker Middleware Stack

```
Request
  -> CORS (hono/cors)
  -> Boot middleware (load automations, init D1 adapter)
  -> requireSecret guard on /api/runner/* and /api/trigger/* (Bearer SHARED_SECRET)
  -> Route Handler
    -> D1 read/write via prisma-d1 adapter
```

- **requireSecret**: Any runner/trigger endpoint without a valid `Authorization: Bearer <SHARED_SECRET>` returns 401. Public GETs (`/api/estimates`, `/api/brief/latest`, etc.) are open for the static frontend.

### 2.5 Execution Model (replaces the old scheduler/Express service layer)

There is no in-process cron anymore. Every recurring job is a GitHub Actions workflow that runs a standalone Node script:

| Workflow | Cadence | Jobs |
|----------|---------|------|
| `cron-every-5min.yml` | every 5 min | whatsapp-digest (runner), light-triggers (curls) |
| `cron-every-15min.yml` | every 15 min | zoho-sent-analyzer (runner) |
| `cron-every-30min.yml` | every 30 min | email-brain-index (runner), light-triggers (curls) |
| `cron-daily-ist.yml` | daily IST | data-retention (curl), morning-brief (runner), eod-summary (runner), baseline-freeze (curl) |

- Heavy jobs (`node scripts/*-runner.js`) pass `WORKER_URL`, `SHARED_SECRET`, `OMNIROUTE_*` via workflow env and call the Worker's `/api/runner/*` endpoints to read/write D1.
- Light automations (monitors, drainers, batchers, dashboards) run as `curl /api/trigger/:slug` and stay on the Worker.
- The 15-min workflow accepts a `force` dispatch input that reclassifies all active estimates with the current `OMNIROUTE_MODEL`.

### 2.6 Storage

D1 is a single SQLite database (`founder-os`) bound to the Worker as `DB`. The `prisma-d1.ts` adapter exposes a Prisma-client-compatible API over D1's `prepare/run/first/all` so existing data-access code ports with minimal change.

```
Worker handler (Hono)
  -> prisma-d1 adapter (D1 binding `DB`)
       -> D1 SQLite (single region, strong consistency)
```

- **Baseline freeze**: the daily `baseline-freeze` job snapshots `status = 'sent'` estimates into a Setting row keyed `zoho_baseline:YYYY-MM-DD` (IST date via `kolkataDateStr()`). The frontend reads it through `GET /api/estimates/baseline` so all viewers share one frozen snapshot instead of per-browser localStorage.
- Runner state (`sales_copilot:last_complete_sync_at` watermarks, classification rows, comments) is also stored in D1.

---

## 3. Frontend Architecture

### 3.1 Tech Stack
| Component | Technology |
|-----------|-----------|
| Framework | Next.js 16 (App Router, Static Export) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 (PostCSS) |
| Charts | Chart.js 4 |
| Fonts | Geist (GeistSans + GeistMono) |
| State | React hooks (useState, useEffect, useMemo, useCallback) |
| Persistence | D1 via Worker `/api/*` (shared baseline etc.); LocalStorage for UI prefs |
| Package Manager | npm |
| Hosting | Cloudflare Pages (static export; `functions/` excluded from typecheck) |

### 3.2 Directory Structure
```
founder-os_frontend/
├── public/                          # Static assets (images, icons)
├── src/
│   ├── app/
│   │   ├── globals.css              # Tailwind v4 + CSS custom properties (dark/light)
│   │   ├── layout.tsx               # Root layout (Geist fonts, metadata)
│   │   └── page.tsx                 # Main application shell (refactored — uses hooks + layout components)
│   ├── api/
│   │   └── client.ts                # Centralized fetch wrapper with error handling
│   ├── hooks/
│   │   ├── useEnquiryData.ts        # Enquiry/comment/agent state management + LocalStorage
│   │   ├── useTheme.ts              # Dark/light theme toggle with LocalStorage persistence
│   │   ├── useToast.ts              # Toast notification queue
│   │   ├── useCSV.ts                # CSV export/import logic
│   │   └── useLocalStorage.ts       # Generic LocalStorage hook
│   ├── types/
│   │   └── index.ts                 # All TypeScript interfaces + initial mock data
│   ├── mockData.ts                  # Backward-compatible re-exports from types/
│   ├── mockDataSheets.ts            # Mock Google Sheets datasets
│   └── components/
│       ├── ErrorBoundary.tsx        # React error boundary wrapper
│       ├── layout/
│       │   ├── Sidebar.tsx          # Desktop sidebar navigation
│       │   └── MobileNav.tsx        # Mobile bottom navigation bar
│       ├── Dashboard.tsx            # Main dashboard with KPI cards + charts
│       ├── EnquiryList.tsx          # Filterable enquiry table
│       ├── EnquiryDetail.tsx        # Per-enquiry deep-dive (comments, timeline, specs)
│       ├── EnquiryModal.tsx         # Add/Edit enquiry form
│       ├── EnquiryRowItem.tsx       # Single enquiry row card
│       ├── ClientProfile.tsx        # Client snapshot panel
│       ├── CommentNode.tsx          # Recursive thread-style comment renderer
│       ├── FilterControls.tsx       # Filter chip bar
│       ├── CalendarRibbon.tsx       # Weekly calendar strip
│       ├── ActivityTimeline.tsx     # Chronological activity feed
│       ├── KpiCard.tsx              # Metric card widget
│       ├── PipelineFunnel.tsx       # Sales pipeline funnel chart
│       ├── TrendChart.tsx           # Chart.js wrapper
│       ├── SpecificationsSection.tsx
│       ├── Lightbox.tsx             # Image lightbox overlay
│       ├── ToastContainer.tsx       # Toast notification display
│       ├── FounderAssistant.tsx     # AI chat interface
│       ├── ZohoEstimates.tsx        # Zoho estimates review queue
│       ├── GoogleSheetsDashboard.tsx
│       ├── CrmTrackerDashboard.tsx
│       ├── PipelineDashboard.tsx
│       ├── TelecallerDashboard.tsx
│       └── WhatsAppDashboard.tsx    # WhatsApp automation hub
```

### 3.3 Component Hierarchy
```
<Layout> (app/layout.tsx)
  <Home> (app/page.tsx)
    <Sidebar> | <MobileNav>      # Navigation
    <main>
      <ErrorBoundary>
        {view === "dashboard" && <Dashboard>}
        {view === "enquiries" && <EnquiryList>}
        {view === "detail" && <EnquiryDetail>}
        {view === "briefing" && <FounderAssistant>}
        {view === "zoho" && <ZohoEstimates>}
        {view === "sheets" && <GoogleSheetsDashboard>}
        {view === "whatsapp" && <WhatsAppDashboard>}
      </ErrorBoundary>
    </main>
    <EnquiryModal>               # Overlay
    <Lightbox>                   # Overlay
    <ToastContainer>
```

### 3.4 State Management

State is decentralized into custom hooks:

| Hook | Manages | Persistence |
|------|---------|-------------|
| `useEnquiryData` | Enquiries, comments, agents, CRUD operations, currentAgent | LocalStorage |
| `useTheme` | Theme (dark/light) | LocalStorage |
| `useToast` | Toast notification queue | In-memory (ephemeral) |
| `useCSV` | CSV export/import logic | None (pure functions) |

The `page.tsx` shell owns only view-routing state (`activeView`, `selectedEnquiryId`, modal visibility). All data CRUD is delegated to hooks.

### 3.5 Data Flow
```
User Action
  -> page.tsx handler (calls hook method or updates view state)
    -> Hook updates state + persists to LocalStorage
    -> React re-renders affected components via prop changes
```

Views like `ZohoEstimates`, `FounderAssistant`, and `WhatsAppDashboard` manage their own state internally and call the Cloudflare Worker API directly via `fetch()` (the frontend is served on Cloudflare Pages and hits the Worker origin with CORS enabled).

### 3.6 Styling Patterns
- **Tailwind CSS v4** with `@theme` tokens: `brand-indigo`, `brand-emerald`, `brand-amber`, `brand-rose`
- **CSS custom properties** for dark/light mode: `--bg-primary`, `--text-primary`, `--bg-card`, `--border-card`, etc.
- **Dark mode**: Toggled by adding/removing `.dark` class on `<html>`
- **Animation utilities**: `animate-fade-in`, `animate-scale-up`
- **Glassmorphism**: Dark theme uses semi-transparent backgrounds with backdrop blur

### 3.7 API Client
```typescript
// src/api/client.ts
const API_BASE = '/api';
```

`/api` is rewritten to the Worker origin in production via Pages `_redirects`/rewrites (same-origin path keeps the client code simple). Public worker endpoints are unauthenticated; runner endpoints (`/api/runner/*`) require the shared secret and are never called from the browser.

---

## 4. Data Models

### 4.1 Database Schema (D1 SQLite — 9 models)

```
Message
  id          String @id @default(uuid())
  chatId      String
  sender      String
  body        String
  timestamp   DateTime
  processed   Boolean @default(false)
  createdAt   DateTime @default(now())
  @@index([chatId, processed])

Email
  id          String @id @default(uuid())
  subject     String
  sender      String
  body        String
  processed   Boolean @default(false)
  createdAt   DateTime @default(now())
  @@index([processed])

Digest
  id              String @id @default(uuid())
  chatId          String
  chatName        String
  summary         String
  priority        Priority
  category        String
  sentiment       String
  requiresFounder Boolean @default(false)
  suggestedReply  String?
  createdAt       DateTime @default(now())

Task
  id          String @id @default(uuid())
  title       String
  owner       String
  status      TaskStatus @default(PENDING)
  deadline    DateTime?
  source      String
  sourceId    String?
  createdAt   DateTime @default(now())

FounderNote
  id          String @id @default(uuid())
  content     String
  createdAt   DateTime @default(now())

Estimate
  estimateId      String @id
  estimateNumber  String
  customerName    String
  total           Float
  date            DateTime?
  status          String
  lastSyncTime    DateTime?
  skipMatching    Boolean @default(false)
  classification  Classification?
  comments        Comment[]

Comment
  commentId       String @id
  estimateId      String
  description     String
  commentedBy     String
  date            DateTime?
  dateDescription String?
  dateFormatted   String?
  estimate        Estimate @relation(fields: [estimateId], references: [estimateId], onDelete: Cascade)

Classification
  estimateId              String @id
  meaningfulUpdate        Boolean?
  followUpMissing         Boolean?
  notAnswering            Boolean?
  improperFollowUp        Boolean?
  lastCommentNotSatisfactory Boolean?
  dayExceeded             Boolean?
  movingSlow              Boolean?
  underDiscussion         Boolean?
  confirm                 Boolean?
  intentScore             Int?
  reasoning               String?
  summary                 String?
  processedAt             DateTime?
  estimate                Estimate @relation(fields: [estimateId], references: [estimateId], onDelete: Cascade)

BrainContext
  id          String @id @default(uuid())
  source      String     // WHATSAPP | EMAIL | DIGEST | ESTIMATE | TASK | COMMENT
  sourceId    String
  entityName  String
  content     String
  metadata    String?    // JSON string
  embedding   String?      // JSON array of 384 floats (no pgvector on D1)
  indexedAt   DateTime @default(now())
  eventDate   DateTime?
  @@unique([source, sourceId])
  @@index([source, entityName, eventDate])
```

### 4.2 Enums
```
Priority: low | medium | high | urgent
TaskStatus: PENDING | IN_PROGRESS | COMPLETED | CANCELLED
```

### 4.3 Frontend Types (TypeScript)
```typescript
Agent { id, name, initials, color, status }
Activity { id, type: 'creation'|'assignment'|'status_change', text, timestamp, agentId? }
Enquiry { id, clientCompany, contactName, contactEmail, contactPhone, title, description, priority, status, assignedAgentId, estimatedValue, createdAt, activities, imageUrls? }
Comment { id, enquiryId, agentId, content, createdAt, parentId, replies?, imageUrl? }
StoredData { enquiries, comments, agents }
```

---

## 5. Extension Guidelines

### 5.1 Adding a New Heavy/Cron Job

1. Create a standalone runner `scripts/<name>-runner.js` (see `runner-lib.js` for shared helpers).
2. Call the Worker's `/api/runner/*` endpoints for D1 reads/writes; make LLM calls via Omniroute directly.
3. Add a job to the matching workflow (`.github/workflows/cron-*.yml`) with `env: { WORKER_URL, SHARED_SECRET, OMNIROUTE_BASE_URL, OMNIROUTE_API_KEY, OMNIROUTE_MODEL }`.

### 5.2 Adding a New Worker Endpoint (D1 read/write)

1. Add the route in `src/worker.ts` with `c.post('/api/runner/<name>', requireSecret, async (c) => {...})`.
2. Keep it instant — no LLM, no long loops; heavy processing belongs in runners.
3. Run `node scripts/build-worker.mjs` then `node scripts/smoke-worker.mjs` to verify.

### 5.3 Adding a New Frontend View

1. Create `<name>.tsx` in `src/components/`
2. Add route to `ViewType` union in `Sidebar.tsx`
3. Add nav item to `navItems` array in `Sidebar.tsx` and `MobileNav.tsx`
4. Add view rendering block in `page.tsx`
5. For API-backed views, use `api.client.ts`:
```typescript
import { api } from '@/api/client';
const data = await api.get('/api/your-endpoint');
```

### 5.4 Adding a New LLM Provider

1. Update `OMNIROUTE_MODEL` / `OMNIROUTE_BASE_URL` in the GitHub Actions secrets/variables.
2. Runners call the OpenAI-compatible Omniroute API via `omnirouteJson()` in `runner-lib.js`.

### 5.5 Code Quality Conventions

- **Runners**: One script per heavy job. Pure Node (ESM), no build step, use `runner-lib.js`.
- **Worker**: One route per domain. Keep handlers thin; throw errors that map to JSON responses.
- **Frontend**: One component per file. Props interfaces co-located. Use `@/` path alias.
- **Types**: Shared types in `types/`. Component-local types at the top of the file.

### 5.6 Testing Strategy

- Worker: `scripts/smoke-worker.mjs` hits the bundled worker and asserts status codes (heavy slugs → 404, auth-protected runner routes → 401 without secret).
- Frontend: `pnpm build` (static export) + `npx tsc --noEmit`.
- Runners: `node --check` on each script before commit.

---

## 6. Deployment

| Component | Target | How |
|-----------|--------|-----|
| Backend | Cloudflare Workers | `node scripts/build-worker.mjs` (esbuild bundle) → `npx wrangler deploy` (D1 binding `DB`) |
| Frontend | Cloudflare Pages | `pnpm build` → static export (`.next`/out) deployed to Pages |
| Cron/AI | GitHub Actions | `.github/workflows/cron-*.yml` schedules file-based runner scripts |
| Secrets | GitHub Actions secrets + wrangler | `WORKER_URL`, `SHARED_SECRET`, `OMNIROUTE_*` (GH); `SHARED_SECRET`, `DB` (wrangler) |

### Deployment Flow
1. Backend changes: `node scripts/build-worker.mjs && node scripts/smoke-worker.mjs && npx wrangler deploy`.
2. Frontend changes: `pnpm build` in `founder-os_frontend` → deploy the static export to Pages.
3. Cron changes: commit workflow YAML to `main`; GitHub Actions picks it up automatically.
4. Verify: `scripts/smoke-worker.mjs` against the live worker URL covers public + auth paths.