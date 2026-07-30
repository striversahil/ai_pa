# WhatsApp Integration — Complete Guide

This document explains the end-to-end WhatsApp flow: how messages come in, get classified, trigger actions, and how replies are sent back — all while avoiding account bans.

---

## Architecture Overview

```
Phone → WhatsApp Web → WAHA (Docker) → Backend Webhook → Redis → Batch Cron → AI/Heuristic → PostgreSQL
                                                                                              ↓
Phone ← WhatsApp Web ← WAHA ← sendWithJitter() ← OutboundService ← Backend API/Frontend
```

**Key components:**

| Component | Role | Port |
|---|---|---|
| **WAHA** | WhatsApp Web bridge (runs in Docker) | 3002 |
| **Backend** | Express server handling webhook + cron + API | 3000 |
| **Redis** | BullMQ queue + classification job storage | 6379 |
| **PostgreSQL** | Persistent storage for messages, digests, tasks | 5432 |

---

## 1. Incoming Message Flow

### 1.1 Webhook Ingestion

When someone sends a message to your WhatsApp number:

```
Phone sends "Hi, can you send me a quote for 500 units?"
  → WAHA receives via WhatsApp Web
  → WAHA POSTs to http://backend:3000/api/whatsapp/webhook

Body: {
  "event": "message",
  "payload": {
    "id": "true_1234567890@c.us_ABCDEF1234",
    "chatId": "918595563952@c.us",
    "from": "918595563952@c.us",
    "sender": { "name": "Rahul", "pushname": "Rahul Kumar" },
    "body": "Hi, can you send me a quote for 500 units?",
    "timestamp": 1698000000,
    "type": "text"
  }
}
```

### 1.2 Backend Processing

The webhook handler (`WhatsAppController.handleWebhook`) does:

```
1. Duplicate check
   Check if wahaMessageId already exists in DB
   If duplicate → return 200, skip processing

2. Extract message details
   chatId = payload.chatId || payload.from
   sender = payload.sender.name || payload.sender.pushname || "Client"
   body   = extractMessageBody(payload)
            → for text: payload.body
            → for media: "[Image]", "[Video]", "[Document: filename.pdf]", etc.
   timestamp = new Date(payload.timestamp * 1000)
   mediaType = payload.type !== "text" ? payload.type : null

3. Save to storage
   WhatsAppService.saveMessage({ chatId, sender, body, timestamp, wahaMessageId })

4. Enqueue classification
   MessageQueueService.enqueueClassification(messageId, chatId, sender, body, timestamp, mediaType)
   → Adds job to BullMQ "whatsapp-classification" queue in Redis

5. Broadcast real-time event
   broadcastWhatsAppEvent("message.received", { chatId, sender, body, timestamp })
   → Frontend receives via SSE and appends message to chat
```

### 1.3 Thundering Herd Handling

WAHA may replay a burst of messages (e.g., after reconnection). The webhook accepts `payloads: [...]` arrays:

```
POST /api/whatsapp/webhook
Body: { "payloads": [ {...}, {...}, {...} ] }

Processing:
  1. Split into batches of 10
  2. Process each batch with Promise.allSettled
  3. Wait 100ms between batches (backpressure)
  4. Each message goes through dedup → save → enqueue
```

No rate limit on the webhook — all messages are accepted and buffered in Redis.

---

## 2. Classification Pipeline

### 2.1 Batch Processing (Every 5 Minutes)

A cron job drains the Redis queue and classifies messages:

```
drainAndProcessBatch()  ← cron */5 * * * *
  │
  1. Get all waiting/active jobs from BullMQ
  2. Split into chunks of 20
  3. For each chunk (parallel):
       a. Skip if message already processed (dedup)
       b. Call ClassificationService.processSingleMessage()
  4. Remove completed jobs from queue
```

### 2.2 Single Message Classification

