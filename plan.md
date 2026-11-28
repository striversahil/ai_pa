# `plan.md` — Unified Third-Party Integration & Dual-Mode Ingestion (`ai_pa`)

> **Target:** Founder OS (`founder-os_backend`, `scripts/`, `founder-os_frontend`)
> **Goal:** Replace coupled per-service integrations (e.g., `sent_estimates.txt` + coupled Zoho estimate analyzer) with:
> 1. **Unified Inbound Ingestion (`hlp_ingested_data`)**: Single webhook/poller staging table supporting both **real-time streaming** (`waitUntil` + `EventHub`) and **scheduled batch processing** (GH Actions runners).
> 2. **Unified Outbound Facade (`call(provider, opts)`)**: Modular gateway resolving default or named provider instances (`zoho`, `whatsapp`, `tally`, `tradeindia`, `justdial`, `alibaba`, `openai`, `custom`), decrypting credentials, and managing OAuth refresh.
> 
> 

---

## 0. Non-Negotiable Repo Guardrails (Read Before Writing Code)

1. **ERP Core Lock (§17):** NEVER modify `prisma/core/*`, `src/modules/core/*`, or `src/worker/routes/work.ts`. Never write directly to `core_*` tables outside `src/modules/core/`. All new tables **must** use the `hlp_` prefix (`hlp_ingested_data`, `hlp_integration_instance`) and write to `core_lead` only via existing `modules/core/` intake functions.
2. **AI Keys Single Source of Truth (§5):** Do **not** store OpenAI-compatible keys in `hlp_integration_instance`. Register `"openai"` in `call("openai")` as a thin adapter delegating directly to `src/shared/ai-gateway.ts` (which reads `Setting` `ai:providers`).
3. **File Size & Duplication Ratchet (§18):** Every new `.ts` / `.tsx` file **must stay under 350 lines** (CI fails at `> 400` lines). Split logic into `types.ts`, `pure.ts` (zero I/O), `store.ts`, `io.ts`, and per-provider files.
4. **Canonical Helpers Only:**
* Backend routes: use `requireViewer` (`worker/viewer.ts`), `writeError` (`worker/http.ts`), `adminGuard` (`worker/context.ts`), `cached` / `cacheRevs` / `bumpRev` (`shared/cache.ts`), and `broadcastLive` (`live.ts`).
* Frontend: use `useLiveDashboard` / `useLiveQuery` / `useOptimisticMutation` (`src/hooks/useLiveData.ts`), `usePagedQuery` (`src/hooks/usePagedQuery.ts`), `@/components/ui` (no ad-hoc modals, no raw `fetch` outside `api/client.ts`, no custom INR/date formatters).


5. **Same-Commit Documentation:** Update `architecture.md` (add **§22 Unified Integrations & Ingestion** and update file trees/routes) in the same commit.

---

## Phase 1: Database Schema & Migration

### 1.1 Create `founder-os_backend/migrations/0183_integrations_and_ingestion.sql`

Create two `hlp_` tables compatible with Cloudflare D1 (SQLite) and Prisma:

* **`hlp_integration_instance`**:
* `id TEXT PRIMARY KEY`
* `provider TEXT NOT NULL` (`zoho` | `whatsapp` | `tally` | `tradeindia` | `justdial` | `alibaba` | `custom`)
* `instanceKey TEXT NOT NULL` (e.g., `default`, `bui_main`, `custom_erp`)
* `label TEXT NOT NULL`
* `isDefault INTEGER NOT NULL DEFAULT 0`
* `enabled INTEGER NOT NULL DEFAULT 1`
* `deliveryMode TEXT NOT NULL DEFAULT 'batch'` (`realtime` | `batch`)
* `baseUrl TEXT`
* `encryptedSecrets TEXT NOT NULL` (AES-GCM ciphertext)
* `configJson TEXT NOT NULL DEFAULT '{}'` (non-secret metadata: `orgId`, `phoneNumberId`, `pollCursor`, `authHeaderName`)
* `createdAt TEXT NOT NULL`, `updatedAt TEXT NOT NULL`
* `UNIQUE(provider, instanceKey)`


