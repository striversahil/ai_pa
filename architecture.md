# Founder OS — Architecture Document

## 1. System Overview

Founder OS is a modular executive assistant platform for Brindavan Udyog (India), a B2B industrial manufacturing company. It comprises a **monolithic Express backend** with PostgreSQL, a **Next.js static frontend**, a **WhatsApp automation layer**, and supporting AI proxy tooling.

### Key Principles
- **Separation of concerns**: Routes, services, storage, and middleware are decoupled.
- **Strategy pattern for storage**: Storage operations delegate to interchangeable providers (Prisma/PostgreSQL or in-memory).
- **Pluggable engines**: Domain modules (WhatsApp, Email, Sales, Brain) implement the `AnalysisEngine` interface.
- **Graceful degradation**: Falls back to in-memory mock data when PostgreSQL is unavailable.

### Repository Structure
```
/ai_pa
├── architecture.md
├── docker-compose.yml
├── founder-os_backend/          # Express + Prisma + PostgreSQL
├── founder-os_frontend/         # Next.js 16 static dashboard
├── whatsapp_receiver/           # WhatsApp bot + React PA dashboard
├── prospect_research/           # ProspectAI Pro lead enrichment
├── zoho_sent/                   # Zoho Books cURL credentials
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
| Runtime | Node.js 20+, TypeScript 6 |
| Framework | Express 5 |
| ORM | Prisma 6 + @prisma/client |
| Database | PostgreSQL 15 + pgvector |
| LLM | OpenAI SDK (Groq default, OpenAI fallback) |
| Embeddings | HuggingFace Router API (384-dim) |
| Validation | Zod 4 |
| Logging | Pino 10 |
| Scheduler | node-cron 4 |
| Package Manager | pnpm 10 |

### 2.2 Directory Structure
```
founder-os_backend/
├── prisma/
│   └── schema.prisma              # Database schema (9 models)
├── src/
│   ├── server.ts                   # Entry point — bootstraps Express, registers middleware & routes
│   ├── config/
│   │   └── index.ts                # Environment validation (dotenv + zod schema)
│   ├── shared/
│   │   ├── engine.ts               # AnalysisEngine interface + EngineRegistry
│   │   ├── logger.ts               # Pino logger instance
│   │   ├── prisma.ts               # Prisma client singleton + pgvector bootstrap
│   │   ├── sse.ts                  # SSE client management + broadcast utility
│   │   ├── wa-engine.ts            # WA Engine API config + contact resolution helpers
│   │   └── seed.ts                 # Mock data seeder
│   ├── middleware/
│   │   ├── asyncHandler.ts         # Wraps async route handlers (catches errors -> next())
│   │   └── errorHandler.ts         # Centralized error handler + AppError class
│   ├── routes/
│   │   ├── index.ts                # Aggregates all route modules + backward-compatible aliases
│   │   ├── status.ts               # GET /api/status
│   │   ├── brief.ts                # GET /api/brief/latest
│   │   ├── digests.ts              # GET /api/digests
│   │   ├── tasks.ts                # GET /api/tasks
│   │   ├── messages.ts             # GET /api/messages/:chatId
│   │   ├── sheet-data.ts           # GET /api/sheet-data
│   │   ├── brain.ts                # POST /api/brain/query, GET /api/brain/stats
│   │   ├── estimates.ts            # GET /api/estimates
│   │   ├── triggers.ts             # POST /api/trigger/digest|email-sync|briefing|summary|brain-index
│   │   ├── whatsapp-proxy.ts       # WA Engine proxy: contacts, campaigns, groups, templates, send, summarize
│   │   └── whatsapp-webhook.ts     # POST /api/whatsapp/webhook
│   ├── modules/
│   │   ├── ai/
│   │   │   ├── service.ts          # Provider-agnostic LLM wrapper (OpenAI SDK)
│   │   │   └── prompts/            # Isolated prompt templates
│   │   ├── brain/
│   │   │   ├── service.ts          # Company Brain RAG — semantic + keyword search
│   │   │   ├── indexer.ts          # Indexes all data sources into BrainContext
│   │   │   └── embedder.ts         # HuggingFace embedding generation
│   │   ├── digest/
│   │   │   └── service.ts          # WhatsApp conversation digest pipeline
│   │   ├── email/
│   │   │   └── service.ts          # Email sync (IMAP abstraction)
│   │   ├── google_sheets/
│   │   │   └── service.ts          # Google Sheets OAuth2 JWT reader
│   │   ├── sales_copilot/
│   │   │   └── service.ts          # Zoho Books -> AI classification -> Notion matching
│   │   ├── scheduler/
│   │   │   └── service.ts          # Cron definitions + EngineRegistry bootstrap
│   │   ├── storage/
│   │   │   └── repository.ts       # Static facade — delegates to StorageProvider
│   │   ├── tasks/
│   │   │   └── service.ts          # Action item extraction & management
│   │   └── whatsapp/
│   │       ├── controller.ts       # Webhook handler (extracts payload, saves, broadcasts SSE)
│   │       └── service.ts          # Message persistence + retrieval
│   └── storage/
│       ├── interfaces.ts           # StorageProvider interface + type definitions
│       ├── index.ts                # Provider factory (returns Prisma or InMemory)
│       ├── prisma-provider.ts      # PostgreSQL implementation
│       └── in-memory-provider.ts   # In-memory implementation with seed data
```

### 2.3 API Endpoints

#### System & Data
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/status | DB & LLM connection diagnostics |
| GET | /api/brief/latest | Latest morning brief / EOD summary |
| GET | /api/digests | WhatsApp conversation digests |
| GET | /api/tasks | Extracted action items |
| GET | /api/messages/:chatId | Raw WhatsApp messages for a chat |
| GET | /api/sheet-data | Google Sheet data |
| GET | /api/estimates | Zoho estimates with classifications & comments |

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

### 2.4 Middleware Stack

```
Request
  -> express.static (serve public/ frontend)
  -> express.json (10mb limit for WhatsApp media Base64)
  -> Request Logger (pino)
  -> Route Handler (with asyncHandler wrapper)
    -> Service Layer
      -> StorageProvider (Prisma or InMemory)
  -> errorHandler (catches all unhandled errors)