```
ClassificationService.processSingleMessage(messageId, chatId, sender, body, timestamp, mediaType)
  │
  1. Fetch recent messages for this chat (conversation context)
  2. If media message, prefix body with "[Image]", "[Video]", etc.
  3. Try AI classification:
       AIService.classifyMessage({ sender, body, conversationContext })
       → LLM returns { is_pending, confidence, reason, suggested_action, priority, category }
  
  4. If AI fails (rate limit, network error, no API key):
       heuristicClassify(enrichedBody)
       → Keyword matching: "urgent", "asap", "help", "quote", "price", "?"
       → Question detection: contains "?"
       → Media prefix detection
       → Default: NOT_PENDING
  
  5. Store result:
       StorageRepository.updateMessageClassification(messageId, classification, reason, classifiedAt, slaDeadline)
  
  6. If isPending:
       a. Save digest with priority, category, reason
       b. If suggested_action exists → create a Task
  
  7. Broadcast SSE "message.classified"
```

### 2.3 Classification Results

| Classification | Meaning | Example |
|---|---|---|
| `PENDING` | Requires founder attention | Quote request, complaint, meeting request |
| `NOT_PENDING` | Informational, no action needed | "Good morning", "Thanks", "Okay" |

### 2.4 SLA Monitoring

Every message must be classified within 15 minutes:

```
SLAChecker.check()  ← cron * * * * * (every minute)
  │
  1. Find messages where classifiedAt IS NULL AND slaDeadline < now
  2. If breaches found → send Slack alert via webhook
  3. Auto-resolve after 30 minutes
```

---

## 3. Digest & Summarization

### 3.1 Digest Generation (Every 5 Minutes)

```
DigestService.processMessagesToDigests()  ← cron */5 * * * *
  │
  1. Fetch all unprocessed messages
  2. Group by chatId
  3. For each chat:
       a. Check if a previous digest exists for this chat
       
       b. If YES → incremental mode:
            AIService.incrementalSummarizeConversation(
              chatName, newMessages, previousSummary, previousPriority, previousActionItems
            )
            → LLM receives only new messages + previous context
            → Returns updated summary, priority, action items
            → ~80% token reduction vs full summarization
       
       c. If NO → full mode:
            AIService.summarizeConversation(chatName, allMessages)
            → LLM receives complete conversation
            → Returns full summary
       
       d. Save digest to database
       e. Extract action items → create Tasks
       f. Mark messages as processed
```

### 3.2 Digest Output

```json
{
  "chatName": "Rahul (Investor)",
  "summary": "Rahul followed up on Q3 growth figures and requested a meeting at 10 AM tomorrow.",
  "priority": "high",
  "category": "Investor",
  "sentiment": "neutral",
  "requires_founder": true,
  "action_items": [
    { "task": "Update pitch deck with latest revenue run-rate", "owner": "Founder", "deadline": "2026-07-31" }
  ],
  "suggested_reply": "Thanks Rahul, I'll have the revised deck ready by tonight."
}
```

---

## 4. Outbound Messaging (Sending Replies)

### 4.1 How to Send a Message

**From the frontend:**
The chat composer sends `POST /api/whatsapp/send` with:
```json
{ "chatId": "918595563952@c.us", "message_body": "Sure, I'll send the quote shortly." }
```

**From code:**
```typescript
import { OutboundService } from '../modules/whatsapp/outbound';
const result = await OutboundService.sendWithJitter(chatId, messageBody);
// result: 'sent' | 'rate_limited' | 'outside_hours'
```

### 4.2 Ban-Proof Send Sequence

Every outbound message follows this exact sequence to avoid WhatsApp account restrictions:

