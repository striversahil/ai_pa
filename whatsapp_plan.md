# WhatsApp AI Processing Plan — WAHA (WEBJS) Integration

---
> Status: Draft · Target SLA: 15 minutes per message · AI Classification: Pending / Not Pending
---

## Table of Contents

- [Architecture Overview](#1-architecture-overview)
- [Message Lifecycle](#2-message-lifecycle)
- [Time Guarantees & SLA](#3-time-guarantees--sla)
- [Error Handling](#4-error-handling)
- [Scalability Considerations](#5-scalability-considerations)
- [Operational Monitoring](#6-operational-monitoring)
- [Security & Compliance](#7-security--compliance)
- [Ban-Proofing & Anti-Detection Strategy](#8-ban-proofing--anti-detection-strategy)
- [Implementation Roadmap](#implementation-roadmap)
- [Appendix: WAHA API Reference](#appendix-waha-api-reference)

---

## 1. Architecture Overview

### 1.1 High-Level Diagram

```
┌──────────────────────┐    Webhook (HTTP)    ┌──────────────────────────────────────┐
│                      │ ───────────────────► │                                      │
│    WAHA Container    │                      │         Founder OS Backend           │
│    (WEBJS Engine)    │ ◄──────────────────  │                                      │
│    :3002             │    REST API          │  ┌──────────┐  ┌──────────────────┐  │
│                      │                      │  │ Webhook  │  │   AI Service     │  │
│  ┌────────────────┐  │                      │  │ Handler  │──► (Groq / OpenAI)  │  │
│  │ Chromium       │  │                      │  └────┬─────┘  └────────┬─────────┘  │
│  │ (Puppeteer)    │  │                      │       │                 │            │
│  │ + stealth      │  │                      │       ▼                 ▼            │
│  └────────────────┘  │                      │  ┌──────────────────────────────┐    │
│                      │                      │  │     Message Queue (In-Mem    │    │
│  ┌────────────────┐  │                      │  │     or Bull/BullMQ Redis)    │    │
│  │ Sessions       │  │                      │  └────────────┬─────────────────┘    │
│  │ (persistent)   │  │                      │               │                      │
│  └────────────────┘  │                      │               ▼                      │
└──────────────────────┘                      │  ┌──────────────────────────────┐    │
                                               │  │     Digest Service (Cron)    │    │
                                               │  │     (every 5 min)            │    │
                                               │  └────┬─────────┬───────────────┘    │
                                               │       │         │                    │
                                               │       ▼         ▼                    │
                                               │  ┌────────┐ ┌──────────┐             │
                                               │  │Postgres│ │ SSE push │             │
                                               │  │ (Msgs, │ │to Front- │             │
                                               │  │Digests,│ │end       │             │
                                               │  │ Tasks) │ │          │             │
                                               │  └────────┘ └──────────┘             │
                                               │                                      │
                                               │  ┌──────────────────────────────┐    │
                                               │  │   Monitoring / SLA Checker   │    │
                                               │  │   (every minute)             │    │
                                               │  └──────────────────────────────┘    │
                                               └──────────────────────────────────────┘
```

### 1.2 WAHA Integration Points

WAHA (WhatsApp HTTP API) wraps whatsapp-web.js in a REST API. It runs as a Docker container on your infrastructure.

| Integration | Direction | Protocol | Details |
|---|---|---|---|
| Inbound messages | WAHA → Backend | Webhook (POST) | WAHA sends message events to POST /api/whatsapp/webhook |
| Outbound replies | Backend → WAHA | REST API | POST http://localhost:3002/api/sendText |
| Session control | Backend → WAHA | REST API | POST /api/sessions/default/start, GET /api/sessions/default/auth/qr |
| Health check | Backend → WAHA | REST API | GET http://localhost:3002/api/sessions/default |

### 1.3 WAHA Docker Setup

```yaml
# docker-compose.yml — WAHA service block
version: '3.8'
services:
  waha:
    image: devlikeapro/waha:latest
    container_name: waha
    restart: unless-stopped
    environment:
      - WAHA_ENGINE=WEBJS
      - WAHA_PRINT_QR=true
      - WAHA_API_KEY=MyLocalSecretKey!
      # ─── Anti-detection browser args ───
      - WAHA_WEBJS_BROWSER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-blink-features=AutomationControlled,--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
      # ─── Webhook config ───
      - WAHA_WEBHOOKS='[{"url": "http://founder-os-backend:5000/api/whatsapp/webhook", "events": ["message"]}]'
    volumes:
      - ./waha_sessions:/app/.wwebjs_auth   # Persistent session = no repeated QR scans
    ports:
      - "3002:3002"
    networks:
      - founder-os-net
```

> Important: WAHA runs Chromium inside the container. The `--disable-blink-features=AutomationControlled` flag strips the `navigator.webdriver = true` property that Meta checks. The desktop User-Agent override prevents fingerprinting via UA mismatches.

### 1.4 Environment Variables

Add to `founder-os_backend/.env`:

```env
# WAHA
WAHA_API_URL=http://waha:3002
WAHA_API_KEY=MyLocalSecretKey!
WAHA_SESSION_NAME=default

# SLA / Queue config
MESSAGE_SLA_MINUTES=15
DIGEST_CRON_INTERVAL=*/5 * * * *
MESSAGE_QUEUE_MAX_RETRIES=5
```

Update `config/index.ts`:

```typescript
const configSchema = z.object({
  // ... existing fields ...
  WAHA_API_URL: z.string().default('http://localhost:3002'),
  WAHA_API_KEY: z.string().default('MyLocalSecretKey!'),
  WAHA_SESSION_NAME: z.string().default('default'),
  MESSAGE_SLA_MINUTES: z.coerce.number().default(15),
  DIGEST_CRON_INTERVAL: z.string().default('*/5 * * * *'),
});
```

### 1.5 Key Design Decisions

| Decision | Rationale |
|---|---|
| WAHA over WhatsApp Business API | No Meta app review, no per-conversation fees, full control over browser fingerprinting, persistent session storage. |
| Per-message SLA (not batch) | Each incoming message must be classified within 15 minutes. Batching could delay urgent items. |
| Cron every 5 minutes | Processing unprocessed messages every 5 minutes guarantees max ~10 min wait, well within the 15-minute SLA. |
| Message queue (Bull/BullMQ) | Decouples webhook reception from AI processing. Prevents webhook timeouts and allows retry without re-ingesting. |
| Persistent session volume | Avoids repeated QR scans which trigger Meta's suspicion. Session survives container restarts. |
| SSE for real-time UI | Reuses existing `sse.ts` infrastructure to push classification results to the frontend immediately. |

### 1.6 WAHA Session Lifecycle

```
┌──────────┐     ┌────────────┐     ┌───────────┐     ┌────────────┐
│ 1. START │────►│ 2. SCAN QR │────►│ 3. CONNECT│────►│ 4. LISTEN  │
│ Session  │     │ (via API)  │     │ WebSocket │     │ for events │
└──────────┘     └────────────┘     └───────────┘     └─────┬──────┘
                                                             │
                                                             ▼
                                                       ┌────────────┐
                                                       │ 5. WEBHOOK │
                                                       │ on message │
                                                       └────────────┘
```

Start session on boot:

```bash
curl -X POST http://localhost:3002/api/sessions/default/start \
  -H "Content-Type: application/json"
```

Get QR code for initial pairing:

```bash
curl http://localhost:3002/api/sessions/default/auth/qr
```

---

## 2. Message Lifecycle

### 2.1 Step-by-Step Flow

```
  ┌──────────┐      ┌──────────────┐      ┌────────────┐      ┌───────────┐
  │ 1. RECV  │ ──►  │ 2. ENQUEUE   │ ──►  │ 3. CLASSIFY│ ──►  │ 4. STORE  │
  │ (Webhook)│      │ (Queue)      │      │ (AI)       │      │ (DB)      │
  └──────────┘      └──────────────┘      └────────────┘      └───────────┘
                                                                     │
                                                                     ▼
                                                               ┌───────────┐
                                                               │ 5. NOTIFY │
                                                               │ (SSE/Task)│
                                                               └───────────┘
```

### 2.2 Step 1 — Receive Webhook from WAHA

WAHA sends a POST to your webhook URL when a message arrives. The payload format:

```json
{
  "event": "message",
  "session": "default",
  "payload": {
    "id": "true_919811044521@c.us_ABCDEF123",
    "from": "919811044521@c.us",
    "body": "Hi, we need 12,000 sieve cleaners urgently",
    "fromMe": false,
    "sender": {
      "name": "Sanjay Singhal",
      "pushname": "Sanjay"
    },
    "timestamp": 1720000000,
    "chatId": "919811044521@c.us",
    "hasMedia": false,
    "type": "text"
  }
}
```

WAHA supports multiple message types. Extract body appropriately per type:

| `payload.type` | Where body lives | Fallback |
|---|---|---|
| `text` | `payload.body` | `'[Text Message]'` |
| `image` | `payload.caption || payload.body` | `'[Image]'` |
| `video` | `payload.caption || payload.body` | `'[Video]'` |
| `audio` | `payload.body` | `'[Audio]'` |
| `document` | `payload.caption || payload.body` | `'[Document: filename]'` |
| `location` | `payload.body` | `'[Location]'` |
| `poll` | `payload.body` | `'[Poll]'` |
| `sticker` | `payload.body` | `'[Sticker]'` |
| `contact` | `payload.body` | `'[Contact Card]'` |
| `buttons` | `payload.body` | `'[Button Reply]'` |
| `list` | `payload.body` | `'[List Selection]'` |

Add a WAHA branch to the existing webhook handler:

```typescript
// In WhatsAppController.handleWebhook — new WAHA branch
function extractMessageBody(payload: any): string {
  if (payload.body) return payload.body;
  if (payload.caption) return payload.caption;
  const typeLabels: Record<string, string> = {
    image: '[Image]',
    video: '[Video]',
    audio: '[Audio]',
    document: payload.filename ? `[Document: ${payload.filename}]` : '[Document]',
    location: '[Location]',
    poll: '[Poll]',
    sticker: '[Sticker]',
    contact: '[Contact Card]',
    buttons: '[Button Reply]',
    list: '[List Selection]',
  };
  return typeLabels[payload.type] || '[Media/System Message]';
}

function extractSenderName(payload: any): string {
  return payload.sender?.name || payload.sender?.pushname || payload.from?.split('@')[0] || 'Client';
}

if (req.body.event === 'message' && req.body.payload) {
  const payload = req.body.payload;
  if (payload.fromMe) {
    return res.status(200).json({ success: true });
  }

  const from = payload.chatId || payload.from;
  const sender = extractSenderName(payload);
  const body = extractMessageBody(payload);
  const timestamp = new Date((payload.timestamp || 0) * 1000);
  const mediaType = payload.type !== 'text' ? payload.type : null;

  const saved = await WhatsAppService.saveMessage({ chatId: from, sender, body, timestamp });
  await MessageQueueService.enqueueClassification(saved.id, from, sender, body, timestamp, mediaType);
  broadcastWhatsAppEvent('message.received', { chatId: from, sender, body, timestamp });

  return res.status(200).json({ success: true });
}
```

### 2.3 Step 2 — Enqueue for Classification

Introduce a Message Queue to decouple ingestion from AI processing.

Option A: BullMQ (Redis) — preferred for production.

```typescript
// src/modules/queue/service.ts
import { Queue, Worker } from 'bullmq';
import { config } from '../../config';

const connection = { host: config.REDIS_HOST, port: config.REDIS_PORT };

export const classificationQueue = new Queue('whatsapp-classification', { connection });

export class MessageQueueService {
  // Delayed outbound queue for night-time deferrals
  static morningQueue = new Queue('whatsapp-morning-delayed', { connection });

  static async enqueueClassification(
    messageId: string, chatId: string, sender: string, body: string, timestamp: Date, mediaType?: string | null
  ) {
    const job = await classificationQueue.add('classify', {
      messageId, chatId, sender, body, timestamp, mediaType,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 500,
    });
    return job.id;
  }

  /**
   * Defer an outbound message to the next working hours window (8 AM).
   * Calculates delay until 8 AM local time and schedules the job.
   */
  static async enqueueDelayedMorning(chatId: string, messageBody: string) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(8, 0, 0, 0);
    if (now >= target) target.setDate(target.getDate() + 1); // next morning
    const delayMs = target.getTime() - now.getTime();

    await this.morningQueue.add('send-morning', { chatId, messageBody }, {
      delay: delayMs,
      attempts: 2,
      removeOnComplete: true,
    });
  }

  static startWorker() {
    const worker = new Worker('whatsapp-classification', async (job) => {
      const { messageId, chatId, sender, body, timestamp, mediaType } = job.data;
      await ClassificationService.processSingleMessage(
        messageId, chatId, sender, body, new Date(timestamp), mediaType
      );
    }, {
      connection,
      concurrency: 5,
      maxStalledCount: 2,
      lockDuration: 60000,
    });
    return worker;
  }

  /**
   * Start the morning flush worker — processes delayed messages at 8 AM
   */
  static startMorningWorker() {
    const worker = new Worker('whatsapp-morning-delayed', async (job) => {
      const { chatId, messageBody } = job.data;
      await OutboundService.sendWithJitter(chatId, messageBody);
    }, { connection, concurrency: 2 });
    return worker;
  }
}
```

Option B: In-Memory Queue — for dev / low-volume.

```typescript
// Simplified in-memory version
export class InMemoryQueue {
  private static queue: any[] = [];
  private static processing = false;

  static enqueue(data: any) {
    this.queue.push({ ...data, enqueuedAt: Date.now() });
    if (!this.processing) this.processNext();
  }

  private static async processNext() {
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const elapsed = Date.now() - item.enqueuedAt;
      if (elapsed > 15 * 60 * 1000) {
        logger.warn({ messageId: item.messageId, elapsed }, 'SLA BREACHED');
      }
      try {
        await ClassificationService.processSingleMessage(
          item.messageId, item.chatId, item.sender, item.body, item.timestamp
        );
      } catch (err: any) {
        logger.error({ error: err.message, messageId: item.messageId }, 'Queue processing failed');
      }
    }
    this.processing = false;
  }
}
```

### 2.4 Step 3 — AI Classification

Create a dedicated `ClassificationService` that analyzes a single message and decides: Pending vs Not Pending.

```typescript
// src/modules/classification/service.ts
export interface ClassificationResult {
  isPending: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  suggestedAction: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
}

export class ClassificationService {
  static async processSingleMessage(
    messageId: string, chatId: string, sender: string, body: string, timestamp: Date, mediaType?: string | null
  ) {
    // 1. Fetch recent context (last 20 messages from same chat)
    const recentMessages = await WhatsAppService.fetchMessagesByChatId(chatId, 20);

    const conversationContext = recentMessages
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map(m => `[${m.timestamp.toISOString()}] ${m.sender}: ${m.body}`)
      .join('\n');

    // 2. Include media type hint in body for better AI classification
    const enrichedBody = mediaType ? `[${mediaType}] ${body}` : body;

    // 3. Try AI classification
    let result: ClassificationResult;
    try {
      result = await AIService.classifyMessage({ sender, body: enrichedBody, timestamp: timestamp.toISOString(), conversationContext });
    } catch {
      result = heuristicClassify(enrichedBody);
    }

    // 4. Store results (see 2.5)
    await this.storeClassification(messageId, chatId, sender, result, timestamp);
  }

  private static async storeClassification(
    messageId: string, chatId: string, sender: string, result: ClassificationResult, timestamp: Date
  ) {
    const prisma = (await import('../../shared/prisma')).prisma;

    await prisma.message.update({
      where: { id: messageId },
      data: {
        processed: true,
        classification: result.isPending ? 'PENDING' : 'NOT_PENDING',
        classificationReason: result.reason,
        classifiedAt: new Date(),
        slaDeadline: new Date(timestamp.getTime() + 15 * 60 * 1000),
      },
    });

    if (result.isPending) {
      const digest = await StorageRepository.saveDigest({
        chatId,
        chatName: sender,
        summary: result.reason,
        priority: result.priority,
        category: result.category,
        sentiment: 'neutral',
        requiresFounder: result.priority === 'high' || result.priority === 'urgent',
        suggestedReply: result.suggestedAction,
      });

      if (result.suggestedAction) {
        await TasksService.createTask({
          title: result.suggestedAction,
          owner: 'Founder',
          status: 'PENDING',
          source: 'WHATSAPP',
          sourceId: digest.id,
        });
      }
    }

    broadcastWhatsAppEvent('message.classified', {
      messageId, chatId,
      isPending: result.isPending,
      priority: result.priority,
      reason: result.reason,
    });
  }
}
```

AI Prompt for Classification

```typescript
// src/modules/ai/prompts/classifyMessage.ts
export const classifyMessagePrompt = `
You are an executive assistant triaging WhatsApp messages for a startup founder.
Analyze the incoming message and its conversation context.

Messages may include media type prefixes like [Image], [Video], [Document], [Audio], [Location], or [Poll] followed by a caption or description. Treat media messages as potentially requiring attention — the sender took action to share content.

Determine if this message is:
- **PENDING** — requires human or system follow-up (a question, a request, a complaint, an action item, a lead that needs a quote, a support issue, a shared media file that needs review, etc.)
- **NOT PENDING** — informational only, already resolved, spam, acknowledgement, or no action needed

Respond with a single, valid JSON object:
{
  "is_pending": boolean,
  "confidence": "high" | "medium" | "low",
  "reason": string (1 sentence explaining the decision),
  "suggested_action": string | null (concrete next step if pending, otherwise null),
  "priority": "low" | "medium" | "high" | "urgent",
  "category": string (e.g. "Customer", "Investor", "Operations", "Partner", "Support", "Spam", "Informational")
}

Only output the raw JSON. No markdown, no explanation.
`;
```

Classification Heuristics (Fallback)

```typescript
// src/modules/classification/heuristics.ts
export function heuristicClassify(body: string): ClassificationResult {
  const lower = body.toLowerCase();

  // Non-text media types are often informational or require context — flag as pending
  const mediaPrefixes = ['[image]', '[video]', '[audio]', '[document', '[location]', '[poll]', '[sticker]', '[contact'];
  const hasMediaPrefix = mediaPrefixes.some(p => lower.startsWith(p));

  if (hasMediaPrefix) {
    return {
      isPending: true,
      confidence: 'low',
      reason: 'Message contains media that may require review or response.',
      suggestedAction: 'Review the media and respond if needed.',
      priority: 'medium',
      category: 'Customer',
    };
  }

  // Only attempt keyword analysis on actual text content
  if (body.trim()) {
    const pendingKeywords = [
      'urgent', 'asap', 'please', 'need', 'required', 'help', 'issue',
      'problem', 'broken', 'not working', 'when', 'how much', 'quote',
      'price', 'order', 'delivery', 'complaint', 'follow up', 'request',
      'can you', 'could you', 'would you', 'send me', 'call me',
    ];

    const hasPendingKeyword = pendingKeywords.some(k => lower.includes(k));
    const isQuestion = body.includes('?');

    if (hasPendingKeyword || isQuestion) {
      return {
        isPending: true,
        confidence: 'medium',
        reason: hasPendingKeyword
          ? 'Message contains keywords indicating a request or action item.'
          : 'Message is a question requiring a response.',
        suggestedAction: 'Review and respond to the sender.',
        priority: hasPendingKeyword && lower.includes('urgent') ? 'urgent' : 'medium',
        category: 'Customer',
      };
    }
  }

  return {
    isPending: false,
    confidence: 'medium',
    reason: 'Message appears informational with no action required.',
    suggestedAction: null,
    priority: 'low',
    category: 'Informational',
  };
}
```

### 2.5 Step 4 — Notify Frontend via SSE

The existing `sse.ts` infrastructure pushes the classification result to the frontend. Add a handler for the new `message.classified` event in `WhatsAppDashboard.tsx`:

```typescript
// In WhatsAppDashboard.tsx SSE useEffect
if (payload.event === 'message.classified') {
  fetchDigests();
  if (payload.data.chatId === selectedContactUid) {
    fetchMessages(selectedContactUid, true);
  }
}
```

### 2.6 Schema Changes

Add classification fields to the `Message` model in `schema.prisma`:

```prisma
model Message {
  id                   String    @id @default(uuid())
  chatId               String
  sender               String
  body                 String
  timestamp            DateTime
  processed            Boolean   @default(false)
  classification       String?   // "PENDING" | "NOT_PENDING" | null
  classificationReason String?
  classifiedAt         DateTime?
  slaDeadline          DateTime?
  createdAt            DateTime  @default(now())

  @@index([chatId])
  @@index([processed])
  @@index([classification])
  @@index([slaDeadline])
}
```

---

## 3. Time Guarantees & SLA

### 3.1 SLA Definition

Every incoming WhatsApp message MUST be classified (Pending / Not Pending) within 15 minutes of receipt.

### 3.2 Timing Breakdown

| Stage | Target | Worst Case | Notes |
|---|---|---|---|
| Webhook reception | < 500ms | 2s | Save + enqueue; respond 200 immediately |
| Queue wait time | < 2 min | 5 min | Cron runs every 5 min (or worker always active) |
| AI classification | < 5s | 30s | LLM call with 0.1 temperature; fallback to heuristics |
| DB persistence | < 200ms | 1s | Single upsert |
| SSE notification | < 100ms | 500ms | Push to connected clients |
| Total (normal) | ~3 min | ~8 min | Well within 15 min SLA |
| Total (with retries) | ~8 min | ~14 min | After 2–3 retry attempts |

### 3.3 Backend-Side Guarantee

Cron-based processing (builds on existing pattern):

Change the existing digest cron from `*/15 * * * *` to `*/5 * * * *`:

```typescript
// In scheduler/service.ts
cron.schedule('*/5 * * * *', async () => {
  const eng = EngineRegistry.get('whatsapp');
  if (eng) await eng.runSync();
});
```

Queue-based processing (recommended for production):

```typescript
// Start worker on server boot
const worker = MessageQueueService.startWorker();
worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Classification completed');
});
worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Classification failed');
});
```

### 3.4 SLA Monitoring Check

Every minute, check for messages that have breached the 15-minute window:

```typescript
// src/modules/monitoring/sla-check.ts
import { prisma } from '../shared/prisma';
import { logger } from '../shared/logger';
import { Alerter } from './alerter';

export class SLAChecker {
  static async check() {
    const now = new Date();
    const deadline = new Date(now.getTime() - 15 * 60 * 1000);

    const breached = await prisma.message.findMany({
      where: { processed: false, timestamp: { lte: deadline } },
      orderBy: { timestamp: 'asc' },
      take: 100,
    });

    if (breached.length > 0) {
      logger.error({ count: breached.length, oldest: breached[0].timestamp }, 'SLA BREACHED');
      await Alerter.alert(`${breached.length} messages breached 15-min SLA`, 'critical');
    }
    return breached;
  }
}

cron.schedule('* * * * *', () => SLAChecker.check());
```

### 3.5 SLA Violation Protocol

| Scenario | Action |
|---|---|
| Message unprocessed after 10 min | Log warning, escalate priority in queue |
| Message unprocessed after 15 min | Log error, fire alert (Slack), fall back to heuristic classification |
| Message unprocessed after 30 min | Mark as classification = "NOT_PENDING" with reason "SLA_EXCEEDED" to prevent backlog stall. Log for manual audit. |

---

## 4. Error Handling

### 4.1 AI Failure Scenarios

| Failure Mode | Detection | Fallback |
|---|---|---|
| LLM timeout (> 30s) | `callLLM` throws timeout error | Use `heuristicClassify()` |
| LLM rate limit (429) | `status === 429` | Retry with next API key (existing shuffle logic); fallback to heuristics |
| LLM returns malformed JSON | `JSON.parse()` throws | Retry once; if still bad, use heuristics |
| LLM model unavailable | `status === 404` | Try next model in fallback chain (llama-3.3 → llama-3.1 → gemma2 → gpt-4o-mini → gpt-4o) |
| All keys/models exhausted | All attempts fail | Use heuristic classification; flag for manual review |

### 4.2 Queue Failure Scenarios

| Scenario | Handling |
|---|---|
| Job stalls (no progress for 60s) | BullMQ `lockDuration` releases the job; another worker picks it up |
| Job exceeds max retries (3 attempts) | Move to dead-letter queue; log error; notify admin |
| Redis unavailable | Fall back to in-memory queue (degraded mode) |
| Worker crashes | PM2 / Docker restarts worker; unacked jobs are picked up after restart |

### 4.3 WAHA Failure Scenarios

| Scenario | Handling |
|---|---|
| WAHA container down | WAHA will reconnect and replay missed messages via WebSocket after restart; no webhook loss for messages received after restart |
| Session disconnected | WAHA auto-reconnects; persistent session volume prevents QR re-scan |
| QR expired | Monitor session health via `/api/sessions/default`; alert if status is not WORKING |
| Browser crash inside WAHA | WAHA auto-restarts Chromium; session persists via `./waha_sessions` volume |

### 4.4 Webhook Delivery Failure

| Scenario | Handling |
|---|---|
| Backend down during webhook | WAHA retries on non-200 response. Configure WAHA `webhook_retries` in env. |
| Webhook payload malformed | Log warning; respond 200 (WAHA will not retry). Validate shape before processing. |
| Duplicate webhook delivery | Check `payload.id` uniqueness before insert using DB unique constraint. |

### 4.5 Graceful Degradation Matrix

```
                        ┌──────────────────────────────────────────┐
                        │          AI AVAILABLE?                   │
                        │    YES                NO                 │
├──────────────────────┼──────────────────────────────────────────┤
│  Queue Available     │  Full pipeline       Heuristics-only      │
│  (Redis up)          │  (AI + context)      (no context)         │
├──────────────────────┼──────────────────────────────────────────┤
│  Queue Down          │  Direct AI call      Manual intervention  │
│  (in-memory fallback)│  (synchronous)       (store raw, alert)   │
└──────────────────────┴──────────────────────────────────────────┘
```

---

## 5. Scalability Considerations

### 5.1 Volume Projections

| Tier | Messages / day | Messages / min (peak) | Burst (5x) |
|---|---|---|---|
| Early | < 100 | < 1 | 5 |
| Growth | 1,000 | ~5 | 25 |
| Scale | 10,000 | ~50 | 250 |

### 5.2 Scaling Strategy

#### 5.2.1 Worker Concurrency

```typescript
// Low volume (default)
const worker = new Worker('whatsapp-classification', handler, {
  connection,
  concurrency: 5,
});

// High volume — scale via PM2 cluster mode
```

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'classification-worker',
    script: 'dist/workers/classification.js',
    instances: 4,
    exec_mode: 'cluster',
  }]
};
```

#### 5.2.2 Database

- Index on `Message.processed` (already exists)
- Index on `Message.slaDeadline` — powers the SLA checker query
- BRIN index on `Message.timestamp` for very large tables (>10M rows)

#### 5.2.3 LLM API Key Rotation

The existing `AIService.callLLM` already shuffles multiple API keys. For high volume, add more keys to `LLM_API_KEY` (comma-separated).

#### 5.2.4 WAHA Session Limits

WAHA runs a single Chromium instance per session. For very high volume, consider:

- Running multiple WAHA instances with different sessions (separate phone numbers)
- Each session handles its own WebSocket; scale horizontally by adding more numbers
- WAHA container resource limits: allocate at least 1GB RAM and 1 CPU core per instance

### 5.3 Avoiding Thundering Herd

When WAHA reconnects after downtime, it may replay buffered messages rapidly:

```typescript
// In webhook handler — rate-limit enqueuing
const BATCH_SIZE = 10;
if (Array.isArray(req.body.payloads) && req.body.payloads.length > BATCH_SIZE) {
  const batches = chunkArray(req.body.payloads, BATCH_SIZE);
  for (const batch of batches) {
    await Promise.all(batch.map(p => MessageQueueService.enqueueClassification(...)));
    await new Promise(r => setTimeout(r, 100));
  }
}
```

---

## 6. Operational Monitoring

### 6.1 Key Metrics

| Metric | Source | Alert Threshold |
|---|---|---|
| Messages received (1m rate) | Webhook request count | > 2x expected peak |
| Unprocessed message age (max) | `Message.timestamp` vs now for `processed=false` | > 10 min → warning; > 15 min → critical |
| Classification latency (p95) | Queue job duration | > 30s |
| AI failure rate (1h) | Failed `classifyMessage` calls / total | > 5% |
| Heuristic fallback rate | Fallback calls / total | > 10% |
| Queue depth | BullMQ `getWaitingCount()` | > 1000 |
| SLA breaches (1h) | `SLAChecker.check()` results | > 0 |
| WAHA session status | GET /api/sessions/default | Not WORKING |

### 6.2 Alert Channels

```typescript
// src/modules/monitoring/alerter.ts
export class Alerter {
  static async alert(message: string, severity: 'warning' | 'critical') {
    logger[severity === 'critical' ? 'error' : 'warn']({ alert: message });

    if (config.SLACK_WEBHOOK_URL) {
      await fetch(config.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `[${severity.toUpperCase()}] WhatsApp SLA: ${message}`,
        }),
      });
    }
  }
}
```

### 6.3 Audit Log for Pending Items

```typescript
// src/modules/audit/service.ts
export class AuditService {
  static async getPendingItems(options: { since?: Date; category?: string; priority?: string }) {
    return prisma.message.findMany({
      where: {
        classification: 'PENDING',
        classifiedAt: options.since ? { gte: options.since } : undefined,
      },
      orderBy: [{ priority: 'desc' }, { classifiedAt: 'asc' }],
    });
  }

  static async getSLABreaches(since: Date) {
    return prisma.message.findMany({
      where: { slaDeadline: { lt: new Date() }, timestamp: { gte: since }, processed: true },
      orderBy: { slaDeadline: 'asc' },
    });
  }
}
```

### 6.4 Health Endpoint

```typescript
// GET /api/health/whatsapp
router.get('/health/whatsapp', async (req, res) => {
  const now = new Date();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);

  // Check WAHA session health with 3s timeout
  let wahaStatus = 'unknown';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const sr = await fetch(`${config.WAHA_API_URL}/api/sessions/${config.WAHA_SESSION_NAME}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (sr.ok) {
      const sData = await sr.json();
      wahaStatus = sData.status || 'unknown';
    }
  } catch { wahaStatus = 'unreachable'; }

  const [unprocessedCount, breachedCount, lastWebhook, pendingCount] = await Promise.all([
    prisma.message.count({ where: { processed: false } }),
    prisma.message.count({ where: { processed: false, timestamp: { lte: fifteenMinAgo } } }),
    prisma.message.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.message.count({ where: { classification: 'PENDING' } }),
  ]);

  res.json({
    status: (breachedCount === 0 && wahaStatus === 'WORKING') ? 'healthy' : 'degraded',
    waha: { status: wahaStatus },
    metrics: {
      unprocessedMessages: unprocessedCount,
      slaBreaches: breachedCount,
      pendingItems: pendingCount,
      lastWebhookAt: lastWebhook?.createdAt,
      lagMs: lastWebhook ? now.getTime() - lastWebhook.createdAt.getTime() : null,
    },
  });
});
```

### 6.5 SLI / SLO Tracking

| SLI | Target SLO |
|---|---|
| % of messages classified within 15 min | ≥ 99.5% |
| % of AI classification calls succeeding | ≥ 99% |
| % of webhooks acknowledged within 2s | ≥ 99.9% |
| WAHA session uptime | ≥ 99.5% |
| System uptime (excluding planned maintenance) | ≥ 99.9% |

---

## 7. Security & Compliance

### 7.1 Token Management

- WAHA API Key (`WAHA_API_KEY`): stored in `.env`, never committed to Git.
- WAHA runs on internal network: bind to `127.0.0.1:3002` or an internal Docker network, never exposed publicly.
- No token exposure to frontend: all outbound calls to WAHA originate from the backend only.

### 7.2 Webhook Verification

WAHA does not sign webhooks by default. Restrict requests to trusted internal subnet or HMAC token headers:

```typescript
// Restrict webhook to WAHA internal network or HMAC token
const WAHA_ALLOWED_IPS = ['172.16.0.0/12', '192.168.0.0/16', '127.0.0.1'];
const clientIp = req.ip || req.socket.remoteAddress;

if (!WAHA_ALLOWED_IPS.some(range => ipaddr.cidrSubnet(range).contains(clientIp))) {
  logger.warn({ ip: clientIp }, 'Rejected webhook from unauthorized IP');
  return res.status(403).json({ error: 'Forbidden' });
}
```

### 7.3 Data Privacy

| Concern | Mitigation |
|---|---|
| Message content stored in DB | Implement TTL policy (auto-delete messages older than 90 days) |
| Message content sent to LLM | Use Groq/OpenAI with data retention disabled. Groq: `"user_data_retention": "none"`. OpenAI: `"usage": { "store": false }` |
| PII in logs | Strip phone numbers from log lines. Use structured logging with PII filtering |
| Media content | WAHA stores media in its container. Configure auto-download only on demand; delete after processing |

### 7.4 Data Retention Policy

```typescript
// Chunked cleanup job — runs daily at 3 AM to avoid DB table locks
cron.schedule('0 3 * * *', async () => {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;
  let batchDeleted = 0;

  do {
    const batch = await prisma.message.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: 1000,
    });
    if (batch.length === 0) break;

    const ids = batch.map(b => b.id);
    const res = await prisma.message.deleteMany({ where: { id: { in: ids } } });
    batchDeleted = res.count;
    totalDeleted += batchDeleted;
  } while (batchDeleted > 0);

  logger.info({ totalDeleted }, 'Cleaned up messages older than 90 days');
});
```

### 7.5 Rate Limiting

Protect the webhook endpoint:

```typescript
// In whatsapp-webhook.ts
import rateLimit from 'express-rate-limit';

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { error: 'Too many webhook requests' },
});

router.post('/', webhookLimiter, WhatsAppController.handleWebhook);
```

### 7.6 Compliance Checklist

- [ ] Messages stored encrypted at rest (PostgreSQL TDE or application-level encryption)
- [ ] LLM providers have signed DPAs
- [ ] User data deleted within 90 days (configurable retention)
- [ ] Webhook endpoint rate-limited and restricted to Docker network
- [ ] No WhatsApp content logged in plaintext (use `maskPhone()` and truncate body)
- [ ] API tokens rotated every 90 days
- [ ] Audit log of all classification decisions available for review

---

## 8. Ban-Proofing & Anti-Detection Strategy

With WAHA/WEBJS, you run the browser locally inside Docker. Meta's protocol-level detection targets two vectors: Automation Fingerprints (e.g., `navigator.webdriver`) and Network-Layer Behavior (e.g., instant messaging, 24/7 loops). This section covers both.

### 8.1 Browser Fingerprint Stripping

Meta's JavaScript checks for `navigator.webdriver = true` (set by Puppeteer by default). This must be explicitly disabled.

#### 8.1.1 WAHA Browser Args

Add these to your `docker-compose.yml`:

```yaml
environment:
  - WAHA_ENGINE=WEBJS
  - WAHA_PRINT_QR=true
  - WAHA_API_KEY=MyLocalSecretKey!
  # ─── Anti-detection args ───
  - WAHA_WEBJS_BROWSER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-blink-features=AutomationControlled,--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
```

| Flag | What it does |
|---|---|
| `--disable-blink-features=AutomationControlled` | Strips `navigator.webdriver = true` — the single biggest bot signal Meta checks |
| `--user-agent="..."` | Forces a standard Windows Chrome 120 UA to prevent Docker Chromium UA mismatches |
| `--no-sandbox` | Required for running Chromium as root inside Docker |
| `--disable-dev-shm-usage` | Prevents `/dev/shm` exhaustion in Docker; reduces crash risk |

#### 8.1.2 Persistent Session Storage

Repeated QR scans trigger Meta's suspicion. Mount a persistent volume:

```yaml
volumes:
  - ./waha_sessions:/app/.wwebjs_auth
```

> This keeps the WhatsApp Web session across container restarts. You only scan QR once.

### 8.2 Human Pacing & Presence Signals — Outbound Message Sending

Never send raw messages without sending read receipts (`sendSeen`) and typing indicators (`startTyping`) first, and avoid sending at fixed intervals or during non-working night hours.

```typescript
// src/modules/whatsapp/outbound.ts
export class OutboundService {
  static async sendWithJitter(chatId: string, messageBody: string) {
    // 1. Operating hours guardrail (8 AM - 10 PM local time)
    if (!this.isWithinWorkingHours()) {
      logger.info({ chatId }, 'Outside working hours. Deferring outbound message to morning queue.');
      await MessageQueueService.enqueueDelayedMorning(chatId, messageBody);
      return;
    }

    // 2. Mark incoming messages as read (blue tick / read receipt)
    await fetch(`${config.WAHA_API_URL}/api/sendSeen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: config.WAHA_SESSION_NAME,
        chatId,
      }),
    });

    // Human pause after opening chat window (1–2.5 seconds)
    await sleep(randomUniform(1000, 2500));

    // 3. Simulate human typing state via WAHA API
    await fetch(`${config.WAHA_API_URL}/api/startTyping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: config.WAHA_SESSION_NAME,
        chatId,
      }),
    });

    // 4. Base typing delay proportional to message length + micro-jitter (2–6 seconds)
    const typingDelay = Math.min(Math.max(messageBody.length * 50, 2000), 6000);
    await sleep(typingDelay + randomUniform(100, 900));

    // 5. Send text message via WAHA REST API
    const response = await fetch(`${config.WAHA_API_URL}/api/sendText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': config.WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: config.WAHA_SESSION_NAME,
        chatId,
        text: messageBody,
      }),
    });

    return response;
  }

  private static isWithinWorkingHours(startHour = 8, endHour = 22): boolean {
    const currentHour = new Date().getHours();
    return currentHour >= startHour && currentHour < endHour;
  }
}

