// Core assignments — frontend mirror + types.
// Mirror: founder-os_backend/src/modules/auth/routes-parts/directory.ts
// (authCoreAssignments: catalog shape, per-login primary designation,
// read-only) — change both together, never drift.
// Fetchers live in the domain api module: ./api.ts (fetchCoreAssignments).

export interface CoreCatalogPosition {
  id: string;
  code: string;
  name: string;
  rank: number;
}

export interface CoreCatalogDepartment {
  id: string;
  code: string;
  name: string;
  positions: CoreCatalogPosition[];
}

export interface CoreAssignmentRow {
  departmentId: string;
  departmentCode: string;
  department: string;
  positionId: string;
  positionCode: string;
  designation: string;
}

export interface CoreAssignmentsResponse {
  assignments: Record<string, CoreAssignmentRow>;
  catalog: { departments: CoreCatalogDepartment[] };
  canManage: boolean;
  coreUnavailable?: boolean;
}
