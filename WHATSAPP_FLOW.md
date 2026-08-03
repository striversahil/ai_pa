# WhatsApp Integration — Complete Guide (Hardened)

This document explains the end-to-end WhatsApp flow in the **founder-os_backend** project: how messages come in, get classified, trigger actions, and how replies are sent back — with every anti-ban hardening and durability mechanism that has been applied. It is the single source of truth for a future engineer/AI to understand and operate the system.

> **Last updated: 2026-08-03.** Reflects the current production state: webhook relay (always-on disk-backed sink), persistent Redis, outbound-intent durability, persisted rate-limit state, orphan recovery, drain locks, message-buffer re-queue, allowlist gate, LID normalization, global send lock, etc.

---

## Architecture Overview

```
Phone → WhatsApp Web → WAHA (Docker) → Webhook Relay (Docker) → Backend Webhook → 200 + buffer → Redis (BullMQ) → AI/Heuristic → PostgreSQL
                                                                                       ↓ (relay holds on disk when backend is down)
Phone ← WhatsApp Web ← WAHA ← sendWithJitter() ← OutboundService ← Backend API/Frontend   (allowlist-gated, global lock)
```

**Components & live ports in this deployment:**

| Component | Role | Address |
|---|---|---|
| **WAHA** | WhatsApp Web bridge (Docker, WEBJS engine) | `127.0.0.1:3002` (host) |
| **webhook-relay** | Always-on dead-letter sink: acks WAHA instantly, persists payloads to a disk write-ahead log, forwards to the backend | `127.0.0.1:5099` (host) |
| **Backend** | Express + TS, runs via `npx ts-node src/server.ts` | `0.0.0.0:5000` (host) |
| **Redis** | BullMQ queues + AOF persistence (named volume) | `6379` (host) |
| **PostgreSQL** | Persistent storage (messages, digests, tasks, contacts, outbound intents) | `5432` |

**How the backend runs (important):**
- The backend is **not** run as the compose `backend` container in practice — it runs on the host under a supervisor shell: `while true; do npx ts-node src/server.ts; echo 'Backend crashed, restarting in 2s...'; sleep 2; done`. This auto-restarts it on crash.
- Backend startup sequence (`server.ts`): `app.listen()` → `await waitForWahaSession()` (polls `GET /api/sessions/default` every 3s up to 180s until `status === "WORKING"`) → `SchedulerService.init()` → `MessageQueueService.startWorker()`.

**Why a relay (instead of WAHA → backend directly, or polling WAHA):**
- WAHA's webhook retry window is ~4 minutes (120 attempts × 2s). If the backend is down longer, WAHA *drops* the event permanently.
- We deliberately do **not** poll WAHA's chat store to recover missed messages (fragile, heavy, and it re-introduces a direct WAHA dependency for reads).
- The relay is a tiny zero-dependency Node container (`webhook-relay/relay.js`) that is always up (`restart: unless-stopped`). It ack's WAHA `200` **before** the backend is involved, so WAHA never retries; every payload is appended to a durable write-ahead log on disk and replayed to the backend when it's reachable. A multi-hour backend outage = messages wait on disk, nothing is lost.

---

## 1. Incoming Message Flow

### 1.1 Webhook Ingestion

WAHA POSTs to `http://host.docker.internal:5099/api/whatsapp/webhook` (**the relay**, not the backend) for every inbound `message` event.

```
Phone sends "Hi, can you send me a quote for 500 units?"
  → WAHA receives via WhatsApp Web
  → WAHA POSTs to http://host.docker.internal:5099/api/whatsapp/webhook   (relay)
  → relay acks 200 immediately + appends payload to .runtime/webhook-relay.log
  → relay forwards to http://host.docker.internal:5000/api/whatsapp/webhook (backend)
  → if the backend is down, the payload waits on disk and is retried every ~2s
```

Example body WAHA sends to the relay (relay forwards it byte-for-byte):

```
Body: {
  "event": "message",
  "payload": {
    "id": { "id": "true_1234567890@c.us_ABCDEF1234" },   // id may be string OR {id: ...} envelope
    "chatId": "918595563952@c.us",                        // may arrive as a @lid in WEBJS!
    "from": "918595563952@c.us",
    "sender": { "name": "Rahul", "pushname": "Rahul Kumar" },
    "body": "Hi, can you send me a quote for 500 units?",
    "timestamp": 1698000000,
    "type": "text"
  }
}
```

