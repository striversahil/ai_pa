import { Enquiry, EnquiryStore, parseItemMedia, parseItemRates, numOrUndefined, normalizeEnquirySource, nextDailyNo, isoOrUndefined, enquiryLabelText, normalizeQty, parseFlagThread, normalizeVisibility, type FlagThreadBy, type FlagThreadEntry } from "./store";
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
 * Full client PII + lead attribution + the agent roster is served ONLY to
 * admins, MIS holders, sales-scope holders, and holders of the
 * `enquiry-tracker` dashboard grant (the admin panel assigns that scope to
 * the sales role — without it, granted sales staff land in the restricted
 * view with an empty Lead By dropdown). Every other authenticated viewer
 * (e.g. procurement staff) gets the same pipeline with PII blanked and an
 * empty agent roster — enforced in the API, never just hidden in the UI.
 */
export function isRestrictedViewer(me: MeResponse): boolean {
  if (!me) return true;
  if (me.isAdmin || (me as any).isRoot) return false;
  const scopes: string[] = (me as any).scopes || [];
  if (scopes.includes('mis') || scopes.includes('sales') || scopes.includes('enquiry-tracker')) return false;
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
  // Source is editable (drives the label); the daily number is server-assigned
  // and never client-writable.
  if (data.source !== undefined) out.source = normalizeEnquirySource(data.source);
  if (data.additionalRequirements !== undefined) {
    out.additionalRequirements = (Array.isArray(data.additionalRequirements) ? data.additionalRequirements : [])
      .map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
      .filter((r: any) => r.text.trim().length > 0);
  }
  if (data.items !== undefined) {
    out.items = (Array.isArray(data.items) ? data.items : [])
      .map((r: any) => ({
        name: String(r?.name ?? '').slice(0, 300),
        qty: normalizeQty(r?.qty).slice(0, 120),
        spec: String(r?.spec ?? '').slice(0, 2000),
        media: parseItemMedia(r?.media),
        category: r?.category ? String(r.category).slice(0, 120) : undefined,
        verbatim: r?.verbatim ? String(r.verbatim).slice(0, 500) : undefined,
        rates: parseItemRates(r?.rates),
        selectedVendor: r?.selectedVendor ? String(r.selectedVendor).slice(0, 200) : undefined,
        markup: numOrUndefined(r?.markup),
        finalRate: numOrUndefined(r?.finalRate),
        finalizedAt: isoOrUndefined(r?.finalizedAt),
        specIssue: r?.specIssue ? String(r.specIssue).slice(0, 2000) : undefined,
        specFlaggedAt: isoOrUndefined(r?.specFlaggedAt),
        rateAvailable: r?.rateAvailable === true,
        internalRates: r?.internalRates === true,
        internalRatesAt: isoOrUndefined(r?.internalRatesAt),
        ratesRequested: r?.ratesRequested ? String(r.ratesRequested).slice(0, 500) : undefined,
        ratesRequestedAt: isoOrUndefined(r?.ratesRequestedAt),
        thread: parseFlagThread(r?.thread),
      }))
      .filter((r: any) => String(r.name ?? '').trim() || String(r.qty ?? '').trim() || String(r.spec ?? '').trim() || r.media.length > 0 || (r.rates ?? []).length > 0)
      .slice(0, 100);
  }
  if (data.rateStatus !== undefined) {
    const rs = String(data.rateStatus ?? '');
    if (['', 'rate_pending', 'rates_received', 'finalized', 'sent'].includes(rs)) (out as any).rateStatus = rs;
  }
  // Procurement handoff flag: ISO instant or '' (clear). Scope-enforced in
  // enquiryUpdate (sales can never touch it); validated here only.
  if (data.procurementSubmittedAt !== undefined) {
    const v = String(data.procurementSubmittedAt ?? '').trim();
    (out as any).procurementSubmittedAt = v ? (isoOrUndefined(v) ?? '') : '';
  }
  return Object.keys(out).length ? out : null;
}

/** Privileged = can decide markup + finalize rates (admin / root / MIS). */
export function canManageRates(me: MeResponse): boolean {
  if (!me) return false;
  if (me.isAdmin || (me as any).isRoot) return true;
  return ((me as any).scopes || []).includes('mis');
}

