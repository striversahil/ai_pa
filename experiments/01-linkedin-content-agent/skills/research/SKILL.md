# Research Skill — BUI

## Purpose
Take a topic from `content/ideas/` and research it for the **founder of Brindavan Udyog India (BUI)**, producing a structured research brief the writing skill will use. Source of truth: `BUI_BRIEF.md` Sections 0-5, 9-10, 16.

## Operating rules (from brief Section 0)
1. Drafts are for the founder, in first-person voice.
2. **Never invent facts.** No yield figures, power savings, prices, customer names, subsidy details, capacities, timelines unless provided. Missing numbers become `[NEED DATA: what is needed]`; ask the founder.
3. **Never name a customer** or show their machine/mill without confirmed permission.
4. Every post must pass the checklist in `BUI_BRIEF.md` Section 12.

## Input
- Topic file: `content/ideas/NNN-slug.md` (BUI idea-bank topics; see `content/ideas/` + `BUI_BRIEF.md` Section 9)
- Brand: `brand/voice.md`, `brand/audience.md`, `brand/content-pillars.md`
- Company facts: `BUI_BRIEF.md` Section 1 (many `[FILL IN]` — treat empties as unknowns, never fill by guessing)

## Process
1. **Understand the topic.** Read slug + idea-bank entry; identify pillar (A-F) and primary audience (Section 3).
2. **Research.** Gather only verifiable facts: mechanisms (roller/sieve/moisture/tempering/power), buyer decision logic, scheme/policy status (flag `[verify before posting]` — schemes, MSP, PLI, FSSAI, GST change).
3. **Structure the brief.** Add a `research_brief` section with:
   - **Context:** 1-2 sentences (who, what, where — Indian milling context)
   - **Key facts:** 3-5 bullets, each either founder-provided/verified or explicitly `[NEED DATA: ...]`; never invent
   - **Audience angles:** one line each for the relevant audiences from Section 3
   - **Visual idea:** one specific *real* photo/video/carousel-slide suggestion per Section 10 (real factory/machine/team; AI images only for simple explainer diagrams, never a machine or customer site)
   - **Risks:** claims to avoid, permission needs, `[verify before posting]` items, no-guarantee rule (use "in one case / in our experience / depending on conditions")
4. **Move the file** from `content/ideas/` to `content/drafts/`; set frontmatter `stage: draft`, `researched_at: YYYY-MM-DD`.
5. If insufficient public/verifiable info, flag `research_status: blocked` with reason.

## Source material
- `BUI_BRIEF.md` (whole file — the operating brief)
- `brand/voice.md`, `brand/audience.md`, `brand/content-pillars.md`
- Founder input, real plant data, verified scheme/policy sources. No stock-photo thinking.
