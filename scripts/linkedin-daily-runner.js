#!/usr/bin/env node
/**
 * linkedin-daily-runner.js — daily BUI founder LinkedIn batch (5 drafts, founder picks 1).
 *
 * Flow per topic: pick (pillar spread, skip recently used) → web research the
 * PROBLEM first (Tavily→Brave→Serper→DDG-lite, zero-config fallback) → research
 * brief → draft → edit (Section-12 gate) → AI explainer visual → POST batch.
 * ALL text via the unified AI gateway (agnes-3.0-flash default); images via
 * the gateway's agnes image lane (same key pool). Founder-story topics (pillar
 * E) skip web research by design — no external facts to verify.
 *
 * Rules (from the BUI brief): never invent facts ([NEED DATA]); AI visuals are
 * explainer-diagram style ONLY — no machines, sites, people, or photographs
 * (enforced by fixed prompt template + banned-token assertion). No
 * auto-posting: the batch lands as status=draft for dashboard review.
 *
 * Env: WORKER_URL, SHARED_SECRET, AI_KEYS (or AGNES_API_KEY(S)).
 * Optional: TAVILY_API_KEY (else Brave/Serper/DDG-lite chain).
 * Manual: TOPIC=<slug> runs a single topic (testing / regenerate refill).
 */

const { workerRequest, agnesText, agnesImage } = require('./runner-lib');
const { TOPICS } = require('./linkedin-topics');
const { webResearch } = require('./linkedin-research');
const { imagePromptFor } = require('./linkedin-visual');
const { API } = require('../founder-os_backend/src/shared/sync-core/contract');

const missing = [];
if (!process.env.WORKER_URL) missing.push('WORKER_URL');
if (!process.env.SHARED_SECRET) missing.push('SHARED_SECRET');
const hasLLM = (process.env.AI_KEYS || process.env.AGNES_API_KEY || process.env.AGNES_API_KEYS);
if (!hasLLM) missing.push('AI_KEYS or AGNES_API_KEY(S)');
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AI_PACING_MS = 3000;

