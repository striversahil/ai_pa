// personal/api.ts — person-workspace domain API (fetch lives here, never in components).
// Endpoint mirrors: backend worker/routes/work.ts (/api/work/my, /api/work/team,
// /api/work/actions/:id/complete, /api/notifications) + org people read
// (worker/routes/org.ts) + telecalling headless data (workspaces/api).

export interface PersonalAction {
  id: string;
  category: string;
  title: string;
  entityType: string | null;
  entityId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  priority: string | null;
  status: string;
  createdAt: string | null;
}

export interface PersonalNotification {
  id: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  actionId: string | null;
  createdAt: string | null;
}

async function readError(res: Response): Promise<string> {
  try {
    const j: { error?: unknown } = await res.json();
    return String(j?.error ?? `request failed (${res.status})`);
  } catch {
    return `request failed (${res.status})`;
  }
}

async function getJson<T>(url: string, method = "GET"): Promise<T> {
  const res = await fetch(url, { cache: "no-store", method });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<T>;
}

/** Own open actions (root preview: root's own queue — target person's queue comes via team scope). */
export async function fetchMyWork(): Promise<{ actions: PersonalAction[] }> {
  return getJson("/api/work/my");
}

/** Team/open actions visible to the caller (root sees all; used for preview-as). */
export async function fetchTeamWork(): Promise<{ actions: PersonalAction[]; scope: string }> {
  return getJson("/api/work/team");
}

/** Own queued notifications, newest first. */
export async function fetchNotifications(): Promise<{ notifications: PersonalNotification[]; unread: number }> {
  return getJson("/api/notifications");
}

export async function completeAction(actionId: string): Promise<void> {
  const res = await fetch(`/api/work/actions/${encodeURIComponent(actionId)}/complete`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const res = await fetch(`/api/notifications/${encodeURIComponent(notificationId)}/read`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
}
