# AGENTS.md

Founder OS: WhatsApp + Zoho Estimates + telecalling CRM behind a Next.js dashboard.
**Live system is Cloudflare Worker (D1) + GitHub Actions runners.** Express/PostgreSQL is an alternate runtime that shares the same modules but is NOT the production path.

## Runtime model (the single most important thing to understand)
- `founder-os_backend/src/modules/*` and `src/automations/*` are imported by BOTH the Cloudflare Worker and the Express server. Don't add Node-only deps to shared modules — the Worker build (`scripts/build-worker.mjs`) bundles them for the edge and redirects Node-bound modules to `*-worker.ts` twins via an esbuild plugin (see `REDIRECTS` map).
- **Worker** = thin JSON API over D1. `src/worker.ts` is now a ~40-line entry that registers route modules; real code lives in `src/worker/`:
  - `context.ts` — `Bindings` type, `bootstrapEnv`, `deps()`, boot, auth guards, `broadcastLive`, `createApp()` (middleware).
  - `routes/*.ts` — one module per domain (auth, chat, enquiries, system, estimates, whatsapp, triggers, runner, autopilot, automations, events).
  - `cron.ts` — the `* * * * *` cron router (see Cron below).
- **Express `src/routes/` is a PARALLEL implementation** of the same endpoints. Adding an endpoint usually means touching both the Worker route module and the Express router (mirror the route). Keep handlers thin; heavy/AI work goes to a GH Actions runner.

## Cron / scheduling (Cloudflare-only dispatch)
- ONE Cloudflare Cron Trigger `* * * * *` (wrangler.toml). `src/worker/cron.ts` runs every minute and dispatches GitHub Actions `workflow_dispatch` by **UTC minute alignment**:
  - every-5min `min%5==0`, every-10min `%10`, every-15min `%15`, every-30min `%30`, daily at 02:30/13:30/15:30/19:30/21:30 UTC (one slot per job family — 02:30 distribution+brief, 13:30 summary+neodove, 15:30 eod-deduction, 19:30 baseline, 21:30 retention; the workflow gates each job on `inputs.slot`, `all` = manual runs everything); neodove-refresh runs natively in-worker every 5 min.
- **Gate on `event.scheduledTime`, NOT `new Date()`** — Cloudflare delivers cron events 1–2 min late; wall-clock gating skips slots.
- The `.github/workflows/cron-*.yml` files have **NO `schedule:` block** (removed on purpose). They fire only via `workflow_dispatch` from the Worker. Don't re-add `schedule:`.
- Heavy AI runs in GH Actions runners: `scripts/*-runner.js` (zoho-sent-runner, morning-brief-runner, eod-summary-runner, neodove-report-runner, whatsapp-digest-runner, whatsapp-autopilot-runner, email-brain-index-runner). They call worker `/api/runner/*` endpoints (Bearer SHARED_SECRET) and the LLM via the **unified AI gateway** — `getGateway(env).complete()/completeJson()` (`src/shared/ai-gateway.ts` for Worker/Express, JS port `scripts/ai-gateway.js` for runners, thin wrappers `groq`/`groqJson` in `runner-lib.js`). Gateway owns the key pool: multi-provider (groq/openrouter/deepseek/together/openai + legacy omniroute fallback), `AI_KEYS=provider:key:label,...` (auto-detect from prefix; legacy `*_API_KEYS` vars still merged), least-failures selection, 429→cooldown (honors retry-after) / 401→disabled / 5xx→rotate, placeholder keys ignored.
- GH secrets used by workflows: `WORKER_URL`, `SHARED_SECRET`, `AI_KEYS` (or legacy `GROQ_API_KEYS`/`OPENROUTER_API_KEYS`/`DEEPSEEK_API_KEYS` + `OMNIROUTE_*` fallback), `NEODOVE_USER_IDS`.
- **Telecalling is production-live and deterministic (no LLM)**: `runLeadConversion()` in `src/automations/telecalling/service.ts`; daily `POST /api/trigger/telecalling` at 08:00 IST (round-robin) + `POST /api/trigger/telecalling/eod` at 21:00 IST (`runEodRemarkDeduction()` — −10 per red-risk holding, gated by the Active Penalty toggle default ON; EOD Reassignment switch is OFF), plus every-15min `effort-sync-runner.js` → `/api/runner/telecalling/effort-sync` (NeoDove snapshots, ops hours only).
- **Quiet hours 21:00–09:00 IST**: Zoho/NeoDove-backed analysis pauses via `isOpsWindow()` in cron.ts — every-10min + every-15min dispatches skipped, every-5min fires with `run_zoho=false` (skips crm + zoho-sent jobs), daily fires with `run_neodove=false`, native neodove-refresh skipped. Manual dispatch defaults both inputs true.
- Worker secret needed for dispatch: `GITHUB_ACCESS_TOKEN` (set via `printf '%s' "$TOKEN" | npx wrangler secret put GITHUB_ACCESS_TOKEN` — `echo` adds a trailing newline and breaks GitHub auth). GitHub rejects the dispatch POST without a `User-Agent` header (403, empty body from CF egress) — already handled in cron.ts.

