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
- **🏆 Leaderboard** — ranked by **Est. Conv ₹ + co-credited close value**, with
  🥇🥈🥉 podium highlighting for the top 3, an "Est. Conv ₹" column, a co-credit
  badge next to Won (`+🏅n.n`), and sort options (Est. Conversion ₹ / Composite
  Score / Won / Calls / Leads). Team KPI strip shows **Est. Conv ₹** (projected
  closed value across the open pipeline) instead of a flat conversion %.
- **🔥 At Risk (EOD snatch)** — founder pre-warning panel, sorted by value, with
  **snatch reason** + a live **countdown chip** (`Snatch in ~Xh`) so agents see
  exactly why a deal is about to be taken and how much time they have left.

## Assignment engine (stability-first, conversion-maximising)

`assignEstimatesForMaxConversion()` replaced the old pure round-robin
(`rotateEstimatesRoundRobin()` is kept in the file as a legacy fallback):

- **Healthy estimates stay put.** Estimates whose live risk is `ok`/`pending`
  keep their current agent — customer relationships/momentum are never reset.
- **Unassigned** `sent` estimates are dealt once, to the best-fit agent.
- **At-risk estimates (`red` / `zombie`) are re-poached** to a better converter.
- Candidate dealing is **high-value first**, scored per agent by
  `conversionWeight (0.6) × historical win rate − loadWeight (0.4) × load
  factor` (`ASSIGN_TUNING`), so proven closers get the whales while nobody is
  buried.
- Every assign/reassign is **recorded into the `EstimateAssignment` chain**
  (previous open row marked `resolved`, new row linked via `reassignedFromId`)
  — the source of truth for fair close-credit. Each EOD snatch also stores a
  **`snatchReason`** on the new row (e.g. "unsatisfactory remark: customer not
  answering"), surfaced to the losing agent so the mechanic is instructive.

The engine runs twice daily: **08:00 IST** (`cron-daily-ist.yml →
POST /api/trigger/telecalling`) to deal unassigned estimates, and the
**9:00 PM IST EOD sweep** (`30 15 * * *` UTC) that re-poaches estimates with an
unsatisfactory remark or 2+ days of silence to the higher-converting agent.
Risk states accumulate live in between via the 15-min Zoho analyzer.

## Estimated conversion (per agent + team)

`conversion.estimatedConversion {count, value}` projects expected closes from
the agent's open pipeline:

```
prob(estimate) = clamp(max(agentWinRate, 0.2), 0.05..0.95) × toCloseMultiplier(risk)
Est. Conv ₹    = Σ over the agent's open estimates of (total × prob)
```

Risk multipliers: `ok 1.0 · pending 0.7 · red 0.35 · zombie 0.15`. The 0.2 win-
rate floor keeps brand-new agents off zero. Also surfaced as the team-level
"Est. Conv ₹" KPI and in each agent-view summary.

## Close co-credit (fair outcome reward)

A snatch-then-close splits credit between the originator and the closer —
**origin 0.6 / closer 0.4** (`CLOSE_CREDIT`) — by walking each won estimate's
`EstimateAssignment` chain to its root. Without history (estimates closed
before this shipped, or never reassigned) the full close credits the current
holder. The leaderboard's Won column shows co-credited closes as `+🏅n.n`, and
co-credited value feeds the ranking, so proven agents aren't demotivated when a
deal they worked gets re-poached and closed by someone else.

## Risk model (live pre-warning)

The dashboard data also computes a real-time risk state for every open `sent`
estimate, so trouble is visible BEFORE the reassignment sweep:

- **red** — latest AI verdict is `meaningfulUpdate=false` (the snatch candidate)
- **zombie** — no sales comment for more than 2 days (`ZOMBIE_DAYS`, matching the
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