function istDateString(d) {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ── BUI prompts (ported from experiments/01-linkedin-content-agent) ──────────
const AVOID = 'game-changing, cutting-edge, world-class, revolutionary, synergy, leverage, next-gen, seamless, unlock, empower';
const RESEARCH_SYS = `You are the RESEARCH skill for the founder of Brindavan Udyog India (BUI), Indian milling-machinery maker (flour/rice/dal/spice/oil mills). First-person founder voice. NEVER invent facts: no yield figures, power savings, prices, customer names, subsidy details, capacities, timelines. Missing numbers become [NEED DATA: what is needed]. Never name a customer without permission. Output a structured research_brief with Context (1-2 sentences, Indian milling context), Key facts (3-5 bullets, each verified or [NEED DATA]), the core PROBLEM (1-2 lines: what hurts the mill owner) and SOLUTION direction (1-2 lines), Audience angles, Visual idea (one simple EXPLAINER-DIAGRAM concept — icons/arrows/numbers, never a machine photo), Risks. No avoid-list buzzwords (${AVOID}).`;
const WRITING_SYS = `You are the WRITING skill for the founder of Brindavan Udyog India (BUI milling machinery). First-person founder voice: practical, honest, specific, warm-but-direct. Simple English, Indian units (Rs., tonnes, HP, kW, quintal, mandi). Output Hook A and Hook B (1-2 lines each, specific and curious; never excited-to-announce), then post of 150-300 words with short paragraphs max 2-3 lines (Context 2-3 lines, the PROBLEM vividly, the SOLUTION with numbers or steps, one takeaway, one soft CTA question or offer), then visual suggestion (explainer diagram), then 3-5 hashtags, then data still needed. Max 2-3 emojis. Never invent numbers: use [NEED DATA]. No avoid-list buzzwords (${AVOID}). No guarantees (use in one case / in our experience / depending on conditions). No customer names without permission. Topic is INDIAN MILLING MACHINERY, never solar or batteries.`;
const EDITING_SYS = `You are the EDITING skill for the BUI founder (Indian milling machinery). Refine, do not rewrite, against the quality checklist. Keep Hook A / Hook B, post, visual suggestion, hashtags, data-needed list. First line specific and curious; at least one concrete number or [NEED DATA]; all numbers founder-provided or [NEED DATA]; no avoid-list buzzwords (${AVOID}); paragraphs max 2-3 lines; practical founder tone not brochure; one takeaway; one soft CTA; 3-5 hashtags; no customer named without permission; scheme/policy flagged [verify before posting]. Milling context only, never solar or batteries. Output the full refined package, no extra commentary.`;

// Explainer-visual safety boundary lives in linkedin-visual.js (imported
// above) — fixed template + banned-token assertion, no caller depictions.

async function researchTopic(topic) {
  if (!topic.angleSeed) return { brief: '', sources: [], provider: 'none-skipped', note: 'founder-story topic — no web research by design' };
  const queries = [topic.angleSeed, `${topic.title} India mill owner problem solution`];
  const seen = new Map();
  for (const q of queries) {
    try {
      const { results, provider } = await webResearch(q, 4);
      for (const r of results) if (r.url && !seen.has(r.url)) seen.set(r.url, { ...r, provider });
    } catch (e) {
      console.warn(`linkedin: research query failed (${q.slice(0, 40)}…): ${e.message}`);
    }
  }
  return { sources: [...seen.values()].slice(0, 6), provider: 'mixed' };
}

async function runTopic(topic) {
  console.log(`linkedin: [${topic.slug}] research…`);
  const { sources } = await researchTopic(topic);
  const srcBlock = sources.length
    ? sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.snippet || '(no snippet)'} (${s.url})`).join('\n')
    : '(no web sources — rely on general milling knowledge, flag everything uncertain as [NEED DATA])';
  await sleep(AI_PACING_MS);

  // Prose stages use plain Agnes text completion — matching the experiment:
  // research/write/edit output markdown, not JSON (a JSON-forcing call dropped
  // 1/5 live). Sticky sessionKey per topic keeps one keyway per draft.
  const briefText = await agnesText(RESEARCH_SYS,
    `Topic: ${topic.title}. Pillar ${topic.pillar}, format ${topic.format}.\n\nWeb findings:\n${srcBlock}\n\nProduce the research_brief (Context, Key facts, PROBLEM, SOLUTION direction, Audience angles, Visual idea, Risks).`,
    { temperature: 0.5, maxTokens: 900, sessionKey: `linkedin:${topic.slug}` });
  await sleep(AI_PACING_MS);

  console.log(`linkedin: [${topic.slug}] write…`);
  const draftText = await agnesText(WRITING_SYS,
    `Research brief:\n${briefText}\n\nWrite the LinkedIn post_draft for: ${topic.title}.`,
    { temperature: 0.7, maxTokens: 1000, sessionKey: `linkedin:${topic.slug}` });
  await sleep(AI_PACING_MS);

  console.log(`linkedin: [${topic.slug}] edit…`);
  const finalText = await agnesText(EDITING_SYS, `Edit this draft:\n\n${draftText}`, { temperature: 0.3, maxTokens: 1000, sessionKey: `linkedin:${topic.slug}` });

  const hashtags = (finalText.match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 5).join(' ');
  const concept = `${topic.title} — problem-to-solution flow in 3 steps`;
  const imgPrompt = imagePromptFor(topic.title, concept);

  console.log(`linkedin: [${topic.slug}] image…`);
  let imageB64 = null;
  try {
    imageB64 = await agnesImage(imgPrompt);
    console.log(`linkedin: [${topic.slug}] image ok (${Math.round(imageB64.length / 1024)}KB b64)`);
  } catch (e) {
    console.warn(`linkedin: [${topic.slug}] image failed (text batch continues): ${e.message}`);
  }
  return {
    topic: topic.slug, pillar: topic.pillar, format: topic.format,
    researchBrief: briefText, postDraft: draftText, postFinal: finalText,
    hashtags, visualBrief: `Explainer diagram: ${concept}. Posting slot Tue/Thu/Sat 8-10 AM IST + one engagement action (reply to every comment in the first hour).`,
    imagePrompt: imgPrompt, ...(imageB64 ? { imageB64 } : {}),
  };
}

async function main() {
  const batchDate = istDateString(new Date());
  const single = String(process.env.TOPIC || '').trim();

  let pool = TOPICS;
  if (single) {
    pool = TOPICS.filter((t) => t.slug === single);
    if (!pool.length) throw new Error(`TOPIC slug not in bank: ${single}`);
  } else {
    let used = [];
    try {
      const r = await workerRequest('/api/runner/linkedin/used-topics?days=14');
      used = new Set(r.topics || []);
    } catch (e) {
      console.warn(`linkedin: used-topics fetch failed (rotation without history): ${e.message}`);
      used = new Set();
    }
    const fresh = TOPICS.filter((t) => !used.has(t.slug));
    const base = fresh.length >= 5 ? fresh : TOPICS;
    // Pillar spread: A, B, C/D, E, F.
    const want = ['A', 'B', 'C', 'E', 'F'];
    pool = [];
    for (const p of want) {
      const cand = base.filter((t) => !pool.includes(t) && (t.pillar === p || (p === 'C' && t.pillar === 'D')));
      if (cand.length) pool.push(cand[Math.floor(Math.random() * cand.length)]);
    }
    for (const t of base) {
      if (pool.length >= 5) break;
      if (!pool.includes(t)) pool.push(t);
    }
    pool = pool.slice(0, 5);
  }
  console.log(`linkedin: batch ${batchDate} — ${pool.map((t) => t.slug).join(', ')}`);

  const posts = [];
  for (const topic of pool) {
    try {
      posts.push(await runTopic(topic));
    } catch (e) {
      console.error(`linkedin: [${topic.slug}] FAILED: ${e.message}`);
    }
  }
  if (!posts.length) throw new Error('linkedin: zero posts generated — failing the run');

  const res = await workerRequest(API.linkedinBatch, { method: 'POST', body: { batchDate, posts } });
  console.log(`linkedin: done — generated ${posts.length} (${posts.filter((p) => p.imageB64).length} with images), stored ${res?.stored ?? '?'}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('linkedin-daily-runner: fatal error:', err.message);
    process.exit(1);
  });
}
