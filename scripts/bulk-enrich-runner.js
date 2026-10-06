#!/usr/bin/env node

/**
 * bulk-enrich-runner.js — AI-minimal staged-row enrichment (Steps 2+4).
 *
 * Runs on GH Actions. Pulls the oldest unfinished batch from
 * GET /api/runner/bulk-import/work (rows + loose candidates precomputed
 * worker-side) plus the slim catalogue snapshot, then:
 *   Step 2 MATCH (unresolved rows, 25/call): raw line + ≤5 candidate
 *     names + live categories → productId | alias_of | new_product.
 *   Vendor detect (vendor-less rows, 25/call): vendor names only.
 *   Step 4 EXTRACT (per product-group, ≤20 rows/call): that product's
 *     REQUIRED checklist (questions only) + raw rows → specs keyed by
 *     attrKey + commercials + nothing else.
 * Pushes updates to POST /api/runner/bulk-import/enrich (worker applies
 * alias appends, recomputes missing, refreshes statuses).
 *
 * AI-economics guardrails: noReasoning on every call (mechanical mapping);
 * tight caps (match 4000, extract 2000+500×rows); deterministic tiers first
 * (worker already resolved those — this script never re-matches them).
 *
 * Env: WORKER_URL, SHARED_SECRET, OPENROUTER_API_KEYS / OPENROUTER_API_KEY.
 * Flags: --batch=<id> (one batch), --limit=N (rows cap, default 150).
 */

const { workerRequest } = require('./runner-lib');
const { getGateway } = require('./ai-gateway');

const batchArg = (process.argv.find((a) => a.startsWith('--batch=')) || '').slice(8);
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const ROW_CAP = limitArg ? Math.max(10, parseInt(limitArg.split('=')[1], 10)) : 150;
const MODEL = 'deepseek/deepseek-v4.1-flash';