/** Margin fields are Management-only: non-privileged readers (sales AND
 *  procurement) see final rates but never the chosen vendor NAME or the
 *  markup. The chosen quote is flagged vendor-free (`selected: true`) so
 *  sales can render its reference attachments without ever seeing the name.
 *  Stored rows are untouched — only the API response. */
export function stripMarginFields<T extends Record<string, any>>(enquiry: T): T {
  if (!enquiry || !Array.isArray((enquiry as any).items)) return enquiry;
  return {
    ...(enquiry as any),
    items: (enquiry as any).items.map((it: any) => {
      if (!it || typeof it !== 'object') return it;
      const { selectedVendor, markup, ...rest } = it;
      if (selectedVendor && Array.isArray((rest as any).rates)) {
        (rest as any).rates = (rest as any).rates.map((r: any) =>
          r && typeof r === 'object' && r.vendor === selectedVendor ? { ...r, selected: true } : r);
      }
      return rest;
    }),
  } as T;
}

/** Money input normalization shared with validation: strips currency
 *  symbols, thousand separators and whitespace so "₹1,200.50" saves as
 *  1200.50 instead of being silently dropped by the strict parser. */
export function normalizeMoneyInput(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().replace(/[₹\s,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Rate validation: a vendor name with an unparseable amount is a 400 with a
 *  human message — never a silent drop (the old parse-then-filter made quotes
 *  "save" and then vanish). Vendor-less rows are still ignored. */
export function validateRatesInput(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  for (let i = 0; i < items.length; i++) {
    for (const f of ['markup', 'finalRate'] as const) {
      const raw = (items[i] as any)?.[f];
      if (raw !== undefined && raw !== null && raw !== '' && normalizeMoneyInput(raw) === undefined) {
        return `Item ${i + 1}: "${String(raw)}" is not a valid ${f === 'markup' ? 'markup' : 'final rate'} — use digits only`;
      }
    }
    const rates = (items[i] as any)?.rates;
    if (!Array.isArray(rates)) continue;
    for (let j = 0; j < rates.length; j++) {
      const r = rates[j] as any;
      if (!String(r?.vendor ?? '').trim()) continue;
      if (normalizeMoneyInput(r?.rate) === undefined) {
        return `Item ${i + 1}, quote ${j + 1}: "${String(r?.rate ?? '')}" is not a valid amount — use digits only (e.g. 1200 or 1200.50)`;
      }
    }
  }
  return null;
}

// ── Scope-safe live summaries ────────────────────────────────────────────────
// The EventHub fans out GLOBALLY (no per-user filtering), so live payloads
// must never carry PII or free text: no description, comments, requirements,
// client fields, or per-vendor rates. Every view refetches its own scoped
// payload on these events (debounced) instead of applying a full row.
export interface EnquiryLiveSummary {
  id: string;
  dailyNo: number | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  rateStatus: string;
  ratesCount: number;
  flaggedCount: number;
  specDiffCount: number;
  requestedCount: number;
}

export function summarizeEnquiry(e: any): EnquiryLiveSummary {
  const items = Array.isArray(e?.items) ? e.items : [];
  let ratesCount = 0;
  let flaggedCount = 0;
  let specDiffCount = 0;
  let requestedCount = 0;
  for (const it of items) {
    ratesCount += Array.isArray((it as any)?.rates) ? (it as any).rates.length : 0;
    if ((it as any)?.specIssue) flaggedCount += 1;
    if ((it as any)?.ratesRequested) requestedCount += 1;
    for (const r of (Array.isArray((it as any)?.rates) ? (it as any).rates : [])) {
      if ((r as any)?.specSame === false) specDiffCount += 1;
    }
  }
  return {
    id: String(e?.id ?? ''),
    dailyNo: e?.dailyNo === undefined || e?.dailyNo === null ? null : Number(e.dailyNo),
    source: String(e?.source ?? 'TL'),
    createdAt: String(e?.createdAt ?? ''),
    updatedAt: String((e as any)?.updatedAt ?? e?.createdAt ?? ''),
    title: String(e?.title ?? ''),
    rateStatus: String((e as any)?.rateStatus ?? ''),
    ratesCount,
    flaggedCount,
    specDiffCount,
    requestedCount,
  };
}

/** Lead inference (telecalling creator-first pattern): resolve the signed-in
 *  user to a sales agent via their email on the Telecaller roster. Falls
 *  back to Google display-name matching (roster rows often lack an email).
 *  Returns the telecaller id, or null when no roster row matches. */
export async function resolveCreatorAgentId(prisma: any, me: MeResponse): Promise<string | null> {
  const email = String((me as any)?.user?.email ?? '').toLowerCase().trim();
  const name = String((me as any)?.user?.name ?? '').toLowerCase().trim();
  if (!email && !name) return null;
  // Local-part comparison covers roster emails stored bare (`buisales4`)
  // vs full logins (`buisales4@…`), and vice versa.
  const local = (e: string): string => e.split('@')[0].trim();
  try {
    const roster = await prisma.telecaller.findMany();
    const rows = ((roster as any[]) ?? []).filter((t) => t && !t?.deleted);
    if (email) {
      const hit = rows.find((t) => {
        const e = String(t?.email ?? '').toLowerCase().trim();
        return e && (e === email || local(e) === local(email));
      });
      if (hit) return String(hit.id);
    }
    if (name) {
      const hit = rows.find((t) => String(t?.name ?? '').toLowerCase().trim() === name);
      if (hit) return String(hit.id);
    }
    return null;
  } catch {
    return null;
  }
}

export interface RedactOpts {
  redact?: boolean;
  /** 1-based page + page size for queue tables (10/50). Omit = full list. */
  page?: number;
  limit?: number;
  /** False when no AI keys are configured — the redacted view then withholds
   *  free text with an explicit badge instead of failing silently. */
  aiConfigured?: boolean;
}

export async function enquiryList(store: EnquiryStore, me: MeResponse, opts?: RedactOpts): Promise<EnquiryResult> {
  const page = Math.max(1, Math.floor(Number(opts?.page) || 0));
  const lim = Math.min(50, Math.max(1, Math.floor(Number(opts?.limit) || 0)));
  let enquiries: any[];
  let comments: any[];
  let total: number | null = null;
  if (page > 0 && (opts as any)?.limit !== undefined) {
    const offset = (page - 1) * lim;
    const paged = await store.listEnquiriesPaged(offset, lim);
    enquiries = paged.rows;
    total = paged.total;
    comments = await store.listCommentsFor(enquiries.map((e: any) => String(e.id)));
  } else {
    [enquiries, comments] = await Promise.all([store.listEnquiries(), store.listAllComments()]);
  }
  const meta = total === null ? {} : { total, page, limit: lim };
  if (!opts?.redact) {
    // Sales sees final rates but never margin internals (selectedVendor /
    // markup stay Management-only). Management (MIS) gets the full row.
    const privileged = canManageRates(me);
    const out = privileged ? enquiries : enquiries.map(stripMarginFields);
    return json(200, { enquiries: out, comments, ...meta });
  }
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
        markup: numOrUndefined(it?.markup),
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
      // Rate-availability is live workflow metadata too: the procurement queue
      // predicate depends on it, so it rides along regardless of cache path.
      served.rateAvailable = (it as any)?.rateAvailable === true;
      // Management rate-requests are live workflow metadata as well: overlay
      // stored values so the queue predicate never waits on the AI cache.
      if ((it as any)?.ratesRequested) {
        served.ratesRequested = String((it as any).ratesRequested).slice(0, 500);
        if ((it as any)?.ratesRequestedAt) served.ratesRequestedAt = String((it as any).ratesRequestedAt);
      }
      // Loop trail is live workflow metadata too: always the stored values.
      served.thread = parseFlagThread((it as any)?.thread);
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
  return json(200, {
    enquiries: redacted.map((r) => r.payload),
    comments: redacted.flatMap((r) => r.servedComments),
    // Route layer kicks a background re-enrichment for these (fire-and-forget).
    redactionPendingIds: redacted.filter((r) => r.entry.pending).map((r) => r.entry.id),
    // Explicit AI-down signal: when false, withheld text is an outage, not a
    // fresh enquiry — the queue shows a banner instead of silent blanks.
    aiConfigured: opts?.aiConfigured ?? true,
    ...meta,
  });
}

export async function enquiryCreate(store: EnquiryStore, me: MeResponse, body: any): Promise<EnquiryResult> {
  // EST No. is OPTIONAL (enter now or later) — only the row itself is created;
  // LLM auto-fill covers the structured fields, so everything is optional.
  const estNumber = String(body?.estNumber ?? "").trim();
  // Vendor quotes with junk amounts are rejected with a message — never
  // silently dropped (the old filter made quotes "save" then vanish).
  const rateError = validateRatesInput(body?.items);
  if (rateError) return json(400, { error: rateError });
  // Lead of = the agent who created the enquiry (no AI guessing). The
  // worker/express route pre-resolves the creator's roster row (login email,
  // then display name); a provided agent still wins (e.g. root assigning).
  // No roster match = unassigned ("") — never the auth-session id, which
  // belongs to a different id space and could resolve to the wrong person.
  const assignedAgentId = String(body.assignedAgentId || "");
  // Daily enquiry number: atomic Setting counter, resets every IST day
  // (concurrent creates can never share a number — the old max+1 scan raced).
  // Root test enquiries skip the sequence (founder rule): Enquiry No is for
  // sales staff only, and root never takes the By. Null renders as "–" in
  // the shared label, so test rows stay visibly distinct. Sales numbering
  // is untouched — the counter only advances on sales creates.
  const now = new Date();
  const dailyNo = me.isRoot
    ? null
    : await store.allocateDailyNo(now).catch(() => nextDailyNo([], now));
  const source = normalizeEnquirySource(body.source);
  // No Title field in the form: a blank title becomes the enquiry number text.
  const title = String(body?.title ?? "").trim()
    || enquiryLabelText(dailyNo, now.toISOString(), source);
  const enquiry = await store.createEnquiry({
    estNumber,
    dailyNo,
    source,
    enquiryNumber: body.enquiryNumber,
    sourceLead: body.sourceLead,
    location: body.location,
    clientCompany: body.clientCompany,
    contactName: body.contactName,
    contactEmail: body.contactEmail || "",
    contactPhone: body.contactPhone || "",
    title,
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
        qty: normalizeQty(r?.qty).slice(0, 120),
        spec: String(r?.spec ?? '').slice(0, 2000),
        media: parseItemMedia(r?.media),
        rates: parseItemRates(r?.rates),
        rateAvailable: r?.rateAvailable === true,
      }))
      .filter((r: any) => String(r.name ?? '').trim() || String(r.qty ?? '').trim() || String(r.spec ?? '').trim() || r.media.length > 0 || (r.rates ?? []).length > 0)
      .slice(0, 100),
    // New requirements arrive as Rate Pending (upgraded below if rates came along).
    rateStatus: 'rate_pending',
  });
  const created = enquiry as any;
  if ((created.items ?? []).some((it: any) => (it.rates ?? []).length > 0)) {
    await store.updateEnquiry(created.id, { rateStatus: 'rates_received' } as any);
    created.rateStatus = 'rates_received';
  }
  // Scope-safe broadcast: a summary only (counts + label parts) — never the
  // full row, which carries client PII to every connected screen.
  const summary = summarizeEnquiry(created);
  // Enquiry → Estimate creator sync: Lead of (Estimate.createdBy) is mapped
  // ENTIRELY from the enquiry agent (Enquiry.estNumber = Estimate.estimateNumber).
  // Overwrites always; fail-open so an enquiry save never fails on it.
  if (estNumber && assignedAgentId) {
    try {
      const { syncEstimateCreatorFromEnquiry } = await import('./estimate-link');
      await syncEstimateCreatorFromEnquiry(estNumber, assignedAgentId);
    } catch { /* fail-open */ }
  }
  const body_ = canManageRates(me) ? enquiry : stripMarginFields(enquiry as any);
  return {
    status: 201,
    body: body_,
    live: { type: LiveEvent.Enquiries, extra: { action: "created", id: created.id, summary } },
  };
}

