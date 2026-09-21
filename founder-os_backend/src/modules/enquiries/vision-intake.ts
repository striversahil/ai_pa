/**
 * vision-intake.ts — Worker-native Agnes vision intake (no GH Actions).
 *
 * Directly in the Worker (via waitUntil), uses Agnes agnes-3.0-flash vision
 * to split unstructured text + enquiry/item images into verbatim line items.
 * Replaces the GH runner `scripts/enquiry-intake-runner.js` which was
 * OpenRouter ling-3.0-flash-vl + 4-way parallel + price-memory.
 *
 * This path is fast (<4s, edge), handles the same `aiBulkText` vs description
 * branching as the runner, and applies fill-empty-only semantics via the
 * shared `applyIntakeBulkResult` helper. Price-memory (HF/Pinecone) is
 * best-effort and skipped when keys are absent — items still land.
 */
import { getGateway, buildVisionUserContent } from '../../shared/ai-gateway';
import { cacheSet } from '../../shared/cache';
import type { EnquiryStore } from './store';

const ROUTER_SYSTEM_AGNES = `You are a B2B industrial-spare intake for flour-mill machinery. From the sales text + attached photos, split the enquiry into purchasable line items.
For EACH item return: {"verbatim": "client wording for the product, copied exactly as written/seen — NEVER rename", "qty": "quantity with unit or empty", "dims": "dimensions as written", "spec": "material/variant/spec detail as written", "name": "short product name derived from verbatim"}.
Also extract the lead block: {"lead": {"clientCompany": "customer company, or empty", "contactName": "contact person, or empty", "contactEmail": "or empty", "contactPhone": "mobile/phone, or empty", "location": "city/state, or empty", "sourceLead": "lead source like IndiaMART/reference, or empty"}} — NEVER invent; empty when not stated. The sales agent's own name ("Lead of ...") is NOT the customer — ignore it.
Rules: one entry per distinct product; a line containing ONLY a quantity (e.g. "QTY - 1") is NOT its own product — attach it to the product line directly above it; NEVER drop or merge product lines — every product mentioned in the text or seen in a photo gets its own entry; qty ALWAYS keeps its number when one is written ("30 pcs", never a bare "pcs"); never invent quantities, dimensions or contact details — if absent, leave empty; return STRICT JSON {"lines":[...],"lead":{...}} with no other text.`;