function requireRunnerEnv() {
  const missing = [];
  if (!process.env.WORKER_URL) missing.push('WORKER_URL');
  if (!process.env.SHARED_SECRET) missing.push('SHARED_SECRET');
  if (!process.env.OPENROUTER_API_KEYS && !process.env.OPENROUTER_API_KEY) {
    missing.push('OPENROUTER_API_KEYS (or OPENROUTER_API_KEY)');
  }
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function llm(gateway, { system, user, maxTokens }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await gateway.completeJson({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0, json: true, maxTokens, noReasoning: true,
        provider: 'openrouter', model: MODEL,
      });
    } catch (e) {
      console.log(`  llm attempt ${attempt + 1}/3 failed (${String(e.message).slice(0, 120)}) — retrying`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  throw new Error('llm failed 3x');
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

async function stepMatch(gateway, rows, categories) {
  // Rows: {id, rawText, candidates:[{id,name,category,exact}]}.
  const updates = [];
  for (const group of chunk(rows, 25)) {
    const lines = group.map((r, i) => {
      const cands = (r.candidates || []).map((c) => `${c.id} :: ${c.name} [${c.category}]`).join(' | ') || 'NONE';
      return `R${i}: "${r.rawText.slice(0, 200)}"\n  candidates: ${cands}`;
    }).join('\n');
    const out = await llm(gateway, {
      system: 'Match vendor price-list rows to catalogue products. Reply JSON {"m":[{"r":0,"pid":"<candidate id or NEW>","alias":false,"cat":"","conf":0.0}]}. Rules: pick the candidate id when the row names that product (alias spellings ok, set alias:true when the row wording is an alias worth keeping). No credible candidate → pid "NEW" + cat = one of the live categories (exact spelling). Never invent ids. conf 0-1.',
      user: `Live categories: ${categories.join(' / ')}\n${lines}`,
      maxTokens: 4000,
    });
    const ms = Array.isArray(out.m) ? out.m : [];
    for (const m of ms) {
      const r = group[m.r];
      if (!r) continue;
      const pid = String(m.pid || '');
      if (!pid || pid === 'NEW') {
        const cat = String(m.cat || '');
        if (categories.includes(cat)) {
          updates.push({ id: r.id, isNewProduct: true, newCategory: cat, productName: r.rawText.slice(0, 120) });
        }
        continue;
      }
      const known = (r.candidates || []).find((c) => c.id === pid);
      if (!known) continue; // never accept invented ids
      updates.push({
        id: r.id, productId: pid, productName: known.name,
        ...(m.alias ? { aliasFor: pid, aliasTerm: r.rawText.slice(0, 120) } : {}),
      });
    }
  }
  return updates;
}

async function stepVendors(gateway, rows, vendors) {
  // Rows without any vendor; vendors = [{id,name}].
  const targets = rows.filter((r) => !r.vendorId && !r.vendorName);
  if (!targets.length || !vendors.length) return [];
  const updates = [];
  for (const group of chunk(targets, 25)) {
    const lines = group.map((r, i) => `R${i}: "${r.rawText.slice(0, 200)}"`).join('\n');
    const out = await llm(gateway, {
      system: 'Identify the vendor named in each price-list row. Reply JSON {"m":[{"r":0,"vid":"<vendor id or NEW:Name or null>"}]}. Use a vendor id only on clear name match; "NEW:<exact name>" when the row names a vendor not in the list; null when no vendor is named. Never invent ids.',
      user: `Vendors: ${vendors.map((v) => `${v.id} :: ${v.name}`).join(' | ')}\n${lines}`,
      maxTokens: 4000,
    });
    for (const m of (Array.isArray(out.m) ? out.m : [])) {
      const r = group[m.r];
      if (!r) continue;
      const vid = String(m.vid || '');
      if (!vid || vid === 'null') continue;
      if (vid.startsWith('NEW:')) {
        const nm = vid.slice(4).trim().slice(0, 200);
        if (nm) updates.push({ id: r.id, vendorName: nm });
        continue;
      }
      const known = vendors.find((v) => v.id === vid);
      if (known) updates.push({ id: r.id, vendorId: known.id, vendorName: known.name });
    }
  }
  return updates;
}

async function stepExtract(gateway, rowsByProduct) {
  // rowsByProduct: Map productId → {name, rows:[{id,rawText,price,unit}]}.
  const updates = [];
  for (const [pid, g] of rowsByProduct) {
    let detail;
    try {
      detail = await workerRequest(`/api/product-line/products/${pid}`, { timeoutMs: 60000 });
    } catch (e) {
      console.log(`  checklist ${pid} failed — skipping group`);
      continue;
    }
    const checklist = ((detail && detail.guide) || [])
      .filter((x) => x && x.active && x.isRequired)
      .map((x) => `${x.attrKey} :: ${x.question}${x.guideNote ? ` (${String(x.guideNote).slice(0, 120)})` : ''}`);
    if (!checklist.length) continue;
    for (const group of chunk(g.rows, 20)) {
      const lines = group.map((r, i) =>
        `R${i}: "${r.rawText.slice(0, 250)}"${r.price != null ? ` [price ${r.price}]` : ''}${r.unit ? ` [unit ${r.unit}]` : ''}`
      ).join('\n');
      const out = await llm(gateway, {
        system: `Extract specs for product "${g.name}". Reply JSON {"m":[{"r":0,"specs":{"<attrKey>":"value"},"price":null,"unit":null,"discount":null,"moq":null,"delivery":null,"weight":null,"packQty":null,"packDims":null}]}. Keys MUST be attrKeys from the checklist (never invent keys); values verbatim from the row. Pre-filled [price]/[unit] are already parsed — echo them back, only fill when the row shows a different/better value. Leave unknown fields null. No prose.`,
        user: `Checklist (attrKey :: question):\n${checklist.join('\n')}\nRows:\n${lines}`,
        maxTokens: 2000 + 500 * group.length,
      });
      for (const m of (Array.isArray(out.m) ? out.m : [])) {
        const r = group[m.r];
        if (!r) continue;
        const u = { id: r.id };
        if (m.specs && typeof m.specs === 'object') {
          const clean = {};
          for (const [k, v] of Object.entries(m.specs)) {
            const val = String(v ?? '').trim().slice(0, 500);
            if (k && val) clean[String(k).slice(0, 120)] = val;
          }
          if (Object.keys(clean).length) u.specs = clean;
        }
        for (const [src, dst] of [['price', 'price'], ['unit', 'unit'], ['discount', 'discount'], ['moq', 'moq'], ['delivery', 'deliveryDays'], ['weight', 'weightPerUnit'], ['packQty', 'packageQty'], ['packDims', 'packageDims']]) {
          if (m[src] !== undefined && m[src] !== null && String(m[src]).trim() !== '') u[dst] = m[src];
        }
        if (Object.keys(u).length > 1) updates.push(u);
      }
    }
  }
  return updates;
}

async function main() {
  requireRunnerEnv();
  const gateway = getGateway(process.env);
  const idx = await workerRequest('/api/runner/bulk-import/index');
  const work = await workerRequest(`/api/runner/bulk-import/work${batchArg ? `?batch_id=${encodeURIComponent(batchArg)}` : ''}`);
  if (!work.batch) { console.log('no unfinished batches'); return; }
  console.log(`batch ${work.batch.id}: ${(work.rows || []).length} unfinished rows`);
  let rows = (work.rows || []).slice(0, ROW_CAP);
  const noVendorDefault = !work.batch.vendorId;

  // Step 2 — match misses.
  const misses = rows.filter((r) => !r.productId && !r.isNewProduct && r.status === 'needs-product');
  let updates = [];
  if (misses.length) {
    console.log(`match: ${misses.length} rows`);
    updates.push(...await stepMatch(gateway, misses, idx.categories || []));
  }
  // Vendor detect (only when the batch has no preset vendor).
  if (noVendorDefault) {
    const vUpd = await stepVendors(gateway, rows, idx.vendors || []);
    console.log(`vendors: ${vUpd.length} rows`);
    updates.push(...vUpd);
  }
  // Step 4 — spec extract per product group (needs-specs rows + newly matched).
  const matchedIds = new Set(updates.filter((u) => u.productId).map((u) => u.id));
  const forExtract = rows.filter((r) =>
    (r.status === 'needs-specs' && r.productId && !r.isNewProduct) ||
    matchedIds.has(r.id) ||
    (r.productId && !r.isNewProduct && (!r.specs || Object.keys(r.specs).length === 0)));
  const byProduct = new Map();
  for (const r of forExtract) {
    const pid = r.productId || (updates.find((u) => u.id === r.id) || {}).productId;
    if (!pid) continue;
    if (!byProduct.has(pid)) byProduct.set(pid, { name: r.productName || pid, rows: [] });
    byProduct.get(pid).rows.push(r);
  }
  if (byProduct.size) {
    console.log(`extract: ${[...byProduct.values()].reduce((n, g) => n + g.rows.length, 0)} rows in ${byProduct.size} product groups`);
    updates.push(...await stepExtract(gateway, byProduct));
  }
  // Merge updates per row id (match + vendor + extract may all hit one row).
  const merged = new Map();
  for (const u of updates) merged.set(u.id, { ...(merged.get(u.id) || { id: u.id }), ...u });
  const list = [...merged.values()];
  console.log(`pushing ${list.length} row updates`);
  for (let i = 0; i < list.length; i += 100) {
    const res = await workerRequest('/api/runner/bulk-import/enrich', {
      method: 'POST', body: { batchId: work.batch.id, updates: list.slice(i, i + 100) }, timeoutMs: 120000,
    });
    console.log(`  applied ${res.applied}`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { stepMatch, stepVendors, stepExtract };
