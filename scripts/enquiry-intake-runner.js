#!/usr/bin/env node

/**
 * enquiry-intake-runner.js — unstructured intake → KYP-grounded items → price memory.
 *
 * Runs on GH Actions (unlimited CPU). Per pending enquiry (from
 * GET /api/runner/enquiry-intake/pending), single source of truth is
 * founder-os_backend/data/know_your_product_v2.json (136 items, 10 cats):
 *   Call 1 SEGMENT (vision+text, NO catalogue — pure splitter): free text +
 *     enquiry/item images → verbatim lines (name/qty/dims/spec split) + lead
 *     block. Client wording is NEVER renamed here; the model never sees the
 *     catalogue so it cannot hallucinate category/item names or drop lines
 *     to fit them.
 *   Call 2 LOOKUP (text-only, per verbatim line): deterministic alias-index
 *     match first (zero tokens); LLM fallback ONLY for unmatched lines using
 *     a slim `Category: item[aliases], ...` list (~1.9k tokens), batched into
 *     one call. Below the confidence floor → Uncategorized, never a guess.
 *     Lookup fills the kyp side-fields only — verbatim wording is untouched.
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
// Segment → lookup keeps prompts small and hallucination-free:
//   Call 1 (segment, vision+text): NO catalogue at all — pure splitter.
//   Call 2 (lookup, text-only, unmatched lines only): slim
//     `Category: item[aliases], ...` list (~1.9k tokens), batched one call.
// No kyp_taxonomy.json / kyp_slots.json — deleted from this pipeline.
const kyp = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'know_your_product_v2.json'), 'utf8'));

// Numbered-category count (validates Call-2 fallback digits).
const ROUTER_COUNT = kyp.categories.length;

// Alias-inclusive list for the Call-2 LLM fallback (unmatched lines only).
// `1. Category: Item[alias,alias]; Item; ...` — one line per category.
const LOOKUP_LINES = kyp.categories
  .map((c, i) => `${i + 1}. ${c.category}: ${c.items.map((it) => {
    const al = (it.aliases || []).filter(Boolean);
    return al.length ? `${it.item_name}[${al.join(',')}]` : it.item_name;
  }).join('; ')}`)
  .join('\n');

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

// Canonical item-name set per category (validates the Call-2 LLM fallback).
const CATEGORY_ITEMS = new Map(
  kyp.categories.map((c) => [c.category, new Set(c.items.map((i) => normName(i.item_name)))]),
);

// Call 2 — lookup for lines the alias index could not resolve.
// Deterministic first (zero tokens): exact item/alias hit inside a KNOWN
// category wins. The LLM fallback runs once, batched over the remaining
// lines; anything under the confidence floor stays Uncategorized.
function lookupDeterministic(line) {
  const r = resolveV2('', `${line.verbatim} ${line.spec}`);
  if (r.category && CATEGORY_DETAIL.has(r.category) && r.item_name) return r;
  return null;
}

async function lookupFallbackLLM(gateway, lines) {
  if (!lines.length) return [];
  const input = lines.map((l, i) => `${i}. ${l.verbatim}${l.spec ? ` | ${l.spec}` : ''}${l.qty ? ` | ${l.qty}` : ''}`.slice(0, 600)).join('\n');
  const out = await gateway.completeJson({
    messages: [{ role: 'system', content: LOOKUP_SYSTEM }, { role: 'user', content: `Match each line:\n${input}` }],
    temperature: 0, json: true, maxTokens: 4000, noReasoning: true,
    provider: 'openrouter',
  });
  const matches = Array.isArray(out.matches) ? out.matches : [];
  return lines.map((_, i) => {
    const m = matches[i] || {};
    const n = /^\d{1,2}$/.test(String(m.category ?? '').trim()) ? parseInt(m.category, 10) : NaN;
    const conf = Number(m.confidence);
    if (!Number.isFinite(n) || n < 1 || n > ROUTER_COUNT) return null;
    if (!Number.isFinite(conf) || conf < 0.65) return null;
    const category = kyp.categories[n - 1].category;
    const itemName = String(m.item || '').slice(0, 300);
    if (!itemName || !(CATEGORY_ITEMS.get(category) || new Set()).has(normName(itemName))) return null;
    return { category, item_name: itemName };
  });
}

const ROUTER_SYSTEM = `You are a B2B industrial-spare intake segmenter for flour-mill machinery. From the sales text + attached photos, split the enquiry into purchasable line items.
For EACH item return: {"verbatim": "client wording for the product, copied exactly as written/seen — NEVER rename, canonicalize, or categorize", "qty": "quantity with unit or empty", "dims": "dimensions as written", "spec": "material/variant/spec detail as written"}.
Also extract the lead block: {"lead": {"clientCompany": "customer company, or empty", "contactName": "contact person, or empty", "contactEmail": "or empty", "contactPhone": "mobile/phone, or empty", "location": "city/state, or empty", "sourceLead": "lead source like IndiaMART/reference, or empty"}} — NEVER invent; empty when not stated. The sales agent's own name ("Lead of ...") is NOT the customer — ignore it.
Rules: one entry per distinct product; a line containing ONLY a quantity (e.g. "QTY - 1") is NOT its own product — attach it to the product line directly above it; NEVER drop or merge product lines — every product mentioned in the text or seen in a photo gets its own entry; qty ALWAYS keeps its number when one is written ("30 pcs", never a bare "pcs"); a trailing code like "150-30 pcs" splits to dims "150" + qty "30 pcs"; never invent quantities, dimensions or contact details — if absent, leave empty; return STRICT JSON {"lines":[...],"lead":{...}} with no other text.`;

// Call-2 lookup fallback: maps verbatim lines the alias index could not
// resolve. Batched — one call for all unmatched lines, aligned by index.
// The model copies a category NUMBER (validated 1-N) plus the exact
// item_name; confidence <0.65 parks the line under Uncategorized.
const LOOKUP_SYSTEM = `You are a product matcher for flour-mill spare parts. For EACH input line, pick the single best catalogue entry.
Catalogue (category NUMBER. Category: Item[aliases]; ...):
${LOOKUP_LINES}
Rules: "category" is the category NUMBER as a bare number; "item" is the item_name copied EXACTLY (never an alias, never invented); "confidence" is 0-1 — below 0.65 when the line genuinely matches nothing (custom/fabricated/as-per-drawing must be 0-0.3, never force a catalogue item); return STRICT JSON {"matches":[{"category":"...","item":"...","confidence":0.9}, ...]} with exactly one entry per input line, in order, and no other text.`;

// NOTE: the Stage-B grounder prompt was removed — item renaming is disabled
// (verbatim-only mode). The v2 catalogue is still the category reference for
// Stage-A routing + price-memory namespacing, never a rename source.

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
  // Call 1 — SEGMENT (vision+text, NO catalogue): pure splitter. Verbatim
  // lines + lead block only; the model never sees KYP so it cannot bend
  // lines toward catalogue names. (ROUTER_LINES intentionally NOT sent.)
  // AI bulk-add (detail-view "Add via AI"): the worker passes the pending
  // unstructured specs as aiBulkText — split ONLY this chunk (the enquiry
  // already has real items; the result endpoint replaces just the aiPending
  // rows, deduped). Otherwise split the enquiry description as usual.
  const bulkText = String(eq.aiBulkText || '').trim();
  if (!bulkText && Array.isArray(eq.items) && eq.items.length > 0) {
    // No aiPending text on a row that already has items: the segmenter falls
    // back to the description and the result merge will discard the lines
    // (nothing to replace). Almost always a dropped aiPending flag upstream.
    console.log(`- ${eq.id}: WARNING no aiBulkText, splitting description on a ${eq.items.length}-item row — result will be discarded`);
  }
  const text = bulkText
    ? `New items to split (ignore everything else):\n${bulkText.slice(0, 3000)}`
    : `Enquiry text:\n${String(eq.description || '').slice(0, 3000)}`;
  const images = [];
  for (const it of eq.items || []) for (const m of it.media || []) if (m.url) images.push(m.url);
  const content = buildVisionUserContent(text, images, 4);
  const _poolNote = Array.isArray(eq.enquiryImages) && eq.enquiryImages.length > 0
    ? eq.enquiryImages.map((m) => m.url)
    : [];
  const fullContent = _poolNote.length > 0 ? buildVisionUserContent(text, [..._poolNote, ...images], 4) : content;
  // Visibility: never silently drop images — a text-only call on an
  // image enquiry yields zero lines and looks like an AI failure.
  const attachedImgs = Array.isArray(fullContent) ? fullContent.filter((b) => b && b.type === 'image_url').length : 0;
  if (_poolNote.length + images.length > 0 && attachedImgs === 0) {
    console.log(`- ${eq.id}: WARNING ${ _poolNote.length + images.length} image(s) present but none attached to vision call`);
  }
  // Free-tier models intermittently return empty/unparseable responses
  // (burst limits) — retry the segment call before giving up on the enquiry.
  let routed;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      routed = await gateway.completeJson({
        messages: [{ role: 'system', content: ROUTER_SYSTEM }, { role: 'user', content: fullContent }],
        // No reasoning trace (it shares the token budget and truncates the
        // JSON mid-stream); 8k headroom so the full lines array always fits.
        temperature: 0, json: true, maxTokens: 8000, noReasoning: true,
        // Enquiry pipeline runs on OpenRouter (ling text+vision); the gateway
        // falls back to Groq automatically when no OpenRouter key is set.
        provider: 'openrouter',
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      console.log(`- ${eq.id}: segment attempt ${attempt + 1}/3 failed (${String(e.message).slice(0, 120)}) — retrying`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  if (lastErr) {
    return { error: `vision failed: ${lastErr.message}`, items: [], missing: [], suggestions: [], candidates: [] };
  }
  if (!Array.isArray(routed.lines) || routed.lines.length === 0) {
    console.log(`- ${eq.id}: segmenter returned 0 lines (lead: ${JSON.stringify(routed.lead || {}).slice(0, 300)})`);
  }
  const lines = (Array.isArray(routed.lines) ? routed.lines : []).slice(0, 30).map((l) => ({
    verbatim: String(l.verbatim || l.spec || '').slice(0, 500),
    qty: String(l.qty || '').slice(0, 120),
    dims: String(l.dims || '').slice(0, 500),
    spec: String(l.spec || '').slice(0, 2000),
  })).filter((l) => l.verbatim || l.qty || l.dims || l.spec);
  // Call 2 — LOOKUP (text-only): deterministic alias-index first, single
  // batched LLM fallback for the misses. Verbatim wording is NEVER touched —
  // lookup only fills the category side-field (price-memory namespacing).
  let nAlias = 0;
  let nLlm = 0;
  const needsLlm = [];
  for (const l of lines) {
    const hit = lookupDeterministic(l);
    if (hit) { l.category = hit.category; nAlias++; }
    else needsLlm.push(l);
  }
  if (needsLlm.length > 0) {
    try {
      const fb = await lookupFallbackLLM(gateway, needsLlm);
      fb.forEach((r, i) => {
        if (r) { needsLlm[i].category = r.category; nLlm++; }
        else needsLlm[i].category = 'Uncategorized';
      });
    } catch (e) {
      console.log(`- ${eq.id}: lookup fallback failed (${String(e.message).slice(0, 120)}) — ${needsLlm.length} line(s) Uncategorized`);
      for (const l of needsLlm) l.category = 'Uncategorized';
    }
  }
  console.log(`- ${eq.id}: lookup alias=${nAlias} llm=${nLlm} uncategorized=${lines.filter((l) => l.category === 'Uncategorized').length}/${lines.length}`);
  // Lead block: trimmed strings only; the worker applies fill-empty-only.
  const leadRaw = (routed.lead && typeof routed.lead === 'object') ? routed.lead : {};
  const fields = {};
  for (const f of ['clientCompany', 'contactName', 'contactEmail', 'contactPhone', 'location', 'sourceLead']) {
    const v = String(leadRaw[f] || '').trim().slice(0, 300);
    if (v) fields[f] = v;
  }
  // VERBATIM-ONLY items: each segmenter line becomes one item with the
  // client's exact wording (name/qty/spec split + cleaned layout). The
  // looked-up category is kept for price-memory namespacing only — never
  // shown as the item name.
  const items = [];
  const missing = [];
  for (const l of lines) {
    items.push({
      category: CATEGORY_DETAIL.has(l.category) ? l.category : 'Uncategorized',
      name: l.verbatim.split('|')[0].trim().slice(0, 300) || l.verbatim.slice(0, 300),
      qty: l.qty,
      spec: [l.dims, l.spec].filter(Boolean).join(' | ').slice(0, 2000),
      verbatim: l.verbatim.slice(0, 500),
    });
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
