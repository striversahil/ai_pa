// redaction.ts — procurement-safe redacted view (AI-only, no fallback).
//
// Extracted from routes.ts (no behavior change). Restricted viewers NEVER
// receive raw free text: description / comments / requirements come from the
// write-time AI rewrite cached per enquiry in KV (`RedactedViewCache`),
// verified piece-by-piece against source hashes. Missing/stale pieces are
// WITHHELD (`redactedPending=true`) while the route layer kicks a background
// re-enrichment — there is deliberately NO deterministic fallback.
import { hashText, redactedCacheKey, REDACTED_CACHE_TTL_MS, type RedactedViewCache } from "./extract";
import { cacheGet } from "../../shared/cache";
import {
  isoOrUndefined,
  normalizeVisibility,
  numOrUndefined,
  parseFlagThread,
  parseItemMedia,
  parseItemRates,
  signedNumOrUndefined,
} from "./parse";
import { redactEnquiryPII } from "./scopes";

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

// ── Row redaction (moved verbatim from routes.ts — Phase-1 split) ──────────
// Extracted verbatim from `enquiryList` (no behavior change): redacts a row
// list through the write-time enrichment cache (hash-verified, fail-closed).
// Used by the list endpoint AND the cached procurement queue endpoints.
export async function redactEnquiryRows(
  rows: any[],
  comments: any[],
  aiConfigured: boolean,
): Promise<{ enquiries: any[]; comments: any[]; redactionPendingIds: string[] }> {
  const enquiries = rows as any[];
// AI-only procurement view: each piece comes from the write-time enrichment
// cache (RedactedViewCache) and only when its hash still matches the source.
// Anything missing/stale is WITHHELD with redactedPending=true — the route
// layer kicks a background re-enrichment and the client refetches on the
// live event. Raw text is never served, and no deterministic fallback exists.
// Sales-scope comments never enter this payload (procurement sees only the
// shared ops thread).
const scopeComments = (comments as any[]).filter(
  (cm) => normalizeVisibility((cm as any)?.visibility) === 'procurement',
);
const commentsByEnquiry = new Map<string, any[]>();
for (const cm of scopeComments) {
  const key = String(cm.enquiryId);
  if (!commentsByEnquiry.has(key)) commentsByEnquiry.set(key, []);
  commentsByEnquiry.get(key)!.push(cm);
}
const redacted = await Promise.all(enquiries.map(async (e: any) => {
  const id = String(e.id);
  let raw: unknown = null;
  try {
    raw = await cacheGet<RedactedViewCache>(redactedCacheKey(id), REDACTED_CACHE_TTL_MS);
  } catch { raw = null; }
  const entry = asRedactedViewCache(raw);
  let pending = false;
  let description = '';
  const srcDesc = String(e.description ?? '');
  if (!srcDesc.trim()) {
    // Nothing to secure — legitimately empty, not pending.
    description = '';
  } else if (entry && entry.descHash === hashText(srcDesc) && typeof entry.description === 'string') {
    description = entry.description;
  } else {
    pending = true;
  }
  const servedComments: any[] = [];
  for (const cm of commentsByEnquiry.get(id) ?? []) {
    const cid = String(cm.id);
    const cached = entry?.comments[cid];
    if (cached && cached.hash === hashText(String(cm.content ?? '')) && typeof cached.content === 'string') {
      servedComments.push({ ...cm, content: cached.content });
    } else {
      pending = true;
    }
  }
  const servedRequirements: any[] = [];
  const rawReqs = Array.isArray(e.additionalRequirements) ? e.additionalRequirements : [];
  rawReqs.forEach((r: any, i: number) => {
    const text = typeof r === 'string' ? r : String(r?.text ?? '');
    const cached = entry?.requirements?.[i];
    if (cached && cached.hash === hashText(text) && typeof cached.text === 'string') {
      servedRequirements.push(typeof r === 'string' ? cached.text : { ...r, text: cached.text });
    } else {
      pending = true;
    }
  });
  // Line items: manual entry is served as-is in BOTH views (specs, not
  // PII) — EXCEPT markup decisions, which are Management-only: restricted
  // viewers see vendor rates but never selectedVendor/markup/finalRate.
  // A cached AI rewrite (legacy AI-split rows) still wins when its hash
  // matches; otherwise the stored item is served with no pending flag.
  const salesItems: Array<{ name: string; qty: string; spec: string; media: Array<{ type: string; url: string; name?: string }>; rates?: Array<{ vendor: string; rate: number }> }> =
    Array.isArray((e as any).items) ? (e as any).items : [];
  const servedItems: Array<{ name: string; qty: string; spec: string; media: Array<{ type: string; url: string; name?: string }>; rates?: Array<{ vendor: string; rate: number }> }> = [];
  salesItems.forEach((it: any, i: number) => {
    const sales = {
      name: String(it?.name ?? ''),
      qty: String(it?.qty ?? ''),
      spec: String(it?.spec ?? ''),
      media: parseItemMedia(it?.media),
      rates: parseItemRates(it?.rates),
      selectedVendor: it?.selectedVendor ? String(it.selectedVendor) : undefined,
      markup: signedNumOrUndefined(it?.markup),
      finalRate: numOrUndefined(it?.finalRate),
      finalizedAt: isoOrUndefined(it?.finalizedAt),
      specIssue: it?.specIssue ? String(it.specIssue).slice(0, 2000) : undefined,
      specFlaggedAt: isoOrUndefined(it?.specFlaggedAt),
    };
    const cached = entry?.items?.[i];
    let served: any;
    if (cached && cached.hash === hashItem(sales)
      && typeof cached.name === 'string' && typeof cached.qty === 'string' && typeof cached.spec === 'string') {
      // Cached AI rewrite wins for name/qty/spec — but rates are LIVE
      // workflow data (adding a quote never changes the hash above), so
      // they must always ride along. Dropping them here made newly added
      // vendor rates "show for a second, then disappear" on refetch.
      served = { name: cached.name, qty: cached.qty, spec: cached.spec, media: sales.media, rates: sales.rates };
    } else {
      // Markup decisions AND finalize timing stay Management-only.
      const { selectedVendor, markup, finalRate, finalizedAt, ...rest } = sales;
      served = rest;
    }
    // Spec-dispute flags are live workflow metadata (not PII, not a markup
    // decision): always overlay the stored values so a flag change never
    // waits on — or invalidates — the AI rewrite cache.
    if (it?.specIssue) {
      served.specIssue = String(it.specIssue).slice(0, 2000);
      if (it?.specFlaggedAt) served.specFlaggedAt = String(it.specFlaggedAt);
    }
    // Rate-availability / not-available is live workflow metadata too: the procurement queue
    // predicate depends on it, so it rides along regardless of cache path.
    served.rateAvailable = (it as any)?.rateAvailable === true;
    served.notAvailable = (it as any)?.notAvailable === true;
    if ((it as any)?.notAvailableReason) served.notAvailableReason = String((it as any).notAvailableReason).slice(0, 500);
    if ((it as any)?.notAvailableAt) served.notAvailableAt = String((it as any).notAvailableAt);
    if ((it as any)?.notAvailableRequested) {
      served.notAvailableRequested = String((it as any).notAvailableRequested).slice(0, 500);
      if ((it as any)?.notAvailableRequestedAt) served.notAvailableRequestedAt = String((it as any).notAvailableRequestedAt);
    }
    // Management rate-requests are live workflow metadata as well: overlay
    // stored values so the queue predicate never waits on the AI cache.
    if ((it as any)?.ratesRequested) {
      served.ratesRequested = String((it as any).ratesRequested).slice(0, 500);
      if ((it as any)?.ratesRequestedAt) served.ratesRequestedAt = String((it as any).ratesRequestedAt);
    }
    // Sales alternate/info requests are live workflow metadata too: procurement
    // must see them (banner + queue) the moment sales asks — never gated
    // on the AI rewrite cache. Common attachment travels with the text.
    if ((it as any)?.variationRequest) {
      served.variationRequest = String((it as any).variationRequest).slice(0, 500);
      if ((it as any)?.variationRequestedAt) served.variationRequestedAt = String((it as any).variationRequestedAt);
      if (Array.isArray((it as any)?.variationRequestMedia) && (it as any).variationRequestMedia.length > 0) {
        served.variationRequestMedia = parseItemMedia((it as any).variationRequestMedia);
      }
    }
      // Loop trail is live workflow metadata too: always the stored values.
      served.thread = parseFlagThread((it as any)?.thread);
      // Resolution is live workflow metadata as well: without it a resolved
      // flag's lingering text would read as still awaiting sales fix (chip +
      // conclude gate both key on openness, never on text presence).
      served.threadResolved = (it as any)?.threadResolved === true;
      if ((it as any)?.threadResolvedBy) served.threadResolvedBy = String((it as any).threadResolvedBy).slice(0, 40);
      if ((it as any)?.threadResolvedAt) served.threadResolvedAt = String((it as any).threadResolvedAt);
      servedItems.push(served);
  });
  return {
    entry: { id, pending },
    payload: {
      ...redactEnquiryPII(e),
      description,
      additionalRequirements: servedRequirements,
      items: servedItems,
      redactedPending: pending,
    },
    servedComments,
  };
}));
  return {
    enquiries: redacted.map((r) => r.payload),
    comments: redacted.flatMap((r) => r.servedComments),
    // Route layer kicks a background re-enrichment for these (fire-and-forget).
    redactionPendingIds: redacted.filter((r) => r.entry.pending).map((r) => r.entry.id),
  };
}

