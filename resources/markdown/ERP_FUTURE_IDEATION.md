# ERP Future Ideation — Partially Built, Rest Mapped

> **Status:** PARTIALLY BUILT as of 2026-11-12 — foundation live, three ideas still deferred but now unblocked.
> **Done:** core tables live in D1 (`core_employee` 33, `core_customer` 5106, `core_sale` 164, `core_enquiry` 602, `core_credit` 1572, `core_sales_order` 142, `core_receipt` 525, `core_promise` 43), 25 dual-write funnels, 6 shadow comparators + heartbeats, My Work tab (`/api/work/my|team`), notifications pull (`/api/notifications`), 2 desks (`sales_my_work`, `sales_team`) + dashboard API, plan Phase 7 `core_lead` DESIGNED (doc-only, `0135` not yet applied).
> **Still needed for a successful transition:** quiet/matching-week flips (customer display, leaderboard/ledger, floor, dues calendar) + human confirmation; Zoho invoices + ledgers/journals (cut-over); more desks + WhatsApp channel (Meta approval); retirements post-flip; Dec 1 parallel run + CA sign-off; then build §1–§3 below on top (no rework).
> **Delivery vehicle (2026-11-15, founder decision):** §1–§2 land inside per-position gamified Workspace dashboards (see §5) — one custom dashboard per org-chart position replaces the pile of individually-granted automation sheets. Sales Head is live first; every position follows the same pattern.
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

### Build trigger (later) — UPDATED 2026-11-12

- **DONE:** `core_employee` (33 rows) + `core_action` / `core_action_event` tables exist; My Work + team queue live (`GET /api/work/my|team`); `EstimateAssignment.tempForTelecallerId + absentSince` prototype still legacy-only.
- **TODO for success:** add `absentSince` to `core_employee`; cover-reason to `core_action_event`; `Buddy:` section to `hlp_dashboard` (3rd desk after `sales_my_work` / `sales_team`); dated grant rows (`validFrom/validTo`); auto-expiry job. No core redesign needed — configuration on top of live tables.

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

### Build trigger (later) — UPDATED 2026-11-12

- **DONE:** estimate-follow-up projector live (`modules/core/projectors.ts`); log-only sweeper on 5-min cron; My Work UI + tab-bar badges; in-app notifications pull (`core_notification` + `GET /api/notifications` + mark-read) + 2 desks + dashboard API (`GET /api/dashboards/:key`); quiet-hours gate (`isOpsWindow`) reused.
- **TODO for success:** seed `core_escalation_policy/step` + templates; wire sweeper from log-only → real `core_action` transitions + `core_notification` fanout; escalation badges/flash states in panel; WhatsApp channel (blocked on Meta template approval); idempotent `(actionId, level)` guards + `core_system_job` proof lines. This is the ladder that makes flips safe to operate.

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

### Build trigger (later) — UPDATED 2026-11-12: Phase 7 `core_lead` is the landing pad

- **DONE (design, not yet migrated):** `ERP_TRANSITION_PLAN.md` §15 `core_lead` — `status (unqualified|qualified)` + `outcome (open|won|lost|dropped)`, `sourceName` enum + `sourceRaw`, `expectedRate*` vs `quotedRate*` per line; live ground truth measured (602/606 enquiries already carry `estNumber`; 1,321 declined = ₹30.17 Cr, `callTag` NULL, 1,055 blank `sourceLead`); daily AI intake (`vision-intake.ts` verbatim lines + catalogue match) proven in prod.
- **TODO for success:** 7a `0135_core_lead.sql` + 1,979-row backfill + shadow → 7b create/decline funnels (telecaller dashboard + digital intake → `unqualified`; `status-sync.ts` decline → `qualified/lost`) → 7c `requireLeadQualifier` gate + `PUT /api/leads/:id/qualify` (unlock-only, parallel week, human sign-off) → 7d rate-intelligence reads core → 7e retire `callTag`/comment-mining. Then portal adapters (one B2B + Meta first), one welcome + one nurture `hlp_rule`, one intake-classifier agent. Do NOT build adapters before 7c is stable — every lead needs somewhere to land.

---

## 4. What stays true for all three + what a successful transition still needs

- **D1 stays.** No Postgres, no new infra. All tables are `core_*`/`hlp_*` in the same D1 with the file-separated Prisma layout from the transition plan.
- **Zoho/NeoDove untouched.** They remain live adapters; these ideas consume their data, never replace them.
- **One queue, one audit, one notify pipe.** Buddy cover, escalation flashes, and marketing sends all flow through `core_action + core_audit_event + core_notification` — three features, one backbone.
- **Deferred, not dropped.** Build order: foundation + identity + My Work first (Phases 0–2). These three land on top without rework.

