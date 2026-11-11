# BUI ERP/CRM Transition Plan — D1-Native, One Source of Truth

> **Status:** approved direction, ready to execute.
> **Constraints locked by founder:** stay on D1 (no Postgres move) · keep Zoho + NeoDove live (no removal) · deploy every change (backend+frontend) · Worker is the live API, Express is frozen.
> **Objective:** one source of truth for the data layer, with every logged-in employee getting only their task queue + their role dashboard, every change audited, and one common notification system.
> **Inspiration:** `bui-crm-v2/` core/automation split — adapted to D1/SQLite (no Postgres schemas, triggers, or event-triggers).

---

## 1. Original idea (what you asked for)

1. A **core data layer** containing every CRM/ERP capability table (HR, Sales, field staff, enquiry, leads, estimates, sales orders, dispatch, payments, stock, finance), file-separated from **custom helper tables** (dashboards, reports, saved views, insights, flags) so the system stays organized.
2. Everything **highly integrated** — HR ↔ Sales ↔ Field ↔ Enquiry ↔ Lead ↔ Order ↔ Dispatch ↔ Payment — without spaghetti code.
3. **No full dashboard per role.** Each login sees only their tasks + their role-scoped actionable dashboard.
4. **Common notification system** for all departments.
5. **Full audit** of every data change (who, what, when, why).

This plan is that idea, made executable on your current stack.

---

## 2. Where we are today (ground truth, Nov 2026)

- **Live:** Cloudflare Worker (`founder-os_backend/src/worker/*`) + D1 (`waba-worker` DB) + GH Actions runners (`scripts/*-runner.js`) + Next.js static frontend on Pages. Express/Postgres is frozen alternate runtime.
- **Modules:** `src/modules/*` (crm, enquiries, estimates, telecalling, master-data, auth, stock, device-calls, etc.) + `src/automations/*` (~30 folders). Worker routes in `src/worker/routes/*.ts`, one per domain.
- **DB:** 143 sequential D1 migrations (`migrations/NNNN_*.sql`), hand-rolled `src/shared/prisma-d1.ts` shim (not real Prisma client). Must register new models in `BOOL_FIELDS / DATE_FIELDS / ID_FIELDS / RELATIONS`.
- **Cache/live:** KV read-through `cached()` (`src/shared/cache.ts`), EventHub DO + auto-live middleware (`data-changed` for any mutating `/api/*`), frontend `useLiveDashboard`.
- **Auth:** Google OAuth, `AuthUser/Session/Scope/Role`, `requireSalesManager` / `requireMisScope`, Users-portal org positions (Sales / Operations / Unmapped), position + display-name overrides.
- **Sales truth today:** Zoho Books (estimates/orders) + `Estimate` + `Telecaller + EstimateAssignment + TelecallerScoreEvent` (20/80 generator/closer) + `MasterCustomer + ClientTypeRule/Segment` + `CrmSalesOrder/CrmSoItem/CrmScheduleEvent` floor + `SoAttachment/DispatchProof` + NeoDove report tables + `AccountsTaskTemplate/Log + DigitalMarketingTaskTemplate/Log + WaTask`.
- **Problem:** truth is split across Zoho + D1 + KV + 105+ tables; tasks are scattered (assignment engine, taskbars, WaTask); dashboards are full-app views gated by scopes instead of per-role queues; audit is per-table, not universal.

---

## 3. Target architecture (D1-native)

```
D1 (single DB, no schemas — prefix convention)
├── core_* tables      <- SOURCE OF TRUTH, human-reviewed only
│     core_employee, core_department, core_position, core_team, core_region, ...
│     core_customer, core_contact, core_address, core_assignment, core_activity
│     core_enquiry, core_estimate, core_sales_order (+lines, stage_events), core_credit
│     core_dispatch (+lines, events), core_stock_entry, core_reservation
│     core_invoice (+lines), core_receipt, core_allocation, core_promise
│     core_action (+events), core_escalation_*, core_approval_*, core_notification_*
│     core_domain_event, core_row_change, core_audit_event, core_access_log
│     core_zoho_link, core_integration_* (Zoho/NeoDove adapters)
├── hlp_* tables       <- HELPERS, agents freely editable
│     hlp_dashboard, hlp_widget, hlp_report, hlp_snapshot, hlp_saved_view,
│     hlp_insight, hlp_custom_field_*, hlp_flag, hlp_cursor
└── legacy tables      <- frozen, dual-written then retired (Estimate, Telecaller, CrmSalesOrder, ...)
```

