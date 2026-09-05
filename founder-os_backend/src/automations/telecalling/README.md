# Telecalling

A single automation that surfaces, per active telecaller, both halves of daily
performance, plus team KPIs and a live leaderboard.

## Sections (dashboard)

Leaderboard now renders **above** the "🔥 At Risk" panel so the competition is
the first thing agents see when they open the tab.

- **Lead Conversion** — Zoho `sent` estimates are assigned programmatically to
  active telecallers by the **stability-first, conversion-maximising engine**
  (see below). At-risk estimates (unsatisfactory/zombie) are re-poached at the
  **9:00 PM IST EOD sweep** to better converters.
- **Lead Generation** — NeoDove calls connected + leads generated per day,
  refreshed live from the NeoDove backend push (every ~10 min via the GH runner).
- **🏆 Leaderboard** — ranked by **composite score** (`close +100 · lead +15 ·
  call +0.5 − snatch 15 − decline 20`) per selected timeframe, with 🥇🥈🥉
  podium highlighting for the top 3 and a color-coded **scoring-criteria strip**
  plus an ⓘ **Game Rules** hover card explaining every rule in plain English.
  Columns: `# · Telecaller · Leads · Est. Won · Calls · Talk · Risk · Score`.
  Sort options: Composite Score / Won / Calls / Leads. Because the score is
  driven by **event-ledger rows keyed by IST day** (see below), every period
  filter (Today / This Week / This Month / This Year…) sums its own range — the
  weekly view restarts at zero each week, giving everyone a fair shot at the
  table.
- **🔥 At Risk (EOD snatch)** — founder pre-warning panel, sorted by value, with
  **snatch reason** + a live **countdown chip** (`Snatch in ~Xh`) so agents see
  exactly why a deal is about to be taken and how much time they have left.

## Assignment engine (stability-first, conversion-maximising)

`assignEstimatesForMaxConversion()` replaced the old pure round-robin
(`rotateEstimatesRoundRobin()` is kept in the file as a legacy fallback):

- **Healthy estimates stay put.** Estimates whose live risk is `ok`/`pending`
  keep their current agent — customer relationships/momentum are never reset.
- **Unassigned** `sent` estimates are dealt once: **creator-first** (see below),
  then best-fit agent.
- **At-risk estimates (`red` / `zombie`) are re-poached** to a better converter.
- Candidate dealing is **high-value first**, scored per agent by
  `conversionWeight (0.6) × historical win rate − loadWeight (0.4) × load
  factor` (`ASSIGN_TUNING`), so proven closers get the whales while nobody is
  buried.
- Every assign/reassign is **recorded into the `EstimateAssignment` chain**
  (previous open row marked `resolved`, new row linked via `reassignedFromId`)
  — the source of truth for the decline-penalty and snatch reasons. Each EOD
  snatch also stores a **`snatchReason`** on the new row (e.g. "unsatisfactory
  remark: customer not answering"), surfaced to the losing agent so the mechanic
  is instructive.

### Creator-first lead assignment

New estimates are credited to the sales agent who generated the lead. When a
`sent` estimate is first dealt, `inferEstimateCreator()` reads the **first 3
comments** (chronological) and matches each author against the active roster —
**Zoho system auto-logs are skipped** via `isSystemGeneratedComment()`
(phrase + author filter), so "Quote sent", "status changed", "created for" etc.
never drive assignment. The **first real comment that names an active agent
wins** (agents are instructed to write their name in the first two comments).
The winning agent gets `Estimate.createdBy` set and the estimate is dealt to
him as sole creator. `creatorMatches()` is prefix/substring-tolerant ("samar" →
"Samarjeet"), with a 3-char minimum to avoid initials.

### Event-ledger scoring (+100 / −15 / −20)

The leaderboard is driven by an append-only `TelecallerScoreEvent` ledger, and
**Won is counted from the +100 close events in the selected timeframe** (not the
lifetime of currently-held won estimates), so Today = only today's conversions:

- **+100** — an estimate the agent held **converts** (status →
  `accepted`/`confirmed`), credited to the **holder at conversion moment**.
  Recorded by `recordConversionClose()` in the status-sync route,
  duplicate-guarded (one +100 per estimate).
- **−15** — an estimate is **snatched at EOD** (unsatisfactory remark or 3+ days
  of silence), charged to the **agent who lost it** by `recordSnatchPenalty()`
  in the assignment engine.
- **−20** — an estimate **declined after 3+ days** (older than `ZOMBIE_DAYS`);
  charged **−20 per holding** to **every agent who held it** by
  `recordDeclinePenalty()` in the status-sync route. Each time an agent held the
  estimate counts once — an agent who held it 3 times (e.g. snatched away, given
  back, re-snatched) is penalised **−20 × 3 = −60**. The whole penalty is
  recorded once per estimate (idempotent).

Each row stores the **IST day** it happened, so any timeframe (week/month/year)
sums its own range — the weekly table restarts at zero naturally, and the score
is fully auditable per event.

The engine runs every **30 minutes** (`cron-every-30min.yml →
POST /api/trigger/telecalling`): it deals unassigned estimates and, at the
**9:00 PM IST EOD sweep**, re-poaches estimates with an unsatisfactory remark or
3+ days of silence to the higher-converting agent. Risk states accumulate live
in between via the 15-min Zoho analyzer (deterministic rules first, LLM fallback
on the GH runner); the risk scan itself is cached in a Setting key with a
**15-min TTL** so it refreshes in lock-step with the AI verdicts.

## Estimated conversion (team KPI + agent view)

`conversion.estimatedConversion {count, value}` projects expected closes from
the agent's open pipeline. It is surfaced as the team-level **Est. Conv ₹** KPI
and in each agent-view summary (not as a leaderboard column):

```
prob(estimate) = clamp(max(agentWinRate, 0.2), 0.05..0.95) × toCloseMultiplier(risk)
Est. Conv ₹    = Σ over the agent's open estimates of (total × prob)
```

Risk multipliers: `ok 1.0 · pending 0.7 · red 0.35 · zombie 0.15`. The 0.2 win-
rate floor keeps brand-new agents off zero.

## Risk model (live pre-warning)

The dashboard data also computes a real-time risk state for every open `sent`
estimate, so trouble is visible BEFORE the reassignment sweep:

- **red** — latest AI verdict is `meaningfulUpdate=false` (the snatch candidate)
- **zombie** — no sales comment for more than 3 days (`ZOMBIE_DAYS`, matching the
  AI rule that stale comments are never meaningful)
- **pending** — no AI verdict yet; **ok** — latest comment was meaningful

Surfaces: the "🔥 At Risk" panel (sorted by value with `valueAtRisk`, per-item
`snatchReason` + `snatchInHours` countdown), a Risk column on the leaderboard
(per-agent red/zombie counts), and `StaleChip`/`SnatchChip` chips on every
follow-up row in the agent and conversion views. A forward-looking customer
promise counts as a meaningful update only when it carries a concrete next step
(follow-up date/day/time).

## Roster
Telecallers are managed via `GET/POST/PUT/DELETE /api/telecallers`. Link each
roster entry to its NeoDove agent with `neodoveUserId` / `neodoveUserName` so
Lead Generation merges with Lead Conversion. Roster rows are auto-seeded from
unique NeoDove agents across stored report days (deactivate leavers manually —
the seeder never reactivates).

Trigger: `POST /api/trigger/telecalling`
Dashboard: `GET /api/automations/telecalling/data`