### 1.2 Backend Processing (`WhatsAppController.handleWebhook`)

The handler returns **HTTP 200 immediately** (before any parsing/validation/DB work) so WAHA never enters its retry loop. All processing happens in a background IIFE.

```
1. Respond 200 { success: true }                       ← non-blocking, stops WAHA retries

2. Identify format:
   - WAHA:   { event: "message", payload }
   - Burst:  { payloads: [...] }                       ← thundering-herd replay array
   - Legacy: currentMessage / message+contact / WhatsJet — kept for backwards compat

3. Per message (processWahaMessage):
   a. Skip if payload.fromMe (our own sent messages never re-ingested)
   b. Dedup cache: recentMessageIds (Map, cap 10_000, 1h expiry) on wahaMessageId → skip if seen
   c. Normalize chatId: if individual chat arrives as @lid, resolve to @c.us via WAHA
      contacts endpoint (cached per LID). LID → @c.us is how WEBJS addresses chats now.
      Contact/group name lookups are also memoized (1h TTL, incl. misses) so the
      WAHA contacts/groups API is NOT hit on every message.
   d. Extract: sender, body (media → "[Image]"/"[Video]"/"[Document: x]"/etc.), timestamp, mediaType
   e. Quoted/reply context: payload.replyTo (WEBJS) → { quotedMessageId, quotedBody, quotedSender }
      (fallback: payload.quotedMsg). Stored on the Message row so the dashboard can
      render the "replied to" bubble; also sent over SSE and fed into AI summaries.
   f. Age gate: now - timestamp > 120s → isHistorical = true
      - Historical replays: saved to DB but skip SSE, skip classification, skip unread increment
   g. Broadcast SSE message.received (only if not historical)
   h. upsertContact (sets hasInbound = true) + AuditService.record
   i. messageBuffer.push({ ... })                       ← batched write-behind
```

### 1.3 Message Buffer (write-behind, idempotent)

`message-buffer.ts` — inbound messages are **not** written one-by-one. They are buffered and flushed as one batch:

- **Flush trigger:** 50 messages buffered **or** 3 seconds elapsed.
- **Write:** `prisma.message.createManyAndReturn({ skipDuplicates: true })` → `INSERT ... ON CONFLICT DO NOTHING` on the unique `wahaMessageId`.
- **Only newly-created rows** get classification enqueued; duplicates and `isHistorical` rows are skipped.
- If Postgres is unavailable (`useInMemoryDb`), falls back to per-message inserts.
- **Durability:** if a flush fails (Postgres down), the batch is **re-queued to the front of the buffer** and retried every 5s (bounded at 10k buffered — beyond that, oldest are dropped with an error log). A DB outage delays writes; it does not silently drop in-flight messages.
- **If Redis is down mid-flush:** the INSERT succeeds but `enqueueClassification` throws. Those rows sit `processed=false` with no job — the orphan-recovery sweep (Section 2.1) re-enqueues them.

Result: replay storms are de-duplicated atomically, the DB is never hammered, and no inbound message is lost to a transient backend/DB/Redis failure.

---

## 2. Classification Pipeline

### 2.1 Delivery paths & recovery

- **Worker** (`MessageQueueService.startWorker`): BullMQ `whatsapp-classification` worker, concurrency 5, runs on boot — the primary path. It re-checks the DB `processed` flag before classifying (idempotency guard).
- **Orphan recovery** (`recoverOrphanedMessages`, cron `*/2`): re-enqueues messages that are `processed=false`, non-historical, and older than 2 minutes but have no job — i.e. the Redis-down-during-flush case. Safe to run repeatedly because classification writes are **atomic** (`updateMany WHERE processed=false`), so only the first of two racing jobs wins.
- `drainAndProcessBatch` (legacy batch drain) is **no longer scheduled** — the BullMQ worker covers it.

### 2.2 Single Message Classification

```
ClassificationService.processSingleMessage(messageId, chatId, sender, body, timestamp, mediaType)
  1. Fetch recent messages for the chat (conversation context)
  2. Try AI: AIService.classifyMessage({...}) → { is_pending, confidence, reason, ... }
  3. On AI failure (rate limit/network/no key) → heuristicClassify() (keywords, "?", media prefix)
  4. Store classification + SLA deadline on the Message row
  5. If PENDING → save digest; if suggested action → create Task
  6. Broadcast SSE "message.classified"
```

