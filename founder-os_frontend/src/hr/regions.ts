// HR-owned sales region catalog (Controller tab).
// Endpoint mirror: founder-os_backend/src/worker/routes/human-resources-regions.ts.

export interface HrRegion {
  id: string;
  code: string;
  name: string;
  tlLevel: "TL1" | "TL2";
  states: string[];
  order: number;
  active: boolean;
  seats: number;
}

export interface HrRegionPosition {
  id: string;
  title: string;
  department: string | null;
  active: boolean;
}

export interface HrRegionsData {
  regions: HrRegion[];
  /** Chart position id → allotted region codes (absent = every active region). */
  allotment: Record<string, string[]>;
  positions: HrRegionPosition[];
}

export const REGION_CODES = ["R1", "R2", "R3", "R4"] as const;