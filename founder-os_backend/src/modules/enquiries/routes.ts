// routes.ts — enquiry CRUD orchestrator (thin).
//
// Domain logic lives in focused modules; this file only wires store calls,
// scope checks, and live broadcasts:
//   types.ts    — row/item/comment/thread shapes + daily-no/label helpers
//   parse.ts    — pure parsers (media/rates/thread/qty/money/ISO)
//   queues.ts   — queue predicates (which enquiry sits in which dashboard)
//   scopes.ts   — authz (isRestrictedViewer/canManageRates), margin policy,
//                 money validation, live summaries, creator-agent resolve
//   redaction.ts— procurement-safe AI redaction cache (hash-verified)
//   update.ts   — item lifecycles (normalizeItemWrites/applyRateLifecycles/…)
//   store.ts    — persistence (D1/Memory/Prisma via store-prisma.ts)
// Re-exports below preserve existing `EnquiryRoutes.*` import paths.
import type { Enquiry, EnquiryStore, FlagThreadBy, FlagThreadEntry } from "./types";
import {
  parseItemMedia,
  parseItemRates,
  numOrUndefined,
  rateIdxOrUndefined,
  normalizeQty,
  parseFlagThread,
  normalizeVisibility,
  isoOrUndefined,
} from "./parse";
import { normalizeEnquirySource, nextDailyNo, enquiryLabelText } from "./types";
import {
  isRestrictedViewer,
  canManageRates,
  redactEnquiryPII,
  stripMarginFields,
  normalizeMoneyInput,
  validateRatesInput,
  summarizeEnquiry,
  resolveCreatorAgentId,
  type EnquiryLiveSummary,
} from "./scopes";
import { asRedactedViewCache, hashItem } from "./redaction";
export {
  isRestrictedViewer,
  canManageRates,
  redactEnquiryPII,
  stripMarginFields,
  normalizeMoneyInput,
  validateRatesInput,
  summarizeEnquiry,
  resolveCreatorAgentId,
  asRedactedViewCache,
  hashItem,
};
export type { EnquiryLiveSummary };
import type { MeResponse } from "../auth/types";
import { LiveEvent } from "../../live";
import { hashText, redactedCacheKey, REDACTED_CACHE_TTL_MS, type RedactedViewCache } from "./extract";
import { cacheGet } from "../../shared/cache";
import { linkEnquiryEstimate } from "../../automations/telecalling/service";

export interface EnquiryResult {
  status: number;
  body: any;
  live?: { type: string; extra: Record<string, unknown> };
}

