#!/usr/bin/env node

/**
 * enquiry-intake-runner.js — unstructured intake → KYP-grounded items → price memory.
 *
 * Runs on GH Actions (unlimited CPU). Per pending enquiry (from
 * GET /api/runner/enquiry-intake/pending):
 *   Stage A (vision, paid Groq via gateway): free text + item images +
 *     slim KYP taxonomy (category/item/aliases only, ~4k tokens) →
 *     { category, item_name, qty, dims, spec, confidence }[] + missing[].
 *   Stage B (deterministic): slot check vs kyp_slots.json, unit
 *     canonicalization. Incomplete → stays with sales (missing[] shown).
 *   Stage C (price memory): HF-embed spec → Pinecone query topK=5 in the
 *     item's category namespace + `uncategorized` → route exact/suggest/miss.
 *   POST /api/runner/enquiry-intake/result applies fill-empty-only updates +
 *     KV suggestions for the sales UI.
 *
 * Env: WORKER_URL, SHARED_SECRET, OPENROUTER_API_KEYS / OPENROUTER_API_KEY
 *   (OpenRouter-only; Groq is never used in this workflow), HF_API_KEY,
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
const taxonomy = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'kyp_taxonomy.json'), 'utf8'));
const slotsDoc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'kyp_slots.json'), 'utf8'));

const TAXONOMY_LINES = taxonomy.items.map((i) => `${i.category} / ${i.item_name}${i.aliases.length ? ` (${i.aliases.slice(0, 5).join(', ')})` : ''}`).join('\n');

// The model often echoes taxonomy lines/aliases instead of canonical names
// ("Resham ki jali" for Milling Fabric, full "cat / item (aliases)" line in
// category). Resolve any such reply to the canonical {category, item_name}.
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const TAX_INDEX = taxonomy.items.map((i) => ({
  category: i.category,
  item_name: i.item_name,
  keys: new Set([normName(i.item_name), ...i.aliases.map(normName)]),
}));
function resolveTaxonomy(category, itemName) {
  const q = normName(`${category} ${itemName}`);
  let best = null;
  let bestScore = 0;
  for (const t of TAX_INDEX) {
    for (const key of t.keys) {
      if (!key) continue;
      if (q === key || normName(category) === key || normName(itemName) === key) return t;
      if (key.length >= 4 && q.includes(key) && key.length > bestScore) {
        bestScore = key.length;
        best = t;
      }
    }
  }
  if (best) return best;
  // Unknown item: keep the model's words under an uncategorized namespace.
  return { category: String(category || '').split('/')[0].trim().slice(0, 120) || 'Uncategorized', item_name: String(itemName || '').slice(0, 300) };
}

const SYSTEM = `You are a B2B industrial-spare extractor for flour-mill machinery. From the sales text + attached photos, split the enquiry into purchasable line items.
For EACH item return: {"category": exact category from the list, "item_name": exact item name from the list, "qty": "quantity with unit or empty", "dims": "dimensions as written", "spec": "material/variant/spec detail", "confidence": 0-1}.
Also extract the lead block: {"lead": {"clientCompany": "customer company, or empty", "contactName": "contact person, or empty", "contactEmail": "or empty", "contactPhone": "mobile/phone, or empty", "location": "city/state, or empty", "sourceLead": "lead source like IndiaMART/reference, or empty"}} — NEVER invent; empty when not stated. The sales agent's own name ("Lead of ...") is NOT the customer — ignore it.
Also return "missing": ["what is still needed, e.g. 'Milling Fabric needs grade no.'"].
Rules: pick ONLY from the taxonomy list (never invent names); write category and
item_name EXACTLY as shown before any parenthesis (parenthesised words are
aliases, not names); never invent quantities, dimensions or contact details — if absent, leave empty and note in missing; one entry per distinct product; return STRICT JSON
{"items":[...],"lead":{...},"missing":[...]} with no other text.`;

function slotCheck(item) {
  const key = `${item.category}||${item.item_name}`;
  const entry = slotsDoc.items[key];
  if (!entry) return [`Unknown item "${item.item_name}" — needs manual mapping`];
  const gaps = [];
  const text = `${item.qty} ${item.dims} ${item.spec}`.toLowerCase();
  for (const slot of entry.slots) {
    if (slot === 'quantity') {
      if (!/\d/.test(text)) gaps.push(`${item.item_name} needs quantity`);
      continue;
    }
    if (slot === 'grade' && !/gg\b|xxx|mf\b|\bn\b|grade|micron/.test(text)) gaps.push(`${item.item_name} needs grade/opening`);
    if (slot === 'width' && !/width|wide|\bcm\b|\bmm\b|\bin\b|inch/.test(text)) gaps.push(`${item.item_name} needs width`);
    if (slot === 'diameter' && !/dia|bore|\bmm\b|inch/.test(text)) gaps.push(`${item.item_name} needs diameter`);
    if (slot === 'machine_make' && !/make|model|buhler|buhler|plansifter|mill/.test(text)) gaps.push(`${item.item_name} needs machine make/model`);
  }
  return gaps;
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
  const text = `Enquiry text:\n${String(eq.description || '').slice(0, 3000)}\n\nTaxonomy (category / item):\n${TAXONOMY_LINES}`;
  const images = [];
  for (const it of eq.items || []) for (const m of it.media || []) if (m.url) images.push(m.url);
  const content = buildVisionUserContent(text, images, 4);
  const _poolNote = Array.isArray(eq.enquiryImages) && eq.enquiryImages.length > 0
    ? eq.enquiryImages.map((m) => m.url)
    : [];
  const fullContent = _poolNote.length > 0 ? buildVisionUserContent(text, [..._poolNote, ...images], 4) : content;
  let parsed;
  try {
    parsed = await gateway.completeJson({
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: fullContent }],
      temperature: 0, json: true, maxTokens: 3000,
      // Enquiry pipeline runs on OpenRouter (ling text+vision); the gateway
      // falls back to Groq automatically when no OpenRouter key is set.
      provider: 'openrouter',
    });
  } catch (e) {
    return { error: `vision failed: ${e.message}`, items: [], missing: [], suggestions: [], candidates: [] };
  }
  const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 30).map((it) => {
    const resolved = resolveTaxonomy(it.category, it.item_name || it.name);
    return {
      category: resolved.category,
      name: resolved.item_name,
      qty: String(it.qty || '').slice(0, 120),
      spec: [String(it.dims || ''), String(it.spec || '')].filter(Boolean).join(' | ').slice(0, 2000),
    };
  }).filter((it) => it.name) : [];
  const missing = [...(Array.isArray(parsed.missing) ? parsed.missing : [])];
  for (const it of items) missing.push(...slotCheck(it));
  // Lead block: trimmed strings only; the worker applies fill-empty-only.
  const leadRaw = (parsed.lead && typeof parsed.lead === 'object') ? parsed.lead : {};
  const fields = {};
  for (const f of ['clientCompany', 'contactName', 'contactEmail', 'contactPhone', 'location', 'sourceLead']) {
    const v = String(leadRaw[f] || '').trim().slice(0, 300);
    if (v) fields[f] = v;
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
  console.log(`intake: ${rows.length} pending (watermark ${pending.watermark})`);
  let processed = 0;
  let lastStamp = null;
  for (const eq of rows) {
    const out = await processEnquiry(gateway, eq);
    console.log(`- ${eq.id}: items=${out.items.length} missing=${out.missing.length} suggestions=${(out.suggestions || []).length}${out.error ? ` ERROR=${out.error}` : ''}`);
    if (!DRY_RUN) {
      const res = await workerRequest('/api/runner/enquiry-intake/result', {
        method: 'POST',
        body: { enquiryId: eq.id, fields: out.fields || {}, items: out.items, suggestions: out.suggestions, missing: out.missing, candidates: out.candidates, advanceWatermark: true },
      });
      if (res && res.ok) { processed++; lastStamp = eq.updatedAt; }
    }
  }
  console.log(JSON.stringify({ mode: DRY_RUN ? 'dry-run' : 'intake', pending: rows.length, processed, lastStamp }, null, 2));
}

main().catch((e) => { console.error(`enquiry-intake-runner failed: ${e.message}`); process.exit(1); });
