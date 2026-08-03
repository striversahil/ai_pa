# Email + Brain Index

## What it does
Every 30 minutes, syncs emails and re-indexes the company brain (embeddings over messages, emails, digests, estimates, tasks) so RAG search stays fresh.

## Folder architecture
| File | Role |
|---|---|
| `index.ts` | Handler → orchestrates email sync + brain indexing |
| `rule.json` | Schedule metadata (`*/30 * * * *`) |

## Flow (what happens inside `index.ts`)
1. `new EmailEngine().runSync()` → `EmailService.syncEmails()` — fetch + store new emails.
2. `new BrainService().runSync()` → `BrainIndexer` rebuilds embeddings across all data sources.

## Trigger
`type: handler` · cron `*/30 * * * *`.

## Why the code lives in `modules/`
`EmailService` and `BrainService` are **platform services** used across the live path too:
- `BrainService.query()` powers `/api/ask-founder-ai` and `/api/brain/*` RAG search in real time.
- `EmailService.fetchUnread()` feeds the briefing/EOD context.
- Both engines are registered for the scheduler's engine registry.
This automation owns the *schedule*; the platform owns the shared machinery.

## Dependencies (platform services in `src/modules/`)
- `modules/email/engine` + `modules/email/service` — email sync
- `modules/brain/service` + `modules/brain/indexer` + `modules/brain/embedder` — embedding index
- `shared/prisma`, `shared/engine`, `shared/logger`

## Data
- **Writes:** `Email` rows, `BrainContext` embedding rows.

## Config
None — email credentials live in env (`.env`).
