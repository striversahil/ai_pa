# Android Call Recording + Call Log — implementation plan

## Goal

Ship a company-owned Android app that (a) records cellular calls best-effort, (b) logs every attempt/connected/missed/rejected event even when audio fails, (c) syncs offline-safe to the existing Founder OS Worker/D1, and (d) gives managers a review tab with KPIs, search and playback.

**Hard gate:** audio quality is proven by a standalone POC before backend/sync work starts. Samsung company phone, Android 13+, sideload via Android Studio/USB. No Play Store, no Accessibility helper in v1.

## Decisions already locked

| Decision | Value |
|---|---|
| POC device / distribution | Company Samsung Android 13+, sideload APK (Android Studio now, MDM later) |
| Backend | Existing Cloudflare Worker + D1, new private R2 bucket for audio |
| App auth | Manager-issued one-time pairing code → per-device revocable token (hashed at rest) |
| Leaderboard | Explicit 3-way source setting: `neodove` / `manual` / `device` |
| Recording retention | 90 days in R2, lifecycle purge; owner agent + MIS/sales-head/root playback |
| Capture scope | Outgoing + incoming on the primary SIM; logging-only fallback |
| POC gate | 10 connected test calls (5 out / 5 in) across the source matrix; GO if far-side score ≥3/5 on ≥60%, else design cloud bridge |
| Project location | `android/` Gradle project in this repo; debug builds use `http://127.0.0.1:8787` via `adb reverse` to `wrangler dev`; release uses the real worker origin |
| Dashboard | New Sales → Calls tab; agent-self + manager-all |
| Permissions | Reuse `telecalling` for self reads; `requireSalesManager` for pairing/revoke/all-region |
| Upload policy | 7-day offline queue, any network (Wi-Fi-only toggle), 60 min / 30 MB cap, 10-min parts, purge local only after ACK |
| Consent | First-run disclosure + explicit accept (stored locally and audit-logged server-side); server `loggingOnly` flag per device, polled by the app |
| Caller identity | Full E.164 + contact-name snapshot + hash; dashboard read-only match to MasterCustomer, no CRM writes |

**Out of scope v1:** WhatsApp/Telegram VoIP, iOS, cloud telephony bridge, transcription/keyword search, MDM packaging, Play Store review, release signing, CRM writes from calls.

---

## Phase 0 — scaffolding (no device behavior yet)

1. Create `android/` as a standalone Gradle project, package `in.brindavan.foundercalls`.
2. `android/.gitignore`: `local.properties`, `**/build/`, `.gradle/`, `*.jks`, `*.keystore`, captures.
3. Stack: Kotlin 2.x, AGP current, Compose BOM, `minSdk 26`, `targetSdk` current. Room + KSP, WorkManager, DataStore, androidx `security-crypto`, OkHttp, kotlinx-serialization.
4. `BuildConfig.API_BASE` per build type: debug `http://127.0.0.1:8787`, release real worker URL; `usesCleartextTraffic` true in debug only.
5. Manual DI via an `AppContainer` (no Hilt in the POC). `android/README.md` documents `adb reverse tcp:8787 tcp:8787`, `./gradlew :app:assembleDebug`, `adb install -r app/build/outputs/apk/debug/app-debug.apk`, and how to read `adb logcat`.
6. Verify the empty app builds and installs on the paired Samsung.

## Phase 1 — standalone POC (GO/NO-GO gate)

No backend, no auth, no upload.

### Data (local only)

Room entities:
- `CallEvent`: id, deviceId (install UUID), direction, numberE164, contactName, attemptAt, ringStartAt, connectAt, endAt, status, callLogType, durationSec, ringSec, simSlot, recordingPath, recordingBytes, maxAmplitude, userFarSideScore, reconciliatonNote.
- `RecordingAttempt`: callId, audioSource, startedAt, endedAt, bytes, maxAmplitude, verdict (`ok|silent|error`), errorText.
- `SyncQueue`: unused placeholder for Phase 2.

### Components