export async function enquiryAddRequirement(store: EnquiryStore, me: MeResponse, id: string, body: any): Promise<EnquiryResult> {
  const text = String(body?.text || "").trim();
  const imageUrl = body?.imageUrl ? String(body.imageUrl) : undefined;
  if (!text && !imageUrl) return json(400, { error: "text required" });
  const existing = await store.getEnquiry(id);
  if (!existing) return json(404, { error: "not found" });
  // An additional requirement is simply a NEW LINE ITEM: appended to the
  // previous items with no vendor rates, so it shows up as rate-pending in
  // Procurement and then flows to Management Review like any other item.
  // (Legacy `additionalRequirements` rows stay readable; new adds go to items.)
  const newItem = {
    name: "",
    qty: "",
    spec: text.slice(0, 2000),
    media: parseItemMedia(imageUrl ? [{ type: "image", url: imageUrl }] : []),
    rates: [],
  };
  const patch: any = { items: [...((existing as any).items || []), newItem] };
  // A finalized enquiry with a new item has pending work again — reopen it so
  // the procurement queue (and, after rating, management review) picks it up.
  if ((existing as any).rateStatus === "finalized") patch.rateStatus = "rate_pending";
  const enquiry = await store.updateEnquiry(id, patch);
  if (!enquiry) return json(404, { error: "not found" });
  return {
    status: 201,
    body: { requirement: { text, imageUrl }, enquiry },
    live: { type: LiveEvent.Enquiries, extra: { action: "requirement", id, summary: summarizeEnquiry(enquiry) } },
  };
}

