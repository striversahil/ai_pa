# Backend Architecture — founder-os_backend

This document describes the system architecture, design patterns, and extension guide for the Founder OS backend.

---

## 1. System Overview

`founder-os_backend` is a **modular Express monolith** acting as the central hub for multiple AI-powered data sync engines. It stores enriched data in PostgreSQL and serves it — along with the pre-compiled frontend static bundle — from a single Node.js process on port `3000`.

```
                    ┌──────────────────────────────────┐
                    │   founder-os_frontend (static)   │
                    │   served from Express /public/   │
                    └──────────────┬───────────────────┘
                                   │ HTTP fetch() calls
                                   ▼
                    ┌──────────────────────────────────┐
                    │        Express REST API           │
                    │          src/server.ts            │
                    └──────────────┬───────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
    ┌──────────────┐      ┌──────────────┐    ┌──────────────────┐
    │  WhatsApp    │      │    Email     │    │  ZohoNotion      │
    │  Digest Eng  │      │  Sync Eng    │    │  Sync & Analyzer │
    └──────┬───────┘      └──────┬───────┘    └────────┬─────────┘
           │                    │                      │
           └────────────────────┼──────────────────────┘
                                ▼
                  ┌─────────────────────────────┐
                  │     PostgreSQL (Prisma)      │
                  │                             │
                  │  Message  Email  Digest      │
                  │  Task  FounderNote           │
                  │  Estimate  Comment           │
                  │  Classification              │
                  └─────────────────────────────┘
                                ▲
                                │ LLM calls
                  ┌─────────────────────────────┐
                  │   AI Service (Groq/OpenAI)   │
                  │   src/modules/ai/service.ts  │
                  └─────────────────────────────┘
```

---

## 2. Pluggable Analysis Engine Pattern

All sync modules implement the `AnalysisEngine` interface from `src/shared/engine.ts`:

```typescript
export interface AnalysisEngine {
  name: string;
  runSync(): Promise<any>;
  getBriefingContext(): Promise<string>;
  getEodContext(): Promise<string>;
}
```

### EngineRegistry Singleton
Engines register themselves at startup inside `SchedulerService.init()`. The `EngineRegistry` singleton holds all active engines and is queried by the briefing and summary services to aggregate context — **completely decoupling** them from domain-specific logic.

```typescript
// Registration (scheduler/service.ts)
EngineRegistry.register('zoho_notion', new ZohoNotionService());

// Querying (briefing generation)
const contexts = await Promise.all(
  EngineRegistry.all().map(e => e.getBriefingContext())
);
```

---

## 3. Module Map

```
src/modules/
├── ai/
│   ├── prompts/                  # One file per LLM prompt (isolated, testable)
│   └── service.ts                # Provider-agnostic LLM caller
│                                   Wraps OpenAI SDK, points at any compatible endpoint
│
├── digest/
│   └── service.ts                # WhatsApp → AI → Digest pipeline
│                                   Groups messages by chat, calls LLM summarization
│
├── email/
│   └── service.ts                # IMAP sync → Email storage
│
├── scheduler/
│   └── service.ts                # node-cron definitions + EngineRegistry bootstrapper
│                                   Schedules: WhatsApp (every 5m), Email (every 15m),
│                                              Zoho (every 30m)
│
├── storage/
│   └── repository.ts             # All Prisma CRUD operations
│                                   Single source of truth for DB access
│
├── tasks/
│   └── service.ts                # Extracts and stores action items
│
├── whatsapp/
│   ├── controller.ts             # POST /api/whatsapp/webhook handler
│   └── service.ts                # Message persistence + retrieval
│
└── zoho_notion/
    └── service.ts                # Core Zoho engine:
                                    1. Fetch sent estimates from Zoho Books REST API
                                    2. Store estimates + comments in PostgreSQL
                                    3. Run AI intent classification (cached to avoid rate limits)
                                    4. Match estimates to Notion B2B enquiry pages
```

---

## 4. AI Classification Pipeline (Zoho)

