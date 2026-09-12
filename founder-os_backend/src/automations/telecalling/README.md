# Telecalling

Single unified automation surfacing, per telecaller, both halves of daily
performance plus team KPIs and a live leaderboard.

Files in this folder:

- `index.ts` — `handler()` runs `runLeadConversion()`; `data` re-exports
  `getTelecallingDashboardData` (`GET /api/automations/telecalling/data`).
- `service.ts` — everything: risk model, assignment engine, absent/present
  cover, creator inference, score ledger, dashboard aggregation.
- `effort-shield.ts` — pure shield verdict over snapshots (no I/O).
- `effort-sync.ts` — NeoDove call-log snapshot writer (read by the engine).
- `rule.json` — handler, `schedule: */30 * * * *`, scope `telecalling`.

## Dashboard views

Two payload shapes from the same `data()` provider:

- **Team view** (no `?agent=`): `meta, kpi, risk, shielded, leaderboard, recent`.
- **Agent view** (`?agent=<id|name|neodoveUserName>`): `meta, agent, followUps`
  (that agent's open `sent` follow-ups + own metrics).

Query params (via `ctx.subject`): `date=YYYY-MM-DD` (default today IST),
`period=today|week|lastweek|month|lastmonth|year|lastyear` (default `today`),
`agent=`, `selfAgentId=` (injected by the worker route for scoped sales agents).

### Leaderboard — ranking is points-first, NOT composite-first

Each row (`TelecallerDayMetrics`): conversion (`assigned, won,
conversionRate, pipelineValue, estimatedConversion`), generation (NeoDove
calls/leads + KRA targets), `score` (composite), `points` (ledger),
`risk` (atRisk/zombie counts).

- **Rank order** (`service.ts` sort): `points.total` desc → then
  `estimatedConversion.value` desc → then composite `score` desc.
  `points.total` = +100 closes minus −10 remark penalties (minus legacy −15
  snatches where present) **in the selected period** (see Scoring). A closer
  always outranks a dialer.
- **Composite score** (display + final tie-break only):
  `won*100 + (penaltiesEnabled ? −snatches*15 : 0) + remarks*−10 +
  leadsGenerated*15 + round(callsConnected*0.5)`.
  Remark penalties always count; when the penalties toggle is OFF (default),
  snatches contribute 0.
- **Won** = +100 close events in the period (day the estimate converted),
  NOT currently-held won estimates. Today shows only today's conversions;
  week restarts at zero naturally.
- **Period conversion**: `assigned` counts `EstimateAssignment` rows whose
  `day` falls in range; pipeline = open `sent` estimates assigned in range.
  Credit split is today-only detail — history drives assigned/pipeline,
  the ledger drives won/points.
- Sort options in UI mirror this; podium 🥇🥈🥉 + scoring strip + ⓘ Game
  Rules card are display only.
- Leaderboard renders **above** the "🔥 At Risk" panel.

### Lead Generation + KRA

Per agent from NeoDove daily reports, matched by `neodoveUserName` then
`neodoveUserId`. Fields: attempted/connected/not-connected, in/outgoing,
talkTimeSec, leadsConverted/InProgress/Lost, followupLeads, `leadsGenerated`
(true get-leads count; fallback `inProgress + converted` for old snapshots).
Targets scale by working days: `CONNECTED_CALLS_PER_DAY * workingDays`,
`LEADS_PER_AGENT_PER_DAY * workingDays`. Traffic light: 🟢 ≥100% · 🟡 60–99%
· 🔴 <60%. `workingDaysBetween()` = Mon–Sat inclusive (Sunday excluded,
min 1). Period mode sums stored daily reports across the range
(`getNeodoveRangeMap`); today mode uses `getNeodoveAgentMap(day)` with
fallback to latest stored NeoDove day (`usingLatestAvailable=true`).

### At-Risk panel + chips

`risk` = open `sent` items with risk red/zombie (scoped to self when
`selfAgentId` present), sorted by value desc, capped `RISK_LIST_CAP=25`,
with `valueAtRisk` sum. Each item carries `snatchReason` +
`snatchInHours` countdown to the 21:00 IST sweep. Leaderboard Risk column
shows per-agent red/zombie counts. Follow-up rows show `StaleChip` /
`SnatchChip`. `shielded` strip (team view) lists red/zombie holdings whose
holder earned protection or exhausted it; null when snapshots unreadable
(tab hides the strip — fail-open).

## Assignment engine (stability-first, conversion-maximising)

`assignEstimatesForMaxConversion()` is the live engine.
`rotateEstimatesRoundRobin()` is legacy fallback (full re-deal from a
`telecalling_rotation:pointer` Setting — kept, not called by the handler).

- **Healthy stays put.** Risk `ok`/`pending` keeps its holder — relationships
  are never reset.
- **Candidates** (highest `total` first): unassigned `sent` (unless
  `skipAssignment`), OR assigned with risk red/zombie, OR locked estimates
  NOT with their locked agent (lock enforcement), OR estimates held by a
  **non-specialist** (lead-gen-only / deleted / absent holder — role
  correction, switch-independent, see below). Everything else is
  untouched.
- **Routing per candidate**: locked → straight to `lockedTelecallerId` (no
  creator inference, no best-fit, no snatch penalty, no `snatchReason`).
  Else sole-creator first claim (below), else best-fit: `score =
  0.6 × conversionRate − 0.4 × loadFactor` (`ASSIGN_TUNING`; `baseWin: 0.2`
  floor only affects projections, unrated agents score 0 on conversion).
  `conversionRate` = won/assigned over all ever-owned estimates;
  `load` = healthy open estimates owned (re-poach candidates excluded),
  normalised by max load. Ties break to lower load.
- **Write**: `Estimate.assignedTelecallerId` updated + `recordAssignment()`
  (prior open row → `resolved`, new row linked via `reassignedFromId`,
  `day` = IST date, `snatchReason` = reason when a holder was re-poached).
  `loadCount` increments for the winner within the run. After the run,
  `invalidateRiskCache()` fires if anything moved.
- **EOD vs every-run**: the engine re-poaches red/zombie on **every**
  run while the EOD Reassignment switch is ON (currently OFF — holders keep
  everything) — there is no 21:00 time gate in the automation. 21:00 IST
  drives the `snatchInHours` countdown (`hoursUntilEod()`, null past
  21:00) and the remark-deduction run. "EOD snatch/sweep" wording elsewhere
  means the legacy standing red/zombie re-poach, not a once-daily job.
- **Role correction (switch-independent)**: estimates held by a
  non-specialist (`assignEstimateFollowUps=false`, deleted, absent holder)
  are always moved to the best-fit specialist — even when the EOD switch
  is OFF. Role fix, not a performance snatch: no effort-shield check, no
  −15 penalty, `snatchReason` = "Lead-gen hold — moved to a conversion
  specialist". (Creator-first can still deal today's fresh lead to its
  lead-gen generator; the correction picks it up on a later run.)
