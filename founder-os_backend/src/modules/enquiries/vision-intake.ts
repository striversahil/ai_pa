/**
 * vision-intake.ts — Worker-native vision intake (no GH Actions).
 *
 * Awaited inline by the write routes (no waitUntil, no sweeper), paid DeepSeek lane primary
 * (deepseek-v4.1-flash for text; the lane's vision model for photo passes),
 * Agnes → OpenRouter free as fallbacks.
 *   Call 1 SEGMENT (vision+text, NO catalogue): splits unstructured text +
 *   enquiry/item images into verbatim line items. The model never sees KYP
 *   so it cannot hallucinate catalogue names or drop lines to fit them.
 *   Imageless enquiries already ride text-only here (buildVisionUserContent
 *   returns plain text with no image parts — same model, zero image tokens).
 *   Call 2 LOOKUP (text-only, per line): deterministic alias-index match
 *   first (exact → key → substring over verbatim+spec+name+dims+qty), the
 *   shared token-overlap tier from match.ts second (one implementation for
 *   intake + sales chat), one batched LLM fallback for the misses only
 *   (<0.65 confidence stays Uncategorized; alias/near-name answers are
 *   resolved back instead of discarded). All tiers read the LIVE ProductItem
 *   table (KV-cached slim index) — catalogue edits apply to the next intake
 *   with no codegen step. Lookup fills the category side-field only —
 *   verbatim wording is untouched.
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
import { getProductDetail, getProductIndex } from '../../automations/product-line/service';
import {
  rankProducts, TOKEN_MIN_SHARED, TOKEN_MIN_SCORE,
  type MatchProduct,
} from '../../automations/product-line/match';
import type { EnquiryStore } from './store';

const ROUTER_SYSTEM = `You are a B2B industrial-spare intake for flour-mill machinery. From the sales text + attached photos, split the enquiry into purchasable line items.
For EACH item return: {"verbatim": "client wording for the product, copied exactly as written/seen — NEVER rename", "qty": "quantity with unit or empty", "dims": "dimensions as written", "spec": "material/variant/spec detail as written", "name": "short product name derived from verbatim"}.
Also extract the lead block: {"lead": {"clientCompany": "customer company, or empty", "contactName": "contact person, or empty", "contactEmail": "or empty", "contactPhone": "mobile/phone, or empty", "location": "city/state, or empty", "sourceLead": "lead source like IndiaMART/reference, or empty"}} — NEVER invent; empty when not stated. The sales agent's own name ("Lead of ...") is NOT the customer — ignore it.
Rules: one entry per distinct product; a line containing ONLY a quantity (e.g. "QTY - 1") is NOT its own product — attach it to the product line directly above it; NEVER drop or merge product lines — every product mentioned in the text or seen in a photo gets its own entry; qty ALWAYS keeps its number when one is written ("30 pcs", never a bare "pcs"); never invent quantities, dimensions or contact details — if absent, leave empty; return STRICT JSON {"lines":[...],"lead":{...}} with no other text.`;

/** ── Call-2 lookup: line → live catalogue product (verbatim never touched). ──
 *  Reads the LIVE ProductItem table via the KV-cached slim index — the same
 *  rows the sales chat matches against. No static artifact: catalogue edits
 *  (products, aliases) apply to the next intake automatically.
 */
const normTok = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
interface KypKey { productId: string; category: string; item: string; keys: Set<string> }
interface LiveCatalog {
  products: MatchProduct[];
  cats: string[];
  itemsByCat: Map<string, Set<string>>;
  index: KypKey[];
}
async function loadLiveCatalog(): Promise<LiveCatalog> {
  const rows = await getProductIndex().catch(() => []);
  const products: MatchProduct[] = rows.map((p) => ({
    id: String(p.id),
    category: String(p.category ?? ''),
    name: String(p.name ?? ''),
    aliases: [...(p.aliases ?? [])],
    active: p.active !== false,
  }));
  const cats = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  const itemsByCat = new Map<string, Set<string>>(
    cats.map((c) => [c, new Set(products.filter((p) => p.category === c).map((p) => normTok(p.name)))]),
  );
  const index: KypKey[] = products.map((p) => ({
    productId: p.id,
    category: p.category,
    item: p.name,
    keys: new Set([normTok(p.name), ...p.aliases.map(normTok)]),
  }));
  return { products, cats, itemsByCat, index };
}
/**
 * Deterministic tiers 1–3 (exact item → exact key → substring). `extra`
 * carries the router's name/dims/qty fields — matchers used to see only
 * verbatim+spec, so any line whose product noun landed in name/dims was
 * unmatchable and fell to Uncategorized. Tier 4 (token-overlap) lives in
 * lookupToken below so call sites can count it separately.
 */