**Why prefixes, not schemas:** D1/SQLite has no Postgres schemas. `core_*` vs `hlp_*` gives the same locked/editable boundary with zero runtime change. Guard script enforces it (see §10).

**Core service layer (the only writer):** `src/modules/core/{actor.ts, permissions.ts, numbering.ts, stages.ts, audit.ts, events.ts}` — every Worker route calls it; it sets actor, checks permission, writes row + audit + domain event in one D1 batch. Helpers and runners never write `core_*` directly.

**Zoho/NeoDove stay live as adapters, not rivals:**

```
core_zoho_link { system: ZOHO_BOOKS|NEODOVE|LEGACY, namespace, externalId, entityType, entityId }
core_integration_event / core_integration_command / core_sync_state
```

- Zoho sync runners keep paging Zoho, then upsert core via the service + attach `core_zoho_link` rows. Zoho stays read-only for orders; floor writes live in core.
- NeoDove report runner writes `core_activity (sourceSystem=NEODOVE)` + roster link stays manual (phone-verified, never auto-overwrite — keep current rule).
- No Zoho/NeoDove code deleted. They become sync adapters into core.

---

## 4. Core data layer (file-separated, one file per capability)

New folder `founder-os_backend/src/modules/core/` + `prisma/core/` definitions (Prisma models for types + D1 migrations for reality). One file per domain, each <400 lines, mirroring the existing modular pattern (`types/parse/queues/scopes/redaction/update/routes/store`):

| File | Tables | Replaces / absorbs |
|---|---|---|
| `01-platform.ts` + migration | `core_legal_entity, core_doc_series, core_attachment, core_domain_event, core_row_change, core_audit_event, core_access_log` | 7 attachment tables → one `core_attachment`; `AuditLog` → `core_audit_event`; `Setting` watermarks stay but scoped |
| `02-identity.ts` | `core_employee, core_department, core_position, core_team, core_region, core_emp_dept, core_emp_position, core_emp_region, core_team_member, core_report_line, core_user_link, core_service_account, core_role, core_position_role, core_emp_role, core_perm_rule, core_access_config, core_field_policy` | `Telecaller + Accountant + DigitalMarketingManager + fieldStaff` → `core_employee`; `AuthUser` linked via `core_user_link (authUserId↔employeeId)`; `AuthScope/Role` seed `core_role/perm_rule`; position overrides → `core_emp_position` |
| `03-customer.ts` | `core_customer, core_contact, core_address, core_assignment, core_activity, core_note, core_tag*` | `MasterCustomer + ClientTypeRule/Segment` → customer + tags + assignment; NeoDove/field calls → `core_activity`; `CustomerNote` → `core_note` |
| `04-sales.ts` | `core_enquiry (+lines, quotes), core_estimate (+lines, assignment, credit)` | `Enquiry + EnquiryComment` → `core_enquiry`; `Estimate + Comment + Classification` → `core_estimate` (+ Zoho link); `EstimateAssignment` → `core_estimate_assignment` (holder, temp-cover); `TelecallerScoreEvent` → `core_credit (generator/closer)` |
| `05-order.ts` | `core_sales_order (+lines, stage_events, gates), core_dispatch (+lines, events), core_stock_entry, core_reservation, core_warehouse` | `CrmSalesOrder/SoItem/ScheduleEvent` → `core_sales_order + stage_events`; `DispatchProof + SoAttachment` → `core_dispatch + core_attachment`; stock tables → ledger + reservations |
| `06-finance.ts` | `core_invoice (+lines), core_note (+lines), core_receipt, core_allocation, core_promise, core_ledger_*, core_journal_*` | Zoho invoices → core with link; `AccountsTaskTemplate(kind=payment)` dues → `core_receipt/promise` projections; payment calendar reads same rows |
| `07-work.ts` | `core_action (+events), core_escalation_policy/step, core_system_job, core_approval_*, core_notification_*` | `AccountsTaskLog + DigitalMarketingTaskLog + WaTask + Task + ChatPendingItem` → `core_action` (category distinguishes); notification-batcher → `core_notification_*` |