1. `ConsentScreen`: plain-language disclosure (calls are recorded for QA/manager review, storage on company servers, 90-day audio retention), explicit Accept, persists flag.
2. `PermissionOnboarding`: request `READ_PHONE_STATE`, `READ_CALL_LOG`, `READ_CONTACTS`, `RECORD_AUDIO`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE_MICROPHONE`, `FOREGROUND_SERVICE_PHONE_CALL`, `RECEIVE_BOOT_COMPLETED`; launch `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
3. `CallStateReceiver`: `PHONE_STATE` + `NEW_OUTGOING_CALL`; derives RINGING → OFFHOOK → IDLE, ring/connect/end times, direction.
4. `CallTrackingService`: foreground `phoneCall` type, persistent notification with call state and counters.
5. `RecordingManager`: one source per test call, selected on the matrix screen, in order `VOICE_RECOGNITION → MIC → VOICE_COMMUNICATION → VOICE_CALL`. `MediaRecorder` AAC 16 kHz mono `.m4a` in app-private storage; poll `getMaxAmplitude()` every 200 ms; mark `silent` when the whole recording stays at 0; mark `empty` under 2 s or 10 KB.
6. `CallLogReconciler`: after IDLE query `CallLog.Calls` last 5 rows, match number + `DATE` within 60 s, copy status/duration/callLogType; ground truth wins over receiver guesses.
7. `MatrixScreen`: pick source, run one test call, playback via a local `ExoPlayer`/`MediaPlayer`, 1–5 far-side score, notes, running CSV `Share` export with device model, Android version, source, bytes, amplitude, score.
8. `CallLogScreen`: all captured calls + attempt details; manual score edit; CSV export.
9. `TrackingToggle` + boot receiver to restore tracking after reboot.

### Acceptance

- 10 connected calls captured, 5 outgoing + 5 incoming, each source exercised.
- CSV reconciles to `CallLog.Calls` for the same window (no missing attempts, no invented connected calls).
- Score the gate: ≥3/5 on ≥60% of connected calls → GO. Otherwise stop and plan the cloud-number path.

## Phase 2 — backend auth, ingestion, dashboard (can start in parallel once Phase 1 builds)

### Migration `0107_device_calls.sql`

```
DeviceRegistration(id PK, telecallerId, tokenHash UNIQUE, deviceId, label,
  status 'active|revoked', loggingOnly INT DEFAULT 0, consentAt, lastSeenAt,
  appVersion, pairedBy, pairedByName, createdAt, updatedAt, revokedAt, revokedBy)
DevicePairCode(code PK, telecallerId, expiresAt, usedAt, createdBy, createdAt)
DeviceCall(id PK, deviceId, telecallerId, idempotencyKey UNIQUE, direction,
  numberE164, numberHash, contactName, attemptAt, ringStartAt, connectAt, endAt,
  status, callLogType, durationSec, ringSec, simSlot, day /* server-derived IST */,
  recordingState 'none|pending|uploaded|empty|expired', recordingKey,
  recordingBytes, recordingParts, recordingUploadedAt, receivedAt, createdAt, updatedAt)
indexes: (telecallerId, attemptAt), (day), (numberHash), (deviceId)
```

Also: `prisma/schema.prisma` models, `npx prisma generate`, then register both models in `src/shared/d1-prisma.ts` `BOOL_FIELDS`/`DATE_FIELDS`/`ID_FIELDS`/`UNIQUE_FIELDS` and add getters. Apply remote with `npx wrangler d1 execute waba-worker --remote --file migrations/0107_device_calls.sql`.

### Worker

New `src/modules/device-calls/` following the modular pattern:
- `types.ts` (enums/limits, `idempotencyKey`, hash helper)
- `parse.ts` (batch validation, timestamp clamp, IST day derivation, E.164 normalize)
- `tokens.ts` (32-byte random token, SHA-256 hash, pair-code generation/lookup)
- `scopes.ts` (`requireDevice`, `requireCallManager` — extract `requireSalesManager` from `routes/telecalling.ts` into `worker/context.ts` and re-export)
- `store.ts` (D1 reads/writes, summary aggregation)
- `routes.ts` (thin handlers)

Routes:
- Device token, `AUTH_EXEMPT` prefix `/api/android/`:
  - `POST /api/android/pair` `{code, deviceId, label, appVersion}` → `{token, device, agent, config}`; single-use code, 15-min TTL, 5 attempts/min/IP.
  - `POST /api/android/heartbeat` → `{loggingOnly, maxBytes, maxMinutes, partMinutes, serverTime}`; updates `lastSeenAt`.
  - `POST /api/android/calls` batch ≤200; per-item accepted/duplicate; upsert on `idempotencyKey` so reconcile updates don't duplicate.
  - `PUT /api/android/recordings/:callId` raw `audio/mp4`, `X-Part-Index`; 30 MB cap; R2 key `calls/<YYYY-MM>/<telecallerId>/<callId>-<part>.m4a`; sets `recordingState='uploaded'`.
  - `POST /api/android/calls/:id/recording-empty` marks `empty` with a reason.