### 2.3 Classification Result

| Classification | Meaning |
|---|---|
| `PENDING` | Requires founder attention (quote request, complaint, meeting) |
| `NOT_PENDING` | Informational (thanks, ok, good morning) |

### 2.4 SLA Monitoring

`SLAChecker.check()` every minute — flags messages missing classification past their 15-min `slaDeadline`, alerts via Slack, auto-resolves after 30 min.

---

## 3. Digest & Summarization

Every 5 minutes, unprocessed messages are grouped by chat and summarized (incremental mode reuses the previous summary to cut ~80% tokens; full mode for new chats). Digests persist to PostgreSQL and action items become Tasks. `GET /api/digests` and `GET /api/tasks` expose them.

---

## 4. Outbound Messaging (Sending Replies) — Anti-Ban Core

### 4.1 How to Send

- **Frontend:** `POST /api/whatsapp/send` with `{ "chatId", "message_body" }`.
- **Code:** `OutboundService.sendWithJitter(chatId, messageBody)` → `'sent' | 'rate_limited' | 'outside_hours' | 'failed'`.

**chatId validation** (`/api/whatsapp/send`): must end with `@c.us`, `@g.us`, or `@lid`; `@c.us` must be `countrycode + 10 digits`, no `+` sign.

### 4.2 Allowlist Gate (rejected UPFRONT)

Only chats that have **ever messaged us** can receive outbound messages. This is the zero-cold-outreach enforcement.

```
POST /api/whatsapp/send  (also /api/whatsapp-proxy/send)
  → validate chatId format
  → StorageRepository.hasInboundMessages(chatId)?
        NO  → HTTP 403 { success:false, error: "chatId is not allowlisted: ..." }
              (no message saved, no WAHA call, no queue entry — verified in logs)
        YES → proceed to saveMessage + sendWithJitter
```

- **Signal:** `Contact.hasInbound` — a **persistent** boolean on the never-pruned Contact table, set to `true` the first time a chat sends us anything.
- It is NOT derived from Message rows at check time (the 90-day retention would otherwise silently reset who is allowed).
- If no Contact row exists yet, it falls back to checking Message history.
- Backfilled once from existing inbound message rows (20 contacts at migration).

### 4.3 LID ↔ @c.us (WEBJS quirk)

WEBJS increasingly addresses individual chats by **LID** (`32070705410048@lid`) instead of phone (`918595563952@c.us`).

- **Ingestion:** LID chatIds are resolved to `@c.us` via `GET /api/{session}/contacts/{lid}` (WAHA returns `id: "<phone>@c.us"`), cached per LID in `controller.ts` (`resolveLidToCus`).
- **Why:** sends target `@c.us`; the allowlist, message history, and Contact table all key on `@c.us`. Without normalization, a chat that messaged us under its LID would look "never messaged" and get blocked.

### 4.4 Ban-Proof Send Sequence (`outbound.ts`)

```
sendWithJitter(chatId, body)
  │
  ├── 0. BURST GUARD: if pendingSendCount >= 25 → return 'rate_limited' (caller defers).
  │        An accidental 5K–10K push can never flood the send chain or WhatsApp.
  │
  ├── GLOBAL LOCK: every send chains onto a single account-wide promise
  │        (globalSendLock). No two messages are EVER sent at the same time to
  │        any recipient, no matter how many are queued. Verified: 5 parallel
  │        requests fired within µs landed 5.5–6s apart at WAHA.
  │
  └── executeSend(chatId, body)
       ├── 1. Chat rate limit: max 15 msgs / rolling 60s per chat → 'rate_limited'
       ├── 2. Account rate limit: max 50±10 (40–60) msgs / rolling hour → 'rate_limited'
       │        (hourly cap recomputed each hour with jitter)
       │        COUNTERS PERSIST: timestamps + the daily cap are written to
       │        .runtime/rate-limit-state.json (debounced, flushed on exit), so a
       │        backend restart right before the 8 AM burst does NOT reset the
       │        throttles to zero and re-fires at full speed.
       ├── 3. Working hours: 8:00 AM – 10:00 PM IST only.
       │        Outside → enqueueDelayedMorning() → 'outside_hours'
       │
       ├── GROUP ROUTE (@g.us):
       │        sleep 1500–2500ms → sendText
       │        (NO sendSeen, NO startTyping — groups must never get typing/
       │        presence broadcasts; verified in WAHA logs: group send = sendText only)
       │
       ├── INDIVIDUAL ROUTE (@c.us / @lid):
       │        a. sendSeen ONLY if chat.unreadCount > 0 (reading a chat we
       │           initiated is an impossible human action; if unknown, skip).
       │           On success, decrement the local unread count.
       │        b. sleep 1500–4500ms
       │        c. startTyping
       │        d. typing delay = clamp(body.length × 50ms, 2000, 6000) + jitter 1000–9000ms
       │
       ├── sendText via WAHA
       │        ALL WAHA calls go through wahaFetch: 30s AbortController timeout,
       │        checks res.ok. If sendText fails → 'failed' (never "silently sent").
       │
       └── post-send cooldown sleep 2000–12000ms  → 'sent'
            (overall inter-message gap ≈ 4.5s–21s+, irregular)
```