**D1 audit without Postgres triggers:** D1 supports simple SQLite triggers but not plpgsql/event-triggers. So:
- `core_row_change` + `core_audit_event` are written **by the core service** in the same `DB.batch()` as the mutation (actor from session, reason from input). No direct `core_*` writes outside the service — guard + code review enforce it.
- Append-only tables (`stage_events, dispatch_events, action_events, journal_lines, stock entries`) get `BEFORE UPDATE/DELETE → RAISE(ABORT)` SQLite triggers in the migration (D1 supports this subset). Business rows get `BEFORE DELETE → RAISE(ABORT)` (deactivate/cancel instead).
- `lw_*` helper tables get a `createdAt` default + service-written change rows (no DB trigger needed).

**Numbering:** `core_doc_series (entityType, prefix, nextNumber)` + `next_number()` in service inside the creating batch (D1 batch is atomic; runners serialize per-entity). Gapless per FY like the draft's `next_document_number`.

**Stage machine (orders):** `DRAFT → CONFIRMED (sales) → ACCOUNTS_VERIFIED (accounts approval) → STOCK_CONFIRMED → PAYMENT_CONFIRMED → READY_TO_DISPATCH → PARTIALLY_DISPATCHED → DISPATCHED → DELIVERED → CLOSED`, plus `ON_HOLD/CANCELLED`. One `transition_order()` function checks `TRANSITION` perm + every `core_stage_gate` row + inserts `stage_event` + `domain_event` + opens next dept's `core_action`. Mirrors your CRM floor lifecycle but enforced.

---

## 5. Helper layer (agents edit freely)

`hlp_*` tables + `src/modules/helpers/` — never business facts, always rebuildable:

- `hlp_dashboard (key, name, requiredScreenKey, layout, isDefaultFor[])` + `hlp_widget (dashboardId, key, type kpi|table|chart|kanban|list, title, dataSource, config, position)`
- `hlp_report (key, requiredScreenKey, query, params)` + `hlp_snapshot (reportId, paramsHash, data, computedAt, expiresAt)` — leaderboard/KRA/OTIF caches live here, not in core.
- `hlp_saved_view, hlp_preference, hlp_explorer_config` — per-user views, columns, search config.
- `hlp_custom_field_def/value` — new field without core change; promote to core via human proposal if business-critical.
- `hlp_insight (kind estimate_intent|followup_quality|churn_risk|next_best_action, entityType/Id, score, status)` — AI output, advisory only.
- `hlp_rule (key, trigger DOMAIN_EVENT|SCHEDULE|MANUAL, eventTypes, cron, conditions, steps, enabled)` + `hlp_rule_run (ruleId, dedupKey, status)` — replaces scattered automation configs.
- `hlp_agent_def/run/tool_call + hlp_prompt` — AI agents run as `core_service_account` with narrow roles, tools = core-service calls only.
- `hlp_flag (key, enabled, rules)` — feature flags per position/employee.
- `hlp_cursor (consumerKey, lastSequence)` — automation/notification fanout position in `core_domain_event`.

**Rules (ported guard):** every `hlp_*` model references core by id only (`customerId TEXT // → core_customer`, no relation); never stores amounts/stages/stock as source of truth (snapshots only); changes core only via core service; reacts via `hlp_cursor`, never polls.

---

## 6. One integration fabric (no spaghetti)

- **Thin routes:** `src/worker/routes/*.ts` stay orchestrators (parse → scope-check → store → broadcast). All write logic lives in `modules/<domain>/update.ts`; all read predicates in `queues.ts`. No cross-domain imports except `queues.ts` + `core/events.ts`.
- **Mirror rule:** every queue predicate exists twice with same name/semantics — `backend/.../queues.ts ↔ frontend/src/<domain>/queue.ts`. Guard `scripts/guards/*.test.mjs` fails on drift (extend the existing `crm-lifecycle.test.mjs` pattern to sales/finance).
- **Events, not polling:** write → `notifyLive` + `core_domain_event` row in same batch → automations/notifications consume the stream via `hlp_cursor`. KV `cached()` stays for heavy reads; write paths call the right invalidator (existing `invalidate*` helpers, extended per domain).
- **Refactor by extract + re-export:** move code verbatim, keep old path re-exporting. Verify with `build-worker.mjs + smoke-worker.mjs` (+ frontend `tsc`/`build`) and deploy per policy.