* **`hlp_ingested_data`**:
* `id TEXT PRIMARY KEY`
* `source TEXT NOT NULL` (`zoho`, `tally`, `whatsapp`, `tradeindia`, `justdial`, `alibaba`, `custom:<slug>`)
* `instanceKey TEXT NOT NULL DEFAULT 'default'`
* `eventType TEXT`
* `externalEventId TEXT` (provider deduplication key)
* `deliveryMode TEXT NOT NULL DEFAULT 'batch'` (`realtime` | `batch`)
* `status TEXT NOT NULL DEFAULT 'pending'` (`pending` | `processing` | `processed` | `dead_letter`)
* `rawPayload TEXT NOT NULL` (exact JSON body or normalized query-string JSON)
* `headersJson TEXT`
* `normalizedJson TEXT` (canonical CRM object produced by mapper)
* `coreRefId TEXT` (id-only reference to `core_lead.id` or `Estimate.estimateId`)
* `retryCount INTEGER NOT NULL DEFAULT 0`
* `errorLog TEXT`
* `receivedAt TEXT NOT NULL`, `processedAt TEXT`
* Indexes:
* `CREATE UNIQUE INDEX idx_hlp_ingested_dedup ON hlp_ingested_data (source, externalEventId) WHERE externalEventId IS NOT NULL;`
* `CREATE INDEX idx_hlp_ingested_queue ON hlp_ingested_data (status, deliveryMode, receivedAt);`
* `CREATE INDEX idx_hlp_ingested_source_status ON hlp_ingested_data (source, status, receivedAt);`





### 1.2 Mirror in `founder-os_backend/prisma/schema.prisma`

Add `HlpIntegrationInstance` and `HlpIngestedData` models matching the exact column names and types above, and register them in `src/shared/d1-prisma.ts` so `d1-parity` guard passes.

---

## Phase 2: Outbound Modular Gateway (`call(provider, opts)`)

Create `founder-os_backend/src/modules/integrations/` (keep every file `< 250` lines):

1. **`types.ts`**:
* `ProviderKey = "zoho" | "whatsapp" | "tally" | "tradeindia" | "justdial" | "alibaba" | "openai" | "custom"`
* `DeliveryMode = "realtime" | "batch"`
* `ResolvedInstance` (decrypted secrets + parsed `configJson`)
* `IntegrationAdapter<TClient>` interface (`provider`, `connect(instance)`)
* `ProviderManifest` interface (fields, secretFields, supportsWebhook, supportsPolling, defaultDeliveryMode)


2. **`manifest.ts`**:
* Declarative manifest registry for all supported providers.
* Defines required/optional config fields, secret fields, webhook path template (`/api/webhooks/:source/:instanceKey`), and default `deliveryMode` (`whatsapp`, `tally`, `justdial` → `realtime`; `zoho`, `tradeindia`, `alibaba`, `custom` → `batch`).


3. **`vault.ts`**:
* Edge-safe WebCrypto (`crypto.subtle`) AES-256-GCM `encryptSecrets(obj, secretKey)` and `decryptSecrets(cipher, secretKey)` using Worker/Node env `VAULT_KEY` (fallback to `SHARED_SECRET` SHA-256 derived key if `VAULT_KEY` is unset, logging a warning).


4. **`store.ts`**:
* CRUD over `hlp_integration_instance` (`listInstances`, `getDefaultInstance`, `getInstanceByKey`, `upsertInstance`, `setDefaultInstance`, `deleteInstance`).
* Enforces single `isDefault = 1` per `provider` atomically.
* Redacts `encryptedSecrets` on all read/list responses (returns `hasSecrets: boolean` + masked hints only).
* Invalidates KV cache via `bumpRev("integrations")` on every write.


5. **`gateway.ts`**:
* Exports `registerAdapter(adapter)` and `call<T>(provider: string, opts?: { instanceKey?: string }): Promise<T>`.
* Fast-paths `provider === "openai"` directly to the OpenAI adapter (no DB lookup).
* Caches resolved instance lookups with `cached("int:inst:...", 300_000, ...)` keyed on `cacheRevs(["integrations"])`.


