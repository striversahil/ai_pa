# current_task.md — CRM Automation: Department Dashboards + Points System

> Session state snapshot. Written so work can resume in a fresh session.
> Repo: `/home/sahildev/development/ai_pa` (branch `main`).
> NOTE: git status shows OTHER pre-existing uncommitted changes on main
> (AGENTS.md, architecture.md, ai-gateway files, telecalling, runner-lib, etc.)
> that are NOT part of this task — do not revert or mix them up.

## Objective

Upgrade the CRM automation (`founder-os_backend/src/automations/crm/`) from a
single read-only pipeline view into a **department-split, points-driven control
room**, mirroring the TelecallingDashboard pattern:

- Horizontal tabs: **Overview | CRM Desk | Accounts | Dispatch | Procurement**
- Every sales-order movement measured via a **DepartmentScoreEvent points
  ledger** (mirrors `TelecallerScoreEvent` in telecalling)
- **TanStack Table v8** (`@tanstack/react-table`, installed) for sortable /
  searchable / paginated order tables per department
- Stage → desk ownership: `confirm`→CRM, `invoice`→Accounts, `ship`→Dispatch,
  `payment`→Accounts (collections)
- Live updates: snapshot POST broadcasts `LiveEvent.Crm` (`"crm"`)

## Points system (DESIGNED + IMPLEMENTED in worker)

| Movement | Points | Dept | Actor attribution |
|---|---|---|---|
| New SO created today | +25 | crm | salesperson |
| Left `confirm` stage (order confirmed) | +50 | crm | salesperson |
| (same event) Material allocated | +25 | procurement | — |
| Left `invoice` stage (invoice raised) | +50 | accounts | — |
| Left `ship` stage (shipped) | +50 | dispatch | salesperson |
| Closed as paid (payment received) | +100 | accounts | — |
| Closed cancelled/void | −20 | dept owning the stage it was in | salesperson |

Backward stage jumps score nothing. Diff logic: worker compares each new
snapshot against the previous KV snapshot (so→stage map) and writes ledger rows
via `prisma.departmentScoreEvent.createMany`.

## COMPLETED (backend fully done, typechecks clean)

1. **`founder-os_backend/prisma/schema.prisma`** — added `DepartmentScoreEvent`
   model: `{ id, dept, soNumber, points, reason, actor?, day (IST date),
   createdAt }` with indexes on dept/day/actor/soNumber. `npx prisma generate`
   HAS been run.

2. **`founder-os_backend/migrations/0021_department_score_events.sql`** — NEW
   file, `CREATE TABLE DepartmentScoreEvent` + 4 indexes. ⚠️ NOT yet applied to
   remote D1 (see TODO).

3. **`founder-os_backend/src/shared/d1-prisma.ts`** — registered the model in
   `DATE_FIELDS` (`createdAt`) and `ID_FIELDS` (`id`) registries (no bools, no
   relations needed).

4. **`founder-os_backend/src/live.ts`** — added `Crm: "crm"` to `LiveEvent`.

5. **`scripts/crm-runner.js`** — fully rewritten (syntax-checked with
   `node --check`): posts a department-grade snapshot
   `{ date, totalActive, totalValue, stages: {confirm|invoice|ship|payment:
   {count, value, orders[]}}, closed[], materials[], salespeople[], meta }`.
   Order rows now include `ageDays, lineCount, items[{name,sku,qty}],
   createdToday`. Efficiency: early scan stop when a page has no active orders
   AND nothing created within 120 days (`SCAN_WINDOW_DAYS`), page cap 30,
   `DETAIL_CAP=400`/stage, `CLOSED_CAP=400`, `MATERIALS_CAP=300`. Materials
   aggregated from `line_items` (`meta.withLineItems` records whether Zoho's
   list response included them).

6. **`founder-os_backend/src/worker/routes/runner.ts`** — `POST
   /api/runner/crm/snapshot` rewritten: accepts `stages` payload (legacy
   `byProcess` accepted when reading prev, stored as alias), diffs vs previous
   KV snapshot, persists points (`departmentScoreEvent.createMany`, best-effort),
   stores new snapshot (45-min TTL), busts `crm:data` cache key, broadcasts
   `LiveEvent.Crm`. Added top-level imports `prisma` + `logger`.
   `npx tsc --noEmit` passes (only pre-existing CF-type errors in
   `context.ts`/`cron.ts` remain).

7. **`founder-os_backend/src/automations/crm/index.ts`** — `data()` rewritten:
   `computeCrmData()` = KV snapshot + 3 parallel D1 aggregates
   (today events, 7-day events, recent 50) → returns
   `{ date, computedAt, fresh, totalActive, totalValue, stages, departments:
   { crm:{pending}, accounts:{toInvoice, awaitingPayment},
   dispatch:{pending}, procurement:{materials, distinctMaterials, totalQty,
   openOrders} }, salespeople, closed, meta, scores: { today,
   todayByDeptCount, week, crmLeaderboard:[{actor,points,events,created,confirmed}],
   recent[] } }`. Wrapped in `cached('crm:data', 60_000, …)`.

8. **Frontend dependency** — `@tanstack/react-table@^8.21.3` added to
   `founder-os_frontend/package.json` via **pnpm** (`pnpm add …`). NOTE: plain
   `npm install` FAILS in this repo (ERESOLVE + ENOTDIR on chart.js) — use pnpm.

## REMAINING WORK (in order)

