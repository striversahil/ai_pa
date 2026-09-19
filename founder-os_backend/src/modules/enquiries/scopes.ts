// scopes.ts — authorization + margin policy + money validation + live summaries.
//
// Extracted from routes.ts (no behavior change). All PII/margin gating lives
// here so route handlers stay orchestration-only:
//
//   isRestrictedViewer — procurement-safe viewer check (full PII ONLY for
//     admin / mis / sales / enquiry-tracker scopes; everyone else redacted).
//   canManageRates   — privileged = admin / root / mis (markup + finalize).
//   redactEnquiryPII / stripMarginFields — response-shape guards (stored rows
//     untouched).
//   normalizeMoneyInput / validateRatesInput — money validation (400s, never
//     silent drops).
//   summarizeEnquiry / EnquiryLiveSummary — scope-safe EventHub payloads
//     (counts + label parts only, never PII/free text/rates).
//   resolveCreatorAgentId — lead inference (login email → roster row).
import type { MeResponse } from "../auth/types";
import { strictNum } from "./parse";

export function isRestrictedViewer(me: MeResponse): boolean {
  if (!me) return true;
  if (me.isAdmin || (me as any).isRoot) return false;
  const scopes: string[] = (me as any).scopes || [];
  if (scopes.includes('mis') || scopes.includes('sales') || scopes.includes('enquiry-tracker')) return false;
  return true;
}

const PII_FIELDS = ['clientCompany', 'contactName', 'contactEmail', 'contactPhone', 'location', 'estNumber'] as const;
const HIDDEN_FIELDS = ['status'] as const;

export function redactEnquiryPII<T extends Record<string, any>>(enquiry: T): T {
  const out: Record<string, any> = { ...enquiry };
  for (const f of [...PII_FIELDS, ...HIDDEN_FIELDS]) out[f] = '';
  return out as T;
}

/** Privileged = can decide markup + finalize rates (admin / root / MIS). */
export function canManageRates(me: MeResponse): boolean {
  if (!me) return false;
  if (me.isAdmin || (me as any).isRoot) return true;
  return ((me as any).scopes || []).includes('mis');
}

/** Margin fields are Management-only: non-privileged readers see final rates
 *  but never the chosen vendor NAME or the markup. Vendor-level discounts
 *  stay hidden; per-quote `selected` flag locates the decided row.
 *  Management-shared ALTERNATES reach sales anonymized: vendor name +
 *  vendor description blanked (they identify the source) — sales sees the
 *  option + green final rate + forwarded salesNote only.
 *  Item thread is the common sales↔procurement channel (per-item, always open,
 *  even after sent — negotiation stays separate). Sales sees thread but
 *  quoted entries with vendor names are stripped (internal). */
export function stripMarginFields<T extends Record<string, any>>(enquiry: T): T {
  if (!enquiry || !Array.isArray((enquiry as any).items)) return enquiry;
  return {
    ...(enquiry as any),
    items: (enquiry as any).items.map((it: any) => {
      if (!it || typeof it !== 'object') return it;
      const { selectedVendor, markup, ...rest } = it;
      if (Array.isArray((rest as any).rates)) {
        (rest as any).rates = (rest as any).rates.map((r: any) => {
          if (!r || typeof r !== 'object') return r;
          const { discountPercent, ...rr } = r;
          if (selectedVendor && r.vendor === selectedVendor) return { ...rr, selected: true };
          if ((r as any)?.sharedWithSales === true) {
            const { vendor, description, ...anon } = rr as any;
            void vendor;
            void description;
            return anon;
          }
          return rr;
        });
      }
      // Thread is common channel — keep for sales but strip internal quoted vendor leaks.
      if (Array.isArray((rest as any).thread)) {
        (rest as any).thread = (rest as any).thread.filter((e: any) => {
          if (e?.kind === 'quoted' && String(e?.by ?? '') !== 'sales') return false;
          return true;
        });
      }
      return rest;
    }),
  } as T;
}

/** Money input normalization: strips ₹/commas/spaces ("₹1,200.50" → 1200.50). */
export function normalizeMoneyInput(v: unknown): number | undefined {
  return strictNum(v);
}

/** Rate validation: vendor name + junk amount → 400 message, never silent drop. */
export function validateRatesInput(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  for (let i = 0; i < items.length; i++) {
    for (const f of ['markup', 'finalRate', 'expectedRate'] as const) {
      const raw = (items[i] as any)?.[f];
      if (raw !== undefined && raw !== null && raw !== '' && normalizeMoneyInput(raw) === undefined) {
        return `Item ${i + 1}: "${String(raw)}" is not a valid ${f === 'markup' ? 'markup' : f === 'finalRate' ? 'final rate' : 'expected price'} — use digits only`;
      }
    }
    const fd = (items[i] as any)?.finalDiscountPercent;
    if (fd !== undefined && fd !== null && fd !== '') {
      const n = Number(String(fd).trim());
      if (!Number.isFinite(n) || n < 0 || n > 100) return `Item ${i + 1}: discount must be 0–100%`;
    }
    const rates = (items[i] as any)?.rates;
    if (!Array.isArray(rates)) continue;
    for (let j = 0; j < rates.length; j++) {
      const r = rates[j] as any;
      if (!String(r?.vendor ?? '').trim()) continue;
      if (normalizeMoneyInput(r?.rate) === undefined) {
        return `Item ${i + 1}, quote ${j + 1}: "${String(r?.rate ?? '')}" is not a valid amount — use digits only (e.g. 1200 or 1200.50)`;
      }
      const d = r?.discountPercent;
      if (d !== undefined && d !== null && d !== '') {
        const n = Number(String(d).trim());
        if (!Number.isFinite(n) || n < 0 || n > 100) return `Item ${i + 1}, quote ${j + 1}: discount must be 0–100%`;
      }
    }
  }
  return null;
}

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
  threadCount: number;
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
  let threadCount = 0;
  for (const it of items) threadCount += Array.isArray((it as any)?.thread) ? (it as any).thread.length : 0;
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
    threadCount,
  };
}

/** Lead inference (telecalling creator-first pattern): login email → roster row. */
export async function resolveCreatorAgentId(prisma: any, me: MeResponse): Promise<string | null> {
  const email = String((me as any)?.user?.email ?? '').toLowerCase().trim();
  const name = String((me as any)?.user?.name ?? '').toLowerCase().trim();
  if (!email && !name) return null;
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
