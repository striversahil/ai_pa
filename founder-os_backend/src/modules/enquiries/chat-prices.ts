// chat-prices.ts — sales copilot price-session state + spec normalization.
//
// Verbatim extract from chat.ts (Phase-1 split): KV-backed per-item pricing
// state (resolved product + collected specs, 30-min TTL — same method as
// product-line intake's draft) plus the pure spec-key/vagueness helpers the
// price tools share. No tool wiring here; see chat-tools-pricing.ts.
import { cacheDel, cacheGet, cacheSet } from '../../shared/cache';

/** Rolling conversation memory TTL (also the legacy intake-cache TTL). */
export const THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PriceItemState {
  productId?: string;
  productName?: string;
  specs: Record<string, string>;
}

export interface PriceSession {
  /** Per-item state, keyed by INTERNAL 0-based index. */
  items: Record<string, PriceItemState>;
  activeItem?: number;
}

// ── Price session (mirrors the intake draft method) ─────────────────────
// Structured per-item pricing state (resolved product + collected specs) in
// KV, 30-min TTL — the same method as product-line intake's draft. Chat
// history prose is lossy for structured data (which specs were answered,
// which product was resolved); without this the model drops specs between
// turns and re-asks. find_price writes it, ask_specs/quote_price merge it.
const PRICE_SESSION_TTL_MS = 30 * 60 * 1000;

export function blankItemState(): PriceItemState {
  return { specs: {} };
}

export function getItemState(s: PriceSession, idx: number): PriceItemState {
  const st = (s.items ?? {})[String(idx)];
  return st && typeof st === 'object' ? { productId: st.productId, productName: st.productName, specs: { ...(st.specs ?? {}) } } : blankItemState();
}

export function priceWho(me: any): string {
  return String(me?.user?.email ?? me?.user?.id ?? 'anon').toLowerCase();
}

function priceSessionKey(enquiryId: string, who: string): string {
  return `enquiry:price:${enquiryId}:${who}`;
}

export async function loadPriceSession(enquiryId: string, who: string): Promise<PriceSession> {
  try {
    const s = await cacheGet<PriceSession>(priceSessionKey(enquiryId, who), PRICE_SESSION_TTL_MS);
    if (s && typeof s === 'object') {
      // Migrate v1 shape ({itemIndex, productId, productName, specs}) → v2 map.
      if (!(s as any).items && ((s as any).productId !== undefined || (s as any).itemIndex !== undefined)) {
        const idx = Number((s as any).itemIndex ?? 0);
        return {
          items: { [String(idx)]: { productId: (s as any).productId, productName: (s as any).productName, specs: { ...(((s as any).specs ?? {}) as Record<string, string>) } } },
          activeItem: idx,
        };
      }
      return { items: { ...((s as any).items ?? {}) }, activeItem: (s as any).activeItem };
    }
  } catch { /* ignore */ }
  return { items: {} };
}

export async function savePriceSession(enquiryId: string, who: string, s: PriceSession): Promise<void> {
  try { await cacheSet(priceSessionKey(enquiryId, who), s, PRICE_SESSION_TTL_MS); } catch { /* ignore */ }
}

export async function clearPriceSession(enquiryId: string, who: string): Promise<void> {
  try { await cacheDel(priceSessionKey(enquiryId, who)); } catch { /* ignore */ }
}

/** SpecForm answers arrive labeled by raw question text, not attrKey —
 resolve either form to the storage key against the live checklist. */
function normSpecKey(s: unknown): string {
  return String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Whole-value vague words ("small", "normal", "standard" standing alone)
 * are NOT specs — filing them poisons scoring and dedupe. Dropped here
 * (quote paths only) and returned for targeted follow-up questions.
 * Whole-value match only: "Indian regular" (fabric) never trips "regular".
 */
const VAGUE_SPEC_VALUES = new Set([
  'small', 'medium', 'large', 'normal', 'standard', 'regular',
  'ok', 'okay', 'fine', 'good', 'average', 'usual', 'as usual',
  'same', 'default', 'any', 'whatever',
]);
export function dropVagueSpecs(
  specs: Record<string, string>,
  required: { attrKey: string; question: string }[],
): { clean: Record<string, string>; vague: { key: string; question: string; value: string }[] } {
  const clean: Record<string, string> = {};
  const vague: { key: string; question: string; value: string }[] = [];
  const label = new Map(required.map((g) => [g.attrKey, g.question]));
  for (const [k, v] of Object.entries(specs ?? {})) {
    if (VAGUE_SPEC_VALUES.has(String(v ?? '').trim().toLowerCase())) {
      vague.push({ key: k, question: label.get(k) ?? k, value: String(v).trim().slice(0, 120) });
      continue;
    }
    clean[k] = v;
  }
  return { clean, vague };
}

/** Price sessions hold ONLY catalogue checklist specs (attrKeys). Generic
 *  ask_question answers share the same reply channel — drop anything that
 *  is not a known checklist key so conversational answers can never pollute
 *  pricing, spec_fix writes, or future scoring. */
export function filterChecklistSpecs(
  specs: Record<string, string>,
  required: { attrKey: string }[],
): Record<string, string> {
  const keep = new Set(required.map((g) => g.attrKey));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs ?? {})) {
    if (keep.has(String(k))) out[String(k)] = v;
  }
  return out;
}

export function resolveSpecKeys(
  specs: Record<string, string>,
  required: { attrKey: string; question: string }[],
): Record<string, string> {
  const byKey = new Map(required.map((g) => [normSpecKey(g.attrKey), g.attrKey]));
  const byQ = new Map(required.map((g) => [normSpecKey(g.question), g.attrKey]));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs ?? {})) {
    const val = String(v ?? '').trim().slice(0, 200);
    if (!val) continue;
    const nk = normSpecKey(k);
    if (!nk) continue;
    let hit = byKey.get(nk) ?? byQ.get(nk);
    if (!hit) {
      // loose fallback: key contained in (or containing) a question
      for (const g of required) {
        const nq = normSpecKey(g.question);
        if (nq && (nq.includes(nk) || nk.includes(nq))) { hit = g.attrKey; break; }
      }
    }
    out[hit ?? String(k)] = val;
  }
  return out;
}

/** Model-facing item numbers are 1-based (Item 1, Item 2 — exactly as the
 *  dashboard shows them). There is no Item 0. Convert to the internal 0-based
 *  array index here, in ONE place — proposals/actions keep 0-based indexes
 *  internally, but every number the MODEL sees or sends is 1-based. */
export function itemIdx(args: Record<string, any>, count: number): { idx: number; num: number } | { error: string } {
  const num = Math.floor(Number(args.itemIndex) || 0);
  if (!(num >= 1) || num > count) {
    return { error: `no Item ${Math.floor(Number(args.itemIndex) || 0)} — this enquiry has ${count} item${count === 1 ? '' : 's'} (use Item 1–${count})` };
  }
  return { idx: num - 1, num };
}
