// catalogue-resolve.ts — ONE home for "map an item to a live catalogue product".
//
// Wraps the intake lookup path so the known-rates picker and vision-intake
// share one matcher instead of each owning one: deterministic tiers
// (lookupDeterministic / lookupToken from vision-intake-parts/pure) first,
// then ONE LLM fallback for the miss — same prompt (LOOKUP_FALLBACK_SYSTEM +
// buildLookupList), same provider order (single AI gateway chain),
// same 0.65 confidence gate, same forgiving resolve-back. Text only
// (name + spec + qty + dims) — no photos, same inputs the intake lookup uses.
// Resolves are KV-cached per normalized item text so repeat expands of the
// same item never re-burn an AI call.
//
// Never throws: no keys / LLM failure / unparseable answer all resolve to
// { product: null } and the caller falls back (fuzzy candidates / manual).
import { getGateway } from '../../shared/ai-gateway';
import { resolveAiChain } from '../../shared/intake-chain';
import { cached } from '../../shared/cache';
import { loadLiveCatalog } from './vision-intake-parts/io';
import {
  LOOKUP_FALLBACK_SYSTEM,
  buildLookupList,
  lookupDeterministic,
  lookupToken,
  normTok,
} from './vision-intake-parts/pure';
import type { MatchProduct } from '../../automations/product-line/match';

/** Below this the model is guessing (custom/fabricated lines score 0–0.3) — never auto-apply. */
export const RESOLVE_CONFIDENCE_MIN = 0.65;

/** Resolve KV TTL: item-text → product mapping is stable until the catalogue
 *  is edited (edits apply on expiry, never instantly — same tradeoff as the
 *  product-line index caches). */
export const RESOLVE_TTL_MS = 6 * 3600 * 1000;

export interface CatalogueHit {
  id: string;
  name: string;
  category: string;
}

export interface CatalogueResolution {
  product: CatalogueHit | null;
  /** 1 for deterministic tiers, model confidence for the LLM tier. */
  confidence: number;
  source: 'exact' | 'llm' | null;
}

const keyOf = (parts: Array<unknown>): string =>
  normTok(parts.map((p) => String(p ?? '')).join(' ').slice(0, 300))
    .replace(/[^a-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .join('-')
    .slice(0, 120) || 'empty';

function toHit(productId: string, category: string, item: string): CatalogueHit {
  return { id: String(productId), name: String(item), category: String(category) };
}

export async function resolveCatalogueItem(
  env: any,
  input: { name?: unknown; spec?: unknown; dims?: unknown; qty?: unknown },
): Promise<CatalogueResolution> {
  const name = String(input?.name ?? '').trim().slice(0, 200);
  const spec = String(input?.spec ?? '').trim().slice(0, 500);
  const dims = String(input?.dims ?? '').trim().slice(0, 200);
  const qty = String(input?.qty ?? '').trim().slice(0, 120);
  if (!name && !spec) return { product: null, confidence: 0, source: null };

  const key = `known-rates:resolve:v1:${keyOf([name, spec, dims, qty])}`;
  return cached<CatalogueResolution>(key, RESOLVE_TTL_MS, async () => {
    const catalog = await loadLiveCatalog().catch(() => null);
    const products: MatchProduct[] = (catalog as any)?.products ?? [];
    const index = (catalog as any)?.index ?? [];
    if (!products.length || !index.length) return { product: null, confidence: 0, source: null };

    // Deterministic tiers first (free, instant): exact/alias/substring, then
    // the shared token tier — same auto-resolve bar as intake + sales chat.
    const extra = `${name} ${dims} ${qty}`;
    const det = lookupDeterministic(name || spec, spec, extra, index);
    if (det) return { product: toHit(det.productId, det.category, det.item), confidence: 1, source: 'exact' };
    const tok = lookupToken(normTok(`${name} ${spec} ${extra}`), products, index);
    if (tok) return { product: toHit(tok.productId, tok.category, tok.item), confidence: 1, source: 'exact' };

    // LLM fallback for the miss only (mirrors intake Call-2): one call, the
    // numbered live catalogue in the prompt, strict JSON, resolve-back.
    try {
      const gateway = getGateway(env as any);
      const chain = await resolveAiChain(env as any);
      if (chain.length === 0) return { product: null, confidence: 0, source: null };

      const cats: string[] = (catalog as any)?.cats ?? [];
      const itemsByCat: Map<string, Set<string>> = (catalog as any)?.itemsByCat ?? new Map();
      const line = `0. ${[name, spec, dims, qty].filter(Boolean).join(' | ')}`.slice(0, 600);
      for (const leg of chain) {
        let out: any = null;
        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 20_000);
          try {
            out = await gateway.completeJson<any>({
              messages: [
                { role: 'system', content: `${LOOKUP_FALLBACK_SYSTEM}\nCatalogue (category NUMBER. Category: Item[aliases]; ...):\n${buildLookupList(cats, products)}` },
                { role: 'user', content: `Match each line:\n${line}` },
              ],
              temperature: 0, json: true, maxTokens: 2000,
              provider: leg.provider, ...(leg.model ? { model: leg.model } : {}),
              signal: ac.signal as any,
              reasoningOff: true,
            });
          } finally { clearTimeout(t); }
        } catch { continue; }
        const m = (Array.isArray(out?.matches) ? out.matches : [])[0] ?? {};
        const raw = String((m as any)?.category ?? '').trim();
        const n = /^\d{1,2}$/.test(raw) ? parseInt(raw, 10) : NaN;
        const conf = Number((m as any)?.confidence);
        const itemName = String((m as any)?.item ?? '').trim();
        if (!itemName || !Number.isFinite(conf) || conf < RESOLVE_CONFIDENCE_MIN) continue;
        if (Number.isFinite(n) && n >= 1 && n <= cats.length
          && (itemsByCat.get(cats[n - 1]) || new Set()).has(normTok(itemName))) {
          const cat = cats[n - 1];
          const hit = index.find((e: any) => e.category === cat && normTok(e.item) === normTok(itemName)) ?? null;
          if (hit) return { product: toHit(hit.productId, hit.category, hit.item), confidence: conf, source: 'llm' };
          continue;
        }
        // Forgiving resolve-back: alias/near-name → deterministic tiers.
        const back = lookupDeterministic(itemName, '', '', index) ?? lookupToken(itemName, products, index);
        if (back) return { product: toHit(back.productId, back.category, back.item), confidence: conf, source: 'llm' };
      }
    } catch { /* fall through to null — caller shows candidates */ }
    return { product: null, confidence: 0, source: null };
  });
}
