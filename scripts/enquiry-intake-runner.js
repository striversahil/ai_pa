#!/usr/bin/env node

/**
 * enquiry-intake-runner.js — unstructured intake → KYP-grounded items → price memory.
 *
 * Runs on GH Actions (unlimited CPU). Per pending enquiry (from
 * GET /api/runner/enquiry-intake/pending), single source of truth is
 * founder-os_backend/data/know_your_product_v2.json (136 items, 10 cats):
 *   Stage A router (vision+text, slim category:item list ~630 tokens):
 *     free text + enquiry/item images → verbatim lines + category each +
 *     lead block. Client wording is NEVER renamed here.
 *   Stage B grounder (text-only, one call per routed category with that
 *     category's full aliases + required_attributes, worst ~4k tokens):
 *     verbatim lines → exact item_name + verbatim spec + missing[] per
 *     required_attributes. Unknown lines pass through verbatim.
 *   Stage C (price memory): HF-embed spec → Pinecone query topK=5 in the
 *     item's category namespace + `uncategorized` → route exact/suggest/miss.
 *   POST /api/runner/enquiry-intake/result applies fill-empty-only updates +
 *     KV suggestions for the sales UI.
 *
 * Env: WORKER_URL, SHARED_SECRET, OPENROUTER_API_KEYS / OPENROUTER_API_KEY
 *   (OpenRouter-only; Groq is never used in this workflow),
 *   OPENROUTER_FREE_MODELS (comma-separated free-model rotation for text;
 *   vision stays on ling-3.0-flash-vl), HF_API_KEY,
 *   PINECONE_HOST, PINECONE_API_KEY.
 *   VISION_MODEL override supported by the gateway (default llama-4-scout).
 * Flags: --limit N (cap enquiries per run), --dry-run (no result POSTs).
 */

const fs = require('node:fs');
const path = require('node:path');
const { workerRequest } = require('./runner-lib');
const { getGateway, buildVisionUserContent } = require('./ai-gateway');

const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const CAP = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10)) : 25;

const missing = [];
if (!process.env.WORKER_URL) missing.push('WORKER_URL');
if (!process.env.SHARED_SECRET) missing.push('SHARED_SECRET');
// Enquiry vision runs on OpenRouter ONLY (paid per-token) — Groq is never
// used in this workflow.
if (!process.env.OPENROUTER_API_KEYS && !process.env.OPENROUTER_API_KEY) {
  missing.push('OPENROUTER_API_KEYS (or OPENROUTER_API_KEY — Groq is not used here)');
}
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}
const HF_KEY = (process.env.HF_API_KEY || '').trim();
const PC_HOST = (process.env.PINECONE_HOST || '').trim().replace(/\/+$/, '');
const PC_KEY = (process.env.PINECONE_API_KEY || '').trim();

const DATA_DIR = path.join(__dirname, '..', 'founder-os_backend', 'data');
// Single source of truth: know_your_product_v2.json (136 items, 10 categories).
// Two-stage extraction keeps prompts small:
//   Stage A (router, vision+text): slim `Category: item, item, ...` list
//     (~630 tokens) → verbatim lines + category each + lead block.
//   Stage B (grounder, text-only, per routed category): full category detail
//     (aliases + required_attributes, worst ~4k tokens) → exact item_name,
//     verbatim spec, missing[] per required_attributes.
// No kyp_taxonomy.json / kyp_slots.json — deleted from this pipeline.
const kyp = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'know_your_product_v2.json'), 'utf8'));

// Slim routing list: NUMBERED categories + item names only (no attributes).
// Numbers make the router copy a digit instead of a name — models reliably
// echo `2` where they would otherwise echo a material or item word.
const ROUTER_LINES = kyp.categories
  .map((c, i) => `${i + 1}. ${c.category}: ${c.items.map((it) => it.item_name).join(', ')}`)
  .join('\n');
const ROUTER_COUNT = kyp.categories.length;

// Full detail per category for Stage B grounding.
const CATEGORY_DETAIL = new Map(
  kyp.categories.map((c) => [c.category, c.items.map((i) => ({
    item_name: i.item_name,
    aliases: i.aliases || [],
    required_attributes: i.required_attributes || [],
  }))]),
);

