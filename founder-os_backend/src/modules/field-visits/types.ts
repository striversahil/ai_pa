// types.ts — Field Staff visit shapes (single source of truth, backend side).
// Mirrors: founder-os_frontend/src/field-staff/types.ts

export interface FieldVisitRow {
  id: string;
  telecallerId: string;
  staffName?: string;
  region?: string;
  day: string;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
  note: string;
  checkInAt: string;
  lastPingAt: string;
  checkOutAt: string;
  mills?: FieldMillRow[];
  expenses?: FieldExpenseRow[];
  followups?: FieldFollowupRow[];
}

export interface FieldMillRow {
  id: string;
  visitId: string;
  millName: string;
  keyContact: string;
  designation: string;
  phone: string;
  rollerPlantNos: string;
  attaChakkiNos: string;
  chakkiSize: string;
  runningTime: string;
  products: string;
  millAgeYrs: string;
  machineBrand: string;
  requirement: string;
  /** Effective verdict: manual toggle wins, else the auto-matcher suggestion. */
  isNew: boolean;
  isNewSuggested: boolean;
  isNewManual: boolean | null;
  matchMasterId: string;
  matchMasterName: string;
  enquiryId: string;
  followUpNeeded: boolean;
}

export interface FieldExpenseRow {
  id: string;
  visitId: string;
  /** Day ledger (global calendar) — visitId='' means no parent visit. */
  day: string;
  staffId: string;
  amount: number;
  description: string;
  createdByName: string;
  createdAt: string;
}

export interface FieldFollowupRow {
  id: string;
  visitId: string;
  /** Day ledger (global queue) — visitId='' means no parent visit. */
  day: string;
  staffId: string;
  millVisitId: string;
  millName?: string;
  dueDate: string;
  note: string;
  owner: string;
  status: string;
}

/** The 11 mill profile fields the founder specified (name + 10 + requirement). */
export const MILL_FIELDS = [
  'millName', 'keyContact', 'designation', 'phone',
  'rollerPlantNos', 'attaChakkiNos', 'chakkiSize', 'runningTime',
  'products', 'millAgeYrs', 'machineBrand', 'requirement',
] as const;

export function effectiveIsNew(isNewSuggested: boolean, isNewManual: boolean | null | undefined): boolean {
  if (isNewManual === true) return true;
  if (isNewManual === false) return false;
  return !!isNewSuggested;
}

/** Open visit (no GPS concept anymore — tracking discontinued). */
export function isVisitActiveNow(v: { checkOutAt: string }): boolean {
  return !v.checkOutAt;
}

/** Open visits first, then recent day → last. Mirrors listVisits ORDER BY. */
export function compareVisits(a: { checkOutAt: string; day: string; checkInAt: string }, b: { checkOutAt: string; day: string; checkInAt: string }): number {
  const ao = a.checkOutAt ? 1 : 0;
  const bo = b.checkOutAt ? 1 : 0;
  if (ao !== bo) return ao - bo;
  if (a.day !== b.day) return a.day < b.day ? 1 : -1;
  return String(a.checkInAt ?? '').localeCompare(String(b.checkInAt ?? ''));
}
