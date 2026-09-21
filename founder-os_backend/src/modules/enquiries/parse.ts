// parse.ts — pure parsers/normalizers for the enquiry domain.
//
// Extracted from store.ts (no behavior change). Everything here is pure
// (no I/O): media/rate/thread parsing, money/quantity/ISO coercion, and the
// JSON-column parsers for items + requirements.
import type { EnquiryItem, EnquiryItemRate, EnquiryMedia, EnquiryRequirement, FlagThreadBy, FlagThreadEntry } from "./types";

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

export const numOrUndefined = (v: unknown): number | undefined => strictNum(v);

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
        markup: numOrUndefined(r?.markup),
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