export async function enquiryUpdate(store: EnquiryStore, me: MeResponse, id: string, body: any): Promise<EnquiryResult> {
  const updates = pick(body || {});
  if (!updates) return json(400, { error: "no valid fields" });
  // Reject junk quote amounts with a message instead of dropping them.
  if (Array.isArray((body as any)?.items)) {
    const rateError = validateRatesInput((body as any).items);
    if (rateError) return json(400, { error: rateError });
  }
  // Items derive from manual entry (AI auto-split is permanently OFF):
  // a description edit preserves them; explicit item saves carry `items`.
  const privileged = canManageRates(me);
  const restricted = isRestrictedViewer(me);
  // Acting surface: privileged writers (MIS/admin) working inside the
  // procurement queue declare `surface: 'procurement'` so their trail stamps
  // read Procurement instead of Management. One-way only — a non-privileged
  // writer can never claim a higher role than their scopes allow.
  const declaredSurface = String((body as any)?.surface ?? '').trim().toLowerCase();
  const actingProcurement = restricted || (privileged && declaredSurface === 'procurement');
  const storedForItems = await store.getEnquiry(id).catch(() => null);
  const storedItems: any[] = Array.isArray((storedForItems as any)?.items) ? (storedForItems as any).items : [];
  if (Array.isArray((updates as any).items)) {
    // Item lifecycles (rates/spec/thread per role) — see update.ts.
    const { normalizeItemWrites } = await import('./update');
    (updates as any).items = normalizeItemWrites((updates as any).items, {
      storedItems, privileged, restricted, actingProcurement,
    });
  }
  // Submit-to-Management lifecycle + reopen + auto-finalize — see update.ts.
  {
    const { applyRateLifecycles } = await import('./update');
    applyRateLifecycles(updates, { storedForItems, storedItems, privileged, restricted });
  }
  // Completeness gate (all writers): 'finalized' / 'sent' are enquiry-level
  // commitments, but decisions are per-item. Refuse to close an enquiry
  // while any loop item (correct spec, rate not already available) still
  // lacks a final rate — otherwise a partial finalize/sent looks complete
  // to Sales and locks the Management panel (locked = finalized || sent)
  // with undecided items stranded inside it. Partial work must stay on
  // plain item saves; finalize/sent unlock only at 100%.
  if ((updates as any).rateStatus === 'finalized' || (updates as any).rateStatus === 'sent') {
    const merged: any[] = Array.isArray((updates as any).items)
      ? (updates as any).items
      : (Array.isArray((storedForItems as any)?.items) ? (storedForItems as any).items : []);
    const loop = merged.filter((it) => !it?.specIssue && !it?.rateAvailable);
    const done = loop.filter((it) =>
      it?.finalRate !== undefined && it?.finalRate !== null && Number.isFinite(Number(it?.finalRate)));
    if (done.length < loop.length) {
      const verb = (updates as any).rateStatus === 'sent' ? 'mark as sent' : 'finalize';
      return json(400, {
        error: `Only ${done.length} of ${loop.length} items have final rates — decide every item before you ${verb}`,
      });
    }
  }
  if (!privileged) {
    // Sales "Mark as sent": finalized → sent, and only with an EST No. on
    // the row. Anything else rateStatus-wise stays Management-only.
    if ((updates as any).rateStatus === 'sent') {
      const current = await store.getEnquiry(id).catch(() => null);
      if (!current) return json(404, { error: 'not found' });
      if (String((current as any).rateStatus ?? '') !== 'finalized') {
        return json(400, { error: 'Only finalized enquiries can be marked as sent' });
      }
      if (!String((current as any).estNumber ?? '').trim()) {
        return json(400, { error: 'Add EST No. before marking as sent', needEstNumber: true });
      }
    } else {
      delete (updates as any).rateStatus;
    }
  }
  // Auto-advance the workflow: first vendor rate moves Rate Pending → Received.
  // Finalized is set explicitly by Management (guarded above) — except the
  // all-available case below, which no role can produce by hand.
  if ((updates as any).rateStatus === undefined) {
    const current = await store.getEnquiry(id).catch(() => null);
    const mergedItems = Array.isArray((updates as any).items)
      ? (updates as any).items
      : ((current as any)?.items ?? []);
    const cur = String((current as any)?.rateStatus ?? '');
    if ((cur === '' || cur === 'rate_pending') && mergedItems.some((it: any) => ((it as any).rates ?? []).length > 0)) {
      (updates as any).rateStatus = 'rates_received';
    }
    // All-quoted shortcut (any writer): every item rate-available with no
    // open spec flag means nothing left to decide — no procurement queue,
    // no management decision. Flip straight to finalized so Mark as Sent
    // enables in realtime on the same save. Empty rows and flagged rows
    // never flip (flags must resolve first).
    if ((cur === '' || cur === 'rate_pending' || cur === 'rates_received')
      && mergedItems.length > 0
      && mergedItems.every((it: any) => it?.rateAvailable === true)
      && !mergedItems.some((it: any) => it?.specIssue)) {
      (updates as any).rateStatus = 'finalized';
    }
    // Late-quote reopen (any writer): a new vendor quote on a finalized row
    // clears that item's committed decision (see update.ts) and drops the
    // enquiry back to rates_received — sales is notified via live event,
    // management re-decides. Sent rows never reopen.
    if (cur === 'finalized') {
      const { applyLateQuoteReopen } = await import('./update');
      if (
        applyLateQuoteReopen(updates, {
          storedItems,
          storedRateStatus: cur,
          actedBy: actingProcurement ? 'procurement' : privileged ? 'management' : 'sales',
        })
      ) {
        (updates as any).rateStatus = 'rates_received';
      }
    }
  }
  const enquiry = await store.updateEnquiry(id, updates);
  if (!enquiry) return json(404, { error: "not found" });
  // Keep the linked Zoho estimate's creator in sync: enquiry agent always wins.
  // When the EST No. itself changed (or was cleared), reconcile the OLD
  // number too — otherwise its By goes stale with no mapping behind it.
  try {
    const { syncEstimateCreatorFromEnquiry, reconcileEstimateCreator } = await import('./estimate-link');
    const finalEst = String((enquiry as any)?.estNumber ?? '').trim();
    const prevEst = String((storedForItems as any)?.estNumber ?? '').trim();
    const nextAgent = (updates as any)?.assignedAgentId !== undefined
      ? String((updates as any).assignedAgentId ?? '')
      : String((enquiry as any)?.assignedAgentId ?? '');
    if (finalEst && nextAgent.trim()) await syncEstimateCreatorFromEnquiry(finalEst, nextAgent);
    if (prevEst && prevEst !== finalEst) await reconcileEstimateCreator(prevEst);
  } catch { /* fail-open */ }
  const canSeeMargins = canManageRates(me);
  return {
    status: 200,
    body: canSeeMargins ? enquiry : stripMarginFields(enquiry as any),
    live: { type: LiveEvent.Enquiries, extra: { action: "updated", id, summary: summarizeEnquiry(enquiry) } },
  };
}

