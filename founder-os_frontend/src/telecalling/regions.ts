// regions.ts — pure region taxonomy for the region-owned sales model.
//
// Mirror: founder-os_backend/src/automations/telecalling/regions.ts — change
// both together, same names + semantics. No I/O here: constants + validators.
export type RegionId = "R1" | "R2" | "R3" | "R4";
export type TlLevel = "TL1" | "TL2" | "";

export interface RegionDef {
  id: RegionId;
  name: string;
  tl: "TL1" | "TL2";
  states: string[];
}

export const REGIONS: RegionDef[] = [
  { id: "R1", name: "North & NCR Region", tl: "TL1", states: ["Delhi", "Haryana", "Punjab", "Chandigarh", "Uttarakhand"] },
  { id: "R2", name: "North-Central & Himalayan Belt Region", tl: "TL2", states: ["Uttar Pradesh", "Himachal Pradesh", "Jammu & Kashmir", "Ladakh"] },
  { id: "R3", name: "West & Central Region", tl: "TL2", states: ["Rajasthan", "Gujarat", "Madhya Pradesh", "Maharashtra", "Goa"] },
  {
    id: "R4",
    name: "South, East & Northeast Region",
    tl: "TL1",
    states: [
      "Tamil Nadu", "Karnataka", "Telangana", "Andhra Pradesh", "Kerala",
      "Puducherry", "West Bengal", "Assam", "Bihar", "Odisha", "Jharkhand",
      "Chhattisgarh", "Nepal", "Northeast States",
    ],
  },
];

export const REGION_IDS: RegionId[] = REGIONS.map((r) => r.id);
export const TL_LEVELS: Array<"TL1" | "TL2"> = ["TL1", "TL2"];

export function isValidRegion(v: unknown): v is RegionId {
  return REGION_IDS.includes(String(v ?? "").trim() as RegionId);
}

export function isValidTlLevel(v: unknown): v is "TL1" | "TL2" {
  return String(v ?? "").trim() === "TL1" || String(v ?? "").trim() === "TL2";
}

export function regionDef(id: string): RegionDef | null {
  return REGIONS.find((r) => r.id === id) ?? null;
}

/** ₹ each TL1 owes per working day of RESELLER accepted value (2026-11-05). */
export const DAILY_TL_RESELLER_TARGET = 100_000;

/**
 * Regions a roster row works (mirror of the backend helper): primary `region`
 * + secondary `region2` for TL1s (two regions at once, pair by sales-head).
 */
export function tlRegions(t: { region?: unknown; region2?: unknown }): RegionId[] {
  const out: RegionId[] = [];
  for (const v of [t?.region, t?.region2]) {
    const s = String(v ?? "").trim();
    if (isValidRegion(s) && !out.includes(s as RegionId)) out.push(s as RegionId);
  }
  return out;
}
