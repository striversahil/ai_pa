#!/usr/bin/env node
/**
 * linkedin-daily-runner.js — daily BUI founder LinkedIn batch (5 drafts, founder picks 1).
 *
 * NEW STYLE (prompt.txt + post_ideas.json, single call per draft):
 * pick idea (HIGH-weighted, skip recently used) → feed the whole idea
 * object through prompt.txt (system) → strict-JSON post (Draft→Edit
 * collapsed into the prompt's punch rules + self-check) → images for
 * all 5 generated IN PARALLEL → POST batch to the worker.
 *
 * The old research→draft→edit pipeline (linkedin-research.js,
 * linkedin-visual.js, linkedin-format.js, linkedin-topics.js) is
 * DISCARDED as a generation path — those files are dormant on disk,
 * nothing imports them now. Text via the unified AI gateway
 * (agnes-3.0-flash default); images via kie.ai GPT-Image-2.5 Flare
 * (scripts/kie-image.js, KIE_API_KEY), Agnes image lane as fallback.
 * No auto-posting: the batch lands as status=draft for dashboard review.
 *
 * Env: WORKER_URL, SHARED_SECRET, AI_KEYS (or AGNES_API_KEY(S)).
 * Manual: IDEA=<P001..P200> (or TOPIC=<same>) runs a single idea;
 * IDEA=AUTO (or TOPIC=AUTO) runs ONE rotation-aware HIGH-priority idea
 * (dashboard "new draft on the fly").
 */

const fs = require('fs');
const path = require('path');
const { workerRequest, agnesText, agnesImage } = require('./runner-lib');
const { kieImage } = require('./kie-image');
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

// ── New-style inputs (prompt.txt is the system prompt) ──────────────────────
const LDIR = path.join(__dirname, '..', 'founder-os_backend', 'src', 'automations', 'linkedin');
const SYS = fs.readFileSync(path.join(LDIR, 'prompt.txt'), 'utf8');
const IDEAS = JSON.parse(fs.readFileSync(path.join(LDIR, 'post_ideas.json'), 'utf8'));

function topicLabel(idea) {
  return `${idea.id} ${idea.related_machine || idea.category || ''}`.slice(0, 60).trim();
}

function ideaInput(idea) {
  return [
    'IDEA (from post_ideas.json — use every field per the system prompt):',
    `ID: ${idea.id}`,
    'POST TYPE: PROBLEM-SOLUTION',
    `CATEGORY: ${idea.category}`,
    `PROBLEM: ${idea.problem}`,
    `AGITATION: ${idea.agitation}`,
    `SOLUTION STEPS: ${(idea.solution_steps || []).map((s, i) => `${i + 1}. ${s}`).join(' | ')}`,
    `RELATED MACHINE: ${idea.related_machine}`,
    `HOOK IDEAS: ${(idea.hook_ideas || []).join(' / ')}`,
    `RECOMMENDED PRODUCT: ${idea.recommended_product}`,
    `PRODUCT ANGLE: ${idea.product_angle}`,
    `PORTFOLIO FIT: ${idea.portfolio_fit}`,
    `NEEDS VERIFICATION: ${idea.needs_verification}`,
    'CTA PREFERENCE: invitation to contact (use the contact details in the system prompt; Mon-Sat, 10 AM-6 PM)',
  ].join('\n');
}

