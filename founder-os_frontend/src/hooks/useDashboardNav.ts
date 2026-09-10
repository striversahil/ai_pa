"use client";
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import { VIEW_SCOPE } from "@/auth/permissions";

export interface DashboardNavItem {
  slug: string;
  name: string;
  scope: string;
}

/** Resolve the permission scope for a dashboard: server-provided scope first,
// explicit frontend override second, slug-as-scope fallback last (matches the
// backend AUTOMATION_SCOPES contract — new dashboards need zero edits). */
export function dashboardScope(a: { slug: string; scope?: string | null }): string {
  return a.scope ?? VIEW_SCOPE[a.slug] ?? a.slug;
}

/** Automation dashboards the current user is allowed to see (live).
 *  Admin/root users don't get the sidebar Dashboards section — they reach every
 *  dashboard via the Automations registry. Roles grant dashboards to regular users. */
export function useDashboardNav(): DashboardNavItem[] {
  const { me } = useAuth();
  const automations = useLiveQuery<Array<{ slug: string; name: string; hasDashboard: boolean; scope?: string | null }>>(
    async () => {
      const res = await fetch("/api/automations");
      if (!res.ok) throw new Error("failed to load automations");
      return res.json();
    },
    { events: ["automation", "automations"] },
  );
  if (me?.isAdmin) return [];
  // Access is resolved against the server-provided scope (dynamic — no per-slug
  // frontend edits needed for new dashboard automations).
  if (!me) return [];
  const granted = new Set(me.scopes);
  return (automations.data ?? [])
    .filter((a) => a.hasDashboard && granted.has(dashboardScope(a)))
    .map((a) => ({ slug: a.slug, name: a.name, scope: dashboardScope(a) }));
}