// Canonical lookup: exact item_name or alias (case-insensitive) → {category, item_name}.
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const V2_INDEX = [];
for (const c of kyp.categories) {
  for (const i of c.items) {
    V2_INDEX.push({
      category: c.category,
      item_name: i.item_name,
      keys: new Set([normName(i.item_name), ...(i.aliases || []).map(normName)]),
    });
  }
}
function resolveV2(category, itemName) {
  const q = normName(`${category} ${itemName}`);
  // Prefer an exact hit inside the routed category first.
  for (const t of V2_INDEX) {
    if (t.category !== category) continue;
    if (normName(t.item_name) === normName(itemName)) return t;
  }
  for (const t of V2_INDEX) {
    for (const key of t.keys) {
      if (!key) continue;
      if (q === key || normName(category) === key || normName(itemName) === key) return t;
    }
  }
  let best = null;
  let bestScore = 0;
  for (const t of V2_INDEX) {
    for (const key of t.keys) {
      if (!key || key.length < 4) continue;
      if (q.includes(key) && key.length > bestScore) {
        bestScore = key.length;
        best = t;
      }
    }
  }
  if (best) return best;
  // Unknown item: keep the model's verbatim words under the routed category
  // (or Uncategorized) — never invent a name.
  return { category: String(category || 'Uncategorized').slice(0, 120), item_name: String(itemName || '').slice(0, 300) };
}

const ROUTER_SYSTEM = `You are a B2B industrial-spare intake router for flour-mill machinery. From the sales text + attached photos, split the enquiry into purchasable line items.
For EACH item return: {"verbatim": "client wording for the product, copied exactly as written/seen — NEVER rename or canonicalize", "category": "the category NUMBER (1-${ROUTER_COUNT}) from the numbered list below, as a bare number", "qty": "quantity with unit or empty", "dims": "dimensions as written", "spec": "material/variant/spec detail as written"}.
Also extract the lead block: {"lead": {"clientCompany": "customer company, or empty", "contactName": "contact person, or empty", "contactEmail": "or empty", "contactPhone": "mobile/phone, or empty", "location": "city/state, or empty", "sourceLead": "lead source like IndiaMART/reference, or empty"}} — NEVER invent; empty when not stated. The sales agent's own name ("Lead of ...") is NOT the customer — ignore it.
Rules: one entry per distinct product; a line containing ONLY a quantity (e.g. "QTY - 1") is NOT its own product — attach it to the product line directly above it; NEVER drop or merge product lines — every product mentioned in the text or seen in a photo gets its own entry; "category" MUST be copied EXACTLY from the
category list below (it is always a multi-word department name like "Conveying
Accessories" — NEVER a material, product, or alias word like "Nylon" or "Belt");
never invent quantities, dimensions or contact details — if absent, leave empty; return STRICT JSON {"lines":[...],"lead":{...}} with no other text.`;

function stageBSystem(category) {
  const detail = (CATEGORY_DETAIL.get(category) || []).map((i) =>
    `- ${i.item_name}${i.aliases.length ? ` (aka: ${i.aliases.slice(0, 6).join(', ')})` : ''}\n  needs: ${i.required_attributes.join(' | ')}`,
  ).join('\n');
  return `You are a B2B industrial-spare grounder for flour-mill machinery, category: ${category}. For each input line, pick the EXACT item_name from the catalogue below (aliases are hints only — output the canonical item_name). When NO catalogue entry truly fits the line, output "item_name": "UNMATCHED" — never force a wrong match. Echo each input's "verbatim" back unchanged, keep qty/dims/spec VERBATIM from the input — never rephrase client wording; merge dims+spec into "spec" as written. Output ONE item per input line, in the SAME order. Also list "missing": what the catalogue's "needs" still requires (e.g. 'Milling Fabric needs grade no.').
Catalogue:\n${detail}\nReturn STRICT JSON {"items":[{"verbatim": "...", "item_name": "...", "qty": "...", "spec": "..."}], "missing":[...]} with no other text.`;
}

