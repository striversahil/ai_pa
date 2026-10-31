// types.ts — Reporting Sheet shapes served by the worker.
//
// MIRROR: founder-os_backend/src/modules/reporting/types.ts (field defs are
// mirrored in fields.ts; the backend is the source of truth — change both).

export type ReportDepartment = 'sales' | 'operations' | 'digital';

export type ReportSection =
  | 'telecaller' | 'data' | 'field'
  | 'scheduling' | 'outstanding' | 'dispatch' | 'stock' | 'feedback'
  | 'kingpin' | 'meta' | 'email-wa' | 'b2b' | 'ecommerce';

export type ReportOrigin = 'manual' | 'autofill' | 'adjusted';

export interface TelecallerRow {
  name: string;
  connected: number;
  leads: number;
}

export interface RegionOrderRow {
  region: string;
  orders: number;
  value: number;
}

export interface ReportEntryView {
  payload: Record<string, unknown>;
  telecallerRows: TelecallerRow[];
  regionOrders: RegionOrderRow[];
  origin: ReportOrigin;
  submittedByName: string;
  submittedAt: string;
}

export interface ReportSectionView {
  section: ReportSection;
  title: string;
  blurb: string;
  autofill: boolean;
  entry: ReportEntryView | null;
}

export interface ReportDepartmentView {
  dept: ReportDepartment;
  title: string;
  canEdit: boolean;
  sections: ReportSectionView[];
  submittedCount: number;
  sectionCount: number;
}

export interface ReportPeriodItem {
  key: string;
  label: string;
  from: string;
  to: string;
  current: boolean;
}

export interface ReportingPayload {
  period: string;
  periods: ReportPeriodItem[];
  editable: boolean;
  departments: ReportDepartmentView[];
}

export interface AutofillResult {
  period: string;
  from: string;
  to: string;
  payload: Record<string, unknown>;
  telecallerRows: TelecallerRow[];
  regionOrders: RegionOrderRow[];
  autoKeys: string[];
  sources: string[];
}

export interface ReportingCapabilities {
  departments: ReportDepartment[];
  canEdit: Record<string, boolean>;
  isManager: boolean;
}
