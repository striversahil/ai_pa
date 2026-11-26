// Org domain API module (fetch lives here — never in components).
// Endpoint mirror: founder-os_backend/src/worker/routes/org.ts.

export interface OrgLogin {
  id: string;
  email: string;
  name: string;
  scopes: string[];
  roles: string[];
  /** Chart positions from the login's roles (one per role, deduped). */
  positions?: string[];
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
    id: string; name: string; displayName?: string; email: string | null; loginEmail: string | null;
    phone: string | null; designation: string | null; department: string | null;
    active: boolean;
  };
  login: OrgLogin | null;
  roster: OrgRoster | null;
  /** Dashboard scopes this position suggests (pre-checked in the editor). */
  suggestedScopes: string[];
  /** Chart login position (display/suggestion only). */
  loginPosition?: string | null;
  canManage: boolean;
  /** True when employee.email + loginEmail are both set but differ. */
  emailMismatch?: boolean;
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

export type OrgWing = "Sales" | "Marketing" | "Operations";

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

export interface OrgChartResponse {
  positions: OrgChartPosition[];
  top: string | null;
  departments: Array<{ name: string; headTitle: string | null; count: number }>;
  canManage: boolean;
  source: "db" | "seed";
}

export interface ChartPositionInput {
  title?: string;
  department?: string | null;
  wing?: OrgWing;
  reportsToId?: string | null;
  isHead?: boolean;
  loginPosition?: string | null;
}

export async function fetchOrgChart(): Promise<OrgChartResponse> {
  const res = await fetch("/api/org/chart", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function createChartPosition(input: ChartPositionInput): Promise<OrgChartPosition> {
  const res = await fetch("/api/org/chart/positions", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function updateChartPosition(id: string, input: ChartPositionInput): Promise<OrgChartPosition> {
  const res = await fetch(`/api/org/chart/positions/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function deleteChartPosition(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/org/chart/positions/${encodeURIComponent(id)}`, { method: "DELETE" });
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
  /** Deprecated: HR never grants access (Users & Permissions owns it). Ignored by the server. */
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

export interface OrgRegion {
  id: string;
  code: string;
  name: string;
  tlLevel: "TL1" | "TL2";
  states: string[];
  order: number;
  active: boolean;
}

export interface OrgRegionsResponse {
  regions: OrgRegion[];
  /** Chart position id → allowed region codes; absent = every active region. */
  allotment: Record<string, string[]>;
}

/** HR-owned region catalog + per-position allotment (drives the person form). */
export async function fetchOrgRegions(): Promise<OrgRegionsResponse> {
  const res = await fetch("/api/org/regions", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
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