function namespaceFor(category) {
  const c = String(category || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return c || 'uncategorized';
}

async function embed(texts) {
  if (!HF_KEY) return null;
  const res = await fetch('https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction', {
    method: 'POST',
    headers: { Authorization: `Bearer ${HF_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: texts }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (Array.isArray(data) && Array.isArray(data[0])) return data;
  if (Array.isArray(data) && typeof data[0] === 'number') return [data];
  return null;
}

async function pineconeQuery(namespace, vector, topK = 5) {
  if (!PC_HOST || !PC_KEY) return null;
  try {
    const res = await fetch(`${PC_HOST}/query`, {
      method: 'POST',
      headers: { 'Api-Key': PC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace, vector, topK, includeMetadata: true }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.matches) ? data.matches : [];
  } catch { return null; }
}

function routeMatch(score, dimsEqual) {
  if (dimsEqual && score >= 0.97) return 'exact';
  if (score >= 0.85) return 'suggest';
  return 'miss';
}

const canon = (s) => String(s || '').toLowerCase().replace(/["″]/g, ' in ').replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();

async function processEnquiry(gateway, eq) {
  // Stage A — router (vision+text, slim ~630-token list): verbatim lines +
  // category each + lead block. Client wording is preserved here; canonical
  // names are assigned in Stage B only.
  const text = `Enquiry text:\n${String(eq.description || '').slice(0, 3000)}\n\nCategories (name: items):\n${ROUTER_LINES}`;
  const images = [];
  for (const it of eq.items || []) for (const m of it.media || []) if (m.url) images.push(m.url);
  const content = buildVisionUserContent(text, images, 4);
  const _poolNote = Array.isArray(eq.enquiryImages) && eq.enquiryImages.length > 0
    ? eq.enquiryImages.map((m) => m.url)
    : [];
  const fullContent = _poolNote.length > 0 ? buildVisionUserContent(text, [..._poolNote, ...images], 4) : content;
  let routed;
  try {
    routed = await gateway.completeJson({
      messages: [{ role: 'system', content: ROUTER_SYSTEM }, { role: 'user', content: fullContent }],
      temperature: 0, json: true, maxTokens: 3000,
      // Enquiry pipeline runs on OpenRouter (ling text+vision); the gateway
      // falls back to Groq automatically when no OpenRouter key is set.
      provider: 'openrouter',
    });
  } catch (e) {
    return { error: `vision failed: ${e.message}`, items: [], missing: [], suggestions: [], candidates: [] };
  }
  const lines = (Array.isArray(routed.lines) ? routed.lines : []).slice(0, 30).map((l) => ({
    verbatim: String(l.verbatim || l.spec || '').slice(0, 500),
    category: String(l.category || 'Uncategorized').slice(0, 120),
    qty: String(l.qty || '').slice(0, 120),
    dims: String(l.dims || '').slice(0, 500),
    spec: String(l.spec || '').slice(0, 2000),
  })).filter((l) => l.verbatim || l.qty || l.dims || l.spec);
  // Guard: resolve the routed category NUMBER to an exact v2 name. A bare
  // 1-N digit maps directly; an exact name still matches; anything else
  // (material/item words the model echoed) is re-resolved from the verbatim
  // wording or parked under Uncategorized — never stored as invented text.
  for (const l of lines) {
    const raw = String(l.category ?? '').trim();
    const n = /^\d{1,2}$/.test(raw) ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n >= 1 && n <= ROUTER_COUNT) {
      l.category = kyp.categories[n - 1].category;
      continue;
    }
    if (CATEGORY_DETAIL.has(raw)) { l.category = raw; continue; }
    const r = resolveV2('', `${l.verbatim} ${l.spec}`);
    l.category = r.item_name && r.category && CATEGORY_DETAIL.has(r.category) ? r.category : 'Uncategorized';
  }
  // Lead block: trimmed strings only; the worker applies fill-empty-only.
  const leadRaw = (routed.lead && typeof routed.lead === 'object') ? routed.lead : {};
  const fields = {};
  for (const f of ['clientCompany', 'contactName', 'contactEmail', 'contactPhone', 'location', 'sourceLead']) {
    const v = String(leadRaw[f] || '').trim().slice(0, 300);
    if (v) fields[f] = v;
  }
  // Stage B — grounder (text-only, one call per routed category): verbatim
  // lines → exact v2 item_name + verbatim spec + missing per
  // required_attributes. Categories with no v2 detail skip the call — lines
  // pass through with their verbatim wording intact.
  const byCat = new Map();
  for (const l of lines) {
    const k = CATEGORY_DETAIL.has(l.category) ? l.category : 'Uncategorized';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(l);
  }
  const items = [];
  const missing = [];
  for (const [cat, catLines] of byCat) {
    if (cat === 'Uncategorized' || !CATEGORY_DETAIL.has(cat)) {
      for (const l of catLines) {
        items.push({
          category: l.category || 'Uncategorized',
          name: l.verbatim.split('|')[0].trim().slice(0, 300) || l.verbatim.slice(0, 300),
          qty: l.qty,
          spec: [l.dims, l.spec].filter(Boolean).join(' | ').slice(0, 2000),
          verbatim: l.verbatim.slice(0, 500),
        });
      }
      continue;
    }
    let grounded;
    try {
      const input = catLines.map((l) => `verbatim: ${l.verbatim} | qty: ${l.qty} | dims: ${l.dims} | spec: ${l.spec}`).join('\n');
      grounded = await gateway.completeJson({
        messages: [{ role: 'system', content: stageBSystem(cat) }, { role: 'user', content: input.slice(0, 4000) }],
        temperature: 0, json: true, maxTokens: 3000,
        provider: 'openrouter',
      });
    } catch (e) {
      // Grounding failure: keep verbatim lines so nothing is lost.
      for (const l of catLines) {
        items.push({ category: cat, name: l.verbatim.split('|')[0].trim().slice(0, 300) || l.verbatim.slice(0, 300), qty: l.qty, spec: [l.dims, l.spec].filter(Boolean).join(' | ').slice(0, 2000), verbatim: l.verbatim.slice(0, 500) });
      }
      missing.push(`${cat}: grounding failed, needs manual mapping`);
      continue;
    }
    const normVerb = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const covered = new Set();
    for (const g of (Array.isArray(grounded.items) ? grounded.items : [])) {
      const gVerb = String(g.verbatim || '').slice(0, 500);
      // Match the output back to its input line via the echoed verbatim.
      // Outputs that match nothing are still kept (never dropped); inputs
      // the grounder omitted are re-added verbatim below.
      let srcIdx = catLines.findIndex((l, i) => !covered.has(i) && normVerb(l.verbatim) === normVerb(gVerb) && normVerb(gVerb).length > 0);
      if (srcIdx < 0) srcIdx = catLines.findIndex((l, i) => !covered.has(i));
      const src = srcIdx >= 0 ? catLines[srcIdx] : null;
      if (srcIdx >= 0) covered.add(srcIdx);
      const rawName = String(g.item_name || g.name || '');
      const verbatim = (src ? src.verbatim : gVerb) || rawName;
      const resolved = rawName === 'UNMATCHED'
        ? { category: cat, item_name: verbatim.split('|')[0].trim().slice(0, 300) || verbatim.slice(0, 300) }
        : resolveV2(cat, rawName);
      items.push({
        category: resolved.category,
        name: resolved.item_name,
        qty: String(g.qty || src?.qty || '').slice(0, 120),
        spec: String(g.spec || '').slice(0, 2000),
        verbatim: verbatim.slice(0, 500),
      });
      if (rawName === 'UNMATCHED') missing.push(`${verbatim.slice(0, 120)}: not in catalogue, needs manual mapping`);
    }
    // Coverage guard: every input line survives — grounder omissions come
    // back verbatim with a sales question instead of vanishing silently.
    catLines.forEach((l, i) => {
      if (covered.has(i)) return;
      items.push({
        category: cat,
        name: l.verbatim.split('|')[0].trim().slice(0, 300) || l.verbatim.slice(0, 300),
        qty: l.qty,
        spec: [l.dims, l.spec].filter(Boolean).join(' | ').slice(0, 2000),
        verbatim: l.verbatim.slice(0, 500),
      });
      missing.push(`${l.verbatim.slice(0, 120)}: not in catalogue, needs manual mapping`);
    });
    for (const m of (Array.isArray(grounded.missing) ? grounded.missing : [])) {
      if (String(m || '').trim()) missing.push(String(m).slice(0, 300));
    }
  }

  // Price-memory lookup per item (best-effort; failures → miss).
  const suggestions = [];
  const candidates = [];
  const specTexts = items.map((it) => [it.name, it.qty, it.spec].filter(Boolean).join(' | ').slice(0, 1000));
  const vecs = await embed(specTexts);
  for (let i = 0; i < items.length; i++) {
    if (!vecs || !vecs[i]) continue;
    const ns = namespaceFor(items[i].category);
    const matches = [...(await pineconeQuery(ns, vecs[i])) || [], ...(ns !== 'uncategorized' ? (await pineconeQuery('uncategorized', vecs[i])) || [] : [])]
      .sort((a, b) => b.score - a.score).slice(0, 5);
    for (const m of matches) {
      const md = m.metadata || {};
      const dimsEq = canon(`${md.name} ${md.qty} ${md.spec}`) === canon(specTexts[i]) && canon(specTexts[i]).length > 0;
      candidates.push({ itemIndex: i, memoryId: m.id, score: m.score, finalRate: md.finalRate, name: md.name, route: routeMatch(m.score, dimsEq) });
    }
    const best = candidates.filter((c) => c.itemIndex === i).sort((a, b) => b.score - a.score)[0];
    if (best && (best.route === 'exact' || best.route === 'suggest')) {
      suggestions.push({ itemIndex: i, memoryId: best.memoryId, score: best.score, finalRate: best.finalRate, name: best.name, route: best.route });
    }
  }
  return { items, fields, missing: [...new Set(missing)].slice(0, 25), suggestions, candidates: candidates.slice(0, 10) };
}

async function main() {
  const gateway = getGateway(process.env);
  if (gateway.keyCount === 0) { console.error('No AI keys configured'); process.exit(1); }
  // OpenRouter-only: refuse to run on Groq keys.
  if (!gateway.health().some((h) => h.provider === 'openrouter')) {
    console.error('No OpenRouter key in pool — refusing to run on Groq keys');
    process.exit(1);
  }
  const pending = await workerRequest(`/api/runner/enquiry-intake/pending?limit=${CAP}`);
  const rows = Array.isArray(pending.rows) ? pending.rows : [];
  // Claim first (parallel runners split the queue; stale claims expire in
  // 10 min so crashed runs never block anyone).
  let claimed = rows.map((r) => r.id);
  if (!DRY_RUN && claimed.length > 0) {
    try {
      const res = await workerRequest('/api/runner/enquiry-intake/claim', { method: 'POST', body: { ids: claimed } });
      claimed = Array.isArray(res.claimed) ? res.claimed : [];
    } catch (e) {
      console.error(`intake: claim failed (${e.message}) — processing unclaimed`);
    }
  }
  const mine = rows.filter((r) => DRY_RUN || claimed.includes(r.id));
  console.log(`intake: ${rows.length} pending, ${mine.length} claimed by this run`);
  let processed = 0;
  let failed = 0;
  // 4-way parallel vision+lookup (each item also fans out internally).
  const PARALLEL = 4;
  for (let i = 0; i < mine.length; i += PARALLEL) {
    const batch = mine.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map(async (eq) => {
      const out = await processEnquiry(gateway, eq);
      if (DRY_RUN) return { eq, out, posted: false };
      const res = await workerRequest('/api/runner/enquiry-intake/result', {
        method: 'POST',
        body: {
          enquiryId: eq.id, seenUpdatedAt: String(eq.updatedAt || ''),
          fields: out.fields || {}, items: out.items,
          suggestions: out.suggestions, missing: out.missing, candidates: out.candidates,
        },
      });
      return { eq, out, posted: !!(res && res.ok) };
    }));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { eq, out, posted } = r.value;
        console.log(`- ${eq.id}: items=${out.items.length} missing=${out.missing.length} suggestions=${(out.suggestions || []).length}${out.error ? ` ERROR=${out.error}` : ''}${posted ? '' : ' (not posted)'}`);
        if (posted) processed++;
        else failed++;
      } else {
        failed++;
        console.log(`- batch item FAILED: ${String(r.reason && r.reason.message || r.reason).slice(0, 200)}`);
      }
    }
  }
  console.log(JSON.stringify({ mode: DRY_RUN ? 'dry-run' : 'intake', pending: rows.length, claimed: mine.length, processed, failed }, null, 2));
}

main().catch((e) => { console.error(`enquiry-intake-runner failed: ${e.message}`); process.exit(1); });