const json = (status: number, body: any): EnquiryResult => ({ status, body });
const err = (message: string, status = 403): EnquiryResult => json(status, { error: message });

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
    const parseDiscount = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      const n = Number(String(v).trim());
      if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
      return Math.round(n * 100) / 100;
    };
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
        selectedRateIdx: rateIdxOrUndefined(r?.selectedRateIdx),
        markup: numOrUndefined(r?.markup),
        finalRate: numOrUndefined(r?.finalRate),
        finalDiscountPercent: parseDiscount(r?.finalDiscountPercent),
        finalizedAt: isoOrUndefined(r?.finalizedAt),
        specIssue: r?.specIssue ? String(r.specIssue).slice(0, 2000) : undefined,
        specFlaggedAt: isoOrUndefined(r?.specFlaggedAt),
        rateAvailable: r?.rateAvailable === true,
        internalRates: r?.internalRates === true,
        internalRatesAt: isoOrUndefined(r?.internalRatesAt),
        // ""-preserving: management withdraws a rate request by saving an
        // explicit empty string (mirrors variationRequest below). Absent =
        // leave stored; answering procurement clears via rate change.
        ratesRequested: (r as any)?.ratesRequested !== undefined ? String((r as any).ratesRequested).slice(0, 500) : undefined,
        ratesRequestedAt: isoOrUndefined(r?.ratesRequestedAt),
        // ""-preserving (unlike the fields above): sales withdraws a
        // variation request by saving an explicit empty string.
        variationRequest: (r as any)?.variationRequest !== undefined ? String((r as any).variationRequest).slice(0, 500) : undefined,
        thread: parseFlagThread(r?.thread),
        // Detail-view "Add via AI" flag — the GH intake action replaces
        // these raw rows with vision-split lines (applyIntakeBulkResult).
        // Dropped here, the runner computes lines the merge then discards.
        aiPending: r?.aiPending === true ? true : undefined,
        // Sales-owned negotiation target (client-expected price + note).
        expectedRate: numOrUndefined(r?.expectedRate),
        expectedNote: r?.expectedNote ? String(r.expectedNote).slice(0, 500) : undefined,
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
      // Sales alternate-requests are live workflow metadata too: procurement
      // must see them (banner + queue) the moment sales asks — never gated
      // on the AI rewrite cache.
      if ((it as any)?.variationRequest) {
        served.variationRequest = String((it as any).variationRequest).slice(0, 500);
        if ((it as any)?.variationRequestedAt) served.variationRequestedAt = String((it as any).variationRequestedAt);
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
    enquiryNumber: String(body?.enquiryNumber ?? ""),
    sourceLead: String(body?.sourceLead ?? ""),
    location: String(body?.location ?? ""),
    clientCompany: String(body?.clientCompany ?? ""),
    contactName: String(body?.contactName ?? ""),
    contactEmail: String(body?.contactEmail ?? ""),
    contactPhone: String(body?.contactPhone ?? ""),
    title,
    description: String(body?.description ?? ""),
    priority: String(body?.priority ?? "medium"),
    status: String(body?.status ?? "new"),
    assignedAgentId,
    rateStatus: 'rate_pending',
    procurementSubmittedAt: "",
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
    });
  const created = enquiry as any;
  if ((created.items ?? []).some((it: any) => (it.rates ?? []).length > 0)) {
    await store.updateEnquiry(created.id, { rateStatus: 'rates_received' } as any);
    created.rateStatus = 'rates_received';
  }
  // Enquiry-linked estimate attribution: a Zoho estimate number on the row
  // assigns that estimate to this enquiry's agent when it is free (never
  // steals, never fails the save — a not-yet-synced estimate is picked up by
  // the daily sweep in runLeadConversion).
  if (estNumber && assignedAgentId) {
    await linkEnquiryEstimate({
      estimateNumber: estNumber,
      agentId: assignedAgentId,
      label: `enquiry ${String(created.enquiryNumber ?? created.id)}`,
    }).catch(() => undefined);
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
  // Items derive from manual entry — except `aiPending` raw items from the
  // detail-view "Add via AI" flow, which the GH intake action replaces with
  // vision-split lines (see applyIntakeBulkResult): a description edit
  // preserves them; explicit item saves carry `items`.
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
    // Every non-held item must have either a vendor rate or be marked
    // rateAvailable — otherwise a half-quoted enquiry could be finalized/sent.
    // Sales saw this as "Mark as sent works even though some items have no
    // rates" (2026-09-17). Block here so both roles get the same hard gate.
    const missingRates = merged.filter((it) => !it?.specIssue && !it?.rateAvailable && !it?.internalRates && ((it as any)?.rates ?? []).length === 0);
    if (missingRates.length > 0) {
      const verb = (updates as any).rateStatus === 'sent' ? 'mark as sent' : 'finalize';
      return json(400, {
        error: `${missingRates.length} item${missingRates.length === 1 ? "" : "s"} still need vendor rates (or mark rate available) before you ${verb}`,
      });
    }
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
    // Late-quote note (any writer): a new vendor quote on a finalized row
    // KEEPS the committed decision so sales keeps the previous rate (see
    // update.ts) — rateStatus stays `finalized`. Management is notified via
    // live event + thread entry and revises only if needed. Sent rows never
    // reopen.
    if (cur === 'finalized') {
      const { applyLateQuoteReopen } = await import('./update');
      applyLateQuoteReopen(updates, {
        storedItems,
        storedRateStatus: cur,
        actedBy: actingProcurement ? 'procurement' : privileged ? 'management' : 'sales',
      });
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