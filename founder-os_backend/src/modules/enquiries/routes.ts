import { Enquiry, EnquiryStore, parseItemMedia } from "./store";
import type { MeResponse } from "../auth/types";
import { LiveEvent } from "../../live";
import { hashText, redactedCacheKey, REDACTED_CACHE_TTL_MS, type RedactedViewCache } from "./extract";
import { cacheGet } from "../../shared/cache";

/** v1 cache entries (description-only) predate the comments/requirements map —
 *  treat them as missing so they get re-enriched, never served. The `items`
 *  map (added later) defaults to {} so v2 entries stay valid. */
function asRedactedViewCache(e: unknown): RedactedViewCache | null {
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
 *  cached procurement rewrite. Must match the writer (runEnquiryExtraction).
 *  Media URLs pass through unredacted (technical drawings, same as the
 *  enquiry-level imageUrls) but ARE part of the hash, so a media change
 *  re-triggers enrichment and is never served stale. */
export function hashItem(item: { name: string; qty: string; spec: string; media?: Array<{ type: string; url: string }> }): string {
  const media = Array.isArray(item?.media)
    ? item.media.map((m) => `${m?.type === 'video' ? 'v' : 'i'}:${String(m?.url ?? '')}`)
    : [];
  return hashText(JSON.stringify([String(item?.name ?? ''), String(item?.qty ?? ''), String(item?.spec ?? ''), media]));
}

export interface EnquiryResult {
  status: number;
  body: any;
  live?: { type: string; extra: Record<string, unknown> };
}

const json = (status: number, body: any): EnquiryResult => ({ status, body });
const err = (message: string, status = 403): EnquiryResult => json(status, { error: message });

/**
 * Procurement-safe viewer check (mirrors the telecalling scoped-view pattern).
 * Full client PII + lead attribution is served ONLY to admins, MIS holders,
 * and sales-scope holders. Every other authenticated viewer (e.g. procurement
 * staff) gets the same pipeline with PII blanked and an empty agent roster —
 * enforced in the API, never just hidden in the UI.
 */
export function isRestrictedViewer(me: MeResponse): boolean {
  if (!me) return true;
  if (me.isAdmin || (me as any).isRoot) return false;
  const scopes: string[] = (me as any).scopes || [];
  if (scopes.includes('mis') || scopes.includes('sales')) return false;
  return true;
}

const PII_FIELDS = ['clientCompany', 'contactName', 'contactEmail', 'contactPhone', 'location', 'estNumber'] as const;

// Status is hidden from restricted viewers too, but it is NOT a scrub term:
// values like "new"/"won" would nuke ordinary words in free text.
const HIDDEN_FIELDS = ['status'] as const;

export function redactEnquiryPII<T extends Record<string, any>>(enquiry: T): T {
  const out: Record<string, any> = { ...enquiry };
  for (const f of [...PII_FIELDS, ...HIDDEN_FIELDS]) out[f] = '';
  return out as T;
}

// ── Procurement view: AI-only redaction ─────────────────────────────────────
// Restricted viewers NEVER receive raw free text. The procurement rewrite
// (description + per-comment) is produced by the SAME background AI call that
// populates the structured fields (see extract.ts + runEnquiryExtraction) and
// cached per enquiry in KV, verified piece-by-piece against source hashes.
// There is deliberately NO deterministic fallback: a piece whose cache is
// missing/stale is withheld (redactedPending) while a background
// re-enrichment is kicked — the route handlers below do that via the
// returned flag. Stored rows stay intact for sales + AI.

function pick(data: any): Partial<Enquiry> | null {
  const map: any = {
    estNumber: "estNumber", enquiryNumber: "enquiryNumber", sourceLead: "sourceLead", location: "location",
    clientCompany: "clientCompany", contactName: "contactName",
    contactEmail: "contactEmail", contactPhone: "contactPhone",
    title: "title", description: "description",
    priority: "priority", status: "status", assignedAgentId: "assignedAgentId",
    imageUrls: "imageUrls", activities: "activities",
  };
  const out: any = {};
  for (const [k, v] of Object.entries(map)) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  if (data.additionalRequirements !== undefined) {
    out.additionalRequirements = (Array.isArray(data.additionalRequirements) ? data.additionalRequirements : [])
      .map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
      .filter((r: any) => r.text.trim().length > 0);
  }
  if (data.items !== undefined) {
    out.items = (Array.isArray(data.items) ? data.items : [])
      .map((r: any) => ({
        name: String(r?.name ?? '').slice(0, 300),
        qty: String(r?.qty ?? '').slice(0, 120),
        spec: String(r?.spec ?? '').slice(0, 2000),
        media: parseItemMedia(r?.media),
      }))
      .filter((r: any) => String(r.name ?? '').trim() || String(r.qty ?? '').trim() || String(r.spec ?? '').trim() || r.media.length > 0)
      .slice(0, 100);
  }
  return Object.keys(out).length ? out : null;
}

export interface RedactOpts {
  redact?: boolean;
}

export async function enquiryList(store: EnquiryStore, me: MeResponse, opts?: RedactOpts): Promise<EnquiryResult> {
  const [enquiries, comments] = await Promise.all([store.listEnquiries(), store.listAllComments()]);
  if (!opts?.redact) return json(200, { enquiries, comments });
  // AI-only procurement view: each piece comes from the write-time enrichment
  // cache (RedactedViewCache) and only when its hash still matches the source.
  // Anything missing/stale is WITHHELD with redactedPending=true — the route
  // layer kicks a background re-enrichment and the client refetches on the
  // live event. Raw text is never served, and no deterministic fallback exists.
  const commentsByEnquiry = new Map<string, any[]>();
  for (const cm of comments as any[]) {
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
    if (entry && entry.descHash === hashText(String(e.description ?? '')) && typeof entry.description === 'string') {
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
    // Line items: sales stores the AI-split `items`; procurement gets the
    // cached per-item rewrite only when its hash still matches the sales item.
    // Media passes through unredacted (technical drawings, like enquiry-level
    // imageUrls). Stale/missing pieces are withheld (pending → re-enrichment).
    const salesItems: Array<{ name: string; qty: string; spec: string; media: Array<{ type: string; url: string }> }> =
      Array.isArray((e as any).items) ? (e as any).items : [];
    const servedItems: Array<{ name: string; qty: string; spec: string; media: Array<{ type: string; url: string }> }> = [];
    salesItems.forEach((it: any, i: number) => {
      const sales = {
        name: String(it?.name ?? ''),
        qty: String(it?.qty ?? ''),
        spec: String(it?.spec ?? ''),
        media: parseItemMedia(it?.media),
      };
      const cached = entry?.items?.[i];
      if (cached && cached.hash === hashItem(sales)
        && typeof cached.name === 'string' && typeof cached.qty === 'string' && typeof cached.spec === 'string') {
        servedItems.push({ name: cached.name, qty: cached.qty, spec: cached.spec, media: sales.media });
      } else {
        pending = true;
      }
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
  return json(200, {
    enquiries: redacted.map((r) => r.payload),
    comments: redacted.flatMap((r) => r.servedComments),
    // Route layer kicks a background re-enrichment for these (fire-and-forget).
    redactionPendingIds: redacted.filter((r) => r.entry.pending).map((r) => r.entry.id),
  });
}

export async function enquiryCreate(store: EnquiryStore, me: MeResponse, body: any): Promise<EnquiryResult> {
  // Only EST No. is mandatory — everything else is LLM-auto-filled from the
  // description/comments (extract.ts), so structured fields are optional.
  if (!body?.estNumber || String(body.estNumber).trim() === "") return json(400, { error: "estNumber required" });
  // Lead of = the agent who created the enquiry (no AI guessing). The creator
  // is the signed-in user; a provided agent still wins (e.g. root assigning).
  const creatorAgentId = String(me?.user?.id ?? "");
  const assignedAgentId = String(body.assignedAgentId || creatorAgentId || "");
  const enquiry = await store.createEnquiry({
    estNumber: String(body.estNumber).trim(),
    enquiryNumber: body.enquiryNumber,
    sourceLead: body.sourceLead,
    location: body.location,
    clientCompany: body.clientCompany,
    contactName: body.contactName,
    contactEmail: body.contactEmail || "",
    contactPhone: body.contactPhone || "",
    title: body.title,
    description: body.description,
    priority: body.priority || "medium",
    status: body.status || "new",
    assignedAgentId,
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls : [],
    activities: Array.isArray(body.activities) ? body.activities : [],
    additionalRequirements: (Array.isArray(body.additionalRequirements) ? body.additionalRequirements : [])
      .map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
      .filter((r: any) => r.text.trim().length > 0),
    items: (Array.isArray(body.items) ? body.items : [])
      .map((r: any) => ({
        name: String(r?.name ?? '').slice(0, 300),
        qty: String(r?.qty ?? '').slice(0, 120),
        spec: String(r?.spec ?? '').slice(0, 2000),
      }))
      .filter((r: any) => String(r.name ?? '').trim() || String(r.qty ?? '').trim() || String(r.spec ?? '').trim())
      .slice(0, 100),
  });
  return {
    status: 201,
    body: enquiry,
    live: { type: LiveEvent.Enquiries, extra: { action: "created", enquiry } },
  };
}

export async function enquiryAddRequirement(store: EnquiryStore, me: MeResponse, id: string, body: any): Promise<EnquiryResult> {
  const text = String(body?.text || "").trim();
  if (!text) return json(400, { error: "text required" });
  const imageUrl = body?.imageUrl ? String(body.imageUrl) : undefined;
  const existing = await store.getEnquiry(id);
  if (!existing) return json(404, { error: "not found" });
  const requirements = [...(existing.additionalRequirements || []), { text, imageUrl }];
  const enquiry = await store.updateEnquiry(id, { additionalRequirements: requirements });
  if (!enquiry) return json(404, { error: "not found" });
  return {
    status: 201,
    body: { requirement: { text, imageUrl }, enquiry },
    live: { type: LiveEvent.Enquiries, extra: { action: "requirement", id, requirement: { text, imageUrl }, enquiry } },
  };
}

export async function enquiryUpdate(store: EnquiryStore, me: MeResponse, id: string, body: any): Promise<EnquiryResult> {
  const updates = pick(body || {});
  if (!updates) return json(400, { error: "no valid fields" });
  // Items derive from the description: a description edit (without explicit
  // items) resets them so the background extraction re-splits fresh.
  // Explicit item saves (manual edit) carry `items` and are preserved.
  if ((updates as any).description !== undefined && (updates as any).items === undefined) {
    (updates as any).items = [];
  }
  const enquiry = await store.updateEnquiry(id, updates);
  if (!enquiry) return json(404, { error: "not found" });
  return {
    status: 200,
    body: enquiry,
    live: { type: LiveEvent.Enquiries, extra: { action: "updated", enquiry } },
  };
}

export async function enquiryDelete(store: EnquiryStore, me: MeResponse, id: string): Promise<EnquiryResult> {
  await store.deleteEnquiry(id);
  return { status: 200, body: { ok: true }, live: { type: LiveEvent.Enquiries, extra: { action: "deleted", id } } };
}

export async function enquiryComments(store: EnquiryStore, me: MeResponse, enquiryId: string, opts?: RedactOpts): Promise<EnquiryResult> {
  const list = await store.listComments(enquiryId);
  if (!opts?.redact) return json(200, list);
  // AI-only: serve cached rewrites whose hashes match; withhold the rest.
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
  return json(200, { comments: served, redactionPendingIds: pending ? [enquiryId] : [] });
}

export async function enquiryAddComment(store: EnquiryStore, me: MeResponse, enquiryId: string, body: any): Promise<EnquiryResult> {
  const content = String(body?.content || "").trim();
  if (!content) return json(400, { error: "content required" });
  const comment = await store.addComment({
    enquiryId,
    agentId: Number(body?.agentId) || 0,
    content,
    parentId: body?.parentId ? String(body.parentId) : null,
    imageUrl: body?.imageUrl ? String(body.imageUrl) : undefined,
  });
  return {
    status: 201,
    body: comment,
    live: { type: LiveEvent.Enquiries, extra: { action: "comment", comment } },
  };
}