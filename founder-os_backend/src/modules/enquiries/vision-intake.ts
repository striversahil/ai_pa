/**
 * vision-intake.ts — Worker-native Agnes vision intake (no GH Actions).
 *
 * Directly in the Worker (via waitUntil), uses Agnes agnes-3.0-flash vision
 * (probed alive 2026-09-21 PM; 2.5-flash remains the automatic fallback if
 * the 3.0 channel ever hangs again).
 *   Call 1 SEGMENT (vision+text, NO catalogue): splits unstructured text +
 *   enquiry/item images into verbatim line items. The model never sees KYP
 *   so it cannot hallucinate catalogue names or drop lines to fit them.
 *   Call 2 LOOKUP (text-only, per verbatim line): deterministic alias-index
 *   match first (zero tokens, data/kyp-lookup.ts codegen), one batched LLM
 *   fallback for misses only (<0.5 confidence stays Uncategorized). Lookup
 *   fills the category side-field only — verbatim wording is untouched.
 *
 * This path is fast (<4s typical, edge), handles the same `aiBulkText` vs
 * description branching as the legacy GH runner, and applies fill-empty-only
 * semantics via the shared `applyIntakeBulkResult` helper.
 *
 * RETIRED: Pinecone price-memory (embeddings + per-category namespaces) was
 * removed — pricing now comes exclusively from live product-line VendorRates
 * via the sales chat matcher (match.ts). The intake KV payload keeps
 * `suggestions: []` / `candidates: []` so the sales UI contract is unchanged.
 */
import { getGateway, buildVisionUserContent } from '../../shared/ai-gateway';
import { cacheSet } from '../../shared/cache';
import { KYP_LOOKUP } from './kyp-lookup';
import type { EnquiryStore } from './store';

const ROUTER_SYSTEM_AGNES = `You are a B2B industrial-spare intake for flour-mill machinery. From the sales text + attached photos, split the enquiry into purchasable line items.
For EACH item return: {"verbatim": "client wording for the product, copied exactly as written/seen — NEVER rename", "qty": "quantity with unit or empty", "dims": "dimensions as written", "spec": "material/variant/spec detail as written", "name": "short product name derived from verbatim"}.
Also extract the lead block: {"lead": {"clientCompany": "customer company, or empty", "contactName": "contact person, or empty", "contactEmail": "or empty", "contactPhone": "mobile/phone, or empty", "location": "city/state, or empty", "sourceLead": "lead source like IndiaMART/reference, or empty"}} — NEVER invent; empty when not stated. The sales agent's own name ("Lead of ...") is NOT the customer — ignore it.
Rules: one entry per distinct product; a line containing ONLY a quantity (e.g. "QTY - 1") is NOT its own product — attach it to the product line directly above it; NEVER drop or merge product lines — every product mentioned in the text or seen in a photo gets its own entry; qty ALWAYS keeps its number when one is written ("30 pcs", never a bare "pcs"); never invent quantities, dimensions or contact details — if absent, leave empty; return STRICT JSON {"lines":[...],"lead":{...}} with no other text.`;