function parsePostJson(text) {
  const t = String(text ?? '').replace(/```json|```/g, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in model output');
  return JSON.parse(t.slice(start, end + 1));
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function runIdea(idea) {
  console.log(`linkedin: [${idea.id}] write…`);
  let out;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await agnesText(SYS,
      ideaInput(idea) + (attempt > 1 ? '\n\nReply with ONE valid JSON object and NOTHING else.' : ''),
      { temperature: 0.7, maxTokens: 1500, sessionKey: `linkedin:${idea.id}` });
    try {
      out = parsePostJson(text);
      break;
    } catch (e) {
      console.warn(`linkedin: [${idea.id}] parse failed (attempt ${attempt}): ${e.message}`);
      await sleep(AI_PACING_MS);
    }
  }
  if (!out) throw new Error(`[${idea.id}] unparseable model output after 2 attempts`);
  if (out.status === 'REJECTED') {
    console.log(`linkedin: [${idea.id}] model rejected (${out.reject_reason || 'no reason'}) — skipping`);
    return null;
  }
  if (!out.post_text) throw new Error(`[${idea.id}] empty post_text`);
  const finished = String(out.post_text).trim();
  const hashtags = (finished.match(/#[\p{L}\p{N}_]+/gu) || []).slice(0, 5).join(' ');
  const imageIdea = String(out.image_idea || '').trim();
  return {
    topic: topicLabel(idea),
    pillar: String(idea.category || ''),
    format: 'PROBLEM-SOLUTION',
    researchBrief: `Problem: ${idea.problem}\nAgitation: ${idea.agitation}\nSteps: ${(idea.solution_steps || []).join(' | ')}`,
    postDraft: JSON.stringify(out).slice(0, 4000),
    postFinal: finished,
    hashtags,
    visualBrief: imageIdea,
    // Diagram part only — the ALT PHOTO line is for the human, not the model.
    imagePrompt: imageIdea.split('ALT PHOTO:')[0].trim(),
    firstComment: String(out.first_comment || ''),
  };
}

async function main() {
  const batchDate = istDateString(new Date());
  const single = String(process.env.IDEA || process.env.TOPIC || '').trim().toUpperCase();

  let pool;
  if (single && single !== 'AUTO') {
    const hit = IDEAS.find((i) => String(i.id).toUpperCase() === single);
    if (!hit) throw new Error(`IDEA id not in bank: ${single} (want P001–P200 or AUTO)`);
    pool = [hit];
  } else {
    let used = new Set();
    try {
      const r = await workerRequest('/api/runner/linkedin/used-topics?days=120');
      used = new Set(r.topics || []);
    } catch (e) {
      console.warn(`linkedin: used-topics fetch failed (rotation without history): ${e.message}`);
    }
    const fresh = IDEAS.filter((i) => !used.has(i.id) && !used.has(topicLabel(i)));
    if (single === 'AUTO') {
      // On-the-fly single: one fresh HIGH, else any fresh, else any idea.
      const high = shuffle(fresh.filter((i) => i.portfolio_fit === 'HIGH'));
      const any = shuffle(fresh.length ? fresh : [...IDEAS]);
      pool = [...high, ...any].slice(0, 1);
      console.log(`linkedin: AUTO picked ${pool[0].id}`);
    } else {
      const base = fresh.length >= 5 ? fresh : IDEAS;
      const high5 = shuffle(base.filter((i) => i.portfolio_fit === 'HIGH'));
      const med = shuffle(base.filter((i) => i.portfolio_fit !== 'HIGH'));
      pool = [...high5, ...med].slice(0, 5);
    }
  }
  console.log(`linkedin: batch ${batchDate} — ${pool.map((t) => t.id).join(', ')}`);

  // Text first (serial, paced — one idea per call, sticky session per idea).
  const posts = [];
  for (const idea of pool) {
    try {
      const p = await runIdea(idea);
      if (p) posts.push(p);
    } catch (e) {
      console.error(`linkedin: [${idea.id}] FAILED: ${e.message}`);
    }
    await sleep(AI_PACING_MS);
  }
  if (!posts.length) throw new Error('linkedin: zero posts generated — failing the run');

  // Images IN PARALLEL across the whole batch (settled individually so one
  // failure never sinks the text batch). kie.ai GPT-Image-2.5 when keyed;
  // kie 401/402 (bad key / out of credits) falls back to Agnes per post.
  const useKie = !!process.env.KIE_API_KEY;
  console.log(`linkedin: images ×${posts.length} (parallel, via ${useKie ? 'kie.ai gpt-image-2.5' : 'agnes fallback'})…`);
  await Promise.allSettled(posts.map(async (p) => {
    if (!p.imagePrompt) return;
    try {
      p.imageB64 = await (useKie ? kieImage(p.imagePrompt) : agnesImage(p.imagePrompt));
      console.log(`linkedin: [${p.topic}] image ok (${Math.round(p.imageB64.length / 1024)}KB b64)`);
    } catch (e) {
      if (useKie) {
        // Any kie failure (401/402/network) → Agnes fallback per post.
        try {
          p.imageB64 = await agnesImage(p.imagePrompt);
          console.log(`linkedin: [${p.topic}] image ok via agnes fallback (${Math.round(p.imageB64.length / 1024)}KB b64)`);
          return;
        } catch (e2) {
          console.warn(`linkedin: [${p.topic}] image failed incl. fallback: ${e2.message}`);
          return;
        }
      }
      console.warn(`linkedin: [${p.topic}] image failed (text batch continues): ${e.message}`);
    }
  }));

  const res = await workerRequest(API.linkedinBatch, { method: 'POST', body: { batchDate, posts } });
  console.log(`linkedin: done — generated ${posts.length} (${posts.filter((p) => p.imageB64).length} with images), stored ${res?.stored ?? '?'}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('linkedin-daily-runner: fatal error:', err.message);
    process.exit(1);
  });
}
