# WhatsApp Business Autopilot

Turns messy WhatsApp conversations into **structured, trackable business work**.
Implements the architecture in `whatsapp-business-autopilot-architecture.md` —
message lineage, per-chat task queue, an LLM state-transition engine (8
transitions: create / update / complete / reopen / wait / clarify / review /
action), a tool registry with approval + failure policies, and a human review
queue.

## Where the heavy work runs

**Nowhere near the Worker request path.** The core loop is executed by the
GitHub Actions runner `scripts/whatsapp-autopilot-runner.js` (every 5 min,
`cron-every-5min.yml`). It calls the Worker's `/api/runner/autopilot/*`
endpoints for D1 reads/writes and makes the LLM calls via Omniroute directly —
the same pattern as `whatsapp-digest-runner.js` / `zoho-sent-runner.js`.

This automation is the **read side only**:

- `handler()`: no-op (nothing to execute server-side).
- `data()`: `GET /api/automations/whatsapp-autopilot/data` → task-queue stats,
  review queue, proposed actions, recent history, override count. Rendered by
  the frontend `AutopilotDashboard`.

## Current phase: 0 — Shadow mode

The full loop runs (association → transition → history → proposed actions) and
populates the task queue, but **no tool ever executes**: every action row stays
`status = pending`, nothing is ever sent to a customer or vendor. Humans still
work WhatsApp normally; the dashboard shows the structured view alongside.

Rollout phases (per the architecture doc §13):

| Phase | Meaning |
|-------|---------|
| 0 (now) | Shadow mode — record everything, send nothing |
| 1 | Assisted — Wait/Clarify apply; Actions/Completes need human approval |
| 2 | Semi-auto — low-risk tools run autonomously; price-bearing reviewed |
| 3 | Scoped full-auto for narrow, well-understood flows |

## Data model (Prisma source of truth; D1 mirror in d1/schema.sql)

| Model | Purpose |
|-------|---------|
| `WaTask` | One open piece of business work per chat; `version` int for optimistic concurrency |
| `MessageLineage` | message → parent → root chain + task association, keyed by WhatsApp message id (unique) |
| `WaTaskHistory` | every transition with confidence — full audit trail (§8) |
| `WaAction` | proposed/executed tools with `requires_approval` semantics |
| `OverrideLog` | human overrides logged next to the system's original decision + confidence |

## Confidence gates (§8 starting thresholds)

- Association < 0.85 → no auto-attach, route to review
- Transition Create/Update < 0.8 → review
- Transition Complete < 0.9 → review
- Wait / Clarify: safe at any confidence (they commit nothing)

## Runner API endpoints (Bearer SHARED_SECRET)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/runner/autopilot/inbox` | Unprocessed messages (+quoted refs), open tasks, recent context per chat |
| GET | `/api/runner/autopilot/lineage-lookup?ids=a,b,c` | Resolve quoted WA ids → `{ taskId, rootWaMessageId }` |
| POST | `/api/runner/autopilot/lineage` | Upsert lineage rows |
| POST | `/api/runner/autopilot/tasks/create` | Create task (create-dedupe window built in) |
| POST | `/api/runner/autopilot/tasks/transition` | Optimistic versioned transition → 409 on conflict w/ fresh row |
| POST | `/api/runner/autopilot/actions` | Record proposed actions (pending) |
| GET | `/api/runner/autopilot/followups` | Due follow-ups + Wait timeouts + silence auto-closes |

Human/dashboard API (session-gated): `POST /api/autopilot/tasks/:id/review`,
`POST /api/autopilot/actions/:id/decide`.
