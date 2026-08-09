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
                                     │ HTTP fetch() + SSE
                                     ▼
                      ┌──────────────────────────────────┐
                      │        Express REST API           │
                      │          src/server.ts            │
                      │          Routes:                  │
                      │   /api/whatsapp/webhook           │
                      │   /api/health/whatsapp            │
                      │   /api/trigger/*                  │
                      └──────┬──────┬────────┬───────────┘
                             │      │        │
              ┌──────────────┘      │        └──────────────┐
              ▼                     ▼                       ▼
    ┌──────────────────┐   ┌──────────────┐   ┌──────────────────────┐
    │  WhatsApp Engine  │   │    Email     │   │    ZohoNotion        │
    │  (Digest + Class) │   │  Sync Eng    │   │  Sync & Analyzer     │
    └──────┬───────────┘   └──────┬───────┘   └────────┬─────────────┘
           │                     │                      │
           ▼                     │                      │
    ┌───────────┐               │                      │
    │  Redis    │               │                      │
    │ (BullMQ)  │               │                      │
    └─────┬─────┘               │                      │
          │                     │                      │
          ▼                     ▼                      ▼
    ┌──────────────────────────────────────────────────────┐
    │             PostgreSQL (Prisma ORM)                   │
    │                                                       │
    │  Message (wahaMessageId, classification, slaDeadline) │
    │  Email  Digest  Task  FounderNote                     │
    │  Estimate  Comment  Classification                    │
    └──────────────────────┬───────────────────────────────┘
                           ▲
                           │ LLM calls
             ┌──────────────────────────────┐
             │   AI Service (Groq/OpenAI)    │
             │   src/modules/ai/service.ts   │
             │   Prompts: classifyMessage    │
             │   summarizeConversation       │
             │   incrementalSummarize        │
             └──────────────────────────────┘

External:
  ┌────────┐    webhook      ┌──────────┐
  │ WAHA   │───────────────▶ │ Backend  │
  │ (Docker│   POST /api/    │ :3000    │
  │ :3002) │   whatsapp/     │          │
  │        │   webhook       │          │
  │  QR    │◀────────────────│ Outbound │
  │ scan   │   sendText      │          │
  └────────┘                 └──────────┘
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
│   ├── prompts/
│   │   ├── classifyMessage.ts             # Pending/Not Pending classification prompt
│   │   ├── summarizeConversation.ts        # Full conversation digest prompt
│   │   ├── incrementalSummarizeConversation.ts  # Incremental digest prompt (reuses prior summary)
│   │   ├── classifyEstimate.ts
│   │   ├── extractEnquiry.ts
│   │   ├── matchBusiness.ts
│   │   ├── answerFounderQuestion.ts
│   │   ├── generateBrief.ts
│   │   ├── generateDailySummary.ts
│   │   ├── brainQuery.ts
│   │   └── summarizeConversation.ts
│   └── service.ts                # Provider-agnostic LLM wrapper (Groq/OpenAI)
│                                   Fallback across multiple API keys + model chain
│
├── classification/
│   ├── service.ts                # Orchestrates AI → heuristic fallback for message classification
│   ├── heuristics.ts             # Keyword-based fallback when LLM unavailable
│
├── digest/
│   └── service.ts                # WhatsApp → AI → Digest pipeline
│                                   Groups unprocessed messages by chat, uses incremental
│                                   summarization when a prior digest exists
│
├── email/
│   └── service.ts                # IMAP sync → Email storage
│
├── monitoring/
│   ├── sla-check.ts              # 1-min cron: detects messages exceeding SLA deadline
│   ├── alerter.ts                # Slack webhook alerts on SLA breaches
│
├── audit/
│   └── service.ts                # Pending items + SLA breach queries used by health endpoint
│
├── queue/
│   └── service.ts                # BullMQ queues + batch drain processor
│                                   classificationQueue (whatsapp-classification)
│                                   morningQueue (whatsapp-morning-delayed)
│                                   5-min batch drain in chunks of 20
│
├── scheduler/
│   └── service.ts                # node-cron definitions + EngineRegistry bootstrapper
│                                   Schedules: classification batch (every 5m), digest (every 5m),
│                                   SLA check (every 1m), batcher flush (every 15m),
│                                   data retention (daily 3AM), WAHA restart (daily 4AM)
│
├── storage/
│   └── repository.ts             # All CRUD operations — routes through StorageProvider
│                                   Abstraction over PrismaStorageProvider / InMemoryStorageProvider
│
├── tasks/
│   └── service.ts                # Extracts and stores action items from digests
│
├── whatsapp/
│   ├── controller.ts             # POST /api/whatsapp/webhook handler
│   │                               WAHA webhook format, thundering herd batch format,
│   │                               legacy Whapi/WhatsJet formats — all supported
│   ├── service.ts                # Message persistence + retrieval + dedup via WhatsAppService
│   ├── outbound.ts               # Ban-proofed send sequence: sendSeen→pause→startTyping→
│   │                               typing delay jitter→sendText, working hours guard
│   └── batcher.ts                # 15-min notification batching via Map-based buffer + flushAll()
│
├── sales_copilot/
│   └── service.ts                # ZohoNotionService: sync estimates, classify, match Notion
│
└── storage/
    └── repository.ts             # Exclusive data access layer
```

---

## 4. WhatsApp Message Ingestion Pipeline

### 4.1 Webhook Flow

```
WAHA (Docker container)
  │  event: "message"
  ▼
POST /api/whatsapp/webhook
  │
  ├── WAHA format (event: "message", payload: {...})
  │     ├── Dedup check: prisma.message.findUnique({ where: { wahaMessageId } })
  │     ├── Extract body (text or media type label via extractMessageBody())
  │     ├── Save message to PostgreSQL/In-Memory via StorageRepository
  │     ├── Enqueue to BullMQ classification queue (Redis)
  │     └── Broadcast SSE event "message.received"
  │
  ├── Thundering herd format (payloads: [...])
  │     Batches of 10 with 100ms inter-batch delay
  │     Same dedup + save + enqueue per payload
  │
  └── Legacy formats (Whapi, WhatsJet)
        Body/contact extraction, save only (no classification)
```

### 4.2 In-Memory Fallback

When PostgreSQL is unreachable, the server runs in **in-memory mode**. All `prisma` calls are guarded by `useInMemoryDb` checks and fall back to `InMemoryStorageProvider`. The health endpoint exposes `useInMemoryDb: true/false`.

### 4.3 Deduplication

- **`wahaMessageId String? @unique`** on the `Message` model — prevents double-saving the same message
- Webhook checks `prisma.message.findUnique({ where: { wahaMessageId } })` before saving
- Queue processor checks `processed` flag before classifying (avoids re-classification on retry)

---

## 5. Classification Pipeline

### 5.1 Overview

Every incoming message must be classified within 15 minutes (M SLA). The classification runs every 5 minutes via cron, draining the BullMQ queue in chunks of 20.

```
Redis (BullMQ queue)
  │  jobs waiting
  ▼
drainAndProcessBatch()  ← cron */5
  │
  ├── Skip if already processed (dedup check)
  │
  ▼