## Deploy policy (standing instruction from founder)
- **Deploy every time you make changes — do not ask.** After any code change (backend or frontend), build + deploy it to production immediately as part of the same task.
- Backend change → `cd founder-os_backend && node scripts/build-worker.mjs && node scripts/smoke-worker.mjs && npx wrangler deploy`.
- Frontend change → `cd founder-os_frontend && npm run build` (webpack!) `&& npx wrangler pages deploy out --project-name founder-os-frontend`.
- If both changed, deploy both (backend first). Never finish a code task in a deployed-but-stale state.
- Never `source ../.env` (contains `$@` in SSH password) — export only the needed vars via grep/python.

## Commands
- Worker build+deploy: `cd founder-os_backend && set -a; source ../.env; set +a; node scripts/build-worker.mjs && npx wrangler deploy`
- Worker smoke test (no DB/LLM): `cd founder-os_backend && node scripts/smoke-worker.mjs`
- Frontend build+deploy: `cd founder-os_frontend && NODE_ENV=production npm run build && set -a; source ../.env; set +a; npx wrangler pages deploy out --project-name founder-os-frontend`
- Frontend dev: use `./run-dev.sh` (Next 16 Turbopack leaks memory and OOMs; the wrapper forces `--webpack`). Plain `npm run dev` uses Turbopack — avoid.
- **Frontend production build MUST use webpack** — `package.json` `build` now runs `next build --webpack`. Next 16 defaults to Turbopack for `next build`, and Turbopack **drops the nested dynamic-import chunks** (e.g. `page → Automations → TelecallingDashboard`): the chips/Export section silently vanish from the deployed bundle even though the source has them. Always rebuild via `npm run build` (webpack) and confirm the deployed index has no `turbopack` chunk.
- **There is no test suite** (`npm test` errors). Verification = `smoke-worker.mjs` + live curl of `/health`, `/api/status`, and dashboard endpoints. `NODE_ENV=production npm run build` in the frontend is the only reliable static-export path.
- Typecheck backend: `cd founder-os_backend && npx tsc --noEmit`. Expect pre-existing errors in `durable/*.ts` (missing CF types) and `automations/zoho-sent-analyzer/service.ts` (4 known `null → number` errors) — leave those untouched.

## D1 / Prisma (the live DB for the Worker)
- Runtime uses **`src/shared/prisma-d1.ts`** (a hand-rolled shim over D1), NOT the real Prisma client — even though types come from `@prisma/client`. After editing `prisma/schema.prisma`, run `npx prisma generate`, then register new models/fields in the shim's `BOOL_FIELDS`, `DATE_FIELDS`, `ID_FIELDS`, `RELATIONS` registries, or the D1 queries won't handle them.
- Migrations: sequential `founder-os_backend/migrations/NNNN_*.sql`. Apply to remote: `npx wrangler d1 execute waba-worker --remote --file migrations/NNNN_*.sql`.
- Real Prisma columns come from Zoho/NeoDove/WA payloads; D1 shim columns are used by raw `c.env.DB.prepare(...)` for the waba_payloads/BrainContext paths.

## KV caching (`src/shared/cache.ts`)
- Read-through helper: `cached(key, ttlMs, compute)` with single-flight coalescing + stale-on-error. Keys namespaced `kvx:`. Invalidate via `cacheDel` / `cacheDelPrefix`.
- Heavy dashboard payloads are KV-cached (estimates payload, telecalling dashboard/risk, NeoDove KRA/range). **When you add a write path that changes data, call the right invalidator** (`invalidateDerivedEstimateCaches`, `invalidateRiskCache`, `invalidateNeodoveCache`) or dashboards go stale for the TTL.