---

## 7. Identity, positions, permissions (who sees what)

**Single roster:** backfill `core_employee` from `Telecaller + Accountant + DigitalMarketingManager + field_staff + AuthUser` (match on email-exact, never name-guess; shared phones flagged, not auto-merged — same rule as NeoDove linking). `AuthUser` stays the login; `core_user_link` binds it to exactly one employee. New hires = one employee row + position/region assignments + login link.

**Positions (seed):** `FOUNDER, SALES_HEAD, TL1, TL2, SALES_EXEC, FIELD_EXEC, ACCOUNTS_HEAD, ACCOUNTANT, PURCHASE_EXEC, STORE_KEEPER, DISPATCH_HEAD, DISPATCH_EXEC, HR_EXEC, MARKETING_MGR` — your Users-portal org groups map 1:1. Ranks drive escalation order.

**Permissions (service-enforced, never UI):** `core_perm_rule (role, entityType, field, action VIEW|CREATE|EDIT|DELETE|APPROVE|TRANSITION|EXPORT, scope OWN|TEAM|REGION|DEPARTMENT|ALL, effect ALLOW|DENY, conditions)`. Effective = position-roles ∪ direct grants. Screens are subjects: `screen:sales_mywork, screen:sales_team, screen:sales_manage, screen:accounts_desk, screen:dispatch_board, screen:store, screen:founder_os`. Seed mirrors your current matrix (sales own-only, TL region, head department, accounts verify/stock/payment/invoice, dispatch ship, founder all) + explicit DENYs (cost/margin, export).

**Field policy:** `core_field_policy` marks `unitCost=SENSITIVE (logged), PAN=RESTRICTED, grandTotal=derived, stage=transition-only, creditLimit=approval-gated`. Every sensitive view lands in `core_access_log`.

---

## 8. Role dashboards (nobody gets the full app)

Each login lands on their default `hlp_dashboard` (by position code). All views use `useLiveDashboard(fetcher)` over scope-filtered endpoints.

| Login | Default dashboard | Sees | Can do |
|---|---|---|---|
| Sales exec / Field exec | `sales_my_work` | own enquiries/estimates/orders/customers/actions | register enquiry, log activity, edit own, request rates/approvals |
| TL1 / TL2 | `sales_team` | team + region(s) pipeline, overdue, Won | reassign, approve small discount, escalate |
| Sales-head / MIS-sales | `sales_manage` | all regions, Unmapped bucket, Controller | re-home, closer-pick, holidays, type rules, segments |
| Accountant senior/junior | `accounts_desk` | verify → stock → payment → invoice queues, dues calendar | verify, reserve, receipt, invoice (draft), promise |
| Store / Purchase | `store` / `purchase_desk` | reservations, GRNs, POs, availability | receive, reserve, raise PO |
| Dispatch exec/head | `dispatch_board` | ready → pack → ship → POD | plan, pack, ship, upload proofs |
| Founder / root | `founder_os` | everything + audit + access + escalations | all + approve + export |

**Unified Sales workspace stays** (Leaderboard / Enquiries / Customer Master / Dispatch / Call Log / Controller tabs) but each tab reads the same `core_*` via its role filter. Agents stay region-locked server-side (no roster row/region ⇒ zero rows); dispatch floor keeps your bucket rules (Incomplete vs Completed, region-derived from estimate, promise-only for agents).

---

## 9. Common notification system

`core_notification (employeeId, channel IN_APP|WHATSAPP|EMAIL|PUSH, title, body, entityType/Id, actionId)` + `core_notification_pref (quiet hours, channel opt)` + templates table. Producers: stage transitions, action assignments, escalations, approvals, overdue sweeper. Delivery: in-app via EventHub typed events; WhatsApp via existing WABA sender (template names as placeholders until Meta approves); quiet hours 21:00–09:00 IST respected (same `isOpsWindow` gate). Every send logged; failures retry via `core_system_job`.

