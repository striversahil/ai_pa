# WhatsApp Autopilot — Current State vs Architecture Spec

*Status as of 2026-08-24. Reference: `whatsapp-business-autopilot-architecture.md` (the "spec").
Implementation phase: **0 — Shadow mode** (lineage + association + transitions run and populate
the task queue; no tool ever executes). Everything below is deployed and verified in production.*

---

## 1. What is live right now

| Fact | Value |
|---|---|
| Channel / provider | WA Engine Pro (`waengine.pro`), webhook `POST /webhook` on `founder-os-worker` |
| Ingestion | Live; raw store `waba_payloads` (idempotent upsert) + founder-os pipeline (`Message`, `Contact`) |
| Historical backfill | 345 inbound messages across 72 chats recovered and ingested (`isHistorical = 1`) |
| Media enrichment | 60 historical media messages enriched with downloadable `mediaUrl`; enrichment runs on every new media message |
| Core loop runner | GH Actions cron every 5 min (`scripts/whatsapp-autopilot-runner.js`) — association + state transitions in shadow mode |
| Dashboard | **Automations → WhatsApp Autopilot** (KPIs, review queue, proposed actions, decision history) |
| Review endpoints | `POST /api/autopilot/tasks/:id/review`, `POST /api/autopilot/actions/:id/decide` |
| Data | D1 (`founder-os`): `WaTask`, `MessageLineage`, `WaTaskHistory`, `WaAction`, `OverrideLog` |

---

## 2. Component-by-component: spec vs built

| Spec § | Component | Status | Notes & deviations |
|---|---|---|---|
| §4.2 | Ingestion & normalization | ✅ Built (+fixed) | waengine flat webhooks normalized (derived message id, epoch-seconds). Fixed two production bugs that had silently dropped **all** inbound messages since Aug 18 (`Invalid time value`, missing id) |
| §4.2 | Idempotency on `wa_message_id` | ⚠️ Partial | Raw store dedupes via upsert on derived id; pipeline uses insert-skipDuplicates + in-isolate recent-id cache. No DB-level UNIQUE on pipeline `Message.wahaMessageId` (D1 schema has it on the column but legacy rows predate it) |
| §4.3 | Lineage resolution (`message → parent → root`) | ✅ Built | `MessageLineage` rows written per message via runner (`/api/runner/autopilot/lineage`) |
| §4.3 | Association: deterministic first | ✅ Built | Reply/quote link (`quotedMessageId`) resolved deterministically before any LLM call |
| §4.3 | Association: LLM fallback + confidence gate | ✅ Built | Omniroute LLM infers task against open queue + recent transcript; `< 0.85` → needs_review (env-tunable) |
| §4.3 | Out-of-order pending→resolved re-check job | ❌ Not built | `resolution_status` field exists; background retro-resolver doesn't |
| §4.3 | Internal/vendor `chat_role` heuristic | ❌ Not built | No chats registry yet; recency weighting only |
| §4.4 | Context model (`context_general` / `context_profile`) | ❌ Not built | Runner prompt carries business context inline; no per-contact profiles |
| §4.5 | Task queue fed to LLM (not raw history) | ✅ Built | Open tasks + last-N transcript per chat are what the LLM sees |
| §4.6 | LLM state-transition engine (8 transitions) | ✅ Built | create/update/complete/reopen/wait/clarify/review/action, JSON-structured output |
| §8 | Separate confidence gates | ✅ Built | Assoc 0.85 · Create/Update 0.80 · Complete 0.90 (env-tunable); Wait/Clarify commit-safe at any confidence |
| §8 | Override logging for threshold tuning | ✅ Logging side | `OverrideLog` written on human decisions; analytics view not built |
| §4.7 | Tool registry with `requires_approval` / `on_failure` | 🟡 Proposed-only | Tools exist as proposals (`WaAction.status=pending`); no executor, no retry/failure policies — correct for shadow mode |
| §4.7 | Load-bearing vs side-effect action failure semantics | ❌ N/A yet | Activates with Phase 1 execution |
| §4.8 | Human review view | ✅ Built | Review queue with reason + confidence; approve/keep-open/wait/cancel per task; approve/reject/did-it-manually per proposed action |
| §4.9 | Follow-up scheduler + `follow_up_policy` | ❌ Not built | Columns exist (`followUpDueAt`, `waitTimeoutAt`, `followUpCount`); scheduler automation does not |
| §4.10 | Per-chat serialization | 🟡 Structural | 5-min batch loop makes races unlikely by construction; no explicit per-chat lock |
| §4.10 | Optimistic concurrency (`version`) | ✅ Built | Conditional writes; conflict → re-read + re-run Phase 2 (runner logs it) |
| §4.10 | Create-dedupe window | ✅ Built | Server-side check for same `(chatId, item, open)` before Create |
| §4.11 | Multimodal — images/PDF/vision/catalog | 🟡 Minimal | Media URLs + captions stored (`mediaUrl`, `[Image] caption` bodies). No transcription, extraction, vision, or catalog parsing |
| §4.12 | Database source of truth | ✅ Built | See mapping below |
| §7 | Failure modes / degradation config | 🟡 Partial | Webhook failures logged + swallowed safely; LLM/tool failure policies not implemented |
| §9 | Messaging-window / template compliance | ❌ N/A yet | Nothing sends; relevant from Phase 1 |
| §13 Phase 0 definition | Shadow mode | ✅ **This is exactly what shipped** | "You still work WhatsApp normally, with a structured view alongside it" |

