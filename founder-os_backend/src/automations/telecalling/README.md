# Sales Leaderboard (Telecalling)

Region-based sales leaderboard. Personal estimate ownership is GONE —
estimates are owned by **region** (R1–R4); everyone in a region works the
region pipeline. ONE leaderboard, ranked by region, with the telecallers of
each region as always-open child rows. Wins/₹/points come from **accepted
estimates**, and every region team owes **₹1,00,000 of accepted value per
working day** with a weekly carry-forward shortfall. Call KPIs come live from
NeoDove.

Files in this folder:

- `index.ts` — `handler()` runs `runLeadConversion()` (region sweep + NeoDove
  attribution); `data` re-exports `getTelecallingDashboardData`
  (`GET /api/automations/telecalling/data`).
- `regions.ts` — pure region taxonomy: R1–R4, region name, TL level, state
  list (mirrored at `founder-os_frontend/src/telecalling/regions.ts`).
- `accepted.ts` — **single source of truth for wins/₹/points**: every
  accepted/confirmed estimate counted once on its `acceptedAt` day, bucketed
  into `region` / `direct` / `unlinked`.
- `targets.ts` — **pure** target + carry ledger: ₹1L/region/working day,
  Mon–Sat, week-by-week `carryOut = max(0, carryIn + target − accepted)`
  (mirrored at `founder-os_frontend/src/telecalling/targets.ts`).
- `service.ts` — conversion sweep + dashboard aggregation (region rows with
  rank/target, staff rows, KPI, risk counts, unmapped + direct/unlinked
  buckets, epoch gate, MIS daily export).
- `scoring.ts` — close-slab points + the append-only ledger (history/export
  only now — the dashboard reads accepted estimates directly).
- `risk.ts` — informational risk model (red / zombie / next-step), KV-cached.
- `enquiry-links.ts` — enquiries stamp `Estimate.createdBy` + `region` from
  the creating agent's roster region; not owner-assignment.
- `roster.ts` — NeoDove → Telecaller sync (keepAlive = recent NeoDove activity).
- `call-tags.ts`, `util.ts` — call tag values/labels, helpers.
- `rule.json` — handler, `schedule: */30 * * * *`, scope `telecalling`.

RETIRED (2026-10-22, founder decision): individual assignment, snatch/re-poach,
absent-cover reassignment, Effort Shield + effort-sync, EOD remark deduction
route (stubbed `{retired:true}`), bulk assignment machinery +
`ops-bulk-assign.yml`. The 15:30 cron slot was removed from `cron.ts` +
`cron-daily-ist.yml`.
RETIRED (2026-10-26): the 20/80 closer pick, the team-wide ₹5L/day + ₹10L gold
bars, and the separate "individual leaderboard" ranking.

## The model

- **Ownership**: `Estimate.region` (what Zoho state the customer is in). Kept
  fresh by `enquiry-links.ts` at enquiry create/update; accepted/confirmed
  estimates with a blank creator/region are healed from the mapping enquiry +
  creator roster region on every sweep. Founder-supplied `EST-*` → region
  mappings are authoritative and never overridden by inference.
- **Staff**: `Telecaller.tlLevel` (TL1/TL2) and `Telecaller.region`;
  `assignEstimateFollowUps` = follow-up specialist (used by the follow-up
  rotation).
- **Won on day** = `Estimate.acceptedAt`, stamped by
  `modules/estimates/status-sync.ts` on every entry into accepted/confirmed and
  cleared when an estimate leaves a close status. Backfilled (migration 0082)
  from the first close-credit day, else `date` — so a July estimate that was
  bulk-marked accepted in October still counts as July business. Period filters
  read `acceptedAt`, never `date`.
- **Close points** (`scoring.ts`, `closePointsFor`): ₹0–1L 50 / ₹1–2.5L 75 /
  ₹2.5–5L 100 / ≥₹5L 200, the FULL slab to the lead creator
  (`Estimate.createdBy`) automatically in one `kind='generator'` row. The
  ledger is still written for history/CSV; a missing row can no longer hide a
  sale because the board prices accepted estimates directly. Historic penalty
  rows (−10 remark / −15 legacy snatch) still reduce staff points.