/** ── Call-2 lookup: verbatim line → KYP category (verbatim never touched). ── */
const normTok = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const KYP_CATS = [...new Set(KYP_LOOKUP.map((e) => e.category))];
const KYP_ITEMS_BY_CAT = new Map<string, Set<string>>(
  KYP_CATS.map((c) => [c, new Set(KYP_LOOKUP.filter((e) => e.category === c).map((e) => normTok(e.item)))]),
);
interface KypKey { category: string; item: string; keys: Set<string> }
const KYP_INDEX: KypKey[] = KYP_LOOKUP.map((e) => ({
  category: e.category,
  item: e.item,
  keys: new Set([normTok(e.item), ...(e.aliases || []).map(normTok)]),
}));
function lookupDeterministic(verbatim: string, spec: string): KypKey | null {
  const q = normTok(`${verbatim} ${spec}`);
  for (const t of KYP_INDEX) {
    if (normTok(t.item) === normTok(verbatim)) return t;
  }
  for (const t of KYP_INDEX) {
    for (const key of t.keys) {
      if (!key) continue;
      if (q === key || normTok(verbatim) === key) return t;
    }
  }
  let best: KypKey | null = null;
  let bestScore = 0;
  for (const t of KYP_INDEX) {
    for (const key of t.keys) {
      if (!key || key.length < 4) continue;
      if (q.includes(key) && key.length > bestScore) {
        bestScore = key.length;
        best = t;
      }
    }
  }
  return best;
}
// Alias-inclusive fallback list, built at runtime from the slim artifact:
// `1. Category: Item[alias,alias]; Item; ...` (~1.9k tokens).
function buildLookupList(): string {
  return KYP_CATS.map((c, i) => `${i + 1}. ${c}: ${KYP_LOOKUP.filter((e) => e.category === c).map((e) => {
    const al = (e.aliases || []).filter(Boolean);
    return al.length ? `${e.item}[${al.join(',')}]` : e.item;
  }).join('; ')}`).join('\n');
}
const LOOKUP_FALLBACK_SYSTEM = `You are a product matcher for flour-mill spare parts. For EACH input line, pick the single best catalogue entry.
Rules: "category" is the category NUMBER as a bare number; "item" is the item_name copied EXACTLY (never an alias, never invented); "confidence" is 0-1 — below 0.65 when the line genuinely matches nothing (custom/fabricated/as-per-drawing must be 0-0.3, never force a catalogue item); return STRICT JSON {"matches":[{"category":"...","item":"...","confidence":0.9}, ...]} with exactly one entry per input line, in order, and no other text.`;

const SPEC_CHECK_SYSTEM = `You are a spec-completeness checker for flour-mill spare parts. For EACH item you receive its collected spec text and its checklist (required_attributes). Return which checklist entries are STILL MISSING.
Rules: an entry is satisfied if the spec text contains a concrete value for it — e.g. "A70" satisfies V-belt number, "Fenner"/"Gates"/any brand token satisfies brand preference, "6 GG" satisfies grade, "115 cm" satisfies width, "2 pcs"/"10 meters"/"3m" satisfies quantity. A brand token anywhere (verbatim, spec, qty) counts; "as per sample" alone does NOT satisfy; return STRICT JSON {"checks":[{"missing":[0,2]}, ...]} where missing lists the 0-based indices of STILL-MISSING entries, one entry per input item, in order. Never invent checklist text — only return indices.`;

/** Rate-limit detector (shared by the attempt loop + the terminal branch):
 *  the gateway reports a drained pool as "All AI keys exhausted after 5
 *  attempts" with no 429/status attached — without the `exhausted` arm that
 *  verdict misclassifies as terminal failure and clears the flags, killing
 *  the sweeper's automatic retry during a storm. */
function isRateLimited(e: any): boolean {
  const msg = String(e?.message ?? e ?? '');
  return /429|rate-limit|1015|exhausted/i.test(msg) || (e as any)?.status === 429;
}