/** Best-effort HF/Pinecone helpers (mirrored from runner, optional). */
async function embed(texts: string[], env: Record<string, unknown>): Promise<number[][] | null> {
  const key = String((env as any)?.HF_API_KEY ?? '').trim();
  if (!key || texts.length === 0) return null;
  try {
    const res = await fetch('https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: texts }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) return data as number[][];
    if (Array.isArray(data) && typeof data[0] === 'number') return [data as number[]];
    return null;
  } catch { return null; }
}
async function pineconeQuery(env: Record<string, unknown>, namespace: string, vector: number[], topK = 5): Promise<any[] | null> {
  const host = String((env as any)?.PINECONE_HOST ?? '').trim().replace(/\/+$/, '');
  const key = String((env as any)?.PINECONE_API_KEY ?? '').trim();
  if (!host || !key) return null;
  try {
    const res = await fetch(`${host}/query`, {
      method: 'POST',
      headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace, vector, topK, includeMetadata: true }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return Array.isArray(data.matches) ? data.matches : [];
  } catch { return null; }
}
function namespaceFor(category: string): string {
  const c = String(category || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return c || 'uncategorized';
}
function routeMatch(score: number, dimsEqual: boolean): string {
  if (dimsEqual && score >= 0.97) return 'exact';
  if (score >= 0.85) return 'suggest';
  return 'miss';
}
const canon = (s: string) => String(s || '').toLowerCase().replace(/["″]/g, ' in ').replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();

export async function runAgnesVisionIntake(env: Record<string, unknown>, store: EnquiryStore, id: string): Promise<void> {
  let enquiry: any;
  try { enquiry = await store.getEnquiry(id); } catch { return; }
  if (!enquiry) return;

  const gateway = getGateway(env as any);
  const hasAgnes = gateway.health().some((h) => h.provider === 'agnes');
  const hasOpenRouter = gateway.health().some((h) => h.provider === 'openrouter');
  if (!hasAgnes && !hasOpenRouter) {
    console.warn('[vision-intake] no Agnes/OpenRouter key — skipping');
    return;
  }
  const provider = hasAgnes ? 'agnes' : 'openrouter';

  // Determine text to split: aiBulkText (Add via AI) takes precedence, otherwise description.
  const items: any[] = Array.isArray(enquiry.items) ? enquiry.items : [];
  const aiBulkText = items.filter((it: any) => it?.aiPending === true).map((it: any) => String(it?.spec ?? '').trim()).filter(Boolean).join('\n\n').slice(0, 3000);
  const text = aiBulkText
    ? `New items to split (ignore everything else):\n${aiBulkText.slice(0, 3000)}`
    : `Enquiry text:\n${String(enquiry.description || '').slice(0, 3000)}`;

  // Collect images: enquiry-level + per-item media (cap 4, data-URI or https)
  const enquiryImages: string[] = Array.isArray((enquiry as any).enquiryImages) ? (enquiry as any).enquiryImages.map((m: any) => m?.url).filter(Boolean) : [];
  const itemImages: string[] = [];
  for (const it of items) for (const m of (it.media || [])) if (m?.url) itemImages.push(String(m.url));
  const allImages = [...enquiryImages, ...itemImages].slice(0, 4);
  const content = buildVisionUserContent(text, allImages, 4) as any;
  const attachedImgs = Array.isArray(content) ? content.filter((b: any) => b && b.type === 'image_url').length : 0;
  if (allImages.length > 0 && attachedImgs === 0) {
    console.log(`[vision-intake] ${id}: WARNING ${allImages.length} image(s) present but none attached to vision call`);
  }

  let routed: any;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // Cap vision call at 12s — gateway now fails fast (3 attempts, <6s total), so intake never hangs 35s.
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 12_000);
      try {
        routed = await gateway.completeJson<any>({
          messages: [{ role: 'system', content: ROUTER_SYSTEM_AGNES }, { role: 'user', content }],
          temperature: 0, json: true, maxTokens: 4000, provider, signal: ac.signal as any,
        });
      } finally { clearTimeout(t); }
      lastErr = null;
      break;
    } catch (e: any) {
      lastErr = e;
      const is429 = /429|rate-limit|1015/i.test(String(e?.message ?? '')) || (e as any)?.status === 429;
      console.log(`[vision-intake] ${id}: attempt ${attempt + 1}/2 failed (${String(e?.message ?? e).slice(0, 120)})`);
      if (is429) break; // fail fast on rate-limit — don't hammer, write empty intake below
      if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
    }
  }
  if (lastErr) {
    const is429 = /429|rate-limit|1015/i.test(String(lastErr?.message ?? '')) || (lastErr as any)?.status === 429;
    if (is429) {
      console.warn(`[vision-intake] ${id}: rate-limited — writing empty intake so UI unsticks, will retry on next edit`);
      try {
        await cacheSet(`enquiry:intake:${id}`, { at: new Date().toISOString(), suggestions: [], missing: [], candidates: [] }, 7 * 24 * 60 * 60 * 1000);
        // also mark done so old GH queue skips
        try {
          const db: any = (env as any)?.DB;
          if (db) {
            const nowIso = new Date().toISOString();
            const doneAt = String((enquiry as any)?.updatedAt ?? nowIso);
            const expired = new Date(Date.now() - 10 * 60 * 1000 - 1000).toISOString();
            await db.batch([
              db.prepare(`INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`).bind('enquiry:intake:done:' + id, doneAt, nowIso),
              db.prepare(`INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`).bind('enquiry:intake:claim:' + id, expired, nowIso),
            ]);
          }
        } catch {}
      } catch {}
    } else {
      console.error(`[vision-intake] ${id}: vision failed: ${String(lastErr?.message ?? lastErr).slice(0, 300)}`);
    }
    if (is429) return;
    // For non-rate-limit errors, also unstick UI with empty intake
    try { await cacheSet(`enquiry:intake:${id}`, { at: new Date().toISOString(), suggestions: [], missing: [], candidates: [] }, 7 * 24 * 60 * 60 * 1000); } catch {}
    return;
  }
  if (!routed || !Array.isArray(routed.lines) || routed.lines.length === 0) {
    console.log(`[vision-intake] ${id}: router returned 0 lines (lead: ${JSON.stringify(routed?.lead || {}).slice(0, 300)})`);
    // Still write empty intake so UI doesn't spin forever on this id
  }
  const lines = (Array.isArray(routed.lines) ? routed.lines : []).slice(0, 30).map((l: any) => ({
    verbatim: String(l.verbatim || l.spec || l.name || '').slice(0, 500),
    name: String(l.name || l.verbatim || '').slice(0, 300),
    qty: String(l.qty || '').slice(0, 120),
    dims: String(l.dims || '').slice(0, 500),
    spec: String(l.spec || '').slice(0, 2000),
    category: String(l.category || 'Uncategorized').slice(0, 120),
  })).filter((l: any) => l.verbatim || l.qty || l.dims || l.spec || l.name);

  const leadRaw = (routed.lead && typeof routed.lead === 'object') ? routed.lead : {};
  const fields: Record<string, string> = {};
  for (const f of ['clientCompany', 'contactName', 'contactEmail', 'contactPhone', 'location', 'sourceLead']) {
    const v = String((leadRaw as any)[f] || '').trim().slice(0, 300);
    if (v) fields[f] = v;
  }

  // Verbatim items (no KYP renaming — keep client wording)
  const outItems = lines.map((l: any) => ({
    name: l.name || l.verbatim.split('|')[0].trim().slice(0, 300) || l.verbatim.slice(0, 300),
    qty: l.qty,
    spec: [l.dims, l.spec].filter(Boolean).join(' | ').slice(0, 2000),
    verbatim: l.verbatim.slice(0, 500),
    category: 'Uncategorized',
  }));

  // Price-memory (best-effort)
  const suggestions: any[] = [];
  const candidates: any[] = [];
  try {
    const specTexts = outItems.map((it) => [it.name, it.qty, it.spec].filter(Boolean).join(' | ').slice(0, 1000));
    const vecs = await embed(specTexts, env as any);
    for (let i = 0; i < outItems.length; i++) {
      if (!vecs || !vecs[i]) continue;
      const ns = namespaceFor(outItems[i].category);
      const matches = [
        ...((await pineconeQuery(env as any, ns, vecs[i])) || []),
        ...(ns !== 'uncategorized' ? (await pineconeQuery(env as any, 'uncategorized', vecs[i])) || [] : []),
      ].sort((a, b) => b.score - a.score).slice(0, 5);
      for (const m of matches) {
        const md: any = m.metadata || {};
        const dimsEq = canon(`${md.name} ${md.qty} ${md.spec}`) === canon(specTexts[i]) && canon(specTexts[i]).length > 0;
        candidates.push({ itemIndex: i, memoryId: m.id, score: m.score, finalRate: md.finalRate, name: md.name, route: routeMatch(m.score, dimsEq) });
      }
      const best = candidates.filter((c) => c.itemIndex === i).sort((a, b) => b.score - a.score)[0];
      if (best && (best.route === 'exact' || best.route === 'suggest')) {
        suggestions.push({ itemIndex: i, memoryId: best.memoryId, score: best.score, finalRate: best.finalRate, name: best.name, route: best.route });
      }
    }
  } catch { /* best-effort */ }

  // Apply via the same result path the runner used, but directly via store + KV
  // (fill-empty-only for fields, bulk-merge for items, KV intake for UI).
  const existing: any = enquiry;
  const updates: Record<string, any> = {};
  for (const f of ['title', 'clientCompany', 'contactName', 'contactEmail', 'contactPhone', 'location', 'sourceLead'] as const) {
    const v = String((fields as any)[f] ?? '').trim();
    if (!v || String(existing[f] ?? '').trim()) continue;
    if (f === 'sourceLead' && /sales|lead\s*of|agent/i.test(v)) continue;
    (updates as any)[f] = v.slice(0, 300);
  }
  const existingItems = Array.isArray(existing.items) ? existing.items : [];
  if (existingItems.length === 0 && outItems.length > 0) {
    (updates as any).items = outItems.slice(0, 50).map((it: any) => ({
      name: it.name, qty: it.qty, spec: it.spec, media: [], category: it.category, verbatim: it.verbatim,
    }));
  } else if (outItems.length > 0 && existingItems.length > 0) {
    const { applyIntakeBulkResult } = await import('./update');
    const merged: any = (applyIntakeBulkResult as any)(existingItems, outItems);
    if (merged) (updates as any).items = merged;
    else console.log(`[vision-intake] ${id}: ${outItems.length} lines discarded, no aiPending item stored`);
  }
  if (String((existing as any)?.rateStatus ?? '') === 'finalized') {
    const mergedItems = Array.isArray((updates as any).items) ? (updates as any).items : existingItems;
    const loop = mergedItems.filter((it: any) => !it?.specIssue && !it?.rateAvailable && !it?.internalRates);
    const done = loop.filter((it: any) => it?.finalRate !== undefined && it?.finalRate !== null && Number.isFinite(Number(it?.finalRate)));
    const loopDone = loop.length === 0 ? mergedItems.length > 0 : done.length === loop.length;
    if (!loopDone) (updates as any).rateStatus = 'rates_received';
  }
  let updated: any = existing;
  if (Object.keys(updates).length > 0) {
    try { updated = await store.updateEnquiry(id, updates).catch(() => null) ?? existing; } catch {}
  }
  try {
    await cacheSet(`enquiry:intake:${id}`, {
      at: new Date().toISOString(),
      suggestions: suggestions.slice(0, 25),
      missing: [],
      candidates: candidates.slice(0, 10),
    }, 7 * 24 * 60 * 60 * 1000);
  } catch {}
  // Mark done/claim markers so the old runner queue skips this id
  try {
    const db: any = (env as any)?.DB;
    if (db) {
      const nowIso = new Date().toISOString();
      const doneAt = String((updated as any)?.updatedAt ?? existing.updatedAt ?? nowIso);
      const expired = new Date(Date.now() - 10 * 60 * 1000 - 1000).toISOString();
      const INTAKE_DONE = 'enquiry:intake:done:';
      const INTAKE_CLAIM = 'enquiry:intake:claim:';
      await db.batch([
        db.prepare(`INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`).bind(INTAKE_DONE + id, doneAt, nowIso),
        db.prepare(`INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`).bind(INTAKE_CLAIM + id, expired, nowIso),
      ]);
    }
  } catch {}
  console.log(`[vision-intake] ${id}: provider=${provider} items=${outItems.length} fields=${Object.keys(fields).join(',') || 'none'}`);
}
