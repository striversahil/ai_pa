# Telecalling

A single automation that surfaces, per active telecaller, both halves of daily
performance, plus team KPIs and a live leaderboard.

## Sections (dashboard)
- **Lead Conversion** — Zoho `sent` estimates are assigned programmatically to
  active telecallers (round-robin by default). End-of-day, estimates whose
  latest classification is still "unsatisfactory" (no meaningful update) are
  reassigned to the next best performer.
- **Lead Generation** — NeoDove calls connected + leads generated per day,
  refreshed live from the NeoDove backend push (every ~10 min via the GH runner).

## KPIs & Leaderboard
Team KPI strip (assigned / won / conversion % / connected calls / leads /
talk time) and a per-telecaller leaderboard ranked by a composite daily score
(wins × 100 + leads × 15 + calls × 0.5 — tunable).

## Roster
Telecallers are managed via `GET/POST/PUT/DELETE /api/telecallers`. Link each
roster entry to its NeoDove agent with `neodoveUserId` / `neodoveUserName` so
Lead Generation merges with Lead Conversion.

Trigger: `POST /api/trigger/telecalling`
Dashboard: `GET /api/automations/telecalling/data`