- **Effort shield check** runs per re-poach (current holder only, lazy
  snapshots, fail-open — see Shield). Shielded → skip (counts `shielded`,
  no write, no penalty). `expired` (day-3) → snatch proceeds with log.
  Skipped for role corrections.
- **Snatch penalty guard**: only when `movedFrom && !locked &&
  penaltiesEnabled && !openRow.tempForTelecallerId && !isRoleCorrection`.
  Temp absent-cover holders and role-corrected holders are never charged.

### Creator-first lead assignment

Never-assigned estimates with no `createdBy` get sole-creator inference
before best-fit routing: `inferEstimateCreator()` reads the **first 3
comments** (date asc), skips Zoho system auto-logs via
`isSystemGeneratedComment()` ("Quote sent", "status changed", "created
for", etc.), and the first real comment whose author matches a roster
name wins. `creatorMatches()` = normalised lowercase alphanumeric,
exact/prefix either direction, or whitespace-token prefix, min 3 chars
("samar" → "Samarjeet"; initials never match). Matches against both
`name` and `neodoveUserName`. Winner gets `Estimate.createdBy` set and
the deal. Candidate pool for matching = all non-deleted, present
telecallers — a lead-gen (non-specialist) creator can still claim their
own lead, but an **absent** creator never receives claims while away.

## Risk model (live pre-warning)

Per open assigned `sent` estimate (`ZOMBIE_DAYS=3`, `FRESH_HOURS=24`).
**Dated next steps beat AI mood-reading**: a valid `nextStepDate`
(`Estimate.nextStep/nextStepDate`, migration 0028, holder-or-MIS-set, max +30
days) protects through its date (`ok`) no matter the verdict; a past date
reads `red` until chased. With no next step, the classic rules apply:

- **zombie** — no parseable comment date, or stale >72h (AI treats stale as
  never meaningful).
- **pending** — has recent comment but no AI verdict yet.
- **red** — latest verdict `meaningfulUpdate=false`, **OR verdict true but
  comment older than 24h** (satisfactory-but-stale: nobody chased it today
  → costs −10 at the EOD remark run).
- **ok** — meaningful AND fresh (<24h).

**Effort shield**: 2+ effective NeoDove attempts at least 3 hours apart
(`spanH`, redial-merged so bursts never count) or a connected call on that
customer today (per-customer snapshot rows) sets `effortShielded` — reported,
never charged at EOD. Failed pickups with genuine spread effort don't
punish.

`latestCommentDates()` prefers `dateFormatted` ("DD/MM/YYYY hh:mm AM/PM",
parsed as explicit `+05:30`) over date-only `date` (midnight UTC would
read ~12h stale); keeps the true newest per estimate; on query failure
degrades to classification-only. `buildSnatchReason()` mirrors the
verdict: zombie → "No reply in over 3 days…"; red-with-positive-verdict
→ "satisfactory but stale (older than 24h)…"; else `EOD remark penalty
(<verdict>): <first 140 chars of reasoning>` (falls back to generic
unsatisfactory line; ignores "No sales agent comment found.").
`RiskItem` also carries `locked` (`lockedTelecallerId` set) and
`skipAssignment` flags. Served from KV `telecalling:risk_cache`
(15-min TTL, single-flight, stale-on-error); `invalidateRiskCache()`
clears it + `telecalling:dashboard*` prefix — call on every estimate/
comment/status/classification write and after each engine run.

## Event-ledger scoring (slab close / −10, −15 legacy, −20 retired)

Append-only `TelecallerScoreEvent` (`telecallerId, estimateId, delta, day`
IST, reason). Only slab close deltas (50/75/100/200), `−10` and `−15` count —
historical −20 decline rows stay in the table but the score loop ignores them
everywhere.

- **Slab close credit** (`recordConversionClose`, called from the status-sync
  route): estimate status → `accepted`/`confirmed`, credited to the **lead
  generator** (`Estimate.createdBy`, holder only as fallback when the creator
  is unknown). Points follow the estimate total: ₹0–1L → 50, ₹1L–2.5L → 75,
  ₹2.5L–5L → 100, ₹5L and above → 200 (boundary totals join the higher slab).
  Split 20/80: the lead generator takes 20% (10/15/20/40), the closer takes
  80% (40/60/80/160) — the closer carries the penalty risk, so the closer
  carries the reward; same person takes one full-slab row. "Converted By"
  export names the generator.
  Duplicate-guarded (any slab or half delta per estimate gates re-entry).
  ALWAYS recorded, toggle-independent. `catchUpConversionCloses()` (start of
  the EOD run) backfills accepted/confirmed converts that never reached the
  ledger, marked catch-up.
- **−10 remark** (`recordRemarkPenalty`, called from `runEodRemarkDeduction`
  at the 21:00 IST EOD run): one charge per red-risk estimate currently held
  (zombies, MIS-locked and skip-assignment holdings excluded).
  Duplicate-guarded (one −10 per holder per estimate per day). Governed by the
  MIS **Active Penalty** toggle (default ON) — the EOD run skips charging
  entirely while it is OFF, and the composite `score` counts penalties only
  while it is ON (`points.total` always sums the ledger).
  **Non-working days deduct zero**: when the day's NeoDove push totals zero
  calls (Sunday/holiday — or a missing report), the run reports red holdings
  but charges nothing (`skipped: 'non-working-day'`).
- **−15 snatch** (`recordSnatchPenalty`, legacy): risk re-poaching is switched
  OFF, so no new −15 rows are written; historical ones still count. Was gated
  by the MIS **Active Penalty** toggle (`Setting
  telecalling:penalties_enabled`, `isPenaltiesEnabled()`, default OFF;
  `setPenaltiesEnabled()` flips it). Temp-cover losses never penalised;
  lock enforcement never penalised.
- Every row stores the IST `day`, so week/month/year sums slice by
  `day >= from && <= to`.

## Effort shield (snatch protection)

A red remark does NOT auto-cost the estimate. Shield evaluated for the
**current holder at snatch time** from the 15-min snapshots (fail-open:
any error → snatch as before).

- **Bar**: ≥3 EFFECTIVE outgoing dials on the lead **today (IST)** with
  first→last span ≥2h. Connects are **irrelevant** (`conn` is evidence
  only). Redials <30 min apart merge into one attempt (20-second redial ≠
  fresh effort): 2 rapid + 1 later = 2 effective = no shield. Counting
  restarts at zero daily.
- **Streak/expiry**: consecutive immediately-preceding qualifying days
  count back (cap 2). Grace = 2 days — day 3 with continued effort still
  snatches with −15 (`expired=true`, status `expiring`).
- **Verdicts** (`effort-shield.ts`): `shielded-1` (today only),
  `shielded-2` (today + yesterday), `expiring`, `insufficient`, `no-phone`.
  `no-phone` when phone10 or holder NeoDove id unmappable → no shield.
- **Mapping**: lead phone = last-10 digits (`normPhone10` — Zoho formats
  vary); agent = holder's `neodoveUserId`. Snapshot rows keyed `(p, u)`.
- **Surfacing**: agent follow-up rows carry `shield {status, reason, n,
  spanH, streak}` for at-risk rows; team view has the `shielded` strip;
  MIS audit at `GET /api/telecalling/shields`. 🛡 chip inline on shielded
  rows.

## Effort snapshots (effort-sync)

`syncEffortSnapshots()` pulls the **live** NeoDove token from D1
(`Token WHERE source='neodove'` — never a curl file) then ALL pages of
`lead-call-log/fetch-lead-call-log-details` for **three IST windows**
(today, yesterday, day-before) and overwrites
`Setting telecalling:effort:<YYYY-MM-DD>` with
`{day, fetchedAt, rows: [{p, u, n, raw, spanH, conn, firstTs, lastTs}]}`.
Details: pipeline `6960ff…`, page limit 100 (loop to short page, max 30
pages/day), 30s per-fetch abort, IST window = 18:30 UTC prev-day → +24h,
only `call_type=5` outgoing counted, `call_status=2` = connected
(evidence), greedy 30-min redial merge, spanH rounded to 0.1h. Fail-open
contract: missing/dead token or any API error writes
`telecalling:effort:auth = {ok:false, at, error}` and returns
`{ok:false}` — engine runs unshielded. Never throws. Engine reads via
`readEffortSnapshot(day)` (null = no evidence), lazily — only when the
first snatch candidate appears, so quiet runs cost 3 indexed Setting
reads max.

## Absent / present cover (MIS)

`markTelecallerAbsent(id)`: flags `absentSince` + deals the agent's open
`sent` pipeline (excluding `skipAssignment`, locked, and estimates whose
open ledger row already covers **another** absent agent — nested-absence
guard via ledger, since provenance lives on `EstimateAssignment`, not
`Estimate`) round-robin across active specialists from a random start.
Each cover row carries `tempForTelecallerId` = absent agent id (carried
forward through later EOD re-poaches by `recordAssignment` default).
Redistribution writes NO score events of any kind — never a snatch.
Batced D1 writes (25/chunk) with sequential fallback. Cover keeps +100
for anything converted meanwhile (holder credited); converted/declined
estimates do not return. `markTelecallerPresent(id)`: clears the flag,
hands every still-open (`sent`) temp row back to the original agent with
provenance cleared (`Returned from absence…`), same batching. Both
invalidate the risk cache.

## MIS overrides

- **Lock** (`lockedTelecallerId`): estimate always placed with / never
  re-poached from its locked agent — "despite whatever the case", even
  red/zombie. Lock enforcement writes no penalty and no `snatchReason`.
- **Skip** (`skipAssignment`): never dealt by any engine path.
- **Bulk assign** (`bulkAssignEstimates(moves, {followUpAgents, reason})`,
  max 500/call): one-time correction — sets holder + ledger rows with the
  reason string, NO locks, NO score events. Only `sent` moves (others
  skipped); explicit `null` temp provenance (real assignment, not cover);
  validates all moves before writing; D1 batch fast path + sequential
  prisma fallback (Express path); optionally flips
  `assignEstimateFollowUps=true` for listed agents; invalidates risk
  cache when anything moved.
- **Penalties toggle**: `telecalling:penalties_enabled` (`true` = −15
  active). Default OFF.

## Roster

Managed via `GET/POST/PUT/DELETE /api/telecallers`; link each entry with
`neodoveUserId`/`neodoveUserName` so Conversion merges with Generation.
`syncTelecallersFromNeodove()` runs on every engine run + dashboard load:
unique NeoDove agents across ALL stored report days become Telecallers;
existing rows get linked without renaming/reordering; **new hires start
`assignEstimateFollowUps=false`** (lead-gen only until MIS flags them a
conversion specialist); leavers deactivated manually (seeder never
reactivates). Assignment pool (`getFollowUpSpecialists()`): flagged true
+ not deleted + not absent, roster order.

## Dashboard data + caching + scoping

`getTelecallingDashboardData()` wraps `computeTelecallingDashboardData()`
in KV `telecalling:dashboard:<period>:<day>:<agent>:<selfAgentId>`
(5-min TTL, single-flight — concurrent filter clicks share one compute;
`selfAgentId` in the key so scoped agents never get the admin payload).
Period ranges (`periodRange()`): week = Mon–today, lastweek = prior Mon–Sun,
month/year from the 1st, lastmonth/lastyear full prior. Follow-up rows:
highest `total` first; `satisfactory` (verdict or null), `intentScore`,
`summary`, `lastCommentDate`/`staleHours`; lead chips (`enquiryNumber,
sourceLead, location, contactName/Phone/Email`) are **per-estimate
captures only** — no company-name enquiry fallback (fuzzy match once
showed the wrong customer's POC); blank = "AI capturing" until the GH
runner stores real data; `detailsFailed` (10 capture turns, <3 fields) =
"Details unavailable". `leadOf` = creator name only (null until
recorded), never the holder. `conversion.acceptedValue` (per agent) and`kpi.acceptedValue` (team) sum the **totals of estimates accepted in the
selected period**, valued from the +100 close-event ledger (day = conversion
day — Today shows only today's closings; week restarts at zero). This is the
number behind the **Est. Conv ₹** KPI — actuals, not a projection.
`estimatedConversion {count, value}` is still computed per agent (Σ `total ×
clamp(max(agentWinRate,0.2), 0.05..0.95) × toCloseMultiplier(risk)`
(`ok 1.0 · pending 0.7 · red 0.35 · zombie 0.15`)) for API compat + as the
third leaderboard tie-break (points → accepted ₹ → projection → score).
Targets (`meta.conversionTarget`): `CONVERSION_TARGET_DAILY = ₹5L`,
`CONVERSION_GOLD_DAILY = ₹10L`, scaled linearly by working days (Mon–Sat):
`target = 5L × workingDays`, `gold = 10L × workingDays`, plus live `value`,
`pct` and `status (below|hit|gold)`. Today = ₹5L/₹10L; full Mon–Sat week =
₹30L/₹60L; 26-day month ≈ ₹1.3Cr/₹2.6Cr. Frontend: below = default; hit =
emerald glow + pulse; gold = gold gradient + shimmer. `recent` = last 25 assigned estimates by sync time.
`unassignedSent`, `activeCount`, `targets`, `workingDays` in meta.

## Triggers, endpoints, invalidation

- Trigger: `POST /api/trigger/telecalling` ← GH `cron-daily-ist.yml`
  (08:00 IST distribution + 21:00 IST EOD sweep; plus local `rule.json`
  node-cron on Express). No time gate — every run deals unassigned +
  re-poaches red/zombie (shield/penalty guards apply) + corrects
  non-specialist holds back to specialists (switch-independent).
- Dashboard: `GET /api/automations/telecalling/data[?date=&period=&agent=]`.
  `&daily=1` (period mode) attaches `daily: TelecallingDailyRow[]` — per-day ×
  per-agent closes with estimate-number tags, declines, snatches, calls, talk,
  leads, score — for the MIS export DAILY section. Capped at 93 days
  (`dailyError` otherwise). Declined day ≈ `lastSyncTime` watermark day.
- Shields audit (MIS): `GET /api/telecalling/shields`.
- Roster: `/api/telecallers` (MIS writes). Absent/present, lock/skip,
  bulk-assign, penalties-toggle endpoints are MIS-only.
- Every write path that changes ownership or Zoho data must call
  `invalidateRiskCache()` (risk + dashboard prefix) or boards go stale
  for the TTL.

## Gotchas for agents

- Ranking is ledger-points first — don't "fix" it to composite.
- OFF-toggle means most boards show zero snatch penalty by design.
- Never charge temp-cover losses or lock enforcements.
- Absent agents are excluded from routing AND creator claims.
- `date` column is date-only — always read `dateFormatted` as `+05:30`.
- Satisfactory-but->24h is red, not ok.
- New roster rows are lead-gen-only until flagged.
- Lead chips must stay per-estimate; never re-add company-fuzzy fallback.
