You have already started implementing the unified integration and ingestion architecture from `plan.md`. Now upgrade and align that implementation to use the **v2.0.0 `manifest.json`** (provided below) as the single source of truth across backend adapters, inbound webhook/poller ingestion, runners, and the Settings UI.

### Step 1: Audit What You Already Built & Reconcile
Inspect any files you already created under:
- `founder-os_backend/migrations/0183_*.sql` and `founder-os_backend/prisma/schema.prisma`
- `founder-os_backend/src/modules/integrations/*` and `src/modules/ingestion/*`
- `founder-os_backend/src/worker/routes/{webhooks.ts,integrations.ts}`
- `founder-os_frontend/src/components/settings/integrations/*`
- `scripts/{zoho-sync/*,ingestion-batch-runner.js,portal-poller-runner.js}`

Do **not** create duplicate files alongside existing ones—refactor in place so every `.ts`/`.tsx` file stays **under 350 lines** (CI ratchet limit is 400 lines) and `core_*` tables/files remain completely untouched (`core-guard.mjs`).

---

### Step 2: Install `manifest.json` & Typed Loader
1. Save the JSON below to `founder-os_backend/src/modules/integrations/manifest.json`.
2. Update `founder-os_backend/src/modules/integrations/manifest.ts` to import `manifest.json` directly and export typed helpers:
   - `getProviderManifest(provider)`
   - `listProviderManifests()`
   - `resolveWebhookUrl(origin, provider, instanceKey)`
   - `validateInstancePayload(provider, config, secrets)` (enforcing `required` and `requiredWhen`, e.g., Zoho `oauth2` vs `raw_headers_bridge`).

---

### Step 3: Upgrade Outbound Gateway (`call(provider, { instanceKey })`)
Ensure `founder-os_backend/src/modules/integrations/gateway.ts` and `adapters/` support every outbound provider in `manifest.json`:

1. **`openai` (`adapters/openai.ts` — Multi-Instance, Multi-Vendor, Key Rotation + Fallback):**
   - Look up the requested `hlp_integration_instance` for `provider = "openai"` (or `isDefault = 1` when `instanceKey` is omitted).
   - Parse comma-separated `secrets.apiKeys` into a key rotation list, use `config.baseUrl` and `config.model`, and expose `{ complete, completeJson, completeJsonStream, embed }`.
   - When `config.fallbackToGlobalPool` is `true` (or when no `hlp_integration_instance` row exists yet for `"openai"`), automatically fail over to `src/shared/ai-gateway.ts` (`Setting` `ai:providers`).
2. **`zoho` (`adapters/zoho.ts` — Zero-Downtime Bridge):**
   - Support both `config.authMode === "oauth2"` (auto-refreshing OAuth tokens cached in the `Token` table as `zoho:<instanceKey>` and retrying once on `401`) and `config.authMode === "raw_headers_bridge"` (parsing `secrets.rawCurlHeaders` so production `sent_estimates.txt` headers can be migrated without downtime).
3. **`whatsapp` (`adapters/whatsapp.ts`):**
   - Wrap `src/modules/waba/client.ts` with the resolved instance's `config.phoneNumberId` and `secrets.accessToken`.
4. **`gmail` (`adapters/gmail.ts`):**
   - Google OAuth2 token refresh (`https://oauth2.googleapis.com/token`, cached in `Token` table as `gmail:<instanceKey>`) + helpers for `listMessages`, `getMessage`, `sendMessage`, and `createDraft`.
5. **`google_maps` (`adapters/google-maps.ts`):**
   - Inject `X-Goog-Api-Key` and `X-Goog-FieldMask` headers against `https://places.googleapis.com/v1` (and Routes API `https://routes.googleapis.com/directions/v2:computeRoutes`) with `regionCode` bias.
6. **`google_search` (`adapters/google-search.ts`):**
   - Support `config.baseUrlOverride || "https://www.googleapis.com/customsearch/v1"` injecting `key` and `cx` query params for company/GST/product search enrichment.
7. **`custom` & Portal Poll Adapters (`adapters/custom-http.ts`):**
   - Generic HTTP client supporting `bearer`, `custom_header`, `basic`, `query_param`, and `none` auth schemes, usable by `call("custom", { instanceKey })` as well as `tradeindia`, `exportersindia`, `alibaba`, `facebook`, `instagram`, `linkedin`, `telegram`, `google_forms`, and `neodove`.

---

### Step 4: Make Inbound Ingestion (`hlp_ingested_data`) 100% Manifest-Driven
Update `src/worker/routes/webhooks.ts`, `src/modules/ingestion/pure.ts`, `src/modules/ingestion/mappers/*`, and `src/modules/ingestion/processor.ts` so adding or configuring any provider requires zero route-level branching:

1. **Dynamic Route `/api/webhooks/:provider/:instanceKey?`:**
   - Look up `manifest.providers[provider].inbound`. Return `404` if unknown or `inbound.supported === false`.
   - **Challenge Handshake (`GET`):** If `verification.challengeGet` is defined (Meta WhatsApp/Facebook/Instagram) and `hub.mode === "subscribe"`, validate `hub.verify_token` against the instance's `config.verifyToken` and return `hub.challenge` (`200 text/plain`).
   - **GET Query Normalization:** If `req.method === "GET"` and `normalizeQueryToBodyOnGet === true` (Justdial, custom), convert URL query params into the JSON payload object.
   - **Verification:** Run HMAC-SHA256 (`X-Hub-Signature-256` for Meta, `Tally-Signature` for Tally, or `signatureHeaderName` for `custom`), `field_match` (`parentid` for Justdial), or `optional_header_token` (`X-Zoho-Webhook-Token`, `X-Webhook-Token`, `X-Telegram-Bot-Api-Secret-Token`).
   - **Idempotency Key:** Extract `externalEventId` dynamically using `inbound.idempotencyKey` (`path`, `composite`, or `config_path`) and insert into `hlp_ingested_data` (`ON CONFLICT DO NOTHING`).
