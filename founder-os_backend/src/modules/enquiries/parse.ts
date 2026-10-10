// parse.ts — pure parsers/normalizers for the enquiry domain.
//
// Extracted from store.ts (no behavior change). Everything here is pure
// (no I/O): media/rate/thread parsing, money/quantity/ISO coercion, and the
// JSON-column parsers for items + requirements.
import type { Enquiry, EnquiryItem, EnquiryItemRate, EnquiryMedia, EnquiryRequirement, FlagThreadBy, FlagThreadEntry } from "./types";
import { normalizeEnquirySource } from "./types";

const THREAD_BY = new Set(['sales', 'procurement', 'management']);
const THREAD_KIND = new Set(['flag', 'remark', 'fix', 'request', 'quoted']);

export function parseFlagThread(raw: unknown): FlagThreadEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e: any) => ({
      by: (THREAD_BY.has(String(e?.by)) ? String(e.by) : 'sales') as FlagThreadBy,
      kind: (THREAD_KIND.has(String(e?.kind)) ? String(e.kind) : 'remark') as FlagThreadEntry['kind'],
      text: String(e?.text ?? '').slice(0, 2000),
      at: isoOrUndefined(e?.at) ?? new Date(0).toISOString(),
      media: parseItemMedia(e?.media),
    }))
    .filter((e: FlagThreadEntry) => e.text.trim().length > 0 || (e.media ?? []).length > 0)
    .slice(-50);
}

/** Normalize a visibility value from any writer (forge-proof). */
export function normalizeVisibility(v: unknown): 'sales' | 'procurement' {
  return String(v ?? '').trim().toLowerCase() === 'procurement' ? 'procurement' : 'sales';
}

/** ISO instant passthrough — invalid values dropped. */
export const isoOrUndefined = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/** Rate-row index passthrough — invalid values dropped. */
export const rateIdxOrUndefined = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  return Number.isInteger(n) && (n as number) >= 0 ? (n as number) : undefined;
};

/** Quantity keeps digits + units (`3 PCS`); anything without a digit → "". */
export function normalizeQty(v: unknown): string {
  const s = String(v ?? '').trim().slice(0, 120);
  return /\d/.test(s) ? s : '';
}

export const MAX_ITEM_MEDIA_URL_CHARS = 15_000_000;
export const MAX_ITEM_MEDIA_COUNT = 10;

export function parseItemMedia(raw: unknown): EnquiryMedia[] {
  if (!Array.isArray(raw)) return [];
  const shaped: EnquiryMedia[] = raw.map((m: any) => ({
    type: (m?.type === 'video' ? 'video' : m?.type === 'pdf' ? 'pdf' : 'image') as EnquiryMedia['type'],
    url: String(m?.url ?? ''),
    name: m?.name ? String(m.name).slice(0, 200) : undefined,
  }));
  return shaped
    .filter((m) => m.url.length > 0 && m.url.length <= MAX_ITEM_MEDIA_URL_CHARS)
    .slice(0, MAX_ITEM_MEDIA_COUNT);
}

export function parseDiscountPercent(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100) / 100;
}

export function parseItemRates(raw: unknown): EnquiryItemRate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any) => {
      const specSame = r?.specSame === false ? false : true;
      return {
        vendor: String(r?.vendor ?? '').slice(0, 200),
        rate: strictNum(r?.rate) ?? NaN,
        discountPercent: parseDiscountPercent(r?.discountPercent),
        description: r?.description ? String(r.description).slice(0, 2000) : undefined,
        salesNote: r?.salesNote ? String(r.salesNote).slice(0, 2000) : undefined,
        sharedWithSales: r?.sharedWithSales === true ? true : undefined,
        sharedFinalRate: (() => {
          const v = strictNum(r?.sharedFinalRate);
          return v !== undefined && v >= 0 ? v : undefined;
        })(),
        specSame,
        specDiff: !specSame && r?.specDiff ? String(r.specDiff).slice(0, 2000) : undefined,
        references: parseItemMedia(r?.references),
        quotedAt: isoOrUndefined(r?.quotedAt),
      };
    })
    .filter((r) => r.vendor.trim().length > 0 && Number.isFinite(r.rate) && r.rate >= 0)
    .slice(0, 50);
}