export async function runAgnesVisionIntake(env: Record<string, unknown>, store: EnquiryStore, id: string): Promise<void> {
  let enquiry: any;
  try { enquiry = await store.getEnquiry(id); } catch (e: any) {
    // Never die silently here — a dropped initial read used to masquerade as
    // "kick never fired" with zero log output. Surface it for `wrangler tail`.
    console.error(`[vision-intake] ${id}: initial read failed (${String(e?.message ?? e).slice(0, 160)}) — intake aborted`);
    return;
  }
  if (!enquiry) {
    console.error(`[vision-intake] ${id}: row not found — intake aborted`);
    return;
  }

  const gateway = getGateway(env as any);
  const health = gateway.health();
  const hasAgnes = health.some((h) => h.provider === 'agnes');
  const hasGroq = health.some((h) => h.provider === 'groq');
  const hasOpenRouter = health.some((h) => h.provider === 'openrouter');
  if (!hasAgnes && !hasGroq && !hasOpenRouter) {
    console.warn('[vision-intake] no AI key — skipping');
    return;
  }
  // Standardized fallback chain: Agnes primary → Groq vision → OpenRouter vision
  // Ensures manual intake never sticks on Agnes 1015 WAF (Cloudflare IP throttled)
  const providers: string[] = [];
  if (hasAgnes) providers.push('agnes');
  if (hasGroq) providers.push('groq');
  if (hasOpenRouter) providers.push('openrouter');
  // Dedupe while preserving order
  const chain = [...new Set(providers)];

  // Determine text to split: aiBulkText (Add via AI) takes precedence, otherwise description.
  const items: any[] = Array.isArray(enquiry.items) ? enquiry.items : [];
  const aiBulkText = items.filter((it: any) => it?.aiPending === true).map((it: any) => String(it?.spec ?? '').trim()).filter(Boolean).join('\n\n').slice(0, 3000);
  const text = aiBulkText
    ? `New items to split (ignore everything else):\n${aiBulkText.slice(0, 3000)}`
    : `Enquiry text:\n${String(enquiry.description || '').slice(0, 3000)}`;

  // Collect images: enquiry-level imageUrls (string[] data-URI/https) + per-item media (cap 4)
  const rawImageUrls: any = (enquiry as any).imageUrls ?? (enquiry as any).enquiryImages;
  const enquiryImages: string[] = Array.isArray(rawImageUrls)
    ? rawImageUrls.map((m: any) => typeof m === 'string' ? m : String(m?.url ?? '')).filter(Boolean)
    : [];
  const itemImages: string[] = [];
  for (const it of items) for (const m of (it.media || [])) if (m?.url) itemImages.push(String(m.url));
  // Add-via-AI / additional-requirement re-run: the prompt says "ignore
  // everything else", so old enquiry photos must not be re-described (their
  // lines would merge in as duplicates). Only media attached to the pending
  // items themselves is in scope; full photo context applies to the
  // description-based pass only.
  const pendingMedia: string[] = [];
  if (aiBulkText) {
    for (const it of items) {
      if (it?.aiPending !== true) continue;
      for (const m of (it.media || [])) if (m?.url) pendingMedia.push(String(m.url));
    }
  }
  const allImages = (aiBulkText ? pendingMedia : [...enquiryImages, ...itemImages]).slice(0, 4);
  const content = buildVisionUserContent(text, allImages, 4) as any;
  const attachedImgs = Array.isArray(content) ? content.filter((b: any) => b && b.type === 'image_url').length : 0;
  if (allImages.length > 0 && attachedImgs === 0) {
    console.log(`[vision-intake] ${id}: WARNING ${allImages.length} image(s) present but none attached to vision call`);
  }

  let routed: any = null;
  let lastErr: any = null;
  let successProvider = chain[0] ?? 'agnes';
  // Try each provider in chain until one succeeds (handles Agnes 1015 WAF without empty poison)
  outer: for (const prov of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 20_000);
        try {
          routed = await gateway.completeJson<any>({
            messages: [{ role: 'system', content: ROUTER_SYSTEM_AGNES }, { role: 'user', content }],
            temperature: 0, json: true, maxTokens: 4000, provider: prov, signal: ac.signal as any,
          });
        } finally { clearTimeout(t); }
        lastErr = null;
        successProvider = prov;
        break outer;
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message ?? e);
        const is429 = isRateLimited(e);
        const is1015 = /1015/i.test(msg);
        console.log(`[vision-intake] ${id}: provider=${prov} attempt ${attempt + 1}/2 failed (${msg.slice(0, 120)})${is1015 ? ' [1015 WAF]' : ''}`);
        if (is429) {
          // For 1015/429, try next provider immediately (don't hammer same provider)
          break;
        }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  if (lastErr && !routed) {
    const is429 = isRateLimited(lastErr);
    if (is429) {
      console.warn(`[vision-intake] ${id}: all providers rate-limited (${chain.join('→')}) — writing empty intake so UI unsticks; flags stay set so the next edit or the 15-min sweeper retries`);
      try {
        await cacheSet(`enquiry:intake:${id}`, { at: new Date().toISOString(), suggestions: [], missing: [], candidates: [] }, 7 * 24 * 60 * 60 * 1000);
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
      console.error(`[vision-intake] ${id}: vision failed on all providers ${chain.join('→')}: ${String(lastErr?.message ?? lastErr).slice(0, 300)}`);
    }
    if (is429) return;
    try { await cacheSet(`enquiry:intake:${id}`, { at: new Date().toISOString(), suggestions: [], missing: [], candidates: [] }, 7 * 24 * 60 * 60 * 1000); } catch {}
    // Terminal failure (non-429): NEVER leave aiPending set with no retry.
    // Clear the flags (raw items stay, same as the zero-lines path) and mark
    // done so the UI stops spinning. Re-read fresh first — the row may have
    // been edited during the vision call and a stale write must not clobber it.
    try {
      let fresh: any = null;
      try { fresh = await store.getEnquiry(id); } catch { fresh = null; }
      const exItems = Array.isArray(fresh?.items) ? fresh.items : [];
      const { applyIntakeBulkResult } = await import('./update');
      const cleared = (applyIntakeBulkResult as any)(exItems, []);
      if (cleared) {
        try { await store.updateEnquiry(id, { items: cleared }).catch(() => null); } catch {}
      }
    } catch {}
    try {
      const db: any = (env as any)?.DB;
      if (db) {
        const nowIso = new Date().toISOString();
        let doneAt = nowIso;
        try { const cur: any = await store.getEnquiry(id).catch(() => null); doneAt = String((cur as any)?.updatedAt ?? nowIso); } catch {}
        const expired = new Date(Date.now() - 10 * 60 * 1000 - 1000).toISOString();
        await db.batch([
          db.prepare(`INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`).bind('enquiry:intake:done:' + id, doneAt, nowIso),
          db.prepare(`INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`).bind('enquiry:intake:claim:' + id, expired, nowIso),
        ]);
      }
    } catch {}
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

  // Verbatim items + Call-2 lookup (category side-field only — the client's
  // exact wording is never renamed). Deterministic alias-index first; one
  // batched LLM fallback for the misses on the provider that won Call 1.
  let nAlias = 0;
  let nLlm = 0;
  let nMisses = 0;
  const kypHits: (KypKey | null)[] = lines.map((l: any) => {
    const hit = lookupDeterministic(String(l.verbatim || ''), String(l.spec || ''));
    if (hit) { nAlias++; return hit; }
    nMisses++;
    return null;
  });
  if (nMisses > 0) {
    try {
      const idx: number[] = [];
      kypHits.forEach((h, i) => { if (!h) idx.push(i); });
      const input = idx.map((i, k) => `${k}. ${String(lines[i].verbatim || '')}${lines[i].spec ? ` | ${lines[i].spec}` : ''}${lines[i].qty ? ` | ${lines[i].qty}` : ''}`.slice(0, 600)).join('\n');
      const ac2 = new AbortController();
      const t2 = setTimeout(() => ac2.abort(), 20_000);
      let out: any;
      try {
        out = await gateway.completeJson<any>({
          messages: [
            { role: 'system', content: `${LOOKUP_FALLBACK_SYSTEM}\nCatalogue (category NUMBER. Category: Item[aliases]; ...):\n${buildLookupList()}` },
            { role: 'user', content: `Match each line:\n${input}` },
          ],
          temperature: 0, json: true, maxTokens: 4000, provider: successProvider, signal: ac2.signal as any,
        });
      } finally { clearTimeout(t2); }
      const matches = Array.isArray(out?.matches) ? out.matches : [];
      idx.forEach((lineIdx, k) => {
        const m = matches[k] || {};
        const raw = String((m as any).category ?? '').trim();
        const n = /^\d{1,2}$/.test(raw) ? parseInt(raw, 10) : NaN;
        const conf = Number((m as any).confidence);
        const itemName = String((m as any).item || '');
        if (Number.isFinite(n) && n >= 1 && n <= KYP_CATS.length && Number.isFinite(conf) && conf >= 0.65 && itemName
          && (KYP_ITEMS_BY_CAT.get(KYP_CATS[n - 1]) || new Set()).has(normTok(itemName))) {
          const cat = KYP_CATS[n - 1];
          const hit = KYP_INDEX.find((e) => e.category === cat && normTok(e.item) === normTok(itemName)) ?? null;
          kypHits[lineIdx] = hit;
          if (hit) nLlm++;
        } else {
          kypHits[lineIdx] = null;
        }
      });
    } catch (e: any) {
      console.log(`[vision-intake] ${id}: lookup fallback failed (${String(e?.message ?? e).slice(0, 120)}) — ${nMisses} line(s) Uncategorized`);
      // leave misses as null → Uncategorized
    }
  }
  const cats: string[] = kypHits.map((h) => h?.category ?? 'Uncategorized');
  const kypItems: (string | undefined)[] = kypHits.map((h) => h?.item ?? undefined);
  const nUncat = cats.filter((c) => c === 'Uncategorized').length;
  console.log(`[vision-intake] ${id}: lookup alias=${nAlias} llm=${nLlm} uncategorized=${nUncat}/${lines.length}`);

  // Call-2.5 — spec completeness per matched item (one batched LLM call).
  // Uses the per-item required_attributes from the slim artifact; falls back
  // to "all missing" if the call fails. Uncategorized → no checklist.
  const KYP_ATTRS_BY_KEY = new Map<string, string[]>(
    KYP_LOOKUP.map((e) => [`${e.category}::${normTok(e.item)}`, e.required_attributes ?? []]),
  );
  const perItemAttrs: string[][] = kypHits.map((h) => {
    if (!h) return [];
    const raw = KYP_ATTRS_BY_KEY.get(`${h.category}::${normTok(h.item)}`) ?? [];
    // Conditional fallbacks like "If the client is unsure of the grade, request a picture..." are
    // not hard requirements when the primary spec is already given. Filter them from the
    // completeness gate so a fully-specified item can actually reach complete.
    return raw.filter((a) => {
      const low = a.toLowerCase();
      if (low.includes('if the client is unsure of the grade')) return false;
      if (low.includes('request a picture or a physical swatch')) return false;
      // Generic "request a picture" fallbacks that are conditional on not knowing the spec
      if (low.startsWith('if the client is unsure') && low.includes('request a picture')) return false;
      return true;
    });
  });
  // kypMissing per line (subset of required_attributes that are still missing)
  let kypMissing: (string[] | undefined)[] = kypHits.map(() => undefined);
  let kypComplete: (boolean | undefined)[] = kypHits.map(() => undefined);
  const checkableIdx: number[] = [];
  kypHits.forEach((h, i) => { if (h && perItemAttrs[i].length > 0) checkableIdx.push(i); });
  if (checkableIdx.length > 0) {
    const checksInput = checkableIdx.map((i, k) => {
      const specText = [lines[i].verbatim, lines[i].dims, lines[i].spec, lines[i].qty].filter(Boolean).join(' | ').slice(0, 800);
      const checklist = perItemAttrs[i].map((a, ai) => `${ai}. ${a}`).join('\n');
      return `Item ${k} spec: "${specText}"\nChecklist:\n${checklist}`;
    }).join('\n\n---\n\n');
    try {
      const ac3 = new AbortController();
      const t3 = setTimeout(() => ac3.abort(), 20_000);
      let raw: any;
      try {
        raw = await gateway.completeJson<any>({
          messages: [
            { role: 'system', content: SPEC_CHECK_SYSTEM },
            { role: 'user', content: checksInput },
          ],
          temperature: 0, json: true, maxTokens: 4000, provider: successProvider, signal: ac3.signal as any,
        });
      } finally { clearTimeout(t3); }
      const checks = Array.isArray(raw?.checks) ? raw.checks : [];
      checkableIdx.forEach((lineIdx, k) => {
        const c = checks[k] || {};
        const idxs: number[] = Array.isArray(c.missing) ? c.missing.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0 && n < perItemAttrs[lineIdx].length) : [];
        let missing = idxs.map((n) => perItemAttrs[lineIdx][n]).filter(Boolean);
        // Deterministic fix for the micron/flour alternative: the single checklist entry covers
        // "micron opening if known, else flour type". If spec already has "micron 80" or
        // "maida"/"suji"/"rava"/"bran"/"chokar", that entry is satisfied regardless of LLM.
        const hay = [lines[lineIdx].verbatim, lines[lineIdx].dims, lines[lineIdx].spec, lines[lineIdx].qty].join(' ').toLowerCase();
        missing = missing.filter((m) => {
          const low = m.toLowerCase();
          if (low.includes('micron opening') && low.includes('flour it is sifting')) {
            if (hay.includes('micron') || hay.includes('maida') || hay.includes('suji') || hay.includes('rava') || hay.includes('bran') || hay.includes('chokar')) return false;
          }
          return true;
        });
        kypMissing[lineIdx] = missing;
        kypComplete[lineIdx] = missing.length === 0;
      });
      // Any checkable line not returned → treat as all-missing
      checkableIdx.forEach((lineIdx) => {
        if (kypMissing[lineIdx] === undefined) {
          kypMissing[lineIdx] = [...perItemAttrs[lineIdx]];
          kypComplete[lineIdx] = false;
        }
      });
    } catch (e: any) {
      console.log(`[vision-intake] ${id}: spec-check failed (${String(e?.message ?? e).slice(0, 120)}) — marking all checkable as incomplete`);
      checkableIdx.forEach((lineIdx) => {
        kypMissing[lineIdx] = [...perItemAttrs[lineIdx]];
        kypComplete[lineIdx] = false;
      });
    }
  }
  // Matched items with empty checklist (should not happen) → complete
  kypHits.forEach((h, i) => {
    if (!h) { kypMissing[i] = undefined; kypComplete[i] = undefined; return; }
    if (kypMissing[i] === undefined) {
      kypMissing[i] = [];
      kypComplete[i] = true;
    }
  });
  const nComplete = kypComplete.filter((v) => v === true).length;
  const nIncomplete = kypComplete.filter((v) => v === false).length;
  if (checkableIdx.length > 0) console.log(`[vision-intake] ${id}: spec-check complete=${nComplete} incomplete=${nIncomplete}/${checkableIdx.length}`);
  const outItems = lines.map((l: any, i: number) => ({
    name: l.name || l.verbatim.split('|')[0].trim().slice(0, 300) || l.verbatim.slice(0, 300),
    qty: l.qty,
    spec: [l.dims, l.spec].filter(Boolean).join(' | ').slice(0, 2000),
    verbatim: l.verbatim.slice(0, 500),
    category: cats[i] || 'Uncategorized',
    kypItem: kypItems[i],
    kypMissing: kypMissing[i],
    kypComplete: kypComplete[i],
  }));

  // RETIRED: Pinecone price-memory removed — pricing comes exclusively from
  // live product-line VendorRates via the sales chat matcher. Suggestions and
  // candidates stay empty; the KV shape is unchanged for the sales UI.
  const suggestions: any[] = [];
  const candidates: any[] = [];

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
      kypItem: it.kypItem, kypMissing: it.kypMissing, kypComplete: it.kypComplete,
    }));
  } else if (existingItems.length > 0) {
    // NOTE: no `outItems.length > 0` guard — on zero router lines the helper
    // clears the aiPending flags (raw items stay) so a spent job can never
    // wedge the row, per its contract. Null = no pending block, keep as-is.
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
  console.log(`[vision-intake] ${id}: provider=${successProvider} items=${outItems.length} fields=${Object.keys(fields).join(',') || 'none'} fallbackChain=${chain.join('→')}`);
}

