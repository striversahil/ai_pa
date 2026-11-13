// Org domain API module (fetch lives here — never in components).
// Endpoint mirror: founder-os_backend/src/worker/routes/org.ts.

export interface OrgLogin {
  id: string;
  email: string;
  name: string;
  scopes: string[];
  roles: string[];
  /** Last session createdAt (ISO) or null when the login never signed in. */
  lastLoginAt: string | null;
}

export interface OrgRoster {
  id: string;
  type: string;
  region: string;
  region2: string;
  tlLevel: string;
  whatsapp: string | null;
  phone: string | null;
  neodoveUserId: string | null;
  neodoveUserName: string | null;
}

export interface OrgPerson {
  employee: {
    id: string; name: string; email: string | null; loginEmail: string | null;
    phone: string | null; designation: string | null; department: string | null;
    active: boolean;
  };
  login: OrgLogin | null;
  roster: OrgRoster | null;
  /** Dashboard scopes this position suggests (pre-checked in the editor). */
  suggestedScopes: string[];
  canManage: boolean;
}

export interface OrgPeopleResponse {
  people: OrgPerson[];
  unlinkedLogins: Array<{ id: string; email: string; name: string }>;
  unlinkedRoster: Array<{ id: string; name: string; email: string | null; type: string }>;
}

async function readError(res: Response): Promise<string> {
  try {
    const j: { error?: unknown } = await res.json();
    return String(j?.error ?? `request failed (${res.status})`);
  } catch {
    return `request failed (${res.status})`;
  }
}

/** Chart people, viewer-scoped server-side. Pass department to scope the read
 *  (the Sales Controller mounts the same chart with `Sales`). */
export async function fetchOrgPeople(department?: string | null): Promise<OrgPeopleResponse> {
  const url = department
    ? `/api/org/people?department=${encodeURIComponent(department)}`
    : "/api/org/people";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export interface AssignPersonInput {
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

/** The single person save — position, sales fields, access, active. */
export async function saveOrgPerson(employeeId: string, input: AssignPersonInput): Promise<void> {
  const res = await fetch(`/api/org/people/${encodeURIComponent(employeeId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
}

/** Root-only, idempotent: create employee rows for roster rows lacking one. */
export async function backfillOrgEmployees(): Promise<{ created: number; skipped: number }> {
  const res = await fetch("/api/org/backfill", { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

/** NeoDove users not yet linked to any roster row (for the office-phone
 *  mapping picker). Lazy-loaded by the person drawer — the telecalling
 *  payload is KV-cached, so this is one cheap read per drawer open. */
export async function fetchUnmappedNeodoveUsers(): Promise<Array<{ userId: string; userName: string }>> {
  const { workspaceDataUrl } = await import("@/workspaces/api");
  const res = await fetch(workspaceDataUrl("telecalling"), { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  const j = await res.json();
  return Array.isArray(j?.meta?.unmappedNeodoveUsers) ? j.meta.unmappedNeodoveUsers : [];
}
