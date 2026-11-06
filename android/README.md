# Founder Calls — Android call recording + call log

Companion app for the Founder OS **Sales → Calls** pipeline. Each telecaller's
phone logs every call attempt locally, records audio (speaker-path), and syncs
to the worker, where the Sales Leaderboard reads it as one of three
`call_source` modes (`neodove | manual | device`).

> **Status:** Phase 1 is a standalone audio-gate POC (does the far side come
> through on this hardware at all?). The sync path to production is implemented
> and end-to-end tested, but R2 audio upload is **not live yet** — see
> [Recordings & R2](#recordings--r2).

## How it fits together

```
Phone call ──▶ CallReceiver ──▶ CallTrackingService (foreground, phoneCall|microphone)
                      │                    │  start RecordingManager on OFFHOOK
                      │                    ▼  stop + reconcile CallLog.Calls on IDLE
                      │              Room DB (call_events, recording_attempts)
                      │                    │
                      │              SyncWorker (WorkManager, 15-min + on-demand)
                      │                    │  heartbeat → batch → recording PUTs
                      ▼                    ▼
              Worker /api/android/* ──▶ D1 device_calls tables ──▶ R2 CALL_RECORDINGS
                                                              ──▶ dashboard CallsPanel
```

- **This repo (`android/`):** detection, recording, local queue, sync client, UI.
- **Backend:** `founder-os_backend/src/modules/device-calls/` (types/parse/tokens/
  scopes/store) + `src/worker/routes/android.ts` (device auth) +
  `src/worker/routes/call-log.ts` (sessions/manager). Device endpoints are
  `AUTH_EXEMPT` and enforce `requireDevice`, not sessions.
- **Dashboard:** Sales → Calls tab (`CallsPanel.tsx`) — pairing codes, device
  list, heartbeat/`appVersion`/consent state.
- **Leaderboard:** device aggregates live in
  `automations/telecalling/device-calls.ts`. Exactly **one** `call_source` is
  active at a time — never sum device + NeoDove for the same call (the 20%
  double-count trap).

## Repo layout

```
android/
  app/
    build.gradle                    # API_BASE per variant, Room/KSP, WorkManager, OkHttp
    src/main/
      AndroidManifest.xml           # permissions, foreground service, receivers
      java/in/brindavan/foundercalls/
        MainActivity.kt             # single-activity Compose nav
        FounderCallsApp.kt          # DI container + restores sync loop on launch
        call/
          CallReceiver.kt           # PHONE_STATE / NEW_OUTGOING_CALL → service
          CallState.kt              # in-memory active-call machine
          CallTrackingService.kt    # foreground service: begin → record → reconcile
          RecordingManager.kt       # MediaRecorder + speaker route + amplitude poll
        data/
          Db.kt                     # Room entities/DAO (call_events, recording_attempts)
          Prefs.kt                  # DataStore: consent, tracking, speaker, wifiOnly, source
          DeviceTokenStore.kt       # EncryptedSharedPreferences bearer token
          Support.kt                # Permissions, Numbers.e164, CallLogReconciler, Clock
        sync/
          ApiClient.kt              # OkHttp client for /api/android/*
          SyncWorker.kt             # heartbeat → batch → recordings → purge
          SyncScheduler.kt          # one-shot + 15-min periodic WorkManager
        ui/
          ConsentScreen.kt / PermissionsScreen.kt / HomeScreen.kt
          CallLogScreen.kt / CallDetailScreen.kt / MatrixScreen.kt
          Export.kt / Components.kt / Theme.kt
```

## Requirements

- JDK 17 (Gradle 8.7 downloads on first `./gradlew` run).
- Android Studio (Hedgehog+) if the wrapper fails to bootstrap.
- A physical Samsung company phone with USB debugging (emulators can't test
  telephony audio). `minSdk 26`, `targetSdk 34`.
- `adb` on PATH.

## Build variants

| Variant   | `applicationId`              | `API_BASE`                                              |
|-----------|------------------------------|---------------------------------------------------------|
| `debug`   | `in.brindavan.foundercalls.debug` | `http://127.0.0.1:8787` (via `adb reverse`)        |
| `release` | `in.brindavan.foundercalls`       | `https://founder-os-worker.connect-bui2.workers.dev` |

`versionName` is sent as `appVersion` on every heartbeat and shown in the
dashboard device list — bump it for every testable build.

```bash
cd android
./gradlew :app:assembleDebug            # APK → app/build/outputs/apk/debug/
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Release: `./gradlew :app:assembleRelease` (unsigned by default; sign in Android
Studio or via `signingConfigs` for sideload distribution — no Play Store).

## Local server wiring (debug)

Debug builds talk to `127.0.0.1:8787` **on the phone**, so forward it:

```bash
adb reverse tcp:8787 tcp:8787
cd ../founder-os_backend
npx wrangler dev --port 8787
```

`adb reverse --list` to verify. Release builds hit the deployed worker directly.

## Pairing a device

Auth is a manager-issued **one-time code**, not a password on the phone:

1. Dashboard → Sales → Calls → Devices → issue a `DevicePairCode` for the agent.
2. On the phone: open the app → accept consent → enter the code.
3. App generates a random `deviceId` (DataStore) + 32-byte token; the **server
   stores only the token's SHA-256** (`DeviceRegistration`), the phone keeps
   the raw token in `EncryptedSharedPreferences`. Raw tokens are never logged
   or persisted server-side.
4. Pair codes are single-use. `401` from any sync call wipes the local token
   (re-pair required).

## App tour

| Screen | Purpose |
|--------|---------|
| Consent | Explicit recording-consent gate. `consent` ships on every heartbeat; the server writes `AuditLog(device.consent)` and `consentAt` on the registration row. No consent → no recording. |
| Permissions | Requests `READ_PHONE_STATE`, `READ_CALL_LOG`, `READ_CONTACTS`, `RECORD_AUDIO` (+ `POST_NOTIFICATIONS` on 33+). Also deep-links to disable battery optimization — OEM task killers stop the foreground service otherwise. |
| Home | Tracking toggle, test AudioSource picker, force-speaker toggle, Wi-Fi-only upload toggle, pair state, Sync-now button. |
| Call log / detail | Every attempt from Room: direction, E.164 + contact snapshot, timestamps, status, duration, source, amplitude, verdict, per-source attempts. Playback via FileProvider. |
| Test matrix | The Phase-1 gate screen: per-source far-side score 1–5, CSV export. |
| Export | CSV of the matrix for the GO/NO-GO decision. |

## Call pipeline (on-device)

1. **Detect.** `CallReceiver` maps `NEW_OUTGOING_CALL` → `outgoing()`,
   `RINGING` → `incoming()`, `OFFHOOK` → `connected()`, `IDLE` → `ended()`.
2. **Track.** `CallTrackingService` (foreground, `phoneCall|microphone`, sticky)
   inserts one `call_events` row at ring/dial with a UUID, contact snapshot via
   `PhoneLookup`, and IST day (`Asia/Kolkata`).
3. **Record.** On connect, `RecordingManager` starts `MediaRecorder`
   (MPEG_4/AAC, 16 kHz mono, 1 h cap) with the configured source — or the
   `AUTO` fallback order `VOICE_RECOGNITION → MIC → VOICE_COMMUNICATION →
   VOICE_CALL` — forcing speaker on, polling `maxAmplitude` every 250 ms.
   Failed sources are logged to `recording_attempts` and skipped.
4. **Reconcile.** On hang-up the recording stops and the row is reconciled
   against `CallLog.Calls` (last-10s window, last-10-digit match = ground truth
   for duration/outcome: missed/rejected/blocked/connected). Unmatched rows are
   kept with `note='unmatched'`, never dropped.
5. **Verdict.** `OK / SILENT (amp 0) / EMPTY (<2 s or <10 KB) / ERROR`.

Identity is full E.164 + contact snapshot + hash. Calls never write CRM or
enquiries in v1.

## Sync protocol

`SyncWorker` runs every 15 min (`SyncScheduler`, `CONNECTED` or `UNMETERED` if
Wi-Fi-only is on) plus on-demand from Home. Each run:

1. **Heartbeat** `POST /api/android/heartbeat`
   `{ deviceId, appVersion, consent }` → `{ loggingOnly, maxBytes,
   maxMinutes, partMinutes, serverTime }`. `loggingOnly` disables recording
   (calls still logged). `maxBytes` caps each upload.
2. **Batch** `POST /api/android/calls` — up to 200 unsynced rows. Server
   replies `{ accepted, duplicates, errors }`; rows are marked synced by
   positional acceptance. `idempotencyKey = deviceId|attemptAt|numberE164`
   makes retries safe.
3. **Recordings** `PUT /api/android/recordings/:callId?part=0` (up to 20/run,
   skipped when over `maxBytes`) or `POST .../recording-empty` for
   empty/missing files so the server stops waiting.
4. **Purge** — 7-day offline queue: ACKed rows older than 7 days (and their
   audio) are deleted, orphan attempts cleaned, total local audio capped at
   ~500 MB (oldest synced files first).

Failures: `401` clears the token; other 4xx (except 429) succeed-without-retry
(poison rows don't wedge the queue); 5xx/network retries via WorkManager
backoff. The loop is restored on app launch and on `BOOT_COMPLETED`
(`BootReceiver`); scheduler reads prefs off-main-thread (ANR-safe).

## Recordings & R2

Server layout (when enabled): private R2 bucket `CALL_RECORDINGS`,
`calls/<YYYY-MM>/<telecallerId>/<callId>-<part>.m4a`, 90-day lifecycle,
streamed by `GET /api/call-log/recording/:callId` (Range). Rows flip to
`expired` on the 21:35 UTC cron.

> **Current state:** R2 is not enabled on the Cloudflare account (API 10042),
> so the `[[r2_buckets]]` binding is commented out of `wrangler.toml` and
> upload handlers return **501**. To go live: enable R2 in the dashboard →
> `wrangler r2 bucket create founder-os-call-recordings` → 90-day lifecycle on
> `calls/` → restore the binding block → redeploy.

## Phase-1 audio gate (POC procedure)

Goal: prove far-side audibility through the speaker/mic path on the actual
hardware before building dashboards on top.

1. Grant every permission; disable battery optimization.
2. Open **Test matrix**, pick `VOICE_RECOGNITION`.
3. Make **5 outgoing + 5 incoming connected calls**; play each back, score
   far-side 1–5.
4. Repeat for `MIC`, `VOICE_COMMUNICATION`, `VOICE_CALL`, `AUTO`.
5. Export CSV; cross-check against the system call log.

**Gate: GO if a source scores ≥ 3/5 on ≥ 60% of connected calls.**
Otherwise stop — design the cloud-bridge fallback instead of shipping the app.

## Permissions

| Permission | Why |
|------------|-----|
| `READ_PHONE_STATE` | Ring/off-hook/idle transitions |
| `READ_CALL_LOG` | Ground-truth reconcile (duration/outcome) |
| `READ_CONTACTS` | Contact-name snapshot per call |
| `READ_PHONE_NUMBERS` | SIM/slot attribution |
| `RECORD_AUDIO` | Recording |
| `POST_NOTIFICATIONS` (33+) | Foreground-service status |
| `FOREGROUND_SERVICE[_MICROPHONE\|_PHONE_CALL]` | Keep tracking alive during calls |
| `RECEIVE_BOOT_COMPLETED` | Restore tracking + sync after reboot |
| `MODIFY_AUDIO_SETTINGS` | Speaker routing |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Ask to exempt from OEM killing |

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| No rows on incoming calls | `READ_PHONE_STATE` denied, or OEM killed the service — check notification is present, disable battery optimization |
| Durations 0 / `unmatched` | `READ_CALL_LOG` denied, or dual-SIM log lag — grant + retry next call |
| Silent recordings (`SILENT`) | Wrong source for this device — run the matrix, try another source |
| `VOICE_CALL` silent | Expected on Android 10+ (blocked for third-party apps) — use speaker-path sources |
| Sync never runs | No network / Wi-Fi-only on mobile data — toggle in Home; `adb shell dumpsys jobscheduler` for WorkManager state |
| 401 loop | Token wiped server-side — re-pair with a fresh manager code |
| Recording upload 501 | R2 not enabled yet — expected, see above |
| Release hits localhost | Installed a debug APK over release (`.debug` suffix) — check package name |

## Known Android constraints

- Android 10+ blocks third-party `VOICE_CALL` capture — it records silence.
- The far side is only reliably audible via the speaker/mic path
  (`VOICE_RECOGNITION`/`MIC` with speaker forced on).
- OEMs (esp. Samsung power management) kill foreground services unless the app
  is battery-exempt — the app nags for this on first run.
- One active call is tracked at a time; call-waiting edge cases resolve to the
  newest attempt.

## Backend reference (for app devs)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/android/pair` | one-time code | Exchange code → token |
| `POST /api/android/heartbeat` | `Bearer` device token | Consent/version ping, caps |
| `POST /api/android/calls` | device token | Idempotent batch ingest |
| `PUT /api/android/recordings/:callId` | device token | Audio part upload (R2) |
| `POST /api/android/calls/:id/recording-empty` | device token | Mark no-audio so server stops waiting |

Server tables: `DevicePairCode`, `DeviceRegistration` (sha-256 only),
`DeviceCall`, `DeviceCallRecording`, `AuditLog(device.consent)`.
Migration `0107_device_calls.sql` created the v1 schema.