---

## 3. Data model mapping

| Spec table | Actual table(s) | Deviation |
|---|---|---|
| `messages` | existing `Message` (+ new `mediaUrl` col) | Pre-dates autopilot; no `message_kind`/`transcript` cols — kind inferred from body placeholders |
| `message_lineage` | `MessageLineage` | Same fields incl. `associationMethod`, `confidence`, `resolutionStatus` |
| `chats` / `contacts` | existing `Contact` | No `chat_role`, no separate chats table |
| `tasks` | `WaTask` | Adds `cancelled` status, `priority`, `summary`, `followUpCount`; lacks `contactId`, `associationTaskId` (linked-task chains), `in24hWindow` |
| `task_history` | `WaTaskHistory` | Same shape + `confidence` per entry |
| `actions` | `WaAction` | Input/output as JSON strings; adds `reason`, `error`, `executedManual` status |
| `override_log` | `OverrideLog` | Same shape |
| `context_general` / `context_profile` | — | Not built |
| `follow_up_policy` | — | Not built (defaults hardcoded in runner env) |
| `products` / `vendors` | — | Not built |

---

## 4. Deliberate deviations from the spec

1. **Channel**: spec assumes Meta Cloud API/BSP. Reality: WA Engine Pro (already contracted, session-based). §9 window/template rules will need re-mapping against waengine's capabilities before Phase 1.
2. **Stack**: spec's MVP (n8n/Claude/Supabase) and custom-build (Node+Redis+Celery) paths were both skipped in favor of the **existing founder-os platform**: Cloudflare Worker + D1, GH Actions as the compute/cron layer, Omniroute LLM, Next.js dashboard. Zero new infrastructure.
3. **Batch vs real-time**: spec describes synchronous per-message processing. The loop runs every 5 minutes. Acceptable while nothing sends; Phase 1 should move association/transition into the webhook path (`waitUntil`) if reply latency matters.
4. **Naming**: `Wa*` prefixes avoid collisions with the pre-existing digest-era tables.

---

## 5. Gaps to close before Phase 1 (assisted mode)

- [ ] Move the core loop from GH batch to webhook-path processing (or shorten cadence)
- [ ] Tool executor + per-tool `requires_approval` / `on_failure` config (the actual Phase-1 dial)
- [ ] Follow-up scheduler (customer silence + internal Wait timeouts) + `follow_up_policy` table
- [ ] Context model: `context_general` draft + optional per-contact profiles
- [ ] Chats registry with `chat_role`; internal/vendor association heuristic
- [ ] Pending-lineage retro-resolver job
- [ ] Voice-note transcription during ingestion (waengine audio → STT)
- [ ] Review-queue backlog alerting (depth threshold → notify owner)
- [ ] Template/window compliance strategy for outbound nudges
- [ ] Override-rate analytics to start tuning thresholds with real data

---

## 6. Ops facts

- Deploy targets: `wrangler deploy` (worker), `wrangler pages deploy out` (frontend), `wrangler d1 execute founder-os --remote --file d1/schema.sql` (migrations; file is fully idempotent)
- Secrets: worker secrets (`SHARED_SECRET`, `WA_ENGINE_API_KEY`, `OMNIROUTE_*`, …) + repo secrets for GH Actions
- Runner tuning env: `ASSOC_THRESHOLD`, `TRANSITION_CREATE_THRESHOLD`, `TRANSITION_COMPLETE_THRESHOLD`, `AUTOPILOT_AUTO_CLOSE_DAYS`
- Known quirk: root `.env` ships empty placeholders (`WORKER_URL=`, `SHARED_SECRET=`, `WA_ENGINE_API_KEY=`) — use `founder-os_backend/.env` for real local values
