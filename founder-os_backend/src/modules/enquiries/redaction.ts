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
  parseItemMedia,
  parseItemRates,
  signedNumOrUndefined,
} from "./parse";
import { parseLoopRecords, migrateItemLoops } from "./loops";
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
      // Sales negotiation target — procurement negotiates vendors toward
      // this (documented contract; the queue card renders it). Live
      // workflow data, never AI-rewritten, never PII.
      expectedRate: numOrUndefined((it as any)?.expectedRate),
      expectedNote: (it as any)?.expectedNote ? String((it as any).expectedNote).slice(0, 500) : undefined,
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
      // Size + expected target ride the same live path (never AI-rewritten).
      served = { name: cached.name, qty: cached.qty, spec: cached.spec, media: sales.media, rates: sales.rates, expectedRate: (sales as any).expectedRate, expectedNote: (sales as any).expectedNote };
    } else {
      // Markup decisions AND finalize timing stay Management-only.
      const { selectedVendor, markup, finalRate, finalizedAt, ...rest } = sales;
      served = rest;
    }
    // Rate-availability is live workflow metadata too.
    served.rateAvailable = (it as any)?.rateAvailable === true;
    served.notAvailable = (it as any)?.notAvailable === true;
    if ((it as any)?.notAvailableReason) served.notAvailableReason = String((it as any).notAvailableReason).slice(0, 500);
    if ((it as any)?.notAvailableAt) served.notAvailableAt = String((it as any).notAvailableAt);
    // Loop records are live workflow metadata (not PII, not a markup
    // decision): always overlay the stored values so an ask/answer never
    // waits on — or invalidates — the AI rewrite cache. Unmigrated legacy
    // rows read through migrateItemLoops (same as the queue compute).
    served.loops = migrateItemLoops({ ...(it as any), loops: parseLoopRecords((it as any)?.loops) });
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
// counts/chips read metadata, never urls). Loop records carry the same rule
// for their attachments. Full media returns on single-row reads
// (`enquiryGet` / `enquiryGetRedacted` below) — dashboard modals fetch the
// open row on demand.
const stripDataUris = (list: any[]): any[] =>
  (Array.isArray(list) ? list : []).filter(
    (m: any) => m && typeof (m as any)?.url === 'string' && !(m as any).url.startsWith('data:'),
  );

export function stripQueueMediaUrls(rows: any[]): any[] {
  return (rows ?? []).map((e: any) => {
    const items = Array.isArray((e as any)?.items) ? (e as any).items : null;
    if (!items) return e;
    let touched = false;
    const out = items.map((it: any) => {
      const hasMedia = Array.isArray((it as any)?.media) && (it as any).media.length > 0;
      const loops = Array.isArray((it as any)?.loops) ? (it as any).loops : [];
      const hasLoopMedia = loops.some((l: any) =>
        (Array.isArray(l?.media) && l.media.length > 0) || (Array.isArray(l?.answer?.media) && l.answer.media.length > 0));
      if (!hasMedia && !hasLoopMedia) return it;
      touched = true;
      const c: any = { ...(it as any) };
      if (hasMedia) c.media = [];
      // Loop attachments stay visible (asks + answers) — but only as short
      // locker URLs. Legacy embedded data-URIs stay stripped: they are the
      // megabytes this strip exists for, and old rows re-upload on next edit.
      if (hasLoopMedia) {
        c.loops = loops.map((l: any) => ({
          ...l,
          media: stripDataUris(l?.media),
          answer: l?.answer ? { ...l.answer, media: stripDataUris(l.answer.media) } : l.answer,
        }));
      }
      return c;
    });
    return touched ? { ...(e as any), items: out } : e;
  });
}
