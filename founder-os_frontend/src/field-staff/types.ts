// types.ts — Field Staff shapes (frontend mirror).
// Backend source of truth: founder-os_backend/src/modules/field-visits/types.ts

export interface FieldStaffMember {
  id: string;
  name: string;
  region: string;
}

export interface FieldMill {
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
  isNew: boolean;
  isNewSuggested: boolean;
  isNewManual: boolean | null;
  matchMasterId: string;
  matchMasterName: string;
  enquiryId: string;
  followUpNeeded: boolean;
}

export interface FieldExpense {
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

export interface FieldFollowup {
  id: string;
  visitId: string;
  /** Day ledger (global queue) — visitId='' means no parent visit. */
  day: string;
  staffId: string;
  millVisitId: string;
  millName: string;
  dueDate: string;
  note: string;
  owner: string;
  status: string;
}

export interface FieldVisit {
  id: string;
  telecallerId: string;
  staffName: string;
  region: string;
  day: string;
  city: string;
  address: string;
  lat: number | null;
  lng: number | null;
  note: string;
  checkInAt: string;
  lastPingAt: string;
  checkOutAt: string;
  mills: FieldMill[];
  expenses: FieldExpense[];
  expenseTotal: number;
  followups: FieldFollowup[];
}

export interface FieldStaffData {
  from: string;
  to: string;
  staff: FieldStaffMember[];
  visits: FieldVisit[];
  openFollowups: FieldFollowup[];
  allFollowups?: FieldFollowup[];
  expenses?: FieldExpense[];
  expensesByDay?: Record<string, { total: number; rows: FieldExpense[] }>;
  totals: { visits: number; mills: number; expenses: number; openFollowups: number };
}

/** Open visit (automated tracking discontinued — no GPS concept). */
export function isVisitOpen(v: Pick<FieldVisit, "checkOutAt">): boolean {
  return !v.checkOutAt;
}

/** Open visits first, then recent day → last. Mirrors backend ORDER BY. */
export function compareVisits(
  a: Pick<FieldVisit, "checkOutAt" | "day" | "checkInAt">,
  b: Pick<FieldVisit, "checkOutAt" | "day" | "checkInAt">,
): number {
  const ao = a.checkOutAt ? 1 : 0;
  const bo = b.checkOutAt ? 1 : 0;
  if (ao !== bo) return ao - bo;
  if (a.day !== b.day) return a.day < b.day ? 1 : -1;
  return String(a.checkInAt ?? "").localeCompare(String(b.checkInAt ?? ""));
}

/** Back-compat alias (GPS retired): open → "live", closed → "closed". */
export function visitPresence(v: Pick<FieldVisit, "checkOutAt">): "live" | "stale" | "closed" {
  return isVisitOpen(v) ? "live" : "closed";
}
