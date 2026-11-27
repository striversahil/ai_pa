// Sales region catalog client (Sales Controller).
// Backend mirror: founder-os_backend/src/worker/routes/sales-regions.ts.
import { api } from "@/api/client";

export interface SalesRegion {
  id: string;
  code: string;
  name: string;
  tlLevel: "TL1" | "TL2";
  states: string[];
  order: number;
  active: boolean;
  /** Active people holding this region (0..N regions each). */
  seats: number;
  /** Who holds it — the Team Leads and the staff they can manage. */
  staff: RegionStaff;
}

export interface RegionStaff {
  teamLeads: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string; type: string }>;
}

export interface SalesRegionsData {
  regions: SalesRegion[];
}

export const REGION_CODES = ["R1", "R2", "R3", "R4"] as const;

export function fetchSalesRegions(): Promise<SalesRegionsData> {
  return api.get<SalesRegionsData>("/api/sales/regions");
}

export function updateSalesRegion(code: string, body: Record<string, unknown>): Promise<SalesRegion> {
  return api.patch<SalesRegion>(`/api/sales/regions/${encodeURIComponent(code)}`, body);
}