/** Strict numeric for money fields: plain digits + optional decimal only.
 *  Strips ₹/commas/spaces first ("₹1,200.50" → 1200.50). Rejects empties
 *  (Number('') is 0!), hex, exponents, trailing words. */
export const strictNum = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().replace(/[₹\s,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/** Signed variant for MARKUP only: net/below-cost rates carry a negative ₹
 *  markup (final below vendor cost). Same junk rejection as strictNum, but a
 *  leading `-` is accepted. Never use for prices themselves (vendor rate,
 *  final, expected) — those stay non-negative. */
export const strictSignedNum = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().replace(/[₹\s,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export const numOrUndefined = (v: unknown): number | undefined => strictNum(v);

/** Signed markup parse (see strictSignedNum). */
export const signedNumOrUndefined = (v: unknown): number | undefined => strictSignedNum(v);

export function parseItems(raw: string | null): EnquiryItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r: any) => ({
        name: String(r?.name ?? '').slice(0, 300),
        qty: normalizeQty(r?.qty).slice(0, 120),
        spec: String(r?.spec ?? '').slice(0, 2000),
        media: parseItemMedia(r?.media),
        category: r?.category ? String(r.category).slice(0, 120) : undefined,
        verbatim: r?.verbatim ? String(r.verbatim).slice(0, 500) : undefined,
        kypItem: r?.kypItem ? String(r.kypItem).slice(0, 120) : undefined,
        kypMissing: Array.isArray(r?.kypMissing) ? r.kypMissing.slice(0, 25).map((s: any) => String(s).slice(0, 500)) : undefined,
        kypComplete: typeof r?.kypComplete === 'boolean' ? r.kypComplete : undefined,
        rates: parseItemRates(r?.rates),
        selectedVendor: r?.selectedVendor ? String(r.selectedVendor).slice(0, 200) : undefined,
        selectedRateIdx: rateIdxOrUndefined(r?.selectedRateIdx),
        markup: signedNumOrUndefined(r?.markup),
        finalRate: numOrUndefined(r?.finalRate),
        finalDiscountPercent: parseDiscountPercent(r?.finalDiscountPercent),
        finalizedAt: isoOrUndefined(r?.finalizedAt),
        specIssue: r?.specIssue ? String(r.specIssue).slice(0, 2000) : undefined,
        specFlaggedAt: isoOrUndefined(r?.specFlaggedAt),
        rateAvailable: r?.rateAvailable === true,
        notAvailable: r?.notAvailable === true,
        notAvailableReason: r?.notAvailableReason ? String(r.notAvailableReason).slice(0, 500) : undefined,
        notAvailableAt: isoOrUndefined(r?.notAvailableAt),
        notAvailableRequested: r?.notAvailableRequested ? String(r.notAvailableRequested).slice(0, 500) : undefined,
        notAvailableRequestedAt: isoOrUndefined(r?.notAvailableRequestedAt),
        internalRates: r?.internalRates === true,
        internalRatesAt: isoOrUndefined(r?.internalRatesAt),
        thread: parseFlagThread(r?.thread),
        ratesRequested: r?.ratesRequested ? String(r.ratesRequested).slice(0, 500) : undefined,
        ratesRequestedAt: isoOrUndefined(r?.ratesRequestedAt),
        variationRequest: r?.variationRequest ? String(r.variationRequest).slice(0, 500) : undefined,
        variationRequestedAt: isoOrUndefined(r?.variationRequestedAt),
        variationRequestMedia: parseItemMedia(r?.variationRequestMedia),
        threadResolved: r?.threadResolved === true,
        threadResolvedBy: (['sales','procurement','management'] as const).includes(r?.threadResolvedBy) ? r.threadResolvedBy : undefined,
        threadResolvedAt: isoOrUndefined(r?.threadResolvedAt),
        aiPending: r?.aiPending === true ? true : undefined,
        expectedRate: numOrUndefined(r?.expectedRate),
        expectedNote: r?.expectedNote ? String(r.expectedNote).slice(0, 500) : undefined,
      }))
      .filter((r: EnquiryItem) => r.name.trim() || r.qty.trim() || r.spec.trim() || r.media.length > 0 || (r.rates ?? []).length > 0)
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function parseRequirements(raw: string | null): EnquiryRequirement[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
      .filter((r: EnquiryRequirement) => r.text.trim().length > 0);
  } catch {
    return [];
  }
}

/** Request-body → writable enquiry fields (whitelist + coerce). Pure input
 *  normalization for create/update: drops unknown keys, clamps lengths,
 *  parses nested item rows. Moved verbatim from routes.ts (Phase-1 split). */
export function pickEnquiryFields(data: any): Partial<Enquiry> | null {
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
        markup: signedNumOrUndefined(r?.markup),
        finalRate: numOrUndefined(r?.finalRate),
        finalDiscountPercent: parseDiscount(r?.finalDiscountPercent),
        finalizedAt: isoOrUndefined(r?.finalizedAt),
        specIssue: r?.specIssue ? String(r.specIssue).slice(0, 2000) : undefined,
        specFlaggedAt: isoOrUndefined(r?.specFlaggedAt),
        rateAvailable: r?.rateAvailable === true,
        notAvailable: (r as any)?.notAvailable !== undefined ? (r as any).notAvailable === true : undefined,
        notAvailableReason: (r as any)?.notAvailableReason !== undefined ? String((r as any).notAvailableReason).slice(0, 500) : undefined,
        notAvailableAt: isoOrUndefined((r as any)?.notAvailableAt),
        notAvailableRequested: (r as any)?.notAvailableRequested !== undefined ? String((r as any).notAvailableRequested).slice(0, 500) : undefined,
        notAvailableRequestedAt: isoOrUndefined((r as any)?.notAvailableRequestedAt),
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
        variationRequestMedia: (r as any)?.variationRequestMedia !== undefined ? parseItemMedia((r as any).variationRequestMedia) : undefined,
        thread: parseFlagThread(r?.thread),
        threadResolved: (r as any)?.threadResolved === true ? true : (r as any)?.threadResolved === false ? false : undefined,
        threadResolvedBy: (r as any)?.threadResolvedBy ? String((r as any).threadResolvedBy).slice(0, 20) : undefined,
        threadResolvedAt: isoOrUndefined((r as any)?.threadResolvedAt),
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


// ── Search identity (migration 0058) ─────────────────────────────────────────
// Write-maintained, lowercased, ≤2000 chars: scalars + description prefix +
// item names/qtys/specs/categories + vendor names. Deliberately EXCLUDED:
// media data-URIs (the megabytes), thread text, rates amounts, comments.
// The search path LIKEs this one tight column instead of sweeping blobs —
// the same exclusion Zoho enforces in COQL criteria (no Description, no line
// items, no Notes/Attachments in WHERE).
export function composeSearchText(e: any): string {
  const s = (v: unknown, n = 300): string => String(v ?? '').trim().slice(0, n);
  const parts: string[] = [
    s((e as any)?.estNumber, 40), s((e as any)?.enquiryNumber, 40),
    s((e as any)?.title), s((e as any)?.clientCompany), s((e as any)?.contactName),
    s((e as any)?.contactPhone, 40), s((e as any)?.sourceLead), s((e as any)?.location, 120),
    s((e as any)?.description, 300),
  ];
  for (const it of (Array.isArray((e as any)?.items) ? (e as any).items : [])) {
    parts.push(s(it?.name), s(it?.qty, 120), s(it?.spec, 500), s(it?.category, 120), s(it?.kypItem, 120));
    for (const r of (Array.isArray(it?.rates) ? it.rates : [])) parts.push(s(r?.vendor, 200));
  }
  for (const r of (Array.isArray((e as any)?.additionalRequirements) ? (e as any).additionalRequirements : [])) {
    parts.push(s(typeof r === 'string' ? r : r?.text));
  }
  return parts.map((p) => p.trim()).filter(Boolean).join(' | ').slice(0, 2000).toLowerCase();
}