## Secrets / env gotchas
- Root `.env` holds Cloudflare tokens, SSH creds, `GITHUB_ACCESS_TOKEN`, but many runtime secrets are **empty there** — real values live as Cloudflare worker secrets and GH repo secrets (`SHARED_SECRET`, `GROQ_API_KEYS`, Zoho creds). Don't curl-verify secret-gated endpoints locally with `.env`; they 401/403 by design.
- `.env` contains `$@` in the SSH password; **do not `source .env`** and reuse those values (bash expands `$@`). Parse with grep/python or set explicitly.
- Remote cron host (`SSH_HOST` in `.env`) still runs the D1 nightly backup + health ping; workflow-dispatch lines there are commented out. Don't "fix" or re-enable them.

## Auth / scopes
- Google OAuth gate: paths in `AUTH_EXEMPT` (context.ts) skip it; runners auth via `SHARED_SECRET` (`requireSecret`), MIS endpoints via the `mis` scope (`requireMisScope`). Roster/telecaller writes are MIS-only.
- Admin panel (`UserAdmin`): root sees Roles + Users; holders of the `user-admin` scope (auto-merged into the `mis` role by `ensureRolesSeeded`) see Users only and can assign roles. The backend rejects touching the root user or granting `admin` (`asUserManager` in `modules/auth/routes.ts`); role create/edit/delete stays root-only; role saves use `ON CONFLICT DO UPDATE`, never `INSERT OR REPLACE` (which would cascade-wipe user assignments).

## Domain quirks worth knowing
- **Telecalling**: `Telecaller.assignEstimateFollowUps` (renamed from `active`, migration 0015) marks conversion specialists — only they get estimate follow-up assignments. Creator-first assignment still lets the lead-gen creator close their own estimate. Score ledger `TelecallerScoreEvent` (close slabs ₹0–1L 50 / ₹1–2.5L 75 / ₹2.5–5L 100 / ≥₹5L 200 split 20/80 generator/closer — 10/15/20/40 + 40/60/80/160; −10 remark / −15 legacy snatch / −20 retired decline). EOD run skips non-working days (zero NeoDove calls), shields genuine spread effort per customer (2+ attempts 3h apart or a connect), honors dated next steps (`Estimate.nextStepDate`, migration 0028; future/today protects, past-due reads red), accepts `?dry=1` preview.
- Zoho comments: DB stores `date` (date-only) + `dateFormatted` (full IST time). Risk model must read `dateFormatted` (parse as `+05:30`) or every today-comment looks 12h stale.
- Architecture truth lives in `architecture.md` (§9 deploy, §5 cron, §10 extension guidelines) — trust it over file names, but it may lag code; verify against config/scripts.

## Live updates (event-driven; automatic for new views)
- Backend writes go live via the **EventHub Durable Object**: any data-write handler calls
  `notifyLive(c, { type })` / `broadcastLive` (fire-and-forget, `ctx.waitUntil`). Clients hold
  ONE WebSocket to `/api/events` (`src/durable/event-hub.ts`).
- **Automatic**: the auto-live middleware in `src/worker/context.ts` (`createApp()`) emits a
  generic `data-changed` event for ANY successful mutating `/api/*` request whose handler didn't
  already broadcast — so a NEW endpoint/dashboard goes live with zero wiring. If a handler
  broadcasts a typed event, the marker suppresses the generic duplicate. Noisy paths are opted
  out via `LIVE_NO_AUTO` (`/api/auth/`, `/api/token/`, `/api/chat/typing`, files, SSE/WebSocket).
- Frontend: a NEW dashboard view should use `useLiveDashboard(fetcher)` (or `useLiveQuery(fetcher)`
  with NO `events` option) — it refetches on every event, including `data-changed`. Use
  `useLiveQuery(fetcher, { events: [...] })` only to narrow refetch at high scale.
- The event is an invalidation signal (type only, not changed rows) — dashboards refetch the full
  payload from KV-cached endpoints (single-flight `cached()`), so refetch storms collapse to one
  compute. Add a new write endpoint → auto-live is covered.