---

## 10. Governance (the lock, D1 edition)

Port `bui-crm-v2/scripts/schema-guard.mjs` → `founder-os_backend/scripts/core-guard.mjs`:

1. Every file under `prisma/core/` + `src/modules/core/` matches `prisma/core.lock` (human signs with `--sign`, never agents, never `--no-verify`).
2. `hlp_*` models: `hlp_` prefix only; column ending in `Id` must not be a Prisma relation to `core_*` (soft ref only).
3. No `INSERT/UPDATE/DELETE` on `core_*` outside `src/modules/core/` (grep check in guard + CODEOWNERS on `prisma/core/`).
4. Migrations touching `core_*` without a lock change in the same diff fail CI.
5. Pre-commit hook + GH workflow `core-guard.yml` run it.

`AGENTS.md` gains one section (this file is the source; AGENTS.md gets a 10-line pointer): core is locked, helpers are free, proposals go in `docs/core-change-requests/YYYY-MM-DD-<topic>.md`.

---

## 11. Execution plan (concrete, D1-native)

### Phase 0 — Skeleton + guard (1 PR, no behavior change)
- Add `founder-os_backend/prisma/core/` (7 files, §4) + `prisma/helpers/` (1 file) as **type sources only**; register in `prisma-d1.ts` registries.
- Migration `0144_core_foundation.sql`: `core_domain_event, core_row_change, core_audit_event, core_access_log, core_zoho_link, core_action (+events), core_notification (+pref, template), core_system_job, hlp_dashboard/widget/flag/cursor` + SQLite `BEFORE DELETE → ABORT` triggers on append-only tables.
- Add `src/modules/core/{actor,permissions,numbering,stages,audit,events}.ts` (stubs returning current behavior) + `scripts/core-guard.mjs` + pre-commit hook + CODEOWNERS.
- New endpoints (Worker-only, thin): `GET /api/work/my, /api/work/team, POST /api/work/actions/:id/complete, GET /api/notifications` (empty until Phase 2).
- Verify: `build-worker.mjs + smoke-worker.mjs` (56 pass), `tsc`, frontend build, deploy backend+frontend, D1 columns check, `/health + /api/status` 200.
- Result: lock exists, tables exist, nothing reads them yet.

### Phase 1 — Identity unify (1–2 PRs)
- Migration `0145_core_identity.sql`: all `core_employee/*` + role/perm tables; backfill employees from rosters (email-exact; duplicates flagged in `core_note`, not merged); link `AuthUser` via `core_user_link`; seed positions/roles/perms/access-configs/field-policies (mirror §7).
- Dual-write: roster create/update writes both old + `core_employee` (old wins on conflict, logged). Read path unchanged.
- New: `GET /api/auth/positions` reads core (keep response shape); Users portal shows same groups, now core-backed.
- Verify: roster counts match, positions endpoint unchanged, guard passes.

### Phase 2 — My Work queue (1 PR, first visible win)
- Start opening `core_action` rows from existing flows: estimate follow-up due, accounts task due, dispatch ready, approval needed. Projector lives in `modules/core/projectors.ts` (idempotent on `(entityType, entityId, category)`).
- Wire `GET /api/work/my|team` with scope filter (`can()`), frontend `My Work` tab per role + tab-bar badges (reuse `inrShort` pattern). Escalation sweeper on the existing 5-min cron updates `nextEscalationAt` + notifies.
- Verify: each test login sees only their queue; founder sees all; live update on create/complete.

### Phase 3 — Customer + Sales spine (2–3 PRs)
- Migration `0146_core_customer_sales.sql`: customer + enquiry + estimate + credit tables + backfill from `MasterCustomer/Estimate/Enquiry` + `core_zoho_link` rows.
- Dual-write on create/update; leaderboard/Controller read core via `queues.ts` (Zoho stays sync source; `acceptedAt/declinedAt`, 20/80 split, reseller/consumer rules ported verbatim into `update.ts`).
- Guards extended: `sales-lifecycle.test.mjs` (status machine, region derivation, credit split) alongside existing `crm-lifecycle.test.mjs`.
- Retire: old score-event writes stop once `core_credit` matches for one full week.

