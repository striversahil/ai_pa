// modules/org/types.ts — shared shapes + tiny helpers for the org module.
//
// Imported by read.ts + write.ts; re-exported via io.ts so route handlers
// keep one import. No DB, no fetch — pure.
import type { AuthStore } from "../auth/store-parts/types";

export type { AuthStore };

export interface OrgError extends Error { status?: number }

export function fail(status: number, message: string): never {
  const e = new Error(message) as OrgError;
  e.status = status;
  throw e;
}

export const normEmail = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/** HumanResourcesMember.salesRegions (JSON array) → clean code list. */
export function parseRegionList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v ?? "").trim().toUpperCase()).filter(Boolean);
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map((x) => String(x ?? "").trim().toUpperCase()).filter(Boolean) : [];
  } catch { return []; }
}

export function isPrivileged(me: any): boolean {
  return me?.isRoot === true || me?.isAdmin === true;
}

export function heldScopes(me: any): Set<string> {
  return new Set(((me?.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
}

export interface OrgLogin {
  id: string; email: string; name: string;
  scopes: string[]; roles: string[];
  /** Chart positions from the login's roles (one per role, deduped). */
  positions: string[];
  lastLoginAt: string | null;
}

export interface OrgRoster {
  /** Always the employee id: the employee row IS the sales row. */
  id: string;
  type: string;
  /** All regions this person works (0..N; first = primary). */
  regions: string[];
  /** Team lead this person reports to (employee id of an active TL). */
  teamLeadId: string | null;
  whatsapp: string | null;
  phone: string | null;
  assignEstimateFollowUps: boolean;
  absentSince: string | null;
}

export interface OrgPerson {
  employee: {
    id: string; name: string; displayName: string; email: string | null; loginEmail: string | null;
    phone: string | null; designation: string | null; department: string | null;
    active: boolean;
  };
  login: OrgLogin | null;
  roster: OrgRoster | null;
  suggestedScopes: string[];
  /** Chart login position for this employee (display/suggestion only). */
  loginPosition: string | null;
  canManage: boolean;
  /** True when employee.email + loginEmail are both set but differ — the card
   *  shows a mismatch badge so alias-Gmail links stay visible. */
  emailMismatch: boolean;
}

export interface OrgPeople {
  people: OrgPerson[];
  /** Non-root logins with no employee row (offer "Create employee record"). */
  unlinkedLogins: Array<{ id: string; email: string; name: string }>;
}

export interface AssignInput {
  position?: string;
  /** Full region list (0..N). Wins over the legacy pair below. */
  regions?: string[];
  /** Legacy pair, still accepted from older clients. */
  region?: string;
  region2?: string;
  /** Team lead this person reports to (employee id). */
  teamLeadId?: string | null;
  whatsapp?: string | null;
  officePhone?: string | null;
  assignEstimateFollowUps?: boolean;
  /** Deprecated: HR never grants access (Users & Permissions owns it). Ignored. */
  scopes?: string[];
  active?: boolean;
}