### 1. Rewrite `founder-os_frontend/src/components/CrmDashboard.tsx` ⬅ START HERE
File is still the ORIGINAL simple version (my rewrite attempt hit the editor's
size limit and was NOT applied). Full-file replacement. Spec:

- `"use client"`; default export `CrmDashboard`.
- `const crm = useLiveQuery<any>(() => fetch("/api/automations/crm/data").then(r=>r.json()), { events: ["crm", "automation"] })`.
- Tabs exactly like TelecallingDashboard (~lines 268-276 + 747-769 for nav
  markup): `type View = "overview"|"crm"|"accounts"|"dispatch"|"procurement"`,
  TABS with emoji icons 📊🤝💰🚚📦, pill buttons (active `bg-indigo-600
  text-white`, inactive `bg-zinc-100 dark:bg-zinc-900`).
- In-file `DataTable` component using TanStack v8: `useReactTable` +
  core/sorted/filtered/pagination row models, global-filter search input,
  sortable headers (▲▼↕), pagination footer (page size 10/25/50, Prev/Next,
  shown only when filteredRows > pageSize), compact `text-[11px]` styling,
  `overflow-x-auto` wrapper, zebra hover rows.
- KPI card helper matching existing style (`rounded-2xl border border-white/10
  bg-[#111726]/80 p-4`).
- Per-tab content:
  - **Overview**: KPI strip (Active SOs, Pipeline Value, points-today cards per
    dept w/ accents indigo/emerald/amber/sky), 4 pipeline stage cards (keep
    existing PROCESS_META accents), "Recent movements" feed from
    `scores.recent` (points pill +green/−red, dept emoji, SO mono, reason,
    actor, short time).
  - **CRM Desk**: KPIs (pending confirm count/value, points today/week);
    leaderboard table (`scores.crmLeaderboard`: rank, actor, points desc
    default, events, created, confirmed); orders table
    (`departments.crm.pending.orders`: SO, Ref, Customer, Salesperson, Value ₹,
    Age (ageDays: >15 red-400, >7 amber-400), status pill, created).
  - **Accounts**: KPIs; two tables — `toInvoice.orders` (invoice status pill)
    and `awaitingPayment.orders` (paid status pill: paid=emerald, partial=amber).
  - **Dispatch**: KPIs; `departments.dispatch.pending.orders` (shipped status
    pill, age).
  - **Procurement**: KPIs (distinctMaterials, totalQty, openOrders, points);
    materials table (`departments.procurement.materials`: item, sku, qty,
    orders, value; qty desc default).
- Helpers: `fmtINR` (en-IN locale), signed points (+50/−20), age coloring,
  `shortTime`. Handle loading / `fresh===false` (keep current file's
  "Waiting for first CRM snapshot (every 15 min)…" spinner state).
- IMPORTANT: write the file in CHUNKS (editor limit ~6000 chars per edit) —
  create the file with the first chunk, then append with `insert_line` or
  sequential anchored edits.
- Verify: `cd founder-os_frontend && npx tsc --noEmit` (ignore pre-existing
  errors outside this file), then `npm run build` (webpack).

### 2. Update `founder-os_backend/src/automations/crm/README.md` (user-requested)
Rewrite for the department edition: new snapshot payload shape, points table,
tabs description, KV keys (`crm:salesorders_snapshot` 45-min TTL, `crm:data`
60-s), runbook (log prefix `crm-runner:`, GH workflow `cron-every-15min.yml`,
migration 0021 must be applied, check `meta.withLineItems` if Procurement tab
is empty). Also refresh `rule.json` description to mention department tabs +
points.

### 3. Apply migration to remote D1
```
cd founder-os_backend && set -a; source ../.env; set +a; \
npx wrangler d1 execute waba-worker --remote --file migrations/0021_department_score_events.sql
```

### 4. Verify + deploy
- Backend: `node scripts/smoke-worker.mjs`; then build+deploy worker
  (commands in AGENTS.md).
- Frontend: `npm run build` (webpack!) in `founder-os_frontend`, then
  `npx wrangler pages deploy out --project-name founder-os-frontend`.
- Optional smoke of the ledger: POST a fake snapshot to
  `/api/runner/crm/snapshot` with SHARED_SECRET, then GET
  `/api/automations/crm/data` and confirm `scores.recent` fills.

## Key data shapes (for the frontend)

Order row (in `stages.<step>.orders` / `departments.*`):
`{ so, ref, customer, total, totalFormatted, status, orderStatus,
invoicedStatus, shippedStatus, paidStatus, salesperson, date, createdTime,
ageDays, lineCount, items[{name,sku,qty}], createdToday }`

Material row: `{ item, sku, qty, orders, value }`
Salesperson rollup: `{ name, openOrders, pipelineValue, byStage{confirm,invoice,ship,payment} }`
Closed row: `{ so, customer, total, status, orderStatus, paidStatus, salesperson, date }`

## Gotchas
- Do NOT `source ../.env` and reuse values (contains `$@`); parse or set explicitly.
- Cron workflows have NO `schedule:` block — do not re-add.
- Frontend dev must use `./run-dev.sh`; production build must be webpack.
- Old KV snapshots (pre-department shape) are handled: route reads
  `prev.stages || prev.byProcess`, and stored snapshots carry a `byProcess` alias.
- Snapshot expiry edge: if the KV snapshot expired, only orders `createdToday`
  earn the +25 new-order credit (flood protection is built in).
- Team-task board has task_0004 (frontend) in_progress and task_0005
  (verification) pending — complete/close them when resuming.