/**
 * sweepStaleAiPending — self-healing backstop for intake jobs that died with
 * zero output (kicked but the waitUntil task never wrote KV or markers, or
 * pre-fix fossils still carrying `aiPending`).
 *
 * Finds rows still carrying `"aiPending":true` that haven't been touched for
 * `olderThanMin` (default 10 — a fresh save has its own in-flight intake, so
 * never double-kick) and re-runs the intake for up to `maxRows` (default 3,
 * oldest first, sequential to bound edge CPU). A per-row sweep-claim backs
 * off repeats to one attempt/hour so a permanently-failing row can't burn
 * LLM calls every sweep. Pure D1 + store — no Zoho/NeoDove traffic.
 */
export async function sweepStaleAiPending(
  env: Record<string, unknown>,
  store: EnquiryStore,
  opts?: { olderThanMin?: number; maxRows?: number },
): Promise<{ checked: number; rekicked: string[] }> {
  const olderThanMs = (opts?.olderThanMin ?? 10) * 60_000;
  const maxRows = opts?.maxRows ?? 3;
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const backoffCutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const out = { checked: 0, rekicked: [] as string[] };
  const db: any = (env as any)?.DB;
  if (!db) return out;
  let ids: string[] = [];
  try {
    const res: any = await db
      .prepare(`SELECT id FROM Enquiry WHERE items LIKE ? AND updatedAt < ? ORDER BY updatedAt ASC LIMIT ?`)
      .bind('%"aiPending":true%', cutoff, maxRows)
      .all();
    const rows = Array.isArray(res?.results) ? res.results : [];
    ids = rows.map((r: any) => String(r?.id ?? '')).filter(Boolean);
  } catch (e: any) {
    console.log(`[intake-sweep] candidate scan failed (${String(e?.message ?? e).slice(0, 120)})`);
    return out;
  }
  out.checked = ids.length;
  if (!ids.length) return out;
  for (const id of ids) {
    try {
      // Backoff: skip rows swept within the hour.
      let claimedAt = '';
      try {
        const c: any = await db.prepare(`SELECT value FROM Setting WHERE key = ?`).bind('enquiry:intake:sweep:' + id).first();
        claimedAt = String((c as any)?.value ?? '');
      } catch {}
      if (claimedAt && claimedAt > backoffCutoff) {
        console.log(`[intake-sweep] ${id}: swept recently (${claimedAt}) — backing off`);
        continue;
      }
      // Re-verify the flag is still set (row may have healed since the scan).
      let cur: any = null;
      try { cur = await store.getEnquiry(id); } catch { cur = null; }
      const stillPending = Array.isArray((cur as any)?.items) && (cur as any).items.some((it: any) => it?.aiPending === true);
      if (!cur || !stillPending) continue;
      const nowIso = new Date().toISOString();
      try {
        await db.prepare(`INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`).bind('enquiry:intake:sweep:' + id, nowIso, nowIso).run();
      } catch {}
      console.log(`[intake-sweep] ${id}: re-kicking stale intake`);
      await runAgnesVisionIntake(env, store, id);
      out.rekicked.push(id);
    } catch (e: any) {
      console.log(`[intake-sweep] ${id} failed (${String(e?.message ?? e).slice(0, 160)})`);
    }
  }
  return out;
}
