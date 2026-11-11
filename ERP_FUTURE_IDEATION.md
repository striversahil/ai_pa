# ERP Future Ideation — Planned, Not Built Yet

> **Status:** ACCEPTED into plan, explicitly **deferred** — do not build in Phase 0–1.
> These three asks from management are answered here so the core design stays compatible from day one.
> Source: discussions Nov 2026 (buddy mode, escalation flashing, lead-magnet + AI marketing).
> Foundation: `ERP_TRANSITION_PLAN.md` (D1-native core `core_*` + helpers `hlp_*`, Zoho/NeoDove stay live).

---

## 1. Buddy Mode (absence cover)

**Ask:** when a staff member is absent, someone else gets temporary access to their dashboard/tasks as "buddy", and every buddy action is logged because the original owner's work would otherwise halt.

**Verdict:** supported by the transitioned model with no extra architecture. Configuration, not a new system.

### How it will work

1. **Absence is a dated fact.** Manager marks `core_employee.absentSince` (same field `Telecaller.absentSince` has today) or sets `validTo` on the person's position/region assignment. No login is ever shared.
2. **Cover is a temporary grant, not identity theft.** One of:
   - Reassign the absent person's open `core_action` rows to the buddy with `reason = "buddy-cover for <name>, <from>–<to>"`, or
   - Add a dated `core_emp_position / core_assignment / core_team_member` row for the buddy (`validFrom/validTo` = absence window).
3. **Buddy sees two queues in their own login:** their own `My Work` + a `Buddy: covering for X` section (same components, scope filter extended). They never "log in as" the absent person.
4. **Attribution stays correct.** Every write stamps `core_row_change.actorId = buddy` + `core_audit_event { actor: buddy, coveredFor: absent, reason }`. The log reads *"Ravi (covering for Asha, 12–14 Nov) confirmed SO-123"* — never credits the absent person.
5. **Auto-expiry.** When the window ends the grant lapses, the section disappears, and still-open items route back to the original owner. Escalation `reassign: true` steps already do the automatic version of this.

### Guards

- Buddy never inherits powers they don't hold (credit-limit, cancellation, export stay permission-checked against the buddy's own roles; extra powers need an explicit delegated `core_approval_request`).
- Prototype exists today: `EstimateAssignment.tempForTelecallerId` + `absentSince` — the transition generalizes it from estimates-only to every queue.

### Build trigger (later)

- Phase 2+ : add `absentSince` to `core_employee`, cover-reason to `core_action_event`, `Buddy` section to `hlp_dashboard`. No core redesign needed.

---

## 2. Escalation + Flashing Notifications (overdue ladder)

**Ask:** if a task is escalated or not done, a notification must fire in the owner's panel; if still ignored after consecutive system flashes, it must climb levels automatically.

**Verdict:** supported — this is the escalation ladder in `07-work.ts` + §9 of the transition plan.

### How it will work

1. **Every task has a clock:** `core_action { dueAt, nextEscalationAt, escalationLevel, escalationPolicyId }`. Policies seeded per department (`qualify_enquiry, estimate_followup, verify_order, confirm_stock, confirm_payment, schedule_dispatch, collect_payment, default`) with steps like L1 +0m → assignee, L2 +120m → direct manager + HIGH, L3 +480–1440m → position (sales-head / accounts-head / founder) + URGENT, optionally reassign.
2. **Sweeper flashes on the existing 5-min cron:** picks up `OPEN/IN_PROGRESS/WAITING` rows with `nextEscalationAt <= now()`, applies the next `core_escalation_step` (notify + raise + schedule next), writes `core_action_event (ESCALATED)` + `core_notification` + `core_system_job` log line.
3. **Lands in-panel first:** owner queue flashes overdue; manager `team` queue shows "escalated to you"; founder sees L3. WhatsApp/email/push are extra channels on the same row; quiet hours 21:00–09:00 IST respected via existing `isOpsWindow` gate.
4. **"Flashed 3 times, nobody acted" is itself auditable:** the task's event history shows L1→L2→L3 with timestamps; the sweeper log proves the system did its part.

### Guards

- Flashing is idempotent per `(actionId, level)` — a slow cron or retry never double-notifies.
- Reassign steps require a reason and are themselves audit rows; the original assignee stays visible in history.

