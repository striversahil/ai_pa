# founder-os_backend

The **Founder OS** backend is a modular, AI-powered executive assistant server built with **Node.js + TypeScript**, **Express**, **PostgreSQL (Prisma ORM)**, and an **OpenAI-compatible LLM abstraction** (currently using Groq). It synchronizes data from Zoho Books, WhatsApp, and Email — classifies and enriches that data with LLM reasoning — and serves it via a REST API to the `founder-os_frontend` static dashboard.

---

## Project Structure

```
founder-os_backend/
├── src/
│   ├── config/
│   │   └── index.ts                      # Env validation via dotenv + zod
│   ├── modules/
│   │   ├── ai/
│   │   │   ├── prompts/                  # Isolated LLM prompt templates
│   │   │   │   ├── classifyEstimate.ts   # Zoho estimate priority classifier prompt
│   │   │   │   ├── extractEnquiry.ts     # Enquiry comment entity extractor prompt
│   │   │   │   ├── matchBusiness.ts      # Notion entity matcher rules prompt
│   │   │   │   ├── answerFounderQuestion.ts
│   │   │   │   ├── generateBrief.ts
│   │   │   │   ├── generateDailySummary.ts
│   │   │   │   └── summarizeConversation.ts
│   │   │   └── service.ts                # Provider-agnostic OpenAI API wrapper
│   │   ├── digest/
│   │   │   └── service.ts                # WhatsApp conversation digest pipeline
│   │   ├── email/
│   │   │   └── service.ts                # IMAP email sync + storage
│   │   ├── scheduler/
│   │   │   └── service.ts                # Pluggable cron manager
│   │   ├── storage/
│   │   │   └── repository.ts             # Exclusive Prisma CRUD layer
│   │   ├── tasks/
│   │   │   └── service.ts                # Action item extraction manager
│   │   ├── whatsapp/
│   │   │   ├── controller.ts             # Webhook ingestion for WhatsApp bot
│   │   │   └── service.ts                # WhatsApp message services
│   │   └── zoho_notion/
│   │       └── service.ts                # Zoho Books crawler + Notion matcher + AI classifier
│   ├── shared/
│   │   ├── engine.ts                     # AnalysisEngine interface + EngineRegistry singleton
│   │   ├── logger.ts                     # Pino structured logger
│   │   ├── prisma.ts                     # Prisma singleton client
│   │   └── seed.ts                       # Mock data seeder
│   └── server.ts                         # Express app bootstrap + all route definitions
├── prisma/
│   └── schema.prisma                     # Database schema (Estimates, Comments, Classifications, etc.)
├── public/                               # Compiled Next.js static bundle (served by Express)
├── tsconfig.json
├── package.json
├── .env.example                          # Environment variable template
└── .env                                  # Active credentials (gitignored)
```

---

## Tech Stack

| Layer          | Technology                              |
|----------------|-----------------------------------------|
| Runtime        | Node.js 20                              |
| Language       | TypeScript 5                            |
| Framework      | Express 4                               |
| Database       | PostgreSQL 15 (via Prisma ORM)          |
| LLM Provider   | Groq (`llama-3.3-70b-versatile`)        |
| Scheduler      | `node-cron`                             |
| Logger         | Pino                                    |
| Notion Client  | `@notionhq/client`                      |
| Package Mgr    | pnpm                                    |

---

## Pluggable Engine System

All data sync modules implement the `AnalysisEngine` interface from `src/shared/engine.ts`:

```typescript
export interface AnalysisEngine {
  name: string;
  runSync(): Promise<any>;
  getBriefingContext(): Promise<string>;
  getEodContext(): Promise<string>;
}
```

Currently registered engines:
| Key            | Engine Name                  | Module                          |
|----------------|------------------------------|---------------------------------|
| `whatsapp`     | WhatsApp Digest Engine       | `modules/digest/service.ts`     |
| `email`        | Email Sync Engine            | `modules/email/service.ts`      |
| `zoho_notion`  | Zoho Notion Sync & Analyzer  | `modules/zoho_notion/service.ts`|

See [architecture.md](./architecture.md) for the full extension guide.

---

## Database Models (Prisma)

| Model          | Purpose                                                    |
|----------------|------------------------------------------------------------|
| `Message`      | Raw WhatsApp messages from webhook                         |
| `Email`        | Synced inbox emails                                        |
| `Digest`       | Structured AI-summarized conversation digests              |
| `Task`         | Action items extracted from chats/emails                   |
| `FounderNote`  | Generated morning briefings and EOD summaries              |
| `Estimate`     | Zoho Books sent estimates (status, dates, value)           |
| `Comment`      | Estimate internal comment timeline                         |
| `Classification` | LLM intent scores, follow-up flags, reasoning per estimate |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the following:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/founder_os?schema=public
LLM_API_KEY=         # Groq API Key
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
NOTION_API_KEY=      # Notion integration secret token
NOTION_DATABASE_ID=  # UUID of the Notion B2B enquiry database
EMAIL_IMAP_HOST=
EMAIL_IMAP_PORT=993
EMAIL_USER=
EMAIL_PASSWORD=
PORT=3000
```

---

## Local Development

### Step 1: Start PostgreSQL
```bash
# From the parent ai_pa/ directory
docker-compose up -d db
```

### Step 2: Push Prisma Schema
```bash
cd founder-os_backend
npx prisma db push
```

### Step 3: Run Dev Server
```bash
pnpm install
pnpm run dev
# Server starts on http://localhost:3000
```

---

## Frontend Deployment

The frontend (`founder-os_frontend`) must be compiled and copied into `public/` before serving:
```bash
cd ../founder-os_frontend
npm run build

# Deploy to backend
rm -rf ../founder-os_backend/public/*
cp -r ./out/* ../founder-os_backend/public/
```

The Express server automatically serves all static files from `public/` at `GET /*`.

---

## Docker (Production)

Full production stack (frontend + backend + PostgreSQL) from the parent `ai_pa/` directory:
```bash
docker-compose up --build -d
```

---

## REST API Reference

### Data Endpoints
| Method | Path                   | Description                                        |
|--------|------------------------|----------------------------------------------------|
| GET    | `/api/estimates`       | All active sent estimates with AI classifications  |
| GET    | `/api/brief/latest`    | Latest morning brief or EOD summary markdown       |
| GET    | `/api/digests`         | WhatsApp conversation digest list                  |
| GET    | `/api/tasks`           | Active action items list                           |
| POST   | `/api/ask-founder-ai`  | Chat with AI using full inbox/estimate context     |
| POST   | `/api/whatsapp/webhook`| Ingest WhatsApp message payloads from bot          |

### Manual Trigger Endpoints
| Method | Path                        | Description                              |
|--------|-----------------------------|------------------------------------------|
| POST   | `/api/trigger/zoho-sync`    | Force sync Zoho estimates + Notion match |
| POST   | `/api/trigger/briefing`     | Force generate morning briefing          |
| POST   | `/api/trigger/summary`      | Force generate EOD summary               |
| POST   | `/api/trigger/email-sync`   | Force sync unread emails                 |
| POST   | `/api/trigger/digest`       | Force sync WhatsApp digests              |

---

## LLM Rate Limiting

The Groq free tier has a **100,000 tokens/day** limit. The `ZohoNotionService` has built-in classification caching:
- If an estimate already has a `Classification` record in the database **and** the comment count hasn't changed, the LLM call is **skipped**.
- Estimates that fail classification (rate-limited) still appear in the frontend with a "Classification pending" placeholder — they will be classified on the next successful sync.