ClassificationService.processSingleMessage()
  │
  ├── Fetch recent messages for chat context (conversationContext)
  ├── Try LLM: AIService.classifyMessage() with classifyMessagePrompt
  │     ├── Success → use AI result (is_pending, confidence, reason, etc.)
  │     └── Failure → fallback to heuristicClassify() keyword/media matching
  │
  ▼
storeClassification()
  │
  ├── Update Message record: classification, classificationReason, classifiedAt, slaDeadline
  ├── If isPending → save Digest + optionally create Task
  └── Broadcast SSE event "message.classified"
```

### 5.2 Heuristic Fallback

When the LLM is unavailable (rate limited, API key missing, network error), `heuristicClassify()` in `classification/heuristics.ts` uses:

- **Keyword matching**: `"urgent"`, `"asap"`, `"please"`, `"help"`, `"issue"`, `"problem"`, `"broken"`, `"how much"`, `"quote"`, `"price"`, `"order"`, `"complaint"`, `"request"`, `"when"`, `"need"` → marks as PENDING
- **Question detection**: Messages containing `?` → marks as PENDING
- **Media prefix**: Non-text types (image, video, document, location, etc.) get a `[MediaType]` prefix that helps the LLM understand context
- Default: NOT_PENDING (informational)

### 5.3 Incremental Digesting

When a chat already has a prior digest, `processMessagesToDigests()` uses `AIService.incrementalSummarizeConversation()` instead of full summarization. This sends only the **new messages** plus the **previous digest summary/priority/action items** to the LLM, reducing token usage by ~80% on subsequent runs.

---

## 6. Queue System (BullMQ + Redis)

### 6.1 Queues

| Queue Name | Purpose | Consumers |
|---|---|---|
| `whatsapp-classification` | Pending message classification jobs | `drainAndProcessBatch()` — 5-min cron, chunks of 20 |
| `whatsapp-morning-delayed` | Messages deferred to next working day | `OutboundService.sendDelayedMorning()` |

### 6.2 Batch Processing

Messages land in Redis RAM immediately on webhook, then are batch-processed to PostgreSQL every 5 minutes. This avoids per-message DB write overhead and groups classifications for efficiency.

```typescript
// drainAndProcessBatch():
// 1. Get all waiting/active jobs
// 2. Split into chunks of 20
// 3. Process each chunk in parallel (Promise.allSettled)
// 4. Remove completed jobs from queue
```

### 6.3 Retry Policy

- Classification jobs: 3 attempts, exponential backoff (2s, 4s, 8s)
- Morning delayed: 2 attempts
- Jobs removed from queue after batch completes

---

## 7. Ban-Proof Outbound Messaging

### 7.1 Send Sequence

To avoid WhatsApp account restrictions, every outbound message follows this sequence:

```
sendSeen(chatId)
  → sleep (1-2.5s, random jitter)
  → startTyping(chatId)
  → typing delay (2-6s, proportional to message length + 100-900ms jitter)
  → sendText(chatId, message)
