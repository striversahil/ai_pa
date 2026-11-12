"use client";

// The viewer's workspaces — ONE live query shared by the sidebar, the session
// grid and the page access guard (replaces two separate /api/automations reads).
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import { fetchWorkspaces, type WorkspaceSummary } from "./api";

export function useWorkspaces(): { workspaces: WorkspaceSummary[]; loading: boolean } {
  const { me } = useAuth();
  const q = useLiveQuery<WorkspaceSummary[]>(
    async () => (me ? fetchWorkspaces() : []),
    { events: ["automation", "automations"], deps: [me?.user?.id ?? ""] },
  );
  return { workspaces: q.data ?? [], loading: q.loading };
}