6. **`adapters/`**:
* **`openai.ts`**: Wraps `src/shared/ai-gateway.ts` (`complete`, `completeJson`, `completeJsonStream`) so `const ai = await call("openai")` works anywhere in the backend.
* **`zoho.ts`**: Resolves `clientId`, `clientSecret`, `refreshToken`, `organizationId`, `accountsUrl` (default `[https://accounts.zoho.in](https://accounts.zoho.in)`), `apiDomain` (default `[https://www.zohoapis.in](https://www.zohoapis.in)`). Caches access token in the existing `Token` table (`source = "zoho:" + instanceKey`), refreshes on 401 or expiry, and returns `{ request(path, init), getSentEstimates(params), getEstimateDetail(id), getComments(estimateId) }`.
* **`whatsapp.ts`**: Wraps `src/modules/waba/client.ts` using the resolved instance's `phoneNumberId` and `accessToken`.
* **`custom-http.ts`**: Generic HTTP client (`baseUrl`, configurable auth header `Bearer` / `X-API-Key` / `Basic` / custom header, JSON request/response wrapper, timeout & retry on 429/5xx).



---

## Phase 3: Unified Inbound Ingestion (`hlp_ingested_data`)

Create `founder-os_backend/src/modules/ingestion/` (keep every file `< 250` lines):

1. **`pure.ts`** (100% pure functions — zero I/O, tested by guard suite):
* `normalizeInboundRequest({ method, query, body, headers })`: normalizes `GET` query params (used by Justdial) or `POST` JSON into a uniform payload object.
* `verifyWebhookSignature(source, rawBody, headers, secret)`: HMAC-SHA256 verification for Meta WhatsApp (`X-Hub-Signature-256`), Tally (`Tally-Signature`), and custom HMAC headers.
* `extractExternalEventId(source, payload)`: deterministic idempotency key extraction per source (`wamid` for WhatsApp, `data.responseId` for Tally, `leadid` for Justdial, `rfi_id` for TradeIndia, `${estimate_id}:${last_modified_time}` for Zoho, or fallback `payload.event_id ?? payload.id`).
* `normalizeIndianPhone(raw)`: converts local 10-digit / `0`-prefixed / `+91` numbers to canonical `+91XXXXXXXXXX`.


2. **`mappers/`** (pure transformations from vendor JSON → canonical CRM shapes):
* **`types.ts`**: `CanonicalLead` (`source`, `externalId`, `contactName`, `companyName`, `phone`, `email`, `city`, `gstin`, `productInterest`, `quantity`, `rawNotes`, `receivedAt`), `CanonicalEstimate` (`source`, `externalId`, `estimateNumber`, `customerName`, `total`, `status`, `date`, `items`, `comments`), `CanonicalMessage`.
* **`b2b-portals.ts`**: Pure mappers for `justdial`, `tradeindia`, and `alibaba` → `CanonicalLead`.
* **`tally.ts`**: Pure mapper for Tally.so webhook payloads (`fields[]` array flattening by label/key) → `CanonicalLead` or `CanonicalEstimate`.
* **`zoho-estimate.ts`**: Pure mapper for Zoho Books estimate payloads → `CanonicalEstimate` (reusing logic from `scripts/zoho-sync/diff.js`).
* **`whatsapp.ts`**: Pure mapper for Meta Cloud API inbound messages → `CanonicalMessage` + `CanonicalLead` (when new enquiry).
* **`index.ts`**: Registry mapping `source` → mapper function (with pass-through fallback for `custom:*` sources).


