/**
 * Enquiry enrichment — edge-safe (Worker + Express share this).
 *
 * Runs the background AI extraction for one enquiry: fills empty structured
 * fields (title, company, contact…) and writes the procurement-view redaction
 * cache (KV). Never throws — enrichment must never fail a write path.
 *
 * Previously this lived only in src/server.ts, so production (Worker+D1)
 * never enriched: every new/edited enquiry stayed `redactedPending` for
 * procurement forever. Both runtimes now call this same function.
 */
import type { EnquiryStore } from "./store";
import {
  extractEnquiryFieldsRobust,
  hashText,
  splitExtractionText,
  redactedCacheKey,
  REDACTED_CACHE_TTL_MS,
  AI_ITEMS_ENABLED,
  type RedactedViewCache,
} from "./extract";
import { cacheSet } from "../../shared/cache";

// NOTE: hashItem lives in routes.ts (serve-time twin). Importing it here
// would cycle routes → enrichment. store.ts re-exports nothing… so we keep a
// local twin. It MUST match routes.ts hashItem (name|qty|spec + media urls).
function hashSalesItem(item: { name: string; qty: string; spec: string; media?: Array<{ type: string; url: string }> }): string {
  const media = Array.isArray(item?.media)
    ? item.media.map((m) => `${m?.type === 'video' ? 'v' : 'i'}:${String(m?.url ?? '')}`)
    : [];
  return hashText(JSON.stringify([String(item?.name ?? ''), String(item?.qty ?? ''), String(item?.spec ?? ''), media]));
}

export async function runEnquiryExtraction(env: Record<string, unknown>, store: EnquiryStore, id: string): Promise<void> {
  try {
    const enquiry = await store.getEnquiry(id);
    if (!enquiry) return;
    let comments: any[] = [];
    try { comments = await store.listComments(id); } catch { /* ignore */ }
    const firstComments = (comments || [])
      .slice(0, 2)
      .map((cm: any) => `${cm.content ?? ''}`)
      .join('\n');
    const reqTexts = Array.isArray((enquiry as any).additionalRequirements)
      ? (enquiry as any).additionalRequirements.map((r: any) => (typeof r === 'string' ? r : String(r?.text ?? '')))
      : [];
    const { text, description } = splitExtractionText(
      enquiry.description,
      firstComments,
      (comments || []).map((cm: any) => ({ id: String(cm.id ?? ''), content: String(cm.content ?? '') })),
      reqTexts,
    );
    const extracted = await extractEnquiryFieldsRobust(env, {
      text,
      title: enquiry.title,
      company: enquiry.clientCompany,
      description,
      salesItems: (Array.isArray((enquiry as any).items) ? (enquiry as any).items : []).map((it: any) => ({
        name: String(it?.name ?? ''),
        qty: String(it?.qty ?? ''),
        spec: String(it?.spec ?? ''),
      })),
    });
    if (!extracted) return;
    // Effective sales line items: manual edits win. AI auto-split is OFF
    // (AI_ITEMS_ENABLED); empty rows stay empty.
    const existingItems: Array<{ name: string; qty: string; spec: string }> =
      Array.isArray((enquiry as any).items) ? (enquiry as any).items : [];
    const salesItems = existingItems.length > 0
      ? existingItems
      : (AI_ITEMS_ENABLED && Array.isArray(extracted.items) ? extracted.items : []);
    // Procurement-view cache (v2): AI rewrites keyed by source hashes.
    if (extracted.redactedDescription) {
      try {
        const byId = new Map(((extracted.redactedComments ?? []) as Array<{ id: string; content: string }>).map((r) => [r.id, r.content]));
        const redactedComments: RedactedViewCache['comments'] = {};
        for (const cm of comments || []) {
          const cid = String((cm as any)?.id ?? '');
          if (!cid || !byId.has(cid)) continue;
          redactedComments[cid] = { content: byId.get(cid) as string, hash: hashText(String((cm as any)?.content ?? '')) };
        }
        const redactedRequirements: RedactedViewCache['requirements'] = {};
        for (const r of (extracted.redactedRequirements ?? []) as Array<{ index: number; text: string }>) {
          const src = reqTexts[r.index];
          if (src === undefined) continue;
          redactedRequirements[r.index] = { text: r.text, hash: hashText(src) };
        }
        const redactedItems: RedactedViewCache['items'] = {};
        for (const r of (extracted.redactedItems ?? []) as Array<{ index: number; name: string; qty: string; spec: string }>) {
          const src = (salesItems as any[])[r.index];
          if (src === undefined) continue;
          redactedItems[r.index] = {
            name: String(r.name ?? ''),
            qty: String(r.qty ?? ''),
            spec: String(r.spec ?? ''),
            hash: hashSalesItem(src),
          };
        }
        const entry: RedactedViewCache = {
          description: extracted.redactedDescription,
          descHash: hashText(description),
          comments: redactedComments,
          requirements: redactedRequirements,
          items: redactedItems,
          at: new Date().toISOString(),
        };
        await cacheSet(redactedCacheKey(id), entry, REDACTED_CACHE_TTL_MS);
      } catch { /* best-effort */ }
    }
    const updates: Record<string, any> = {};
    if (!enquiry.title && extracted.title) updates.title = extracted.title;
    if (!enquiry.enquiryNumber && extracted.enquiryNumber) updates.enquiryNumber = extracted.enquiryNumber;
    if (!enquiry.sourceLead && extracted.sourceLead) updates.sourceLead = extracted.sourceLead;
    if (!enquiry.location && extracted.location) updates.location = extracted.location;
    if (!enquiry.clientCompany && extracted.company) updates.clientCompany = extracted.company;
    if (!enquiry.contactName && extracted.contactName) updates.contactName = extracted.contactName;
    if (!enquiry.contactEmail && extracted.contactEmail) updates.contactEmail = extracted.contactEmail;
    if (!enquiry.contactPhone && extracted.contactPhone) updates.contactPhone = extracted.contactPhone;
    if (existingItems.length === 0 && salesItems.length > 0) updates.items = salesItems;
    if (Object.keys(updates).length) await store.updateEnquiry(id, updates);
  } catch (e: any) {
    try { console.error('enquiry extraction failed:', e?.message); } catch { /* noop */ }
  }
}

/** Fire-and-forget kick used by route handlers (Worker waitUntil / Express). */
export function kickEnquiryExtraction(env: Record<string, unknown>, store: EnquiryStore, id: string): void {
  try { void runEnquiryExtraction(env, store, id); } catch { /* ignore */ }
}
