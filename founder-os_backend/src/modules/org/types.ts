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

export function isPrivileged(me: any): boolean {
  return me?.isRoot === true || me?.isAdmin === true;
}

export function heldScopes(me: any): Set<string> {
  return new Set(((me?.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
}

export interface OrgLogin {
  id: string; email: string; name: string;
  scopes: string[]; roles: string[];
  lastLoginAt: string | null;
}

export interface OrgRoster {
  id: string; type: string; region: string; region2: string; tlLevel: string;
  whatsapp: string | null; phone: string | null;
  neodoveUserId: string | null; neodoveUserName: string | null;
}

export interface OrgPerson {
  employee: {
    id: string; name: string; email: string | null; loginEmail: string | null;
    phone: string | null; designation: string | null; department: string | null;
    active: boolean;
  };
  login: OrgLogin | null;
  roster: OrgRoster | null;
  suggestedScopes: string[];
  canManage: boolean;
}

export interface OrgPeople {
  people: OrgPerson[];
  /** Non-root logins with no employee row (offer "Create employee record"). */
  unlinkedLogins: Array<{ id: string; email: string; name: string }>;
  /** Live roster rows with no employee row (consumed by backfill). */
  unlinkedRoster: Array<{ id: string; name: string; email: string | null; type: string }>;
}

export interface AssignInput {
  position?: string;
  region?: string;
  region2?: string;
  tlLevel?: string;
  whatsapp?: string | null;
  officePhone?: string | null;
  neodoveUserId?: string | null;
  neodoveUserName?: string | null;
  scopes?: string[];
  active?: boolean;
}