3. **`store.ts`**:
* `ingestRawEvent(row)`: `INSERT INTO hlp_ingested_data ... ON CONFLICT(source, externalEventId) DO NOTHING`, returning `{ id, inserted, deliveryMode }`.
* `claimBatch(limit, source?)`: claims `status = 'pending'` rows (marking `status = 'processing'`) for batch workers.
* `markProcessed(id, normalizedJson, coreRefId?)` and `markFailed(id, errorMessage)` (increments `retryCount`; moves to `dead_letter` when `retryCount >= 3`).
* `replayRow(id)`: resets `status = 'pending'`, `retryCount = 0`, `errorLog = null`.
* `listIngestedPaged(query)` + `getIngestionStats()`: uses `src/shared/paging.ts` (`pagedQuery`) + KV-cached summary counts.


4. **`processor.ts`**:
* `processIngestedRow(id)`: loads row, runs source mapper from `mappers/index.ts`, routes canonical output:
* `CanonicalLead` → creates/dedupes lead via `modules/core/` intake (or existing `Enquiry` store), matching existing buyers by normalized E.164 phone.
* `CanonicalEstimate` → upserts into `Estimate` store and triggers classification if needed.
* `CanonicalMessage` → routes to WhatsApp message store.


* Calls `markProcessed` on success or `markFailed` on error.



---

## Phase 4: Worker Routes, Context Wiring & Runners

### 4.1 Worker Routes (`founder-os_backend/src/worker/routes/`)

1. **`webhooks.ts`** (Public ingress — mounted at `/api/webhooks`):
* `ALL /api/webhooks/:source` and `ALL /api/webhooks/:source/:instanceKey` (supports `GET` challenge verification for Meta `hub.challenge`, `GET` lead push for Justdial, and `POST` webhooks for all sources).
* Resolves instance config (if any) to read `deliveryMode` and `webhookSecret`.
* Verifies signature via `pure.verifyWebhookSignature`.
* Inserts into `hlp_ingested_data` and returns `200 OK` immediately.
* **If `deliveryMode === "realtime"**`: executes `c.executionCtx.waitUntil(processIngestedRow(id).then(() => broadcastLive(c, LiveEvent.Enquiries)))`.
* **If `deliveryMode === "batch"**`: leaves row `pending` for the scheduled worker.


2. **`integrations.ts`** (Admin & Runner endpoints):
* Admin routes (`adminGuard(c)` — root/admin only):
* `GET /api/integrations/manifest`
* `GET /api/integrations/instances`
* `POST /api/integrations/instances` (encrypts secrets via `vault.ts`, upserts)
* `PATCH /api/integrations/instances/:id` (toggle `enabled`, `isDefault`, `deliveryMode`, update config/secrets)
* `DELETE /api/integrations/instances/:id`
* `POST /api/integrations/instances/:id/test` (runs connectivity check via `call(provider, { instanceKey })`)
* `GET /api/integrations/ingested` (paged list via `parsePageQuery` — source, status, mode, search)
* `GET /api/integrations/ingested/stats` (per-source counts)
* `POST /api/integrations/ingested/:id/replay` (resets failed/dead-letter row; if `realtime`, processes immediately via `waitUntil`)


* Runner routes (`requireSecret` Bearer `SHARED_SECRET`):
* `GET /api/runner/integrations/resolve?provider=&instanceKey=` (returns decrypted instance config + fresh OAuth token for GH Actions runners)
* `POST /api/runner/ingestion/claim`
* `POST /api/runner/ingestion/ack`





### 4.2 Wire into `src/worker.ts` and `src/worker/context.ts`

* Register `registerWebhookRoutes(app)` and `registerIntegrationRoutes(app)` in `src/worker.ts`.
* Add `"/api/webhooks/"` to `AUTH_EXEMPT` in `src/worker/context.ts`.
* Add `"/api/webhooks/"` to `LIVE_NO_AUTO` in `src/worker/context.ts` (prevents raw unmapped webhook writes from firing generic `data-changed` events before processing).

### 4.3 Refactor Zoho Sync & Add Batch/Poller Runners (`scripts/`)