- Session + scope:
  - `GET /api/call-log/calls?from&to&agentId&direction&status&q&limit&before` — agents self-locked via `resolveSelfTelecaller`, managers all.
  - `GET /api/call-log/summary` same filters, KPIs from `store.ts`.
  - `GET /api/call-log/recording/:callId` — Range-capable R2 stream; agent-own or manager.
  - `POST /api/call-log/devices/pair-code` `{telecallerId}`; `GET /api/call-log/devices`; `DELETE /api/call-log/devices/:id` (revoke); `PATCH /api/call-log/devices/:id` `{loggingOnly}`.
- Add `DeviceCalls` to `src/live.ts`; broadcast on ingest/revoke/flag change. Invalidate summary cache prefix.

Bindings: add `CALL_RECORDINGS?: R2Bucket` to `Bindings`; add `[[r2_buckets]] binding = "CALL_RECORDINGS"` to `wrangler.toml`; create the bucket and set a 90-day lifecycle rule on prefix `calls/` (manual infra step).

### Leaderboard integration

- New Setting key `call_source` (`neodove|manual|device`), migration seeds it from `manual_calls_mode`.
- `automations/telecalling/device-calls.ts`: `getDeviceCallSums(from,to)` returning attempted/connected/notConnected/talkMin per agent/day.
- `service.ts:341-383` and `:491-511`: add the `device` branch; device rows override NeoDove only when source is `device`. Manual and NeoDove paths unchanged.
- `ManualCallsPanel` toggle becomes a 3-way source switch.

### Dashboard

- `SalesWorkspace.tsx`: rename the `calls` tab to Calls and render new `CallsPanel`.
- `CallsPanel.tsx`: source switch (managers), `DeviceCallsTable` + filters + KPI cards + detail drawer with player, and the existing manual day sheet embedded for `manual` mode.
- Devices section in the Calls header (managers): issue code, copy, list paired devices with last-seen, revoke, logging-only toggle.
- Hooks under `src/device-calls/`: `api.ts`, `normalize.ts`, `types.ts`; `useLiveQuery(..., { events: ["device-calls"] })`; optimistic mutations per §11.5.

## Phase 3 — app sync + recording upload

1. Pairing screen + `DeviceTokenStore` in `EncryptedSharedPreferences`.
2. Retrofit/OkHttp with Bearer interceptor; 401 → re-pair screen.
3. `SyncWorker` (constraint-aware, exponential backoff): flush JSON first, then audio parts; 7-day retention, 500 MB local cap, purge only after 200/ACK.
4. Heartbeat worker every 15 min + on launch: `loggingOnly` and config; server time offset correction.
5. `RecordingManager` writes parts and enqueues them; size/duration caps enforced.
6. Consent accept posts an audit row (`AuditLog action=device.consent`); logging-only mode still logs calls.
7. Release flavor: HTTPS worker origin, debug matrix screen hidden behind a debug menu.

## Phase 4 — pilot hardening

- Boot receiver, Doze/battery whitelist, OEM autostart instructions for Samsung.
- Crash-safe state machine; recorder watchdog; notification actions.
- 50-call QA sheet vs `CallLog.Calls`: attempts, connected, missed, rejected, duration delta.
- Offline 24 h + reboot + airplane + Bluetooth + speaker toggle test.
- Consent audit export; retention job marks `recordingState='expired'` 90 days after upload (daily native cron step).
- MDM rollout guide.

---

## Failure modes to handle explicitly

- Recorder returns silence → `silent` verdict, keep the call row, UI badge; never lose the log.
- Service killed → foreground service + boot receiver + `SyncWorker` backoff.
- Duplicate uploads → unique `idempotencyKey`; R2 keys overwrite per part.
- Clock skew/future timestamps → server clamps and derives IST `day` itself.
- Revoked/lost device → token row status `revoked`, immediate 401, rows retained.
- Playback after lifecycle purge → 404 + `expired` state.
- PII: full number visible only to owner/managers; Controller export counts unchanged.

## Validation

- POC: `./gradlew :app:assembleDebug`, install, complete the 10-call matrix, CSV vs system log.
- Backend: `node scripts/build-worker.mjs && node scripts/smoke-worker.mjs && npx tsc --noEmit` (known pre-existing errors only), then local `wrangler dev` + `adb reverse` + curl pair/log/upload/playback.
- Frontend: `npm run build` (webpack) + typecheck.
- Deploy per standing policy: backend first (`build-worker` → `smoke-worker` → `wrangler deploy`), then frontend (`npm run build` → `wrangler pages deploy out --project-name founder-os-frontend`).

## Open items for the implementer

- Confirm R2 bucket creation and lifecycle API access before Phase 2 deploy.
- Decide whether the POC's `VOICE_CALL` attempt is worth keeping on Android 13+ (expected silent; keep for the matrix record).
- Transcription, cloud bridge and CRM writes remain follow-ups.
