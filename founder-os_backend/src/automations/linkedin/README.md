# LinkedIn — Daily Founder Content

Daily BUI founder LinkedIn pipeline: 5 web-researched drafts/day, founder picks 1 on the dashboard, posting stays manual.

Link used :
1. https://claude.ai/chat/edd34646-fb74-460c-8b08-547caa54869d  - generate post ideas

| Path | Where | Does what |
|---|---|---|
| `scripts/linkedin-daily-runner.js` (+ `linkedin-topics.js`, `linkedin-research.js`) | GH Actions, 00:30 UTC daily | Topic rotation → web research → research brief → draft → edit → AI explainer visual (all via AI gateway, agnes-3.0-flash) → POST batch to worker |
| `src/automations/linkedin/index.ts` | Worker | `handler()` heartbeat; `data()` serves today's batch + history (KV-cached 60s) |
| `src/worker/routes/linkedin.ts` | Worker | `GET /api/linkedin/today`, `GET /api/linkedin/image/:id`, `POST /api/linkedin/pick`, `POST /api/linkedin/regenerate`, `POST /api/runner/linkedin/batch` (secret) |
| `LinkedinPost` (migration 0051) | D1 | Text + status per draft; images as raw bytes in CHAT_FILES KV (`linkedin/<id>.png`, same pattern as CRM attachments) |

Rules: never invent facts (`[NEED DATA]`); AI visuals are explainer-diagram style only (no machines, sites, people); posting is manual-tap only via `POST /api/linkedin/post-now` (personal profile OAuth, tokens in KV) — the Worker never auto-posts.
