// ── CRM ↔ sales region: which region owns a sales order ─────────────────────
//
// The sales team works by region ownership (R1–R4). A Zoho sales order only
// carries its EST number in `referenceNumber`, so the owning region is the one
// stamped on that estimate — the SAME source the Controller "Re-home" action
// rewrites. Resolving it here (not storing a manual copy) means a re-home is
// reflected on the next sync tick with no extra wiring.
//
// Cross-org rule (founder 2026-09-24, reused from the enquiry↔estimate link):
// BUI + DPG share the EST series. An order's Zoho org wins when that org has a
// row for the number; otherwise the estimate with the most recent Zoho date
// wins (`pickLatestEstimate`).
import { pickLatestEstimate } from '../enquiries/estimate-link';

export const ALL_REGIONS_TOKEN = 'all';
export const UNMAPPED_REGION = '';

/** Estimate rows indexed by their exact (trimmed) estimate number. */
export type EstimateRegionIndex = Map<string, any[]>;

export interface EstimateRegionRow {
  estimateNumber?: string;
  organizationId?: string;
  region?: string;
  date?: string;
  lastSyncTime?: string;
}

/** Build the lookup used by the sync tick. Exact number only — the Zoho SO
 *  reference is machine-written, so the tolerant case/whitespace scan the
 *  enquiry flow needs is not required here. */
export function buildEstimateRegionIndex(rows: EstimateRegionRow[]): EstimateRegionIndex {
  const index: EstimateRegionIndex = new Map();
  for (const row of rows || []) {
    const num = String(row?.estimateNumber ?? '').trim();
    if (!num) continue;
    const list = index.get(num) || [];
    list.push(row);
    index.set(num, list);
  }
  return index;
}

/** Region for one order. `org` = the order's Zoho organization id. */
export function resolveOrderRegion(
  index: EstimateRegionIndex,
  referenceNumber: unknown,
  org: unknown,
): string {
  const num = String(referenceNumber ?? '').trim();
  if (!num) return UNMAPPED_REGION;
  const rows = index.get(num) || [];
  if (!rows.length) return UNMAPPED_REGION;
  const wantOrg = String(org ?? '').trim();
  const pinned = wantOrg ? rows.find((r) => String(r?.organizationId ?? '') === wantOrg) : null;
  const picked = pinned || (rows.length === 1 ? rows[0] : pickLatestEstimate(rows as any[]));
  return String((picked as any)?.region ?? '').trim();
}

/** Does this order's region pass the viewer's region filter?
 *  `filter` semantics: 'all'/'' → everything, 'unmapped' → region '', else exact. */
export function regionMatches(orderRegion: unknown, filter: unknown): boolean {
  const want = String(filter ?? '').trim();
  if (!want || want === ALL_REGIONS_TOKEN) return true;
  const have = String(orderRegion ?? '').trim();
  if (want === 'unmapped') return have === UNMAPPED_REGION;
  return have === want;
}

/** Normalize a requested region filter to the API contract. */
export function normalizeRegionFilter(v: unknown): string {
  const raw = String(v ?? '').trim();
  if (!raw || raw.toLowerCase() === ALL_REGIONS_TOKEN) return ALL_REGIONS_TOKEN;
  if (raw.toLowerCase() === 'unmapped') return 'unmapped';
  return raw.toUpperCase();
}
