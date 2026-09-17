// redaction.ts — procurement-safe redacted view (AI-only, no fallback).
//
// Extracted from routes.ts (no behavior change). Restricted viewers NEVER
// receive raw free text: description / comments / requirements come from the
// write-time AI rewrite cached per enquiry in KV (`RedactedViewCache`),
// verified piece-by-piece against source hashes. Missing/stale pieces are
// WITHHELD (`redactedPending=true`) while the route layer kicks a background
// re-enrichment — there is deliberately NO deterministic fallback.
import { hashText, redactedCacheKey, REDACTED_CACHE_TTL_MS, type RedactedViewCache } from "./extract";

export { redactedCacheKey, REDACTED_CACHE_TTL_MS };
export type { RedactedViewCache };

/** v1 cache entries (description-only) predate the comments/requirements map —
 *  treat them as missing so they get re-enriched, never served. */
export function asRedactedViewCache(e: unknown): RedactedViewCache | null {
  if (!e || typeof e !== 'object') return null;
  const v = e as Record<string, unknown>;
  if (typeof v.descHash !== 'string') return null;
  if (!v.comments || typeof v.comments !== 'object') return null;
  if (!v.requirements || typeof v.requirements !== 'object') return null;
  const out = e as RedactedViewCache;
  if (!out.items || typeof out.items !== 'object') out.items = {};
  return out;
}

/** Stable hash of one sales line item — serve-time freshness check for the
 *  cached procurement rewrite. Must match the writer (runEnquiryExtraction). */
export function hashItem(item: { name: string; qty: string; spec: string; media?: Array<{ type: string; url: string }> }): string {
  const media = Array.isArray(item?.media)
    ? item.media.map((m) => `${m?.type === 'video' ? 'v' : 'i'}:${String(m?.url ?? '')}`)
    : [];
  return hashText(JSON.stringify([String(item?.name ?? ''), String(item?.qty ?? ''), String(item?.spec ?? ''), media]));
}