```
sendWithJitter(chatId, "Sure, I'll send the quote.")
  │
  ├── 1. Per-chat mutex check
  │     If another send is in progress for this chat, wait for it to finish
  │     (prevents concurrent sends that look bot-like)
  │
  ├── 2. Rate limit check — CHAT level
  │     Max 15 messages per rolling 60 seconds per chat
  │     If exceeded → returns 'rate_limited', retry in next drain cycle
  │
  ├── 3. Rate limit check — ACCOUNT level
  │     Max ~175 messages per rolling hour (randomized 150-200)
  │     If exceeded → returns 'rate_limited', retry in next drain cycle
  │
  ├── 4. Working hours check
  │     8:00 AM – 10:00 PM only
  │     If outside → enqueue to morning queue (sends at 8 AM next day)
  │     Returns 'outside_hours'
  │
  ├── 5. sendSeen → POST /api/sendSeen
  │     Marks message as "read" in WhatsApp
  │
  ├── 6. Sleep 1.0–2.5s (random uniform)
  │     Natural pause before "typing"
  │
  ├── 7. startTyping → POST /api/startTyping
  │     Shows typing indicator in chat
  │
  ├── 8. Typing delay (length-proportional + jitter)
  │     base     = messageBody.length × 50ms (capped 2000-6000ms)
  │     jitter   = random 500-3000ms
  │     total    = base + jitter
  │     Example: "Hi" (2 chars)     → 2000 + 500-3000 = 2.5-5.0s
  │              "Quote for 500..." (50 chars) → 2500 + 500-3000 = 3.0-5.5s
  │              Long message (120+ chars) → 6000 + 500-3000 = 6.5-9.0s
  │
  ├── 9. sendText → POST /api/sendText
  │     Actual message delivery
  │
  └── 10. Returns 'sent'
```

### 4.3 Rate Limit Flow Diagram

```
sendWithJitter called
  │
  ├── per-chat mutex → queue if busy
  │
  ├── chat rate limit (15/min)?
  │     ├── under → continue
  │     └── over  → return 'rate_limited'
  │                  → if called from drainMorningQueue: job stays, retries in 5 min
  │                  → if called from batcher: alerts re-buffered, retries in 15 min
  │
  ├── account rate limit (~175/hr)?
  │     ├── under → continue
  │     └── over  → return 'rate_limited' (same retry as above)
  │
  ├── working hours (8AM-10PM)?
  │     ├── yes  → send with jitter sequence
  │     └── no   → enqueueDelayedMorning → returns 'outside_hours'
  │                  → job fires at 8 AM next day via drainMorningQueue
  │
  └── sent successfully → return 'sent'
```

### 4.4 Morning Queue Drain

Every 5 minutes during working hours:

```
drainMorningQueue()  ← cron */5 * * * *
  │
  1. Get all due jobs from morning queue (delayed + waiting)
  2. For each job:
       a. Call sendWithJitter(chatId, messageBody)
       b. If result === 'sent' → remove job from queue
       c. If result === 'rate_limited' → keep job, retry next cycle
       d. If result === 'outside_hours' → keep job (enqueueDelayedMorning updated the delay)
```

### 4.5 Notification Batcher

Notifications (digest alerts, SLA warnings) are grouped to avoid flooding:

```
NotificationBatcher.addAlert(chatId, "New message from Rahul")
  → Buffered in Map<chatId, string[]>

NotificationBatcher.flushAll()  ← cron */15 * * * *
  → For each chat: batch all alerts into one summary message
  → sendWithJitter(chatId, "Batch Summary\n\n1. New message from Rahul\n2. ...")
  → If rate_limited: re-buffer alerts for next flush
```

---

## 5. Real-Time Updates (SSE)

The frontend receives live updates via Server-Sent Events:

```
GET /api/whatsapp/events
  → Opens persistent SSE connection

Events:
  message.received:
    → Frontend appends message to active chat
    → Refreshes digests + contacts

  message.classified:
    → Frontend refreshes digests + contacts
    → Fetches updated messages for active chat
```

---

## 6. Monitoring & Health

### 6.1 Health Endpoint

```
GET /api/health/whatsapp

Response:
{
  "status": "healthy" | "degraded",
  "waha": { "status": "WORKING" | "STOPPED" | "unreachable" },
  "metrics": {
    "unprocessedMessages": 0,
    "slaBreaches": 0,
    "pendingItems": 0,
    "lastWebhookAt": "2026-07-30T10:00:00.000Z",
    "lagMs": 5000
  }
}
```