1. **`scripts/zoho-sync/fetch.js`**: Remove dependency on `founder-os_backend/zoho_sent/sent_estimates.txt` cURL parsing. Fetch Zoho credentials and fresh access token from `GET /api/runner/integrations/resolve?provider=zoho` (keeping `sent_estimates.txt` only as an emergency fallback if no DB instance exists yet). Push raw changed estimates into `hlp_ingested_data` (`source = 'zoho'`).
2. **`scripts/zoho-sync/analyze.js`**: Accept `CanonicalEstimate` objects produced by `mappers/zoho-estimate.ts` instead of raw Zoho JSON keys.
3. **`scripts/ingestion-batch-runner.js`**:
* Calls `POST /api/runner/ingestion/claim` (`limit: 50`).
* Processes claimed `batch` rows (including AI enrichment via `POST /api/ai/complete` when configured) and posts results to `POST /api/runner/ingestion/ack`.
* Wire into `.github/workflows/cron-every-5min.yml` (skipping Zoho-only work during quiet hours `21:00–09:00 IST` per §5.1).


4. **`scripts/portal-poller-runner.js`**:
* Pulls new enquiries from pull-only B2B portals configured in `hlp_integration_instance` (`tradeindia`, `alibaba`) using their stored `pollCursor` and posts them to `POST /api/webhooks/:source/:instanceKey`.
* Wire into `.github/workflows/cron-every-15min.yml` (ops window only).



---

## Phase 5: Frontend Integrations & Ingestion Console

Create `founder-os_frontend/src/components/settings/integrations/` (keep every file `< 250` lines):

1. **`IntegrationsTab.tsx`** (mounted inside Settings alongside `ai-gateway`, root/admin only):
* Fetches manifest + instances + stats via `useLiveDashboard`.
* Uses `useOptimisticMutation` (`src/hooks/useLiveData.ts`) for instant toggles (`enabled`, `isDefault`, `deliveryMode: realtime | batch`).
* Includes a top summary card for **AI Gateway (OpenAI-Compatible)** linking directly to `Settings → AI gateway` (`ai:providers`), clarifying that `call("openai")` uses that pool.


2. **`InstanceModal.tsx`**:
* Built with `@/components/ui` modal primitives (never ad-hoc modals).
* Dynamically renders config & secret inputs from `ProviderManifest`, displays the copyable webhook URL (`/api/webhooks/:source/:instanceKey`), and provides a **Test Connection** button.


3. **`IngestedLogsPanel.tsx`**:
* Uses `usePagedQuery` (`src/hooks/usePagedQuery.ts`) over `GET /api/integrations/ingested` with `<Pager>` and `<ChangesBanner>`.
* Filters by `source`, `status` (`pending` / `processed` / `dead_letter`), and `deliveryMode`.
* Row drawer displays `rawPayload` vs `normalizedJson` side-by-side plus `errorLog` and a **Replay** button.



---

## Phase 6: Guards, Verification & Docs

1. **Add Guard Test `scripts/guards/integrations-ingestion.test.mjs**`:
* Asserts every provider in `manifest.ts` has a registered adapter or inbound mapper.
* Tests `pure.ts` functions: Meta/Tally HMAC signature verification, Justdial `GET` query normalization, E.164 phone normalization (`9876543210` → `+919876543210`), and deterministic `externalEventId` extraction.
* Tests all pure mappers (`b2b-portals.ts`, `tally.ts`, `zoho-estimate.ts`, `whatsapp.ts`) against fixture payloads.


2. **Update `architecture.md**`:
* Add **§22 Unified Third-Party Integrations & Ingestion** documenting `hlp_integration_instance`, `hlp_ingested_data`, `call(provider)`, `realtime` vs `batch` routing, and the `AUTH_EXEMPT` `/api/webhooks/*` contract.
* Update §1 repository structure and §3 route inventory.


3. **Run Full Verification Suite (All Must Pass Before Commit):**
```bash
node founder-os_backend/scripts/core-guard.mjs
node --test "scripts/guards/*.test.mjs"
node scripts/dup-audit.mjs
cd founder-os_backend && pnpm build && tsc --noEmit
node scripts/build-worker.mjs && node scripts/smoke-worker.mjs
cd ../founder-os_frontend && npm run build && tsc --noEmit

```