/** Redacted comment thread for one enquiry (the `enquiryComments` redacted
 *  branch): cached rewrites whose hashes match are served, the rest withheld.
 *  Moved verbatim from routes.ts (Phase-1 split). */
export async function redactCommentList(
  enquiryId: string,
  list: any[],
  aiConfigured: boolean,
): Promise<{ comments: any[]; redactionPendingIds: string[] }> {
  let raw: unknown = null;
  try {
    raw = await cacheGet<RedactedViewCache>(redactedCacheKey(enquiryId), REDACTED_CACHE_TTL_MS);
  } catch { raw = null; }
  const entry = asRedactedViewCache(raw);
  const served: any[] = [];
  let pending = false;
  for (const cm of list as any[]) {
    const cid = String(cm.id);
    const cached = entry?.comments[cid];
    if (cached && cached.hash === hashText(String(cm.content ?? '')) && typeof cached.content === 'string') {
      served.push({ ...cm, content: cached.content });
    } else {
      pending = true;
    }
  }
  return { comments: served, redactionPendingIds: pending ? [enquiryId] : [], aiConfigured } as any;
}

// Queue payloads must stay small: item `media` carries embedded base64
// photos/video (one row alone is ~2.5MB; ~84% of all item bytes), and every
// dashboard render + 60s poll + live-event refetch hauls the full queues.
// Strip media BYTES at every queue serve point (tables never render them —
// counts/chips read metadata, never urls). Threads stay fully intact: the
// write path appends remarks by media-identity dedupe, so a slimmed thread
// echo would re-push every stored remark as a duplicate.
// Full media returns on single-row reads (`enquiryGet` / `enquiryGetRedacted`
// below) — dashboard modals fetch the open row on demand.
export function stripQueueMediaUrls(rows: any[]): any[] {
  return (rows ?? []).map((e: any) => {
    const items = Array.isArray((e as any)?.items) ? (e as any).items : null;
    if (!items) return e;
    let touched = false;
    const out = items.map((it: any) => {
      const hasMedia = Array.isArray((it as any)?.media) && (it as any).media.length > 0;
      const hasVarMedia = Array.isArray((it as any)?.variationRequestMedia) && (it as any).variationRequestMedia.length > 0;
      if (!hasMedia && !hasVarMedia) return it;
      touched = true;
      const c: any = { ...(it as any) };
      if (hasMedia) c.media = [];
      // Sales' request reference photo MUST stay visible to procurement (the
      // whole point of the alternate/info request) — but only as short
      // locker URLs. Legacy embedded data-URIs stay stripped: they are the
      // megabytes this strip exists for, and old rows re-upload on next edit.
      if (hasVarMedia) {
        c.variationRequestMedia = ((it as any).variationRequestMedia as any[]).filter(
          (m: any) => m && typeof (m as any)?.url === 'string' && !(m as any).url.startsWith('data:'),
        );
      }
      return c;
    });
    return touched ? { ...(e as any), items: out } : e;
  });
}