- **Buckets** (three-way, founder rule 2026-10-26):
  - `region` — the estimate's region (or the creator's roster region) is
    R1–R4. Counts toward that region's target.
  - `direct` — the creator exists on the roster but holds NO region (Sales
    Head / HQ, e.g. Muskan). Shown so totals reconcile with Zoho, NEVER
    counted toward a region target.
  - `unlinked` — no creator, or a creator id that is not on the roster. Shown
    + flagged for `EST-*` → region mapping, never counted toward a target.
- **Targets + carry-forward** (`targets.ts`): each region owes ₹1,00,000 of
  accepted value per working day (Mon–Sat, 6-day week → ₹6L/week), regardless
  of headcount. The current week accrues day by day so nobody looks
  catastrophically behind at 09:00 Monday. A week's shortfall carries into the
  next week and is never forgiven; a surplus clears backlog first and is NOT
  banked. Ledger start = Setting `salesboard:targetStart` (default
  `2026-10-01`, retroactive). The team bar is simply the sum of the four
  region targets (₹4L/day, ₹24L/week) — no second/gold bar.
- **Ranking**: regions are ranked by target attainment since the ledger start
  (`accepted ÷ owed`), ties broken by accepted ₹. Telecallers are children of
  their region and are ordered by composite score inside it.
- **History reset**: `POST /api/telecalling/reset-history` (`?dry=1` preview)
  deletes ALL close-credit ledger rows and stamps epoch Setting
  `salesboard:epoch` — points/counters read only `day >= epoch`. Founder
  approved one-time purge.
- **Risk model is informational only**: red/zombie/next-step markers drive no
  scoring and no movement. Roster region changes re-point work going forward —
  nothing auto-modifies past behavior except epochs.

## Dashboard

`GET /api/automations/telecalling/data` (5-min KV-cached, converters
shortcut). Payload:

- `meta` — period/labels, workingDays, viewer region restriction via scope,
  epoch, unmapped lead count, `teamTarget` (team roll-up of the four region
  ledgers: `weekTarget`, `weekAccepted`, `carryIn`, `due`, `sinceStart*`, `pct`,
  `status`).
- `kpi` — `won` / `closedValue` (WHOLE acceptance cohort), `regionWon` /
  `regionValue`, `directWon` / `directValue`, `unlinkedWon` / `unlinkedValue`,
  leads/calls/talk.
- `regions[]` — R1–R4 rows: `rank`, `won {count,value}`, `accepted
  {count,value,points}`, `target` (`RegionTarget` ledger incl. `weeks[]`,
  `weekTarget`, `weekDue`, `carryIn`, `carryOut`, `sinceStart`,
  `attainmentPct`, `status`), `open`, calls/leads/KRA, `points`, `staff[]`.
- `direct` / `unlinked` — `{ count, value, points, items[], label, kind }`,
  always visible (they answer "why don't the region rows add up to the KPI?").
- `unmapped` (managers) — open estimates with no region.
- `risk: { counts, atRisk[], valueAtRisk }`, `recent[]` (today's converted
  estimates, viewer-region channeled), `unmappedStaff[]`.

Agent view (`?agent=`): that agent's REGION pipeline (`status:'sent', region=X`,
total desc) + own metrics; scoped staff are coerced to self via `selfAgentId`.

Query params: `date=YYYY-MM-DD` (default today IST),
`period=today|week|lastweek|month|lastmonth|year|lastyear` (default `today`),
`converters=1&since=YYYY-MM-DD` (CSV close map).

## Endpoints (worker routes, `src/worker/routes/telecalling.ts`)

- `GET/POST /api/telecallers`, `PUT/DELETE /api/telecallers/:id` — roster CRUD
  (tlLevel/region validation, MIS + sales-head write).
- `PUT /api/estimates/:id/region` — link unmapped estimates (MIS+).
- `POST /api/telecalling/reset-history` (`?dry=1`) — epoch purge.
- `PUT /api/estimates/:id/call-tag` + `/next-step` — region-scoped writes.
- `POST /api/trigger/telecalling` — daily conversion sweep (02:30 UTC cron).
- `/api/trigger/telecalling/eod`, `/api/runner/telecalling/*` — retired stubs.

Frontend: `founder-os_frontend/src/components/TelecallingDashboard.tsx`
(merged region board with open telecaller children, week-by-week carry ledger
expander, Direct/Unlinked rows, at-risk panel; region drill via `?agent=`,
unmapped link + roster + reset-history modals, daily + estimates CSV exports).
