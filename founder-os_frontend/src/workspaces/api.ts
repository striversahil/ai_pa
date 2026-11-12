// workspaces/api.ts — the ONLY place that knows workspace HTTP paths.
//
// Dashboard components never spell `/api/automations/<slug>/data` or
// `/api/session/...` themselves: they build URLs with workspaceDataUrl() so the
// same component renders under /session and /automations, and the endpoint can
// move without touching 20 files.
//
// Backend: founder-os_backend/src/worker/routes/session.ts.

/** Base for workspace data reads. `/api/automations/<slug>/data` is the
 *  deprecated alias of the same handler; the session path is canonical. */
export const WORKSPACE_DATA_BASE = "/api/session/workspaces";

/** `<base>/<slug>/data` — callers append their own `?query` unchanged. */
export function workspaceDataUrl(slug: string): string {
  return `${WORKSPACE_DATA_BASE}/${slug}/data`;
}

export interface WorkspaceSummary {
  slug: string;
  name: string;
  scope: string;
  scopes: string[];
}

/** Workspaces the signed-in viewer may open (server-filtered by scope). */
export async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  const res = await fetch("/api/session/workspaces", { cache: "no-store" });
  if (!res.ok) throw new Error(`workspaces load failed (${res.status})`);
  return res.json();
}

/** JSON payload of one workspace, scoped to the viewer by the server. */
export async function fetchWorkspaceData<T>(slug: string, query = ""): Promise<T> {
  const res = await fetch(`${workspaceDataUrl(slug)}${query ? (query.startsWith("?") ? query : `?${query}`) : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${slug} load failed (${res.status})`);
  return res.json();
}
