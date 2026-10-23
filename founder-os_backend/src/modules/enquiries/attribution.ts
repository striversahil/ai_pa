// attribution.ts — Field Staff referral attribution (single source of truth).
//
// Field staff never operate the dashboard. A sales agent logs their enquiry
// with source "Field Staff" and picks WHICH field staff it came from; the
// enquiry then belongs to that field staff:
//   assignedAgentId  = field staff id  → Lead By / 20% generator credit /
//                      Estimate.region (via the normal estimate-link path)
//   fieldStaffId     = field staff id  → immutable referral origin
//   loggedByAgentId  = sales agent who typed it (audit only)
//
// Validation is server-side: the picked id must be an ACTIVE field-staff row
// in the sales roster (not deleted, not absent). Lookup goes through the
// EnquiryStore abstraction so this module stays Worker-safe (D1 + Prisma).
import type { EnquiryStore } from './types';

export const FIELD_STAFF_SOURCE = 'Field Staff';

export type StaffType = 'telecaller' | 'field_staff';

export const STAFF_TYPES: readonly StaffType[] = ['telecaller', 'field_staff'];

export function isStaffType(v: unknown): v is StaffType {
  return STAFF_TYPES.includes(String(v ?? '') as StaffType);
}

export function isFieldStaffSource(v: unknown): boolean {
  return String(v ?? '').trim() === FIELD_STAFF_SOURCE;
}

export interface FieldStaffRow {
  id: string;
  name: string;
  region: string;
}

export type FieldStaffResolution =
  | { ok: true; row: FieldStaffRow }
  | { ok: false; error: string };

/** Resolve + validate the selected field staff from the roster. */
export async function resolveFieldStaff(store: Pick<EnquiryStore, 'getStaffAttribution'>, fieldStaffId: unknown): Promise<FieldStaffResolution> {
  const id = String(fieldStaffId ?? '').trim();
  if (!id) return { ok: false, error: 'Select the active field staff this enquiry came from' };
  try {
    const row: any = await store.getStaffAttribution(id).catch(() => null);
    if (!row) return { ok: false, error: 'Field staff not found in the sales roster' };
    if (row.deleted) return { ok: false, error: 'Field staff is deleted — restore them in the Sales Roster first' };
    if (row.absentSince) return { ok: false, error: 'Field staff is marked absent — mark them present first' };
    if (String(row.type ?? 'telecaller') !== 'field_staff') {
      return { ok: false, error: 'Selected staff is not a Field Staff member' };
    }
    return {
      ok: true,
      row: { id: String(row.id), name: String(row.name ?? ''), region: String(row.region ?? '') },
    };
  } catch {
    return { ok: false, error: 'Field staff lookup failed — try again' };
  }
}
