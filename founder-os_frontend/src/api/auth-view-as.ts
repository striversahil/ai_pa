// ─────────────────────────────────────────────────────────────────────────────
// api/auth-view-as.ts — root "view as" (impersonation) calls.
//
// Endpoint mirror: founder-os_backend/src/worker/routes/view-as.ts
// The overlay itself is a cookie the server sets; the frontend never sees or
// stores it. Entering is read-only by construction (the server refuses writes
// while the overlay is on), so there is nothing to toggle here.
// ─────────────────────────────────────────────────────────────────────────────

export interface ViewAsTarget {
  id: string;
  email: string;
  name: string;
}

export interface ViewAsLogRow {
  id: string;
  rootEmail: string | null;
  targetEmail: string | null;
  targetName: string | null;
  startedAt: string;
  endedAt: string | null;
}

async function readError(res: Response): Promise<string> {
  try {
    const j: { error?: unknown } = await res.json();
    return String(j?.error ?? `request failed (${res.status})`);
  } catch {
    return `request failed (${res.status})`;
  }
}

/** Enter: view the platform as `userId` (root only, read-only). */
export async function startViewAs(userId: string): Promise<ViewAsTarget> {
  const res = await fetch("/api/auth/view-as", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const j = await res.json();
  return (j?.actingAs ?? j?.me?.actingAs) as ViewAsTarget;
}

/** Exit: back to the real root session (closes the audit row). */
export async function stopViewAs(): Promise<void> {
  const res = await fetch("/api/auth/view-as", { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res));
}

/** Audit trail: the last root views (who looked at whom). */
export async function fetchViewAsLog(): Promise<ViewAsLogRow[]> {
  const res = await fetch("/api/auth/view-as", { cache: "no-store" });
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}
