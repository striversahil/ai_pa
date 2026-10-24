# Sales Leaderboard (Telecalling)

Region-based sales leaderboard. Personal estimate ownership is GONE —
estimates are owned by **region** (R1–R4); everyone in a region works the
region pipeline. Close credit splits **20% generator (automatic) / 80% closer
(manual pick)**. Call KPIs come live from NeoDove.

Files in this folder:

- `index.ts` — `handler()` runs `runLeadConversion()` (region sweep + NeoDove
  attribution); `data` re-exports `getTelecallingDashboardData`
  (`GET /api/automations/telecalling/data`).
- `regions.ts` — pure region taxonomy: R1–R4, region name, TL level, state
  list (mirrored at `founder-os_frontend/src/telecalling/regions.ts`).
- `service.ts` — conversion sweep + daily/dashboard aggregation (region cards,
  staff rows, KPI, conversion target, risk counts, unmapped bucket, pending
  closer picks, epoch gate).
- `scoring.ts` — close-credit ledger: slabs, 20/80 split, closer pick,
  pending picks, converters map, history reset + epoch stamp.
- `risk.ts` — informational risk model (red / zombie / next-step), KV-cached.
- `enquiry-links.ts` — enquiries stamp `Estimate.createdBy` + `region` from
  the creating agent's roster region; not owner-assignment.
- `roster.ts` — NeoDove → Telecaller sync (keepAlive = recent NeoDove activity).
- `rotation.ts` — round-robin pick from region conversion specialists.
- `call-tags.ts`, `util.ts` — call tag values/labels, helpers.
- `rule.json` — handler, `schedule: */30 * * * *`, scope `telecalling`.

RETIRED (2026-10-22, founder decision): individual assignment, snatch/re-poach,
absent-cover reassignment, Effort Shield + effort-sync, EOD remark deduction
route (stubbed `{retired:true}`), bulk assignment machinery +
`ops-bulk-assign.yml`. The 15:30 cron slot was removed from `cron.ts` +
`cron-daily-ist.yml`.

## The model

- **Ownership**: `Estimate.region` (what Zoho state the customer is in). Kept
  fresh by `enquiry-links.ts` at enquiry create/update; accepted/confirmed
  estimates with a blank creator/region are healed from the mapping enquiry +
  creator roster region on every sweep. Estimates that synced before their
  creator had a region land in the **unmapped bucket**;
  `PUT /api/estimates/:id/region` lets a manager link them.
- **Staff**: `Telecaller.tlLevel` (TL1 leads ≥2 staff / TL2 reports to a TL1)
  and `Telecaller.region`; `assignEstimateFollowUps` = follow-up specialist
  (used by the follow-up rotation).
- **Close credit** on conversion (`scoring.ts`): the FULL slab goes to the
  generator (`Estimate.createdBy`) automatically in one `kind='generator'` row.
  Closer picks were retired 2026-10-24 — no manual 80% hand-off and no
  `pendingCloserPicks` queue.
  - Slabs unchanged: ₹0–1L 50 / ₹1–2.5L 75 / ₹2.5–5L 100 / ≥₹5L 200.
    Penalty rows survive unshuffled: −10 remark / −15 legacy snatch
    (readable via the epoch gate).
- **Region points are not the sum of members' ledger points.** Region cards
  price the **full accepted slab once per estimate**, grouped by
  `Estimate.region` (the lead creator's region), deduped by estimate id. The
  20/80 individual rows still drive the staff leaderboard and stand on their
  own. October-2026 was reclassified by `0072_reclassify_accepted_october.sql`
  (legacy rows moved to creators, missing full slabs inserted).
- **History reset**: `POST /api/telecalling/reset-history` (`?dry=1` preview)
  deletes ALL close-credit ledger rows and stamps epoch Setting
  `salesboard:epoch` — points/counters read only `day >= epoch`. Founder
  approved one-time purge.
- **Risk model is informational only**: red/zombie/next-step markers drive no
  scoring and no movement. Roster region changes re-point work going forward —
  nothing auto-modifies past behavior except epochs.

## Dashboard

`GET /api/automations/telecalling/data` (5-min KV-cached, converters
shortcut). Payload: `meta` (period, viewer region restriction via scope,
epoch, conversion target, unmapped lead count), `kpi` (leads/calls/talk),
`risk: { counts: { red, zombie }, atRisk[], valueAtRisk }`,
`unmapped: { count, value, items[] }`,
`unmappedAccepted: { count, value, points, items[] }` (managers only),
`regions[]` (R1–R4 cards), `staffRows[]` (per-telecaller conversion +
generation + KRA + points, unmapped staff last), `recent[]` (today's
converted estimates, viewer-region channeled), `unattributedLeads`.

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
(regions / staff board / at-risk / manage; region drill via `?agent=`,
unmapped link + roster + reset-history modals, daily + estimates CSV exports).