2. **Mappers (`src/modules/ingestion/mappers/` — all pure functions):**
   - `b2b-portals.ts`: Handles `indiamart`, `tradeindia`, `justdial`, `exportersindia`, and `alibaba` using their `fieldMap` definitions + E.164 Indian phone normalization (`+91XXXXXXXXXX`).
   - `social-meta.ts`: Handles `whatsapp`, `facebook` (Lead Ads `leadgen` + Messenger), and `instagram` (DMs + comment enquiries).
   - `social-extra.ts`: Handles `linkedin` Lead Gen forms and `telegram` bot updates.
   - `forms.ts`: Handles `tally` (`data.fields[]` label alias matching from `fieldMap.labelAliases`) and `google_forms` (Apps Script webhook & Forms API response shapes).
   - `email.ts`: Handles `gmail` message payloads → `CanonicalEmail` (for Brain indexing and RFQ lead extraction).
   - `zoho-estimate.ts` & `neodove.ts` & `custom.ts` (applying `config.fieldMapJson`).
3. **Dual-Mode Execution (`realtime` vs `batch`):**
   - Resolve `deliveryMode` from the matched `hlp_integration_instance` (falling back to `manifest.inbound.defaultDeliveryMode`).
   - **`realtime`**: Run `c.executionCtx.waitUntil(processIngestedRow(id).then(() => broadcastLive(c, manifest.inbound.liveEvent)))` and return `200 OK` immediately.
   - **`batch`**: Leave `status = 'pending'` for `scripts/ingestion-batch-runner.js` (respecting `quietHoursIst` `21:00–09:00 IST` where declared).

---

### Step 5: Safe Production Cutover for Runners (`scripts/`)
1. **`scripts/zoho-sync/fetch.js`:** Resolve Zoho credentials from `GET /api/runner/integrations/resolve?provider=zoho` first; if no enabled DB instance exists yet, fall back to `founder-os_backend/zoho_sent/sent_estimates.txt` so production never breaks during cutover.
2. **`scripts/portal-poller-runner.js`:** Poll enabled pull-mode instances (`tradeindia`, `exportersindia`, `alibaba`, `indiamart` when `captureMode = crm_pull_api`, `google_forms` when `captureMode = forms_api_poller`, `gmail`) using `config.pollCursor` and post fetched items to `/api/webhooks/:provider/:instanceKey`.
3. **`scripts/ingestion-batch-runner.js`:** Claim `status = 'pending'` rows via `POST /api/runner/ingestion/claim`, run mapping + optional AI enrichment via `POST /api/ai/complete`, and ack via `POST /api/runner/ingestion/ack`.

---

### Step 6: Dynamic Frontend Settings UI (`founder-os_frontend/src/components/settings/integrations/`)
Update the Settings → Integrations UI (using `@/components/ui`, `useLiveDashboard`, `useOptimisticMutation`, and `usePagedQuery` — zero raw `fetch` or ad-hoc modals):
1. Group providers by `category` (`ai`, `accounting`, `b2b_portal`, `social`, `forms`, `email`, `geo_enrichment`, `search_enrichment`, `telecalling`, `custom`).
2. Support **multiple instances per provider** (since `multiInstance: true`), with one `Default` badge/toggle (`isDefault`) so `call("openai")` or `call("zoho")` resolves the default while `call("openai", { instanceKey: "groq_fast" })` targets a specific instance.
3. Dynamically render `configFields` (`text`, `number`, `boolean`, `select`, `json`) and `secretFields` (respecting `requiredWhen`), plus a one-click copy box for `/api/webhooks/<provider>/<instanceKey>` whenever `inbound.supported === true`.
4. Include the live **`hlp_ingested_data` Inspector & Replay Drawer** (filtered by `source`, `status`, `deliveryMode`) with side-by-side `rawPayload` vs `normalizedJson` and one-click `Replay`.

---

### Step 7: Update Docs & Run All Guards
1. Update `architecture.md` to document the v2.0.0 integration gateway, `hlp_integration_instance`, `hlp_ingested_data`, and `/api/webhooks/*`.
2. Write/update `scripts/guards/integrations-ingestion.test.mjs` to test every provider in `manifest.json` (signature verification, GET query normalization, idempotency key extraction, field mappers, and `requiredWhen` validation).
3. Run and verify all checks pass with 0 errors:
   - `node founder-os_backend/scripts/core-guard.mjs`
   - `node --test "scripts/guards/*.test.mjs"`
   - `node scripts/dup-audit.mjs`
   - `cd founder-os_backend && pnpm build && tsc --noEmit && node scripts/build-worker.mjs && node scripts/smoke-worker.mjs`
   - `cd founder-os_frontend && npm run build && tsc --noEmit`

---
### `manifest.json` (v2.0.0)
[PASTE THE manifest.json v2.0.0 CONTENT HERE]