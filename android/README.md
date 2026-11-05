# Founder Calls (Android POC)

Standalone proof-of-concept for the call recording + call logging task. See `.kilo/plans/1793845667459-android-call-recording-plan.md`.

## What this build does

- Detects incoming/outgoing calls and logs every attempt to a local Room DB.
- Reconciles each call against `CallLog.Calls` after hang-up (ground truth for duration/outcome).
- Records audio with a selectable AudioSource, speaker forced on, amplitude polled.
- Matrix screen scores far-side audibility 1–5 per source and exports CSV.
- Nothing syncs until the audio gate passes.

## Build and install

Requirements: Android Studio with a paired, USB-debugging-enabled Samsung company phone.

```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`./gradlew` downloads Gradle 8.7 on first run. If the wrapper fails, open the project in Android Studio and let it sync.

## Server wiring (debug)

Debug builds call `http://127.0.0.1:8787`. Forward the phone to a local worker:

```bash
adb reverse tcp:8787 tcp:8787
cd ../founder-os_backend
npx wrangler dev --port 8787
```

Release builds call the deployed worker (see `API_BASE` in `app/build.gradle`).

## POC procedure

1. Grant every permission and disable battery optimization.
2. Open **Test matrix**, pick `VOICE_RECOGNITION`.
3. Make 5 outgoing and 5 incoming connected calls. Play each recording back and score it.
4. Repeat for `MIC`, `VOICE_COMMUNICATION`, `VOICE_CALL`, and `AUTO`.
5. Export CSV and compare against the system call log.

**Gate:** GO if a source scores ≥3/5 on ≥60% of connected calls. Otherwise stop and design the cloud-bridge fallback.

## Known Android constraints

- Android 10+ blocks third-party `VOICE_CALL`; it will usually be silent.
- OEMs may kill the foreground service unless battery-optimized.
- The far side is only clearly audible through the speaker/mic path.