export async function enquiryDelete(store: EnquiryStore, me: MeResponse, id: string): Promise<EnquiryResult> {
  const doomed = await store.getEnquiry(id).catch(() => null);
  await store.deleteEnquiry(id);
  // Unlink: the deleted row's EST No. must not keep a stale By behind.
  try {
    const num = String((doomed as any)?.estNumber ?? '').trim();
    if (num) {
      const { reconcileEstimateCreator } = await import('./estimate-link');
      await reconcileEstimateCreator(num);
    }
  } catch { /* fail-open */ }
  return { status: 200, body: { ok: true }, live: { type: LiveEvent.Enquiries, extra: { action: "deleted", id } } };
}

/**
 * Scoped single-row read for live merge: the broadcast carries ids only, so
 * each view fetches the one changed row (server-scoped) instead of the full
 * list. Restricted (procurement) viewers get 403 here — their redacted
 * payload only comes from the list endpoint; the frontend keeps the
 * debounced list refetch for that view.
 */
export async function enquiryGet(store: EnquiryStore, me: MeResponse, id: string): Promise<EnquiryResult> {
  if (isRestrictedViewer(me)) return json(403, { error: "restricted", restricted: true });
  const enquiry = await store.getEnquiry(id).catch(() => null);
  if (!enquiry) return json(404, { error: "not found" });
  const comments = await store.listComments(id).catch(() => []);
  const body = canManageRates(me) ? enquiry : stripMarginFields(enquiry as any);
  return json(200, { enquiry: body, comments });
}