### Transition success checklist (2026-11-12 — all required before §1–§3 scale)

- [x] Core mirrors live + verified: identity/customers/sales/credit/orders/stock/finance/promises + shadows + heartbeats (commits to `7baf514`; plan `be27558`).
- [ ] Flips with quiet/matching week + human confirmation: customer display → core; leaderboard/ledger → `core_credit`; floor → `core_sales_order`; dues calendar → `core_receipt`.
- [ ] Finance cut-over: Zoho invoices (`core_invoice` + lines), ledgers/journals, Dec 1 parallel run, Zoho read-only Jan 1, CA sign-off (human, owner needed).
- [ ] Notifications GA: more desks (accounts/dispatch/store/founder), WhatsApp channel (Meta approval), retire legacy registries post-flip.
- [ ] Phase 7 7a–7e: `core_lead` migration → funnels → qualification gate → rate intelligence → retire loss-tagging. Unblocks the lead-magnet (§3).
- [ ] Monthly: `docs/core-change-requests/` review, lock re-sign, `core_access_log` + `core_row_change` actor coverage audit.

---

## 5. Position Workspaces — the delivery vehicle (founder decision 2026-11-15)

**Ask:** each org-chart position gets ONE custom gamified dashboard instead of a pile of individually-granted automation sheets. The holder opens Workspace and sees their whole job — delays, targets, tasks, floor — with smoothing animations and a rewards system so they *want* to stay in it and finish things. Root opens the same dashboard live from a gallery and can take control (audited).

**Verdict:** configuration + composition on the live backbone — no new system, no new tables. The automation sheets stay as data sources; the position dashboard is the only home the holder ever opens.

### How it works

1. **One dashboard per position, built from the sheets.** Each pack composes the REAL panels (same dynamic imports, never copies) as animated sections under a My Day hero (target + severity + tasks + streak). Sales Head is live first (all 8 Sales sections); shared pieces (`sales/tabs.ts`, `NotificationDock`, `ui/motion.tsx`, `personal/api.ts`) are built once and reused by every pack.
2. **Gamified = notifications + motion + rewards.** Delays surface as 🔴 Critical / 🟠 High / 🟡 Medium / 🔵 Low / ⚪ Info with overdue flash (pure `severityFor`, mirrored + guarded); the bottom-right dock rides every view; tab/section transitions, shimmer skeletons and the streak ring use one shared kit (`prefers-reduced-motion` respected). Rewards v1 are local-first streaks; server-derived streaks come from `core_action_event` COMPLETED history (no new tables — core lock respected).
3. **Single access, strict.** The holder's grant pile is replaced: landing prefers the Workspace home, old `/session/<slug>` deep links redirect there (data endpoints untouched), sidebar pile hidden. Rollback = flag off. Root keeps direct deep links as the admin escape hatch.
4. **Root gallery = peek + take control.** Root-only `/workspace` lists every chart title as a card (seated counts from the HR master, Live/Soon) and mounts the position's REAL live dashboard preview-as. Every write stamps root as actor (`core_audit_event` + notify) — never silent, never as the holder.
5. **Packs ship one position at a time.** A title joins `LIVE_DASHBOARD_TITLES` when its pack is approved; unbuilt cards show "soon". Other roles keep their current sheets byte-identical until their pack ships.

### Guards

- No panel is ever copied: tabs/panels render the same components the sheets use (guard `position-workspace.test.mjs` asserts the imports).
- No fetch in presentational layers — all reads/writes go through domain api modules (ratchet `fe.raw_fetch_api` must not grow).
- Severity mapping is pure and mirrored; rewards never invent server truth (local-first until the derived endpoint exists).
- Every act-as write is audited (actor + reason); previews are read-only unless the write path stamps the actor.

### Build order

1. Sales Head (live): hero + shared tabs + dock + streak + gallery + redirect. ✅ SHIPPED
2. Live target math (real numbers into the hero tile).
3. Escalation sweeper log-only → real (§2 ladder goes live inside the dock + feed).
4. Buddy cover section (§1 lands as `Buddy: covering for X` in the dashboard).
5. Telecaller pack, then remaining positions one by one; sidebar piles retire per position.

### Build trigger (later) — UPDATED 2026-11-15

- **DONE:** `hr/position-dashboards.ts` registry (code-config) + `personal/api.ts` + `position-widgets/` + `ui/motion.tsx` + `sales/tabs.ts`; `SalesHeadDashboard` (hero + 8 real sections); `PersonWorkspace` fallback pile; `WorkspaceView` gallery; strict single-access redirect; guard `position-workspace.test.mjs` (8 cases); deployed + pushed.
- **TODO:** target math → sweeper → buddy → Telecaller → rest. Server-derived streaks need a read endpoint (no migration — reads `core_action_event`).

---
