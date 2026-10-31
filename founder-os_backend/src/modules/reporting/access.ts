// access.ts — who may see / enter each Reporting Sheet department.
//
// The founder's rule: a head enters ONLY their own department. Sales-head is a
// department head here (not a cross-department manager) — cross-department
// power belongs to root + MIS, who see and may edit everything. A plain
// `reporting-sheet` grant is a read-only management viewer (sees all, edits
// nothing). The server enforces all of this; the UI only hides controls.
import type { MeResponse } from '../auth/types';
import { DEPARTMENTS, type ReportDepartment } from './types';

export const REPORTING_SCOPE = 'reporting-sheet';

function heldScopes(me: MeResponse | null): Set<string> {
  return new Set(((me?.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
}

/** Root / MIS — full power over every department and every week. */
export function isReportingManager(me: MeResponse | null): boolean {
  if (!me) return false;
  if (me.isAdmin) return true;
  return heldScopes(me).has('mis');
}

/** Departments this viewer may open. Managers and read-only viewers see all;
 *  a department head sees only their own. */
export function viewableDepartments(me: MeResponse | null): ReportDepartment[] {
  if (!me) return [];
  if (isReportingManager(me)) return DEPARTMENTS.map((d) => d.dept);
  const held = heldScopes(me);
  if (held.has(REPORTING_SCOPE)) return DEPARTMENTS.map((d) => d.dept);
  return DEPARTMENTS.filter((d) => held.has(d.scope)).map((d) => d.dept);
}

/** May this viewer enter data for this department? */
export function canEditDepartment(me: MeResponse | null, dept: ReportDepartment): boolean {
  if (!me) return false;
  if (isReportingManager(me)) return true;
  const entry = DEPARTMENTS.find((d) => d.dept === dept);
  return !!entry && heldScopes(me).has(entry.scope);
}