export async function enquiryComments(store: EnquiryStore, me: MeResponse, enquiryId: string, opts?: RedactOpts): Promise<EnquiryResult> {
  const all = await store.listComments(enquiryId);
  // Procurement sees only the shared ops thread; sales/management see both.
  const list = opts?.redact
    ? (all as any[]).filter((cm) => normalizeVisibility((cm as any)?.visibility) === 'procurement')
    : all;
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
  return json(200, { comments: served, redactionPendingIds: pending ? [enquiryId] : [], aiConfigured: opts?.aiConfigured ?? true });
}

/** Intake panel (unstructured intake → items + price-memory suggestions).
 *  Stored by the GH intake runner at `enquiry:intake:<id>` (7d TTL).
 *  Restricted (procurement) viewers get names/routes/missing only — final
 *  rates stay out of their payload, same margin policy as stripMarginFields. */
export async function enquiryIntake(me: MeResponse, enquiryId: string): Promise<EnquiryResult> {
  let raw: unknown = null;
  try {
    raw = await cacheGet<Record<string, any>>(`enquiry:intake:${enquiryId}`, 7 * 24 * 60 * 60 * 1000);
  } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return json(200, { ready: false });
  const restricted = isRestrictedViewer(me);
  const suggestions = (Array.isArray((raw as any).suggestions) ? (raw as any).suggestions : []).map((s: any) => {
    const base: Record<string, unknown> = {
      itemIndex: s?.itemIndex, memoryId: s?.memoryId, score: s?.score, name: s?.name, route: s?.route,
    };
    if (!restricted && s?.finalRate !== undefined) base.finalRate = s.finalRate;
    return base;
  });
  return json(200, {
    ready: true,
    at: (raw as any).at ?? null,
    suggestions,
    missing: Array.isArray((raw as any).missing) ? (raw as any).missing : [],
    candidates: restricted ? [] : (Array.isArray((raw as any).candidates) ? (raw as any).candidates : []),
  });
}
export async function enquiryAddComment(store: EnquiryStore, me: MeResponse, enquiryId: string, body: any): Promise<EnquiryResult> {
  const content = String(body?.content || "").trim();
  if (!content) return json(400, { error: "content required" });
  // Scope: restricted (procurement) writers can only post to the shared ops
  // thread; sales/management choose, defaulting to their private thread.
  // Replies inherit the parent's scope — cross-scope replies are rejected.
  let visibility = isRestrictedViewer(me) ? 'procurement' : normalizeVisibility(body?.visibility);
  const parentId = body?.parentId ? String(body.parentId) : null;
  if (parentId) {
    const siblings = await store.listComments(enquiryId).catch(() => []);
    const parent = (siblings as any[]).find((cm) => String(cm?.id) === parentId);
    if (!parent) return json(400, { error: "parent comment not found" });
    visibility = normalizeVisibility((parent as any)?.visibility);
  }
  const comment = await store.addComment({
    enquiryId,
    agentId: Number(body?.agentId) || 0,
    content,
    parentId,
    imageUrl: body?.imageUrl ? String(body.imageUrl) : undefined,
    visibility,
  } as any);
  // Scope-safe: comment content is free text (never broadcast); receivers
  // refetch the scoped thread instead.
  const updated = await store.getEnquiry(enquiryId).catch(() => null);
  return {
    status: 201,
    body: comment,
    live: {
      type: LiveEvent.Enquiries,
      extra: { action: "comment", id: (comment as any).id, enquiryId, visibility, summary: updated ? summarizeEnquiry(updated) : undefined },
    },
  };
}