```

### 7.2 Anti-Detection Measures

- **sendSeen** before typing — simulates natural "opening" behavior
- **startTyping** shows WhatsApp typing indicator
- **Typing delay** proportional to message length (longer messages = longer "typing")
- **Random jitter** added to all delays (±0.5s on pause, ±400ms on typing)
- **Working hours guard**: Messages only sent between 8 AM and 10 PM
- **Night deferral**: Messages outside working hours are enqueued to `morningQueue` with delay until 8 AM next day
- **WAHA restart**: Daily 4 AM cron restarts the WAHA container to prevent session staleness

### 7.3 Notification Batcher

Outbound notifications (digests, alerts) are buffered in a Map-based collection and flushed every 15 minutes via `flushAll()`. This prevents rapid-fire outbound messages and groups notifications per chat.

---

## 8. Monitoring & Alerting

### 8.1 SLA Check

Every 60 seconds, `SLAChecker.check()` runs:

```
Fetch all messages where classifiedAt IS NULL AND slaDeadline < now()
  → Count SLA breaches
  → If breaches > 0, call Alerter.sendSlackAlert()
  → Auto-resolve after 30 minutes (breaches list cleared)
```

### 8.2 Slack Alerts

When SLAs are breached, the `Alerter` sends a formatted Slack message with:
- Count of breached messages
- Oldest unclassified message time
- Warning to check WAHA session or API keys

Configured via `SLACK_WEBHOOK_URL` env var. Silently skipped if not configured.

### 8.3 Health Endpoint

`GET /api/health/whatsapp` returns:

```json
{
  "status": "healthy" | "degraded" | "down",
  "wahaStatus": "WORKING" | "STOPPED" | "unknown",
  "metrics": {
    "unprocessedMessages": 0,
    "slaBreaches": 0,
    "pendingItems": 0,
    "lastWebhookAt": "ISO timestamp | null",
    "lagMs": null
  }
}
```

### 8.4 Data Retention

Daily at 3 AM, messages older than 90 days are purged in chunks of 1000 to avoid long-running transactions.

---

## 9. AI Classification Pipeline (Zoho)

The `ZohoNotionService` follows this pipeline per estimate sync cycle:

```
Zoho Books API
      │
      ▼  GET /estimates?status=sent