### 4.5 Deferral & Retry (nothing is dropped, nothing is flooded)

- `/send` endpoints: on `'rate_limited'` or `'failed'` → `enqueueDelayedMorning(chatId, body, 30–60min jitter)`.
- `drainMorningQueue()` cron **every minute** (working hours only): pulls due jobs, calls `sendWithJitter`; removes the job only on `'sent'`/`'outside_hours'`; keeps it on `'rate_limited'` for the next cycle. A **drain lock** prevents two overlapping cron runs from double-sending the same job, and each cycle processes at most **60** due jobs so a giant 8 AM backlog paces itself instead of monopolizing the serialized send chain.
- Morning queue lives in **Redis (persistent)** — backend crashes don't lose it.
- **Redis-down durability (`OutboundIntent`):** if `enqueueDelayedMorning` cannot reach Redis (deferral would be lost), it instead writes an `OutboundIntent` row (`status=PENDING`, original delay preserved, deduped against rapid retries). `recoverOutboundIntents()` (cron `* * * * *`) re-deferrals PENDING intents into the morning queue once Redis is back, then marks them `ENQUEUED`. Outbound sends survive even a full Redis outage at deferral time.

### 4.6 Notification Batcher (`batcher.ts`)

Alerts are grouped per chat and flushed every 15 minutes as one summary.