### 6.2 Cron Jobs

| Job | Schedule | What it does |
|---|---|---|
| Classification batch | `*/5 * * * *` | Drain Redis queue, classify messages |
| Digest generation | `*/5 * * * *` | Group unprocessed messages, summarize via LLM |
| Morning queue drain | `*/5 * * * *` | Send deferred outbound messages |
| SLA check | `* * * * *` | Detect SLA breaches, alert via Slack |
| Notification batcher flush | `*/15 * * * *` | Send grouped notifications |
| Data retention | `0 3 * * *` | Purge messages older than 90 days |
| WAHA restart | `0 4 * * *` | Prevent session staleness |

---

## 7. Anti-Detection Summary

All measures taken to avoid WhatsApp account restrictions:

| Measure | Detail |
|---|---|
| **sendSeen before typing** | Simulates natural "opening" behavior |
| **Typing indicator** | Shows WhatsApp typing before every message |
| **Length-proportional typing delay** | Longer messages = longer "typing" time |
| **Random jitter** | ±1250ms variance on typing time |
| **Per-chat mutex** | Messages to same chat never overlap |
| **Chat rate limit** | Max 15 messages per chat per minute |
| **Account rate limit** | Max ~175 messages per hour (randomized 150-200) |
| **Working hours only** | Messages only sent 8AM–10PM |
| **Night deferral** | After-hours messages queued for 8AM next day |
| **Daily WAHA restart** | Prevents 24/7 connection fingerprint at 4AM |
| **Desktop user agent** | `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)...` |
| **`--disable-blink-features=AutomationControlled`** | Hides automation flag from browser |

---

## 8. API Endpoints

### WhatsApp Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/api/whatsapp/webhook` | WAHA message ingestion | None (internal) |
| `GET` | `/api/whatsapp/events` | SSE real-time stream | None |
| `POST` | `/api/whatsapp/send` | Send reply with ban-proof sequence | None |
| `GET` | `/api/whatsapp/contacts` | List contacts | None |
| `GET` | `/api/whatsapp/contacts/:uid/messages` | Message history for a contact | None |
| `POST` | `/api/whatsapp/contacts/:uid/summarize` | Generate on-demand digest | None |

### General Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/digests` | All conversation digests |
| `GET` | `/api/tasks` | Extracted action items |
| `GET` | `/api/health/whatsapp` | WAHA + SLA health metrics |
| `POST` | `/api/trigger/digest` | Force digest generation |

---

## 9. Quick Start

```bash
# 1. Start infrastructure
docker compose up -d postgres redis waha

# 2. Check WAHA status
curl http://localhost:3002/api/sessions/default
# → {"name":"default","status":"STOPPED"}

# 3. Scan QR code (open in browser)
echo "http://localhost:3002/api/sessions/default/auth/qr"

# 4. Verify session is connected
curl http://localhost:3002/api/sessions/default
# → {"name":"default","status":"WORKING"}

# 5. Run migrations
npx prisma migrate dev

# 6. Start backend
pnpm dev

# 7. Send a test message from your phone
#    Check it arrived:
curl http://localhost:3000/api/health/whatsapp

# 8. Wait up to 5 min for classification, then:
curl http://localhost:3000/api/digests
```

---

## 10. Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `WAHA_API_URL` | `http://localhost:3002` | WAHA REST API |
| `WAHA_API_KEY` | `MyLocalSecretKey!` | WAHA auth key |
| `WAHA_SESSION_NAME` | `default` | WAHA session |
| `REDIS_HOST` | `localhost` | Redis for BullMQ |
| `REDIS_PORT` | `6379` | Redis port |
| `MESSAGE_SLA_MINUTES` | `15` | Classification SLA |
| `SLACK_WEBHOOK_URL` | — | Slack alerts on SLA breach |
| `DATABASE_URL` | — | PostgreSQL (absent = in-memory mode) |
| `LLM_API_KEY` | — | Groq/OpenAI key (absent = heuristic only) |