function lookupDeterministic(verbatim: string, spec: string, extra: string, index: KypKey[]): KypKey | null {
  const q = normTok(`${verbatim} ${spec} ${extra}`);
  for (const t of index) {
    if (normTok(t.item) === normTok(verbatim)) return t;
  }
  for (const t of index) {
    for (const key of t.keys) {
      if (!key) continue;
      if (q === key || normTok(verbatim) === key) return t;
    }
  }
  let best: KypKey | null = null;
  let bestScore = 0;
  for (const t of index) {
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
/**
 * Tier 4 — token-overlap via the shared sales matcher (match.ts), same
 * strict bar the sales chat auto-resolves on (≥2 shared tokens, ≥0.5
 * containment). Catches reordering/noise the substring tier cannot
 * ("Elevator Bucket Plastic 8/5 Jindal" vs "Elevator Bucket - AA Type").
 * Single best only — null when nothing credible matches.
 */
function lookupToken(q: string, products: MatchProduct[], index: KypKey[]): KypKey | null {
  const top = rankProducts(products, q, 1, TOKEN_MIN_SHARED, TOKEN_MIN_SCORE)[0];
  if (!top) return null;
  return index.find((t) => t.productId === top.product.id) ?? null;
}
// Fallback list for the LLM, built from the live catalogue:
// `1. Category: Item[alias,alias]; Item; ...`.
function buildLookupList(cats: string[], products: MatchProduct[]): string {
  return cats.map((c, i) => `${i + 1}. ${c}: ${products.filter((p) => p.category === c).map((p) => {
    const al = (p.aliases || []).filter(Boolean);
    return al.length ? `${p.name}[${al.join(',')}]` : p.name;
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
  const hasPaid = health.some((h) => h.provider === 'openrouter-paid');
  const hasAgnes = health.some((h) => h.provider === 'agnes');
  const hasOpenRouter = health.some((h) => h.provider === 'openrouter');
  if (!hasPaid && !hasAgnes && !hasOpenRouter) {
    console.warn('[vision-intake] no AI key — skipping');
    return;
  }
  // Paid DeepSeek lane primary (text → deepseek-v4.1-flash; photo passes ride
  // the lane's vision model). Agnes → OpenRouter free stay as fallbacks so
  // intake never sticks on a single provider. (Groq keys never load — dropped.)
  const providers: string[] = [];
  if (hasPaid) providers.push('openrouter-paid');
  if (hasAgnes) providers.push('agnes');
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
            messages: [{ role: 'system', content: ROUTER_SYSTEM }, { role: 'user', content }],
            temperature: 0, json: true, maxTokens: 24000, provider: prov, signal: ac.signal as any,
            // Never burn 100s on doomed direct-Agnes attempts: relay lane if
            // warm, else fail fast to the next provider (OpenRouter).
            agnesRelayOnly: true,
            // Splitting lines needs no chain-of-thought — thinking tokens are
            // billed output with zero UI use on this path.
            reasoningOff: true,
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
  // exact wording is never renamed). Live catalogue first: deterministic
  // alias-index (fed the FULL line: verbatim + spec + name + dims + qty),
  // then the shared token tier, then one batched LLM fallback for the misses
  // on the provider that won Call 1.
  const catalog = await loadLiveCatalog().catch(() => null);
  const liveProducts: MatchProduct[] = catalog?.products ?? [];
  const liveCats: string[] = catalog?.cats ?? [];
  const liveItemsByCat: Map<string, Set<string>> = catalog?.itemsByCat ?? new Map();
  const liveIndex: KypKey[] = catalog?.index ?? [];
  if (liveProducts.length === 0) console.warn(`[vision-intake] ${id}: live catalogue empty — all lines Uncategorized this run`);
  let nAlias = 0;
  let nToken = 0;
  let nLlm = 0;
  let nMisses = 0;
  const kypHits: (KypKey | null)[] = lines.map((l: any) => {
    const extra = `${String(l.name || '')} ${String(l.dims || '')} ${String(l.qty || '')}`;
    const hit = lookupDeterministic(String(l.verbatim || ''), String(l.spec || ''), extra, liveIndex);
    if (hit) { nAlias++; return hit; }
    const tok = lookupToken(normTok(`${String(l.verbatim || '')} ${String(l.spec || '')} ${extra}`), liveProducts, liveIndex);
    if (tok) { nToken++; return tok; }
    nMisses++;
    return null;
  });
  if (nMisses > 0) {
    try {
      const idx: number[] = [];
      kypHits.forEach((h, i) => { if (!h) idx.push(i); });
      const input = idx.map((i, k) => `${k}. ${[lines[i].verbatim, lines[i].name, lines[i].dims, lines[i].spec, lines[i].qty].filter(Boolean).join(' | ')}`.slice(0, 600)).join('\n');
      const ac2 = new AbortController();
      const t2 = setTimeout(() => ac2.abort(), 20_000);
      let out: any;
      try {
        out = await gateway.completeJson<any>({
          messages: [
            { role: 'system', content: `${LOOKUP_FALLBACK_SYSTEM}\nCatalogue (category NUMBER. Category: Item[aliases]; ...):\n${buildLookupList(liveCats, liveProducts)}` },
            { role: 'user', content: `Match each line:\n${input}` },
          ],
          temperature: 0, json: true, maxTokens: 24000, provider: successProvider, signal: ac2.signal as any,
          agnesRelayOnly: true,
          reasoningOff: true,
        });
      } finally { clearTimeout(t2); }
      const matches = Array.isArray(out?.matches) ? out.matches : [];
      idx.forEach((lineIdx, k) => {
        const m = matches[k] || {};
        const raw = String((m as any).category ?? '').trim();
        const n = /^\d{1,2}$/.test(raw) ? parseInt(raw, 10) : NaN;
        const conf = Number((m as any).confidence);
        const itemName = String((m as any).item || '');
        if (!itemName || !Number.isFinite(conf) || conf < 0.65) {
          kypHits[lineIdx] = null;
          return;
        }
        if (Number.isFinite(n) && n >= 1 && n <= liveCats.length
          && (liveItemsByCat.get(liveCats[n - 1]) || new Set()).has(normTok(itemName))) {
          const cat = liveCats[n - 1];
          const hit = liveIndex.find((e) => e.category === cat && normTok(e.item) === normTok(itemName)) ?? null;
          kypHits[lineIdx] = hit;
          if (hit) nLlm++;
        } else {
          // Forgiving resolve: the model returned an alias or near-name
          // instead of the exact item_name — map it back through the same
          // deterministic tiers rather than discarding to Uncategorized.
          const back = lookupDeterministic(itemName, '', '', liveIndex) ?? lookupToken(itemName, liveProducts, liveIndex);
          kypHits[lineIdx] = back;
          if (back) nLlm++;
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
  console.log(`[vision-intake] ${id}: lookup alias=${nAlias} token=${nToken} llm=${nLlm} uncategorized=${nUncat}/${lines.length}`);

  // Call-2.5 — spec completeness per matched item (one batched LLM call).
  // Required checklist comes from the LIVE KypGuide rows for each matched
  // product (same source the sales chat's stepped form uses); falls back
  // to "all missing" if the call fails. Uncategorized → no checklist.
  const guideCache = new Map<string, string[]>();
  async function liveAttrs(productId: string): Promise<string[]> {
    if (guideCache.has(productId)) return guideCache.get(productId)!;
    let qs: string[] = [];
    try {
      const detail = await getProductDetail(productId).catch(() => null);
      qs = (((detail as any)?.guide ?? []) as any[])
        .filter((g: any) => g && g.active !== false && g.active !== 0 && (g.isRequired === true || g.isRequired === 1))
        .sort((a: any, b: any) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
        .map((g: any) => String(g.question ?? '').trim())
        .filter(Boolean);
    } catch { /* treat as no checklist */ }
    guideCache.set(productId, qs);
    return qs;
  }
  const perItemAttrs: string[][] = await Promise.all(kypHits.map(async (h) => {
    if (!h) return [];
    const raw = await liveAttrs(h.productId);
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
  }));
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
          temperature: 0, json: true, maxTokens: 24000, provider: successProvider, signal: ac3.signal as any,
          agnesRelayOnly: true,
          reasoningOff: true,
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