- **Spin-tax:** the summary heading is one of **6 variants**, chosen by a **stable hash of the chatId** — so different recipients get different text (defeats Meta's identical-mass-text matching) while each recipient stays consistent.
- On `rate_limited`, alerts are re-buffered for the next flush.

---

## 5. Real-Time Updates (SSE)

`GET /api/whatsapp/events` opens a persistent SSE stream (implemented in both `server.ts` and `shared/sse.ts`). Events: `message.received`, `message.classified`. Disconnects are logged with a client count; if the count grows unbounded that indicates a leak — otherwise "SSE client disconnected / clientCount: 0" is normal.

---

## 6. Monitoring & Health

### 6.1 Health

`GET /api/health/whatsapp` → status (`healthy`/`degraded`), WAHA session state, metrics (unprocessed, SLA breaches, last webhook, lag).

### 6.2 Cron Jobs (SchedulerService.init)

| Job | Schedule | What it does |
|---|---|---|
| WhatsApp digest | `*/5 * * * *` | Drain classification queue, classify messages |
| Email + Brain index | `*/30 * * * *` | Email sync + RAG indexing |
| Sales Copilot (Zoho) | `*/15 * * * *` | Sync Zoho estimates + **always refresh comments** (new comments detected via comment_id; AI re-classify only when new/changed) |
| Morning founder brief | `0 8 * * *` | Daily briefing via AI |
| Evening EOD summary | `0 19 * * *` | Daily end-of-day summary |
| **Morning queue drain** | `* * * * *` | Send due deferred messages (working hours) — drain-locked, 60/cycle cap |
| **Orphaned-message recovery** | `*/2 * * * *` | Re-enqueue `processed=false` messages stuck with no job (Redis-down flush) |
| **Outbound-intent recovery** | `* * * * *` | Re-deferral persisted `OutboundIntent` rows once Redis is back |
| SLA monitor | `* * * * *` | Flag SLA breaches → Slack |
| Notification batcher flush | `*/15 * * * *` | Flush grouped alerts (spin-taxed) |
| **Data retention** | `0 3 * * *` | Delete messages older than **90 days** (batches of 1000) |
| WAHA session health monitor | `*/5 * * * *` | If session not WORKING for >1min → `POST /start` |

**Timezone:** every `cron.schedule` passes `{ timezone: 'Asia/Kolkata' }`, so all schedules fire in IST even though the host runs `Etc/UTC`. `* * * * *` / `*/N` interval jobs are timezone-independent anyway. The EOD "tasks created today" boundary also uses IST midnight (`kolkataDayStartUtc`), and the morning-queue target time is computed from IST via `nextKolkataTimeUtc`.

---

## 7. Anti-Detection Summary

| Measure | Detail |
|---|---|
| **Global account lock** | Zero simultaneous sends to any recipients — single promise chain |
| **Burst guard** | Max 25 pending sends; overflow deferred, never dropped |
| **Allowlist gate** | Only chats that messaged us can receive outbound (403 upfront) |
| **LID normalization** | LID→`@c.us` at ingestion so the allowlist never misfires |
| **Chat rate limit** | 15 msgs/chat/min |
| **Account rate limit** | 40–60 msgs/hour (50±10 jitter) |
| **Working hours only** | 8AM–10PM IST; nights deferred to 8AM queue |
| **Group protocol bypass** | `@g.us` skips sendSeen/startTyping entirely |
| **Conditional read receipts** | sendSeen only when the chat actually has unread |
| **Human typing simulation** | length-based delay + 1–9s jitter |
| **Post-send cooldown** | 2–12s irregular gap between messages (4.5–21s+ total) |
| **Honest failures** | `failed` on WAHA errors; deferred to retry, never silently dropped |
| **Content spin-tax** | Batch headings vary per recipient (hash-stable) |
| **Webhook instant 200** | No WAHA retry loops |
| **Idempotent ingestion** | unique `wahaMessageId` + `ON CONFLICT DO NOTHING` |
| **120s historical barrier** | old replay packets never trigger real-time actions |
| **Retention 90 days** | Never resets the allowlist (flag lives on Contact, not Message) |
| **Anti-automation browser flags** | `--disable-blink-features=AutomationControlled` + WebGL/ANGLE flags |

---

## 8. API Endpoints

### WhatsApp

| Method | Path | Purpose | Notes |
|---|---|---|---|
| `POST` | `/api/whatsapp/webhook` | Backend ingestion (reached via the webhook relay at `:5099`) | Returns 200 before processing |
| `GET` | `/api/whatsapp/events` | SSE stream | |
| `POST` | `/api/whatsapp/send` | Send reply | **403 if not allowlisted**; validates format |
| `GET` | `/api/whatsapp/contacts` | List contacts | includes `hasInbound` |
| `GET` | `/api/whatsapp/contacts/:uid/messages` | Message history | |
| `POST` | `/api/whatsapp/contacts/:uid/summarize` | On-demand digest | |
| `POST` | `/api/whatsapp-proxy/send` | Alternate send route | same allowlist gate |

### General

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/digests` | Conversation digests |
| `GET` | `/api/tasks` | Action items |
| `GET` | `/api/health/whatsapp` | WAHA + SLA health |
| `POST` | `/api/trigger/digest` | Force digest generation |

---

## 9. Infrastructure & Docker (docker-compose.yml in founder-os_backend)

| Service | Image | Key config |
|---|---|---|
| `waha` | `devlikeapro/waha:latest-2026.7.2` (**pinned**) | `WAHA_ENGINE=WEBJS`, `TZ=Asia/Kolkata`, `WAHA_WEBHOOK_CONCURRENCY=5`, `WAHA_WEBJS_PUPPETER_ARGS=--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-blink-features=AutomationControlled --use-gl=angle --use-angle=swiftshader-webgl --enable-webgl --ignore-gpu-blocklist --enable-unsafe-swiftshader`, `WHATSAPP_HOOK_URL=http://host.docker.internal:5099/api/whatsapp/webhook` (**relay**), `WHATSAPP_HOOK_RETRIES_POLICY=constant`, `WHATSAPP_HOOK_RETRIES_DELAY_SECONDS=2`, `WHATSAPP_HOOK_RETRIES_ATTEMPTS=120`, volume `./waha_sessions:/app/.sessions`, `mem_limit: 2g`, `cpus: 1`, `stop_grace_period: 30s`, port `127.0.0.1:3002:3000` |
| `webhook-relay` | `node:20-alpine` | Zero-dep `relay.js` (bind-mounted from `../webhook-relay`); `RELAY_BACKEND=http://host.docker.internal:5000`, `RELAY_LOG_DIR=/runtime` (writes `webhook-relay.log` + `.offset`), healthcheck `wget 127.0.0.1:5099/health` (use **IPv4**, busybox wget on `localhost` fails via `::1`), port `127.0.0.1:5099:5099`, `restart: unless-stopped` |
| `redis` | `redis:7-alpine` | `redis-server --appendonly yes --appendfsync everysec`, `TZ=Asia/Kolkata`, volume `redisdata:/data` (**persistent** — named volume + AOF) |
| `postgres` | `postgres:16-alpine` | `TZ=Asia/Kolkata`, volume `pgdata` (container `founder-os-db`, managed by a **separate** compose project `ai_pa`) |
| `backend` | build | `TZ=Asia/Kolkata` (defined but backend actually runs on host via ts-node) |

**Log rotation:** every service uses `logging: json-file, max-size: 10m, max-file: 3`.

### Environment Variables (config/index.ts)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Backend listen port (deployed as `5000`) |
| `WAHA_API_URL` | `http://localhost:3002` | WAHA REST API |
| `WAHA_API_KEY` | `MyLocalSecretKey!` | WAHA auth |
| `WAHA_SESSION_NAME` | `default` | WAHA session |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | BullMQ Redis |
| `DATABASE_URL` | — | PostgreSQL (absent = in-memory mode) |
| `MESSAGE_SLA_MINUTES` | `15` | Classification SLA |
| `SLACK_WEBHOOK_URL` | — | Slack alerts |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | — | LLM for classification/summaries |
| `EMAIL_*`, `NOTION_*` | — | Email/Notion modules |

---

## 10. Operations Runbook

### 10.1 Start everything

```bash
cd /home/sahil/development/ai_pa/founder-os_backend
docker compose up -d webhook-relay redis waha    # postgres is actually in the ai_pa project
npx ts-node src/server.ts                        # under the supervisor while-loop in production
```

`start.sh` automates all of this (including the Redis volume/AOF guard and the relay healthcheck); on `docker compose up` always target specific services — never bare `up -d` (see gotcha 6).

### 10.2 WAHA session & QR

- Session `default` should be **WORKING** (`curl http://127.0.0.1:3002/api/sessions/default -H "X-Api-Key: MyLocalSecretKey!"`).
- **A QR scan is only needed if the saved auth is gone.** The auth lives in `founder-os-backend/waha_sessions/webjs/default/session-default/` — never delete it.
- QR if required: open `http://127.0.0.1:3002/api/sessions/default/auth/qr` and scan.

### 10.3 Session recovery (IMPORTANT — the bind-mount trap)

**Symptom:** WAHA returns `Session not found` / `/api/sessions` = `[]` even though `waha_sessions/` has data on the host. The host data is intact — the container is just not seeing it.

**Root cause (seen in production):** the container's `/app/.sessions` was mounted as a **tmpfs**, not the bind. Verify with:
```bash
docker exec waha mount | grep sessions        # must be /dev/* type ext4, NOT "tmpfs"
docker exec waha sh -c 'echo x > /app/.sessions/probe.txt' && ls founder-os_backend/waha_sessions/probe.txt
```

**Fix without a QR rescan:**
```bash
docker stop waha
docker compose rm -sf waha            # removes the container + its tmpfs
docker compose up -d waha             # recreates; bind re-attaches to the host dir
# verify mount is ext4 (not tmpfs) BEFORE trusting it, then poll:
curl http://127.0.0.1:3002/api/sessions/default -H "X-Api-Key: MyLocalSecretKey!"   # → WORKING, me set
```

### 10.4 Backup the session (root-owned files)

`waha_sessions` files are root-owned (created by the container). Back up **inside the container** and pull the archive out:
```bash
docker exec waha sh -c 'tar czf /tmp/ws.tar.gz -C /app/.sessions . 2>/dev/null; true'
docker cp waha:/tmp/ws.tar.gz /home/sahil/waha_sessions_backup.tar.gz
docker exec waha rm /tmp/ws.tar.gz
tar -tzf /home/sahil/waha_sessions_backup.tar.gz >/dev/null && echo VALID   # verify
# restore: tar -xzf ~/waha_sessions_backup.tar.gz -C founder-os_backend/waha_sessions
```

### 10.5 Database migration caveat (prisma)

- `prisma db push` / `migrate` is **blocked** because `schema.prisma` is missing the `BrainContext` model — a full sync would drop the RAG `embedding` column.
- Use **targeted SQL** for schema changes instead:
  ```bash
  npx prisma db execute --stdin <<< 'ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "hasInbound" BOOLEAN NOT NULL DEFAULT false;'
  npx prisma generate
  ```
- Column additions are written to both `schema.prisma` and applied via ALTER.

### 10.6 Restart the backend

The backend is a host process under a supervisor `while true` loop. Restart it by killing the ts-node process; it auto-restarts in ~2s:
```bash
kill "$(ss -tlnp 2>/dev/null | grep 5000 | grep -oP 'pid=\K[0-9]+' | head -1)"
```

### 10.7 Webhook relay ops

- **Health:** `curl http://127.0.0.1:5099/health` → `ok`. If the container shows `unhealthy`, it's almost always the IPv4/IPv6 healthcheck trap (fix is in compose).
- **Buffer location:** `founder-os_backend/.runtime/webhook-relay.log` (append-only JSONL) + `.runtime/webhook-relay.offset` (bytes already forwarded). A live count of held messages: `wc -l < .runtime/webhook-relay.log`.
- **Manual drain:** the relay drains automatically every ~2s; if it's stuck behind a long backend outage it resumes on its own once the backend answers.
- **To reset the buffer** (e.g. after a disk/data fix): stop the relay, delete both files, `docker compose up -d webhook-relay`. Only do this when you intend to drop the held payloads.
- **Log rotation:** the relay truncates the log to 0 bytes whenever it fully drains; it never grows unbounded in steady state.

---

## 11. Known Gotchas

1. **LID vs @c.us:** inbound individual chats may arrive as `@lid`. Normalization (Section 4.3) handles it; the allowlist and history key on `@c.us`.
2. **`hasInbound` never resets:** retention prunes Message rows, never Contact. Don't "optimize" the allowlist back to scanning Message rows or customers get locked out after 90 days.
3. **Global lock ≠ per-chat:** the account-wide promise chain serializes everything. Do not replace it with per-chat locks — that reintroduces simultaneous sends.
4. **Groups must stay silent:** never add startTyping/sendSeen to `@g.us`. Verified in WAHA logs: a group send emits only `sendText`.
5. **`WAHA_WEBJS_PUPPETER_ARGS` is the real env var** (space-separated, parsed by WebJSEngineConfigService). `WAHA_CHROME_ARGS` does not exist; `WAHA_WEBJS_BROWSER_ARGS` is never read.
6. **Don't run `docker compose up -d` (bare):** it would try to create the `backend` container and conflict with the host-run backend on port 5000. Use service-specific targets (`docker compose up -d waha redis`).
7. **Pinned image `latest-2026.7.2`** matched the running digest exactly — pinning was a zero-change no-op. On upgrade, update the tag deliberately.
8. **Redis is persistent now** (AOF + volume). Morning/classification jobs survive container recreates.
9. **WAHA webhooks go to the relay, not the backend.** If you change `WHATSAPP_HOOK_URL` back to `:5000` you lose the hold-on-disk guarantee. The relay forwards to the backend's IP-allowlisted webhook; its container egress (docker bridge `172.28.x.x`) is inside `172.16.0.0/12` so it passes.
10. **Relay healthcheck must use `127.0.0.1`**, not `localhost` — the relay binds IPv4 only, and busybox `wget` resolves `localhost` to `::1` → connection refused → container marked unhealthy.
11. **Rate-limit state is a file** (`.runtime/rate-limit-state.json`), not Redis — by design, so throttling still works when Redis is down. It's gitignored; don't commit it.
12. **`OutboundIntent` table:** created via `prisma db execute` (never `db push`). If you recreate the DB from scratch, re-run the `CREATE TABLE "OutboundIntent"` DDL in the schema's matching migration.
13. **Orphan/intent sweeps are idempotent** because the storage layer uses atomic `updateMany WHERE processed=false` — safe to run every minute, no double-classification.