function randomUniform(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 8.3 Batch Notifications — Never Send One-Off Alerts

One-off alerts for every minor event = machine-like pattern. Batch into 15-minute grouped summaries.

| Pattern | Risk | Fix |
|---|---|---|
| 1 alert → 1 message immediately | High — obvious automation | Buffer alerts for 15 min, send grouped summary |
| Status check every 5 min | High — predictable interval | Add jitter, or batch into heartbeat digests |
| 24/7 message flow at night | Medium — humans don't message at 3 AM | Defer non-urgent night messages to morning queue |

```typescript
// src/modules/whatsapp/batcher.ts
export class NotificationBatcher {
  private static buffer: Map<string, string[]> = new Map();

  static addAlert(chatId: string, alert: string) {
    if (!this.buffer.has(chatId)) this.buffer.set(chatId, []);
    this.buffer.get(chatId)!.push(alert);
  }

  static async flushAll() {
    for (const [chatId, alerts] of this.buffer.entries()) {
      if (alerts.length === 0) continue;
      const summary = `📋 *Batch Summary*\n\n${alerts.map((a, i) => `${i + 1}. ${a}`).join('\n')}`;
      await OutboundService.sendWithJitter(chatId, summary);
    }
    this.buffer.clear();
  }
}

// Flush every 15 minutes
cron.schedule('*/15 * * * *', () => NotificationBatcher.flushAll());
```

### 8.4 Connection Hygiene

| Practice | Why |
|---|---|
| Do NOT restart WAHA unnecessarily | Each reconnect sends a new WebSocket handshake to Meta; excessive reconnects look suspicious |
| Use persistent sessions (`./waha_sessions`) | Avoids repeated QR scans — each scan is a signal to Meta |
| Keep WAHA on a single egress IP | Sending from multiple IPs for the same number flags the account |
| Schedule daily WAHA restart during low activity | Humans don't stay connected 24/7. Restart once daily at 4 AM (lowest message volume) |
| Do NOT run multiple WAHA instances for the same number | Each instance = parallel WebSocket connection = protocol violation |

### 8.5 Message Velocity Limits & Account Warm-Up Schedule

#### 8.5.1 Account Warm-Up Schedule (For New SIMs / Sessions)

If using a newly registered SIM or fresh WhatsApp session, apply a dynamic warm-up ramp-up to avoid immediate flagging:

| Account Age | Max Outbound / Min | Max Outbound / Hour | Max New Contacts / Day |
|---|---|---|---|
| Week 1 (Days 1–7) | < 1 | < 10 | ≤ 5 |
| Week 2 (Days 8–14) | < 2 | < 20 | ≤ 15 |
| Week 3 (Days 15–21) | < 3 | < 35 | ≤ 30 |
| Week 4+ (Days 22+) | < 5 | < 60 | ≤ 50 |

#### 8.5.2 Steady-State Limits

| Activity | Safe Limit | Notes |
|---|---|---|
| Outbound messages per minute | < 5 | Higher rates trigger velocity checks |
| Outbound messages per hour | < 60 | Spread across the hour with jitter |
| New conversations initiated per day | < 50 | Cold outreach limits are stricter |
| Replies to existing conversations | No limit (within reason) | Natural back-and-forth is fine |

### 8.6 Complete WAHA docker-compose.yml

```yaml
version: '3.8'
services:
  waha:
    image: devlikeapro/waha:latest
    container_name: waha
    restart: unless-stopped
    environment:
      - WAHA_ENGINE=WEBJS
      - WAHA_PRINT_QR=true
      - WAHA_API_KEY=MyLocalSecretKey!
      - WAHA_WEBJS_BROWSER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-blink-features=AutomationControlled,--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
      - WAHA_WEBHOOKS='[{"url": "http://founder-os-backend:5000/api/whatsapp/webhook", "events": ["message"]}]'
    volumes:
      - ./waha_sessions:/app/.wwebjs_auth
    ports:
      - "3002:3002"
    networks:
      - founder-os-net
    mem_limit: 1g
    cpus: 1
```

### 8.7 Ban-Proof Checklist

- [ ] `--disable-blink-features=AutomationControlled` flag set in WAHA browser args
- [ ] Desktop User-Agent override set in WAHA browser args
- [ ] Persistent session volume mounted (`./waha_sessions:/app/.wwebjs_auth`)
- [ ] Outbound messages call `sendSeen` (read receipt) before typing
- [ ] Outbound messages call `startTyping` signal before `sendText`
- [ ] Outbound messages use randomized jitter (typing simulation + micro-jitter)
- [ ] Outbound sending guarded by working hours check (`isWithinWorkingHours`, 8 AM – 10 PM)
- [ ] Night-time messages deferred or delayed via queue workers
- [ ] Account warm-up schedule enforced for new SIMs (starting at 5 new contacts/day)
- [ ] Notifications batched into 15-minute grouped summaries (no one-off alerts)
- [ ] Message velocity stays under 5/min and 60/hour for outbound
- [ ] WAHA container NOT restarted unnecessarily
- [ ] WAHA scheduled restart daily at 4 AM
- [ ] Single egress IP for the WAHA container
- [ ] No parallel WAHA instances for the same number
- [ ] Session health monitored via health endpoint (checking `status = WORKING`)

---

## Implementation Roadmap

| Phase | Tasks | Timeline |
|---|---|---|
| P0 — Core Pipeline | WAHA docker-compose, webhook handler, message queue, AI classification prompt, heuristic fallback, DB schema migration | Week 1 |
| P1 — SLA Enforcement | SLA checker cron, alert integration (Slack), health endpoint, retry logic | Week 2 |
| P2 — Ban-Proofing | Jitter, `sendSeen` + `startTyping` emulation, notification batcher, working hours deferral, WAHA browser args, session persistence | Week 3 |
| P3 — Hardening | Rate limiting, IP allowlisting, chunked data retention cron, load testing, documentation | Week 4 |

---

## Appendix: WAHA API Reference (Quick Links)

| Resource | Endpoint | Description |
|---|---|---|
| Start Session | POST http://localhost:3002/api/sessions/default/start | Starts the default session |
| Get QR Code | GET http://localhost:3002/api/sessions/default/auth/qr | Gets QR PNG/string for initial pairing |
| Session Status | GET http://localhost:3002/api/sessions/default | Check session health (WORKING) |
| Send Read Receipt | POST http://localhost:3002/api/sendSeen | Sends blue ticks (`chatId`, `session`) |
| Start Typing Indicator | POST http://localhost:3002/api/startTyping | Emulates typing state (`chatId`, `session`) |
| Send Text Message | POST http://localhost:3002/api/sendText | Dispatches text payload (`chatId`, `text`, `session`) |
| Session Logout | POST http://localhost:3002/api/sessions/default/logout | Unlinks session without destroying config |
| Delete Session | DELETE http://localhost:3002/api/sessions/default | Removes session files & metadata |
