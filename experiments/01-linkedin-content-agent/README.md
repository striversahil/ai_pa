# 01-linkedin-content-agent — BUI founder LinkedIn pipeline (Agnes 3.0 Flash)

File-driven pipeline ported from `amit-srivatsa/ampfield-linkedin-content-agent`
and **re-optimized for the BUI founder brief** (chat, 2026-09-29; pointer in `BUI_BRIEF.md`).
Text via **Agnes 3.0 Flash** (`agnes-3.0-flash`); visuals are **real-photo briefs only**
(per brief Section 10 — no stock, no AI machine photos).

Ampfield source kept under `brand/*.AMPFIELD.bak`, `skills/*/SKILL.AMPFIELD.bak`,
`workflows/create-post.AMPFIELD.bak`, `agnes_client.AMPFIELD.bak`, `run.AMPFIELD.bak`,
`content/{ideas,drafts,published}/_ampfield_archive/`, `UPSTREAM_*.md`. Prior Agnes
output kept under `output/006-what-demand-response-actually-pays/` (reference only).

## Setup

```bash
export AGNES_API_KEY='sk-...'   # never commit; rotate any key pasted in chat
export AGNES_BASE_URL='https://apihub.agnes-ai.com/v1'
export AGNES_TEXT_MODEL='agnes-3.0-flash'
python3 run.py --topic 003-five-reasons-yield-dropping.md
python3 run.py --all-new   # all 10 BUI ideas
```

## Pipeline (per topic)

1. **Research** — `skills/research/SKILL.md` + BUI idea → `research_brief` (verified facts or `[NEED DATA]`, audience angles, real-visual idea, risks)
2. **Write** — `skills/writing/SKILL.md` → Hook A / Hook B + 150-300w post + visual suggestion + hashtags + data-needed
3. **Edit** — `skills/editing/SKILL.md` → Section 12 checklist gate
4. **Visual brief** — one shootable real photo/video/carousel brief + posting slot + engagement action (no AI image gen)
5. **Output** — `output/NNN-slug/` with `research_brief.md`, `post_draft.md`, `post_final.md`, `visual_brief.txt`, `run_log.json`. `content/` is never mutated by `run.py`.

## Security

- Key from env only. `.gitignore` covers `.env`, `output/`.
- Rotate any key ever pasted in chat (per `AGNES_AI_USAGE.md`).
