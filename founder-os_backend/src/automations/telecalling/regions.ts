// regions.ts — pure region taxonomy for the region-owned sales model.
//
// Mirror: founder-os_frontend/src/telecalling/regions.ts — change both
// together, same names + semantics. No I/O here: constants + validators only.
//
// Model (founder decision, 2026-10-22): estimates are owned by REGIONS, not
// individuals. Staff hold/work estimates only in their own region. The
// Telecaller roster carries `region` (R1–R4) + `tlLevel` (TL1/TL2); an
// Estimate's `region` is stamped from the creating staff's roster row via the
// mapping enquiry (Enquiry.estNumber = Estimate.estimateNumber). Unmapped
// stays '' and lands in the dashboard's Unmapped bucket.

export type RegionId = 'R1' | 'R2' | 'R3' | 'R4';
export type TlLevel = 'TL1' | 'TL2' | '';

export interface RegionDef {
  id: RegionId;
  name: string;
  /** Team-lead tier that owns this region's team. */
  tl: 'TL1' | 'TL2';
  states: string[];
}

/** Region table (founder-supplied, 2026-10-22) — display + grouping only. */
export const REGIONS: RegionDef[] = [
  {
    id: 'R1',
    name: 'North & NCR Region',
    tl: 'TL1',
    states: ['Delhi', 'Haryana', 'Punjab', 'Chandigarh', 'Uttarakhand'],
  },
  {
    id: 'R2',
    name: 'North-Central & Himalayan Belt Region',
    tl: 'TL2',
    states: ['Uttar Pradesh', 'Himachal Pradesh', 'Jammu & Kashmir', 'Ladakh'],
  },
  {
    id: 'R3',
    name: 'West & Central Region',
    tl: 'TL2',
    states: ['Rajasthan', 'Gujarat', 'Madhya Pradesh', 'Maharashtra', 'Goa'],
  },
  {
    id: 'R4',
    name: 'South, East & Northeast Region',
    tl: 'TL1',
    states: [
      'Tamil Nadu', 'Karnataka', 'Telangana', 'Andhra Pradesh', 'Kerala',
      'Puducherry', 'West Bengal', 'Assam', 'Bihar', 'Odisha', 'Jharkhand',
      'Chhattisgarh', 'Nepal', 'Northeast States',
    ],
  },
];

export const REGION_IDS: RegionId[] = REGIONS.map((r) => r.id);
export const TL_LEVELS: Array<'TL1' | 'TL2'> = ['TL1', 'TL2'];

/** ₹ each TL1 owes per working day of RESELLER accepted value (founder
 *  decision 2026-11-05) — same ₹1L/day as the region end-consumer target,
 *  same weekly carry-forward ledger (targets.ts). */
export const DAILY_TL_RESELLER_TARGET = 100_000;

export function isValidRegion(v: unknown): v is RegionId {
  return REGION_IDS.includes(String(v ?? '').trim() as RegionId);
}

export function isValidTlLevel(v: unknown): v is 'TL1' | 'TL2' {
  return String(v ?? '').trim() === 'TL1' || String(v ?? '').trim() === 'TL2';
}

export function regionDef(id: string): RegionDef | null {
  return REGIONS.find((r) => r.id === id) ?? null;
}

/**
 * Regions a roster row works (founder rule 2026-11-05: a TL1 handles TWO
 * regions at once — primary `region` + secondary `region2`, pair decided by
 * the sales-head). TL2s / unset rows return at most one. Anything outside
 * R1–R4 is dropped so a stale value never credits a stranger's sales.
 */
export function tlRegions(t: { region?: unknown; region2?: unknown }): RegionId[] {
  const out: RegionId[] = [];
  for (const v of [t?.region, t?.region2]) {
    const s = String(v ?? '').trim();
    if (isValidRegion(s) && !out.includes(s as RegionId)) out.push(s as RegionId);
  }
  return out;
}

/** Validate a TL's region pair for roster writes. TL1 needs exactly two
 *  DISTINCT valid regions; everyone else needs at most one (region2 must
 *  stay empty). Returns an error string, or null when the pair is fine. */
export function tlPairError(tlLevel: unknown, region: unknown, region2: unknown): string | null {
  const tl = String(tlLevel ?? '').trim();
  const r1 = String(region ?? '').trim();
  const r2 = String(region2 ?? '').trim();
  if (r2 && !isValidRegion(r2)) return 'region2 must be R1–R4 (or empty)';
  if (tl === 'TL1' && r1 && r2 && r1 === r2) return 'TL1 needs two DIFFERENT regions';
  return null;
}