Fetch all active sent estimates
      │
      ▼  Every tick, for ALL estimates (in parallel):
Fetch internal comments from Zoho (comments do NOT bump last_modified_time,
so this runs unconditionally; new comments are detected by comparing Zoho's
max comment_id against the highest comment_id already in the DB)
      │
      ▼  Check DB: new comment_id, no Classification, estimate modified, or forced?
      ├── NO  → Skip LLM call
      └── YES → Call Groq LLM with classifyEstimate.ts prompt
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

## 10. Static Frontend Serving

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

## 11. Adding a New Module

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

## 12. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Single Express monolith** | Startup scale — simplicity over microservices overhead |
| **BullMQ + Redis for message queue** | In-memory queuing avoids per-message DB writes; batch drain reduces connections |
| **Classification by 5-min cron, not real-time** | Batches reduce LLM costs and allow context grouping per chat |
| **AI first, heuristic fallback** | LLM provides nuanced classification; heuristics ensure zero downtime |
| **Incremental digesting** | Avoids re-summarizing entire conversation history — 80% token reduction on subsequent runs |
| **Ban-proof outbound sequence** | Prevents WhatsApp account restrictions via natural typing simulation |
| **WAHA (WEBJS) over cloud APIs** | Self-hosted, full control over anti-detection, no per-message API costs |
| **In-memory fallback mode** | Development and demo without PostgreSQL dependency |
| **Body-hash classification cache** | Prevents repeat LLM calls for identical messages (e.g. "Hi", "?") |
| **Static Next.js export** | No separate frontend server needed; Express serves everything |
| **EngineRegistry pattern** | Briefing/EOD summary generation stays decoupled from domain modules |
| **pnpm** | Faster installs + disk-efficient for the backend |
| **Prisma ORM** | Type-safe DB access with automatic migration support |
| **Pino logger** | Structured JSON logging with pretty-printing in dev mode |

---

## 13. Cron Schedule Summary

| Job | Schedule | What it does |
|---|---|---|
| Classification batch | `*/5 * * * *` | Drain BullMQ queue, classify messages via AI/heuristic |
| Digest generation | `*/5 * * * *` | Group unprocessed messages by chat, summarize via LLM |
| SLA check | `* * * * *` | Detect messages exceeding 15-min SLA deadline |
| Notification batcher flush | `*/15 * * * *` | Send buffered outbound notifications |
| Data retention | `0 3 * * *` | Purge messages older than 90 days (chunks of 1000) |
| WAHA restart | `0 4 * * *` | Restart WAHA container to prevent session staleness |
| Email sync | `*/15 * * * *` | Sync IMAP inbox → stores emails |
| Zoho + Notion sync | `*/30 * * * *` | Sync estimates, classify, match to Notion |
| Morning briefing | `0 7 * * *` | Generate morning briefing via LLM |
| EOD summary | `0 21 * * *` | Generate end-of-day summary via LLM |

---

## 14. Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | No | — | PostgreSQL connection string; absent → in-memory mode |
| `LLM_API_KEY` | No | — | Groq/OpenAI API key (comma-separated for fallback) |
| `LLM_BASE_URL` | No | `https://api.groq.com/openai/v1` | OpenAI-compatible endpoint |
| `LLM_MODEL` | No | `llama-3.3-70b-versatile` | Primary LLM model |
| `WAHA_API_URL` | Yes | `http://localhost:3002` | WAHA REST API base URL |
| `WAHA_API_KEY` | Yes | — | WAHA API authentication key |
| `WAHA_SESSION_NAME` | No | `default` | WAHA session name |
| `REDIS_HOST` | No | `localhost` | Redis host for BullMQ |
| `REDIS_PORT` | No | `6379` | Redis port |
| `MESSAGE_SLA_MINUTES` | No | `15` | SLA deadline in minutes |
| `SLACK_WEBHOOK_URL` | No | — | Slack webhook for SLA breach alerts |
| `PORT` | No | `3000` | Express server port |