# Create Post Workflow — BUI

Source of truth: `BUI_BRIEF.md` Section 17. This project stops at a reviewable draft; never auto-posts.

## Pipeline
1. **Read** `BUI_BRIEF.md` fully. If critical Section 1 `[FILL IN]` fields are empty, ask the founder for the most important one first (one question at a time).
2. **Select** an idea from `content/ideas/` (BUI idea bank, mirroring brief Section 9) or a new founder-given topic.
3. **Research** → brief with verified facts only + `[NEED DATA]` list + real-visual idea (Section 10). Move file `ideas/` → `drafts/`.
4. **Draft** per Section 8 template with **2 hook options**.
5. **Edit** against tone (Section 4) + checklist (Section 12).
6. **Suggest visual**: specific real photo/video idea or carousel slide outline (AI images only for simple explainer diagrams, never machines/customer sites). **No AI stock-photo generation by default.**
7. **Suggest** posting day/time (Tue/Thu/Sat 8-10 AM IST cadence, Section 11) + one engagement action.
8. **Deliver** the package: Hook A / Hook B, post text, visual suggestion, hashtags, data still needed.
9. **Log** the post in `output/RUN_LOG.md` (date, topic, pillar, format, hooks, data-needed, results) for monthly review (Section 15).

## Naming convention
- Every topic gets one file: `NNN-slug.md` (zero-padded, creation order, never reuse/renumber).
- File moves `content/ideas/` → `content/drafts/` → `content/published/` (not copied/renamed per stage); check all three folders before creating a new slug.
- Each file accumulates research notes, post copy, and visual brief inline.
- Outputs also mirrored to `output/NNN-slug/` by `run.py` (`research_brief.md`, `post_draft.md`, `post_final.md`, `visual_brief.txt`, `run_log.json`) without mutating `content/`.