The `ZohoNotionService` follows this pipeline per estimate sync cycle:

```
Zoho Books API
      │
      ▼  GET /estimates?status=sent
Fetch all active sent estimates
      │
      ▼  For each estimate:
Fetch internal comments from Zoho
      │
      ▼  Check DB: does Classification exist with same comment count?
      ├── YES → Skip LLM call (cached result)
      └── NO  → Call Groq LLM with classifyEstimate.ts prompt
                      │
                      ▼  Returns JSON:
                 { intentScore, meaningfulUpdate, followUpMissing,
                   notAnswering, improperFollowUp, dayExceeded,
                   movingSlow, underDiscussion, confirm,
                   lastCommentNotSatisfactory, reasoning }
                      │
                      ▼
              Upsert Classification in DB
      │
      ▼
Match estimate to Notion page by estimate number
      │
      ▼
Return enriched estimate list via GET /api/estimates
```

### Rate Limit Handling
Groq free tier: **100,000 tokens/day**. If the LLM call fails with `429`, the estimate is stored without a classification and is shown in the frontend with a `"Classification pending"` message. It will be classified on the next successful sync.

---

## 5. Static Frontend Serving

The Express server serves the compiled `founder-os_frontend` static bundle from `public/`:

```typescript
// src/server.ts
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});
```

This means **one server, one port (3000), one Docker container** serves both the API and the UI.

---

## 6. Adding a New Module

Follow this 4-step workflow to add a new integration (e.g., Stripe):

### Step 1: Define Database Models
Append to `prisma/schema.prisma` and push:
```prisma
model StripeInvoice {
  id        String   @id
  amount    Float
  status    String
  createdAt DateTime
}
```
```bash
npx prisma db push
```

### Step 2: Implement the Engine
Create `src/modules/stripe/service.ts`:
```typescript
import { AnalysisEngine } from '../../shared/engine';

export class StripeEngine implements AnalysisEngine {
  public name = 'Stripe Sync Engine';

  public async runSync(): Promise<any> {
    // Fetch from Stripe API → persist to PostgreSQL
  }

  public async getBriefingContext(): Promise<string> {
    return '### Stripe\n- No payment disputes today.';
  }

  public async getEodContext(): Promise<string> {
    return 'Stripe: ₹2,40,000 processed today.';
  }
}
```

### Step 3: Register the Engine
In `src/modules/scheduler/service.ts`:
```typescript
import { StripeEngine } from '../stripe/service';

EngineRegistry.register('stripe', new StripeEngine());

cron.schedule('0 * * * *', () => EngineRegistry.get('stripe')?.runSync());
```

### Step 4: Expose API Routes
In `src/server.ts`, add:
```typescript
app.get('/api/stripe/metrics', async (req, res) => {
  const data = await StripeEngine.getMetrics();
  res.json(data);
});
```
Then create a new view in `founder-os_frontend` and rebuild.

---

## 7. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Single Express monolith** | Startup scale — simplicity over microservices overhead |
| **Static Next.js export** | No separate frontend server needed; Express serves everything |
| **Classification caching** | Avoids hitting Groq's 100k TPD limit on every sync cycle |
| **EngineRegistry pattern** | Briefing/EOD summary generation stays decoupled from domain modules |
| **pnpm** | Faster installs + disk-efficient for the backend; npm used for the standalone frontend |
| **Prisma ORM** | Type-safe DB access with automatic migration support |
| **Pino logger** | Structured JSON logging with pretty-printing in dev mode |

---

## 8. Cron Schedule Summary

| Engine        | Schedule        | What it does                                |
|---------------|-----------------|---------------------------------------------|
| WhatsApp      | Every 5 minutes | Processes unread messages → digest          |
| Email         | Every 15 minutes| Syncs IMAP inbox → stores emails            |
| Zoho + Notion | Every 30 minutes| Syncs estimates, classifies, matches Notion |
| Briefing      | 7:00 AM daily   | Generates morning briefing note             |
| EOD Summary   | 9:00 PM daily   | Generates end-of-day summary note           |
