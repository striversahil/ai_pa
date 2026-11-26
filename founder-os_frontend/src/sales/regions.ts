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
  seats: number;
}

export interface SalesRegionPosition {
  id: string;
  title: string;
  department: string | null;
  active: boolean;
}

export interface SalesRegionsData {
  regions: SalesRegion[];
  /** Chart position id → allotted region codes (absent = every active region). */
  allotment: Record<string, string[]>;
  positions: SalesRegionPosition[];
}

export const REGION_CODES = ["R1", "R2", "R3", "R4"] as const;

export function fetchSalesRegions(): Promise<SalesRegionsData> {
  return api.get<SalesRegionsData>("/api/sales/regions");
}

export function updateSalesRegion(code: string, body: Record<string, unknown>): Promise<SalesRegion> {
  return api.patch<SalesRegion>(`/api/sales/regions/${encodeURIComponent(code)}`, body);
}

export function savePositionRegions(positionId: string, regions: string[]): Promise<{ ok: boolean; regions: string[] }> {
  return api.put(`/api/sales/position-regions/${encodeURIComponent(positionId)}`, { regions });
}