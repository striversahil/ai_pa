// modules/org/chart/types.ts — shapes shared by the D1 organization chart.
// Pure: no DB, no Worker imports.
export const ORG_WINGS = ["Sales", "Marketing", "Operations"] as const;
export type OrgWing = (typeof ORG_WINGS)[number];

export interface OrgChartRow {
  id: string;
  title: string;
  titleKey: string;
  department: string | null;
  wing: string;
  reportsToId: string | null;
  isTop: boolean;
  isHead: boolean;
  loginPosition: string | null;
  order: number;
  active: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface OrgChartPosition {
  id: string;
  title: string;
  titleKey: string;
  department: string | null;
  wing: OrgWing;
  reportsToId: string | null;
  reportsTo: string | null;
  isTop: boolean;
  isHead: boolean;
  loginPosition: string | null;
  order: number;
}

export interface OrgChartDepartment {
  name: string;
  headTitle: string | null;
  count: number;
}

export interface OrgChartResponse {
  positions: OrgChartPosition[];
  top: string | null;
  departments: OrgChartDepartment[];
  canManage: boolean;
  source: "db" | "seed";
}