### Phase 4 — Orders / Dispatch / Stock (2 PRs)
- Migration `0147_core_order_dispatch.sql`: order + dispatch + stock tables + backfill from `CrmSalesOrder/SoItem/DispatchProof/SoAttachment` (burn-once preserved as UNIQUE storage keys in `core_attachment`).
- `transition_order()` live; floor tabs read core; sync runner (`crm-runner.js`) writes core via service (fingerprint + miss-count + `deleted_source` logic unchanged).
- Proofs: all six slots (invoice/photos/transport/courier/packing) as `core_attachment(kind)` with View/Download; attach-after-dispatch allowed for the five optional kinds (existing rule).

### Phase 5 — Finance + dues (1–2 PRs)
- Migration `0148_core_finance.sql`: invoices/receipts/allocations/promises/journals + backfill opening receivables; dues calendar + statement-date logic read same rows (`statementDateFor` ported, not forked).
- Month-start parallel run with Zoho (one month), then Zoho read-only. CA confirms chart of accounts, GST rates, e-invoice applicability before cut-over (same checkpoint as draft README).

### Phase 6 — Notifications + helpers GA (1 PR)
- Fanout `core_domain_event → core_notification` via `hlp_cursor` consumer on the 5-min cron; WhatsApp templates live; prefs + quiet hours enforced.
- Seed `hlp_dashboard` rows per §8; retire legacy dashboard registry entries as each screen cuts over; `legacy.*` models deleted from Prisma one by one (never new ones added).

---

## 12. What you get (result)

- **One source of truth:** every domain in `core_*`, every id traceable to Zoho/NeoDove/legacy via `core_zoho_link`.
- **One task per login:** `core_action` queue filtered by `can()` — exec sees own, TL sees team/region, head sees department, founder sees all.
- **One audit:** `core_row_change` (every write, actor-stamped) + `core_audit_event` (reason) + `core_access_log` (every sensitive view).
- **One notify pipe:** in-app + WhatsApp from the same event stream, with prefs and escalation.
- **No spaghetti:** thin routes, pure `queues.ts` predicates mirrored backend↔frontend, events not polling, extract+re-export refactors, guards failing on drift.
- **Zoho/NeoDove intact:** live adapters, zero removal, every synced row linked.

---

## 13. Open decisions (need founder call)

1. `core_employee` code format: keep roster UUIDs or new `EMP-0001` series? (Recommend: keep UUIDs, add human `employeeCode`.)
2. Finance cut-over month: next 1st or next quarter 1st? (Recommend: next month 1st, parallel run starts now.)
3. Cost/margin visibility: TL sees own-team margin? (Recommend: no — SENSITIVE, logged, head-only.)
4. File bytes: stay in KV/R2 as today with metadata in `core_attachment`, or move to R2 only? (Recommend: stay, `storageKey` abstracts it.)

---

## 14. Next actions checklist

- [ ] Approve this plan + decisions in §13.
- [ ] Phase 0 PR: `0144` migration + `modules/core/*` stubs + `core-guard.mjs` + `GET /api/work/my` (empty) + deploy.
- [ ] Phase 1 PR: `0145` identity + backfill + dual-write + positions on core.
- [ ] Phase 2 PR: projectors + My Work UI + escalation sweeper.
- [ ] Phases 3–6 in order; delete one legacy model per cut-over; never add to legacy.
- [ ] Monthly: review `docs/core-change-requests/`, sign lock, audit `core_access_log` + `core_row_change` actor coverage.

*Source notes: current-stack facts from `AGENTS.md` + `architecture.md` (Worker/D1/GH-runners, KV, EventHub, deploy policy, org positions, TL1 two-region, 20/80 credits, NeoDove manual link, dues calendar); target-model ideas from `bui-crm-v2/{README,AGENTS,prisma/schema/{core,automation,legacy}.prisma,prisma/sql/core/{001,002}.sql,tests/scenario.sql,scripts/schema-guard.mjs}` — Postgres specifics replaced with D1-native equivalents above.*
