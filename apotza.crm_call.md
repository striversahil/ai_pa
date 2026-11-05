Client Call Recording + Detailed Call Logging - Android App - task.md
1. Task Overview
1.1 Title
Build an Android mobile application for client-managed phones that (a) records phone conversations and (b) logs detailed call metrics: attempts made, connected calls, missed/rejected, durations, timestamps, per-number and per-agent analytics.
1.2 Problem Statement
Field / sales / support teams make dozens of cellular calls per day. Business has no visibility into attempts vs connected, talk-time, missed breakdown, or what was spoken.
1.3 Objectives
1. Auto-capture cellular call audio (both sides best-effort) on managed devices.
2. Log every call event in detail even when audio fails.
3. Sync logs + recordings to backend for manager dashboard, search, playback.
4. Work offline, survive reboots and battery optimization.
5. Stay legally compliant with consent laws.
1.4 Success Criteria
- 95%+ of dial attempts in dashboard within 5 min (when online).
- Connected vs attempt counts match CallLog.Calls ground truth.
- Recordings playable for 80%+ of connected calls on approved fleet.
- No data loss offline for 7 days.
2. Critical Constraint — from active web research Nov 2026
1. Android 10+ blocks 3rd-party VOICE_CALL capture. Returns silence. Must fallback to MIC / VOICE_RECOGNITION / VOICE_COMMUNICATION.
2. Play Store ban effective May 11, 2022: No Accessibility API for call recording. Third-party recorders rejected/removed.
3. Only privileged apps truly record: system pre-loaded dialer (Samsung/Pixel), rooted, or sideloaded helper + Accessibility — this is how Cube ACR works today: main app on Play + Helper APK sideloaded from website/APKMirror.
4. Logging is fully allowed: READ_CALL_LOG + READ_PHONE_STATE + Telecom APIs with justification.
5. Native dialers announce: "This call is now being recorded" — cannot be silently disabled via public API.
Implication: If these are company-owned phones you control -> distribute via MDM / direct APK, NOT Play Store. If it must be Play Store / BYOD -> scope to logging-only + native record link, OR route via cloud telephony (Exotel/Twilio) where server records.
3. Solution Approach: Hybrid A+D
Path A (primary): Internal Enterprise App sideloaded via MDM — full tracking + best-effort audio via ForegroundService + helper.
Path D (fallback): Cloud bridge number — app triggers backend (Exotel/Twilio) to bridge to customer, server records with 100% fidelity. Use when device audio fails QA.
Out of scope V1: WhatsApp/Telegram VoIP, iOS.
4. Scope V1
Mobile (Kotlin, minSdk 26): call-state detection, detailed log + Room DB, foreground-service recording with fallback chain, encrypted storage + WorkManager upload, login, consent UI, settings.
Backend: Auth, ingestion APIs, S3 audio storage, Postgres, manager dashboard with KPIs, playback, filters.
Ops: MDM rollout guide + battery-whitelist per OEM + legal consent trail.
5. Functional Requirements
FR-1 Detection: PHONE_STATE (RINGING->OFFHOOK->IDLE) + NEW_OUTGOING_CALL + TelephonyCallback (API 31+) + CallScreeningService. Compute ringDuration = connect - ringStart, talkDuration = end - connect. Attempt = every dial/RINGING, connected = reached OFFHOOK duration>0.
FR-2 Logging (must work even if audio fails):
number, contactName, direction IN/OUT, attemptTime, ringStart, connectTime, endTime, status CONNECTED/MISSED/REJECTED/BLOCKED/FAILED, callLogType 1/2/3/5/6, durationSec, simSlot, agentId, deviceId
Reconcile after IDLE by querying CallLog.Calls (last 5 rows, match number+DATE within 60s). Derive totals, connectRate, avg talk/ring, repeat-attempt rate.
FR-3 Recording: ForegroundService microphone|phoneCall with ongoing notification. Start OFFHOOK, stop IDLE. Try VOICE_RECOGNITION -> MIC -> VOICE_COMMUNICATION -> VOICE_CALL. AAC 16kHz mono .m4a (~0.5-1MB/min). Filename {agentId}_{ts}_{dir}_{hash}.m4a, encrypted (EncryptedFile + Keystore). Mark RECORDING_EMPTY if <2s/<10KB. Upload via WorkManager with exponential backoff.
FR-4 Sync: Room call_events, recordings, sync_queue. JSON log first, then audio. Idempotency deviceId+attemptTime+number. 7-day offline retention, purge after ACK.
FR-5 Dashboard: Filters date/agent/direction/status/number. KPIs attempts, connected, %, missed, rejected, total/avg talk, repeat rate. Table + detail + player. Roles Admin/Manager/Agent.
FR-6 Consent: First-run disclosure, region toggle for logging-only mode, audit log.
6. Technical Design
Mobile: Kotlin + Coroutines/Flow, Compose, Hilt, Room, Retrofit/OkHttp, WorkManager, MediaRecorder/AudioRecord, JWT auth. QA on Samsung OneUI, Pixel stock, Xiaomi MIUI, OnePlus ColorOS.
Components: CallStateReceiver, CallTrackerService (Foreground), CallLogObserver, AccessibilityHelperService (helper APK), RecordingManager, SyncWorker.
Permissions: READ_PHONE_STATE, READ_CALL_LOG, READ_CONTACTS, READ_PHONE_NUMBERS, RECORD_AUDIO, POST_NOTIFICATIONS, FOREGROUND_SERVICE_*, PROCESS_OUTGOING_CALLS, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, RECEIVE_BOOT_COMPLETED, BIND_ACCESSIBILITY_SERVICE
Backend APIs:
POST /v1/auth/login
POST /v1/calls/log
POST /v1/calls/:id/recording/init -> presigned S3 URL
PUT <s3> + POST /v1/calls/:id/recording/complete
GET /v1/calls?from=&to=&agentId=&status=&q=
GET /v1/stats/summary
DB Postgres: agents(id,name,team,device_id), calls(id, idempotency_key UNIQUE, agent_id, direction, number_e164, number_hash, attempt_at, connect_at, end_at, status, duration_sec, ring_sec, recording_url, recording_state) indexed on (agent_id, attempt_at).
Storage: Private S3/R2, presigned GET 15min, SSE.
7. Execution Phases
Phase 0 Discovery (3-4d): Lock fleet models + MDM, distribution MDM vs Play, legal review, KPI definitions.
Phase 1 POC (1w) GO/NO-GO: Throwaway APK testing all AudioSources on 3-4 real devices, score far-side 1-5. If <3, design cloud-number path.
Phase 2 Logging MVP (1-2w): Tracker + reconciliation + backend + dashboard. QA 50 calls vs system log.
Phase 3 Recording+Sync (2-3w): Recorder + encryption + upload + playback + whitelist onboarding. Test interrupts, reboot, 24h offline.
Phase 4 Pilot (2w): 10 agents via MDM, Crashlytics + remote config, storage caps, consent audit. GO for fleet or pivot to cloud.
Phase 5 V2: Transcription, keyword search.
8. Test Plan
Matrix Samsung/Pixel/Redmi/Nord x Android 11-14. Cases: out-connect, out-no-answer, in-connect, in-missed, rejected, blocked, airplane, dual-SIM, BT, speaker toggle, back-to-back, reboot, Doze. Metrics: log accuracy vs CallLog, recording success, MOS, battery/8h, 24h offline upload.
9. Risks
Far-side inaudible -> early matrix + speaker prompt + cloud fallback. OS kills service -> Foreground + whitelist + BOOT + resync job. Legal -> consent UI + logging-only mode. Storage -> 500MB cap + purge. Play rejection -> ship MDM-only.
10. Deliverables
POC matrix, APK + source, backend + dashboard staging URL, MDM doc + 50-call QA sheet, privacy sign-off.
11. Open Questions
1. Company-owned + MDM or BYOD + Play required?
2. Top 3 device models?
3. Only SIM or WhatsApp too?
4. Retention 30/90/365d + which law?
5. Cloud-telephony per-min budget OK?