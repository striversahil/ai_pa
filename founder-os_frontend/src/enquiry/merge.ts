// enquiry/merge.ts — list→store media preservation (single source of truth).
//
// WHY: backend list/queue payloads STRIP items[].media BYTES for size
// (`redaction.ts` stripQueueMediaUrls) — only single-row reads
// (`GET /api/enquiries/:id`) carry full media. Every dashboard hydrates a row
// on open (mergeSingle / fetchSelFull), but the NEXT background merge — the
// 60s poll, a live 'enquiries'/'data-changed' event, or a KV-cached queue
// refetch — replaces that hydrated row with the media-less list copy, and the
// open photo silently vanishes ("shows once, gone after the cache API hit").
//
// Mirror of the backend write-path guard (`modules/enquiries/update.ts`
// isStaleEmpty, :379 + reference-media :170): an item whose INCOMING media is
// EMPTY must never overwrite stored media bytes. Incoming non-empty media
// always wins (fresh upload or a real removal). Pure + framework-free so all
// three surfaces (sales tracker, procurement queue, management review) share
// one rule. Keep in sync with the backend strip.
import type { Enquiry, EnquiryItem, EnquiryMedia } from '../types';

const mediaKey = (m: EnquiryMedia): string => `${m?.type ?? 'image'}:${String(m?.url ?? '')}`;
const isLockerUrl = (m: EnquiryMedia): boolean => !String(m?.url ?? '').startsWith('data:');
const itemIdentity = (it: EnquiryItem): string =>
  `${String(it?.name ?? '').trim()}|${String(it?.qty ?? '').trim()}|${String(it?.spec ?? '').trim()}`;

/** Carry stored media over one incoming media-stripped item. Returns the
 *  incoming item unchanged when no carry is needed (referential identity). */
export function mergeItemMedia(stored: EnquiryItem | undefined, incoming: EnquiryItem): EnquiryItem {
  if (!stored) return incoming;
  const inMedia = incoming.media ?? [];
  const stMedia = stored.media ?? [];
  const inVar = incoming.variationRequestMedia ?? [];
  // Never resurrect legacy embedded data: bytes (megabytes) — only short
  // locker URLs are safe to carry (same filter the backend applies).
  const stVar = (stored.variationRequestMedia ?? []).filter(isLockerUrl);
  const carryMedia = inMedia.length === 0 && stMedia.length > 0;
  const carryVar = inVar.length === 0 && stVar.length > 0;
  if (!carryMedia && !carryVar) return incoming;
  return {
    ...incoming,
    ...(carryMedia ? { media: stMedia } : {}),
    ...(carryVar ? { variationRequestMedia: stVar } : {}),
  };
}

/** Preserve stored item media on `fresh` when it arrived stripped.
 *  Items pair by (name|qty|spec) identity first — greedy, so duplicate lines
 *  match in order — then by index when the arrays align. */
export function preserveItemMedia(stored: Enquiry | null | undefined, fresh: Enquiry): Enquiry {
  const prevItems = stored?.items;
  const items = fresh?.items;
  if (!prevItems || prevItems.length === 0 || !Array.isArray(items) || items.length === 0) return fresh;
  const byId = new Map<string, EnquiryItem[]>();
  for (const it of prevItems) {
    const k = itemIdentity(it);
    const q = byId.get(k);
    if (q) q.push(it); else byId.set(k, [it]);
  }
  let changed = false;
  const merged = items.map((it, i) => {
    const q = byId.get(itemIdentity(it));
    const match = (q && q.length ? q.shift() : undefined)
      ?? (prevItems.length === items.length ? prevItems[i] : undefined);
    const out = mergeItemMedia(match, it);
    if (out !== it) changed = true;
    return out;
  });
  return changed ? { ...fresh, items: merged } : fresh;
}

/** Preserve hydrated media across an array merge: each `fresh` row pairs with
 *  the stored row of the same id. Used by the store's `merge` branches (polls,
 *  live events, queue refetches) so a list payload can't un-hydrate an open row. */
export function preserveRowsMedia(stored: Enquiry[], fresh: Enquiry[]): Enquiry[] {
  if (!Array.isArray(fresh) || fresh.length === 0 || !Array.isArray(stored) || stored.length === 0) return fresh;
  const byId = new Map(stored.map((e) => [e.id, e] as const));
  return fresh.map((row) => {
    const prev = byId.get(row.id);
    return prev ? preserveItemMedia(prev, row) : row;
  });
}
