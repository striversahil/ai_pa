# Getting Started — WhatsApp + AI Classification Pipeline

This guide walks you through running the full stack locally to test the WhatsApp message ingestion and AI classification system.

## Prerequisites

- Docker & Docker Compose
- Node.js 20+
- pnpm
- A secondary WhatsApp number (for testing)

---

## 1. Start Infrastructure

Launch PostgreSQL, Redis, and the WAHA WhatsApp bridge:

```bash
docker compose up -d postgres redis waha
```

Check they're running:

```bash
docker compose ps
```

Verify WAHA is ready:

```bash
curl http://localhost:3002/api/sessions/default
# → {"name":"default","status":"STOPPED"}
```

---

## 2. Configure Environment

Ensure your `.env` has the correct values for local Docker networking:

```env
DATABASE_URL=postgresql://founder:founder_secret@localhost:5432/founder_os
LLM_API_KEY=your_groq_api_key           # Optional — falls back to heuristics
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
WAHA_API_URL=http://localhost:3002
WAHA_API_KEY=MyLocalSecretKey!
WAHA_SESSION_NAME=default
REDIS_HOST=localhost
REDIS_PORT=6379
MESSAGE_SLA_MINUTES=15
```

---

## 3. Run Database Migrations

```bash
npx prisma migrate dev --name initial_setup
# or if already applied:
npx prisma db push
```

Then generate the Prisma client:

```bash
npx prisma generate
```

---

## 4. Start the Backend

```bash
pnpm install
pnpm dev
```

You should see:

```
[10:00:00] Server running on http://localhost:3000
[10:00:00] Cron: digest, classification batch, SLA check, batcher flush, data retention, WAHA restart registered
```

---

## 5. Pair Your WhatsApp Number

WAHA prints a QR code in its logs. View it:

```bash
docker compose logs waha --tail 50
```

Look for a block of `██████` — the QR code. Alternatively, fetch it via API:

```bash
# Open this URL in a browser
echo "http://localhost:3002/api/sessions/default/auth/qr"
```

**On your phone:**
1. Open WhatsApp → Linked Devices → Link a Device
2. Scan the QR code

Verify the session is connected:

```bash
curl http://localhost:3002/api/sessions/default
# → {"name":"default","status":"WORKING"}
```

---

## 6. Send a Test Message

Send a WhatsApp message from another phone to the paired number. The webhook will fire immediately.

Check classification was picked up by the 5-minute batch cron:

```bash
# Wait up to 5 minutes, then:
curl http://localhost:3000/api/health/whatsapp
```

Response example:

```json
{
  "wahaStatus": "WORKING",
  "totalUnprocessed": 0,
  "totalPending": 0,
  "slaBreaches": 0,
  "lastWebhookAt": "2026-07-29T10:05:00.000Z",
  "useInMemoryDb": false
}
```

---

## 7. Check Stored Messages

Query PostgreSQL directly:

```bash
docker compose exec postgres psql -U founder -d founder_os \
  -c "SELECT id, waha_message_id, body, classification, classified_at FROM \"Message\" ORDER BY created_at DESC LIMIT 5;"
```

Or via the API (if the frontend is built):

```bash
curl http://localhost:3000/api/digests
```

---

## 8. Manual Classification Test

Trigger the classification batch immediately (skip the 5-min wait):

```bash
curl -X POST http://localhost:3000/api/trigger/digest
```

Force an SLA check:

```bash
curl http://localhost:3000/api/health/whatsapp   # re-check
```

---

## 9. Test Without a Database (In-Memory Mode)

Stop PostgreSQL, then restart the backend. It falls back to in-memory storage:

```bash
docker compose stop postgres
pnpm dev
# → "In-memory storage provider active"
curl http://localhost:3000/api/health/whatsapp
# → {"useInMemoryDb": true}
```

Webhooks still work and data is held in RAM (lost on restart).

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| WAHA returns `STOPPED` | Session not paired | Scan QR code |
| WAHA returns `404` | Wrong API key | Check `WAHA_API_KEY` in `.env` matches `docker-compose.yml` |
| `connection refused` on DB | PostgreSQL not started | `docker compose up -d postgres` |
| `useInMemoryDb: true` unexpectedly | PostgreSQL unreachable | Check `DATABASE_URL` and `docker compose ps` |
| Webhook returns `429` | Rate limit hit | Wait 1 minute, check `express-rate-limit` config |
| Messages not classified | LLM key missing | Check heuristic fallback is working, or set `LLM_API_KEY` |

---

## Architecture Overview

```
Phone ──send message──▶ WAHA ──webhook──▶ Backend ──redis──▶ Batch Cron (every 5 min)
                                                                    │
                                                            ┌───────┴───────┐
                                                            ▼               ▼
                                                     AI Classification  Heuristic Fallback
                                                            │               │
                                                            └───────┬───────┘
                                                                    ▼
                                                           PostgreSQL / In-Memory
                                                                    │
                                                            SLA Check (every 1 min)
                                                                    │
                                                         Slack Alert (on breach)
                                                                    │
                                                       Notification Batcher (every 15 min)
                                                                    │
                                                           WAHA Outbound (ban-proofed)
```

## Key Cron Schedules

| Cron | Interval | Purpose |
|---|---|---|
| Classification batch | Every 5 min | Drain Redis queue, classify messages |
| SLA check | Every 1 min | Detect SLA breaches |
| Notification batcher | Every 15 min | Flush buffered outbound messages |
| Data retention | Daily 3 AM | Purge old messages (chunks of 1000) |
| WAHA restart | Daily 4 AM | Prevent session staleness |
| Digest generation | Every 5 min | Build AI conversation summaries |

---

## Related Files

| File | Purpose |
|---|---|
| `src/modules/whatsapp/controller.ts` | WAHA webhook handler |
| `src/modules/classification/service.ts` | AI + heuristic classification orchestrator |
| `src/modules/queue/service.ts` | BullMQ queues + batch drain |
| `src/modules/monitoring/sla-check.ts` | SLA breach detection |
| `src/modules/whatsapp/outbound.ts` | Ban-proofed message sending |
| `src/modules/whatsapp/batcher.ts` | 15-min notification batching |
| `src/routes/health.ts` | WhatsApp health endpoint |
| `docker-compose.yml` | Full stack orchestration |