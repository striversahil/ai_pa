"use client";

// hooks/useNotifications.ts — one shared notification feed for the dock and any
// inline list. Fetch + mark-read live in personal/api.ts (never in components);
// this hook only subscribes (live events + 60s poll) and refreshes.
import { useLiveDashboard } from "./useLiveData";
import { fetchNotifications, markNotificationRead } from "@/personal/api";

export function useNotifications() {
  const q = useLiveDashboard(fetchNotifications, { events: ["notifications"], pollMs: 60000 });
  const read = async (id: string) => {
    try { await markNotificationRead(id); } finally { q.refresh(); }
  };
  return {
    notes: q.data?.notifications ?? [],
    unread: q.data?.unread ?? 0,
    loading: q.loading,
    error: q.error,
    refresh: q.refresh,
    read,
  };
}