```

- **asyncHandler**: Wraps async route handlers. Any thrown error is forwarded to `next(err)`.
- **errorHandler**: Centralized error handler. Logs the error, returns JSON with appropriate status code. Special handling for 429 rate limit errors.
- **AppError**: Custom error class with `statusCode` property for controlled error responses.

### 2.5 Service Layer

All domain logic lives in `src/modules/*/service.ts`. Services implement the `AnalysisEngine` interface when they participate in the daily briefing/summary pipeline:

```typescript
interface AnalysisEngine {
  name: string;
  runSync(): Promise<any>;
  getBriefingContext(): Promise<string>;
  getEodContext(): Promise<string>;
}
```

**Registered Engines:**
| Key | Engine | Module | Cron |
|-----|--------|--------|------|
| `whatsapp` | WhatsApp Digest | `digest/service.ts` | Every 15 min |
| `email` | Email Sync | `email/service.ts` | Every 30 min |
| `sales_copilot` | Sales Copilot | `sales_copilot/service.ts` | Every 30 min |
| `brain` | Company Brain | `brain/service.ts` | Every 30 min |

### 2.6 Storage Strategy Pattern

Storage operations are abstracted behind a `StorageProvider` interface:

```
StorageRepository (static facade)
  -> getStorageProvider() -> StorageProvider
       -> PrismaStorageProvider (PostgreSQL via Prisma)
       -> InMemoryStorageProvider (arrays, seeded with mock data)
```

- `StorageRepository` exposes the same static methods as before — **no callers were changed**.
- `storage/index.ts` selects the provider based on `useInMemoryDb` flag.
- To add a new storage backend (e.g., MongoDB, Supabase), implement `StorageProvider` and update the factory.

### 2.7 Scheduler

Cron jobs are defined in `scheduler/service.ts`:
- WhatsApp digest: `*/15 * * * *`
- Email + Sales Copilot + Brain index: `*/30 * * * *`
- Morning Briefing: `0 8 * * *`
- EOD Summary: `0 19 * * *`

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
| Persistence | LocalStorage (mock data) |
| Package Manager | npm |

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

Views like `ZohoEstimates`, `FounderAssistant`, and `WhatsAppDashboard` manage their own state internally and call the backend API directly via `fetch()`.

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

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
```

---

## 4. Data Models

### 4.1 Database Schema (Prisma — 9 models)

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
  embedding   vector(384)?
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

### 5.1 Adding a New Backend Module

1. Create `src/modules/<name>/service.ts` implementing `AnalysisEngine`:
```typescript
import { AnalysisEngine } from '../../shared/engine';

export class MyNewService implements AnalysisEngine {
  name = 'My New Engine';

  async runSync(): Promise<any> {
    // Fetch data, process, store
  }

  async getBriefingContext(): Promise<string> {
    return 'Key information for morning briefing...';
  }

  async getEodContext(): Promise<string> {
    return 'Key information for evening summary...';
  }
}
```

2. Register in `scheduler/service.ts`:
```typescript
import { MyNewService } from '../my_new/service';
EngineRegistry.register('my_engine', new MyNewService());
```

3. Add route in a new file `src/routes/<name>.ts`:
```typescript
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
const router = Router();
router.get('/', asyncHandler(async (req, res) => { ... }));
export default router;
```

4. Mount in `src/routes/index.ts`:
```typescript
import myRouter from './<name>';
router.use('/<name>', myRouter);
```

### 5.2 Adding a New Storage Provider

1. Implement `StorageProvider` interface from `src/storage/interfaces.ts`:
```typescript
import { StorageProvider } from './interfaces';

export class MongoStorageProvider implements StorageProvider {
  async saveMessage(data: MessageData): Promise<StoredMessage> { ... }
  // ... all 11 methods
}
```

2. Update `src/storage/index.ts`:
```typescript
if (useMongoDb) {
  provider = new MongoStorageProvider();
}
```

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

1. Update `LLM_MODEL` and `LLM_BASE_URL` in environment config.
2. The AI service in `modules/ai/service.ts` already supports model fallback chains.
3. For custom behavior, add a new prompt in `modules/ai/prompts/`.

### 5.5 Code Quality Conventions

- **Routes**: One file per domain resource. Use `asyncHandler` wrapper. Throw `AppError` for controlled error responses.
- **Services**: Implement `AnalysisEngine` for scheduled modules. Keep I/O operations async.
- **Storage**: Never import `prisma` directly outside `storage/` or route files. Use `StorageRepository` facade.
- **Hooks**: One hook per concern. Use `useCallback` for handlers, `useMemo` for derived data.
- **Components**: One component per file. Props interfaces should be co-located.
- **Types**: Shared types in `types/`. Component-local types at the top of the file.
- **Imports**: Use `@/` path alias for frontend imports (e.g., `@/hooks/useTheme`).

### 5.6 Testing Strategy

- Backend: Unit test services with `InMemoryStorageProvider` as the test fixture.
- Frontend: Extract logic into hooks (pure state management) + components (pure rendering).
- API: Test route handlers by mounting the Express app with `supertest`.