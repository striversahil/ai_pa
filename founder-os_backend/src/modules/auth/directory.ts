// Org directory helpers — framework-free (no imports) so Worker and Express
// can both use them. Mirror: founder-os_frontend/src/auth/directory.ts
// (row shape, email-exact sources) — change both together, never drift.

/** Scopes granting the wide read (HR included). Managers keep edit rights
 *  separately via `canManage` (user-admin/admin only — same rule as the
 *  Users portal today). HR holders get read-only width on this endpoint. */
export const DIRECTORY_WIDE_SCOPES = ["admin", "user-admin", "human-resources"];

const normEmail = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/** Roster row with identity links (ids are link-only, never access). */
export interface DirectoryRosterRow {
  id?: string | null;
  email?: string | null;
  loginEmail?: string | null;
  name?: string | null;
  type?: string | null;
  role?: string | null;
  region?: string | null;
  designation?: string | null;
}

export interface DirectoryRosters {
  telecallers: DirectoryRosterRow[];
  accountants: DirectoryRosterRow[];
  marketers: DirectoryRosterRow[];
  hrMembers: DirectoryRosterRow[];
}

export interface DirectorySource {
  id: string;
  kind: "telecaller" | "accountant" | "marketer" | "hr-member";
  label: string;
}

/** Email-exact roster links for one login (never name-guessed). */
export function directorySources(email: string, rosters: DirectoryRosters): DirectorySource[] {
  const e = normEmail(email);
  if (!e) return [];
  const out: DirectorySource[] = [];
  for (const t of rosters.telecallers ?? []) {
    if (normEmail(t.email) === e && t.id) {
      out.push({ id: String(t.id), kind: "telecaller", label: `Roster · ${String(t.type ?? "telecaller")}${t.region ? ` · ${t.region}` : ""}` });
    }
  }
  for (const a of rosters.accountants ?? []) {
    if (normEmail(a.email) === e && a.id) {
      out.push({ id: String(a.id), kind: "accountant", label: `Accounts · ${String(a.role ?? "accountant")}` });
    }
  }
  for (const m of rosters.marketers ?? []) {
    if (normEmail(m.email) === e && m.id) {
      out.push({ id: String(m.id), kind: "marketer", label: `Digital Marketing · ${String(m.role ?? "")}`.trim() });
    }
  }
  for (const h of rosters.hrMembers ?? []) {
    if ((normEmail(h.email) === e || (h.loginEmail && normEmail(h.loginEmail) === e)) && h.id) {
      out.push({ id: String(h.id), kind: "hr-member", label: `HR · ${String(h.designation ?? "member")}` });
    }
  }
  return out;
}

/** Effective-scope check shared by backend gate + frontend affordances. */
export function hasAnyScope(scopes: string[], keys: string[]): boolean {
  const have = new Set(scopes.map((s) => String(s ?? "").toLowerCase()));
  return keys.some((k) => have.has(k.toLowerCase()));
}
