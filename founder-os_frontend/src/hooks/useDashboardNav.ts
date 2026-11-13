"use client";
import { useAuth } from "@/auth/AuthContext";
import { VIEW_SCOPE } from "@/auth/permissions";
import { useWorkspaces } from "@/workspaces/useWorkspaces";

export interface DashboardNavItem {
  slug: string;
  name: string;
  scope: string;
  scopes: string[];
}

/** Resolve the permission scope for a dashboard: server-provided scope first,
// explicit frontend override second, slug-as-scope fallback last (matches the
// backend AUTOMATION_SCOPES contract — new dashboards need zero edits). */
export function dashboardScope(a: { slug: string; scope?: string | null }): string {
  return a.scope ?? VIEW_SCOPE[a.slug] ?? a.slug;
}

/** Every scope that grants this dashboard (legacy aliases included). */
export function dashboardScopes(a: { slug: string; scope?: string | null; scopes?: string[] | null }): string[] {
  return a.scopes?.length ? a.scopes : [dashboardScope(a)];
}

/** Sidebar "Dashboards" section: the viewer's workspaces, already filtered by
 *  scope on the server (GET /api/session/workspaces). Root opens everything
 *  from the (root-only, DEV-ONLY) Workspace page, so only root skips the
 *  section — non-root admins need it while Workspace is hidden. */
export function useDashboardNav(): DashboardNavItem[] {
  const { me } = useAuth();
  const { workspaces } = useWorkspaces();
  if (!me || me.isRoot) return [];
  return workspaces.map((w) => ({
    slug: w.slug, name: w.name,
    scope: dashboardScope(w), scopes: dashboardScopes(w),
  }));
}