### Build trigger (later)

- Phase 2 : seed policies/steps/templates, wire sweeper to `core_action`, add panel badges. Templates for WhatsApp stay placeholders until Meta approves.

---

## 3. Lead Magnet + AI Automated Marketing (B2B + social intake)

**Ask:** turn the whole CRM/ERP into a lead magnet — every B2B/social portal flows in automatically, and sales + digital marketing run AI-enabled automated marketing from inside the platform with different strategies.

**Verdict:** supported — intake + rules + bounded agents on the same core. Not a separate module.

### 3a. Intake: every portal becomes a pipe

- One `core_integration_connection` per source (IndiaMART, TradeIndia, JustDial, Meta/FB, Google Ads, website form, WhatsApp click-to-chat, B2B portal, referral, walk-in), each with its own `core_service_account` key so every row is attributable.
- Payload → `core_integration_event (RECEIVED → PROCESSED)` → normalized `core_enquiry { leadSourceId, sourceDetail (campaign/adset/portal ref), prospect contact/city, title/requirements, regionId (derived), ownerId (routed) }`.
- **Dedup/merge at the door:** phone/email exact first, then name+city fuzzy; repeat/existing-customer leads link to `core_customer` instead of duplicating. Cheap deterministic spam filter first; LLM only on ambiguous rows (cost control, same gateway pool).
- Every ingested row gets a link row (`core_zoho_link`-style: `system + namespace + externalId → entityType/entityId`) so "what was this called on the portal" is always answerable.
- What exists today and carries over: `LeadSource` seed codes, WhatsApp intake path, Meta/Google source tags, NeoDove report ingestion → `core_activity`.

### 3b. Strategies: data, not code

- Each play is an `hlp_rule`: `trigger = DOMAIN_EVENT (e.g. enquiry.created) + conditions (source == META_ADS, region == R2) + steps[] (ai_enrich → assign_owner → send_template → create_day2_action → if_no_reply_48h → variant_B)`.
- Digital marketing clones/edits strategies per source × region × product from the dashboard (rules + prompt templates + send windows). No deploy needed to try a new nurture.
- Sends execute as `core_integration_command (QUEUED → APPROVED → IN_FLIGHT → SUCCEEDED/FAILED)` via the existing WABA/AiSensy sender. High-risk blasts (large audience, new template) pause at `PENDING_APPROVAL` → `core_approval_request` → human approves from their queue.

### 3c. AI agents: bounded, logged, never direct

- `hlp_agent_def (intake-classifier, nurture-writer, churn-risk, next-best-action)` runs as a narrow service account; tools = core-service calls only (enrich, assign, draft, schedule). Output lands as `hlp_insight` (advisory) + draft commands.
- Agents never touch core tables directly, never send directly, never bypass opt-in/DND/quiet-hours. Every tool call is a `hlp_agent_tool_call` row with input/output/cost.

### 3d. Closed loop + attribution

- Replies → `core_activity`; interest → estimate → order → `core_credit` (generator/closer). Per-strategy funnel lives in `hlp_report + hlp_snapshot` (sent → delivered → read → replied → converted), so marketing learns which strategy makes pipeline, not just sends.
- Guardrails: `whatsappOptIn` + DND enforced in the sender; Meta template names stay placeholders until approved; every auto-send killable (`CANCELLED`), deduped per `(ruleId, dedupKey)`.

### Build trigger (later)

- Phase 3+ : portal adapter per source (start with one B2B + Meta), one welcome + one nurture rule, one agent (intake-classifier). Scale adapters/strategies after the sales spine (Phase 3) is live so every lead has somewhere to land.

---

## 4. What stays true for all three

- **D1 stays.** No Postgres, no new infra. All tables are `core_*`/`hlp_*` in the same D1 with the file-separated Prisma layout from the transition plan.
- **Zoho/NeoDove untouched.** They remain live adapters; these ideas consume their data, never replace them.
- **One queue, one audit, one notify pipe.** Buddy cover, escalation flashes, and marketing sends all flow through `core_action + core_audit_event + core_notification` — three features, one backbone.
- **Deferred, not dropped.** Build order: foundation + identity + My Work first (Phases 0–2). These three land on top without rework.
