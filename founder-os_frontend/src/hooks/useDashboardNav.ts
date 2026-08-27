"use client";
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";

export interface DashboardNavItem {
  slug: string;
  name: string;
}

/** Automation dashboards the current user is allowed to see (live).
 *  Admin/root users don't get the sidebar Dashboards section — they reach every
 *  dashboard via the Automations registry. Roles grant dashboards to regular users. */
export function useDashboardNav(): DashboardNavItem[] {
  const { me, canView } = useAuth();
  const automations = useLiveQuery<Array<{ slug: string; name: string; hasDashboard: boolean }>>(
    async () => {
      const res = await fetch("/api/automations");
      if (!res.ok) throw new Error("failed to load automations");
      return res.json();
    },
    { events: ["automation", "automations"] },
  );
  if (me?.isAdmin) return [];
  return (automations.data ?? [])
    .filter((a) => a.hasDashboard && canView(a.slug))
    .map((a) => ({ slug: a.slug, name: a.name }));
}