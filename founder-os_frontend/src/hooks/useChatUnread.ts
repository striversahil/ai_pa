"use client";

import { useEffect, useRef } from "react";
import { chatListChanged, fetchChannels, onChannelsChanged } from "@/components/chat/api";
import type { Channel } from "@/components/chat/types";
import { useLiveQuery } from "./useLiveData";

/**
 * Global chat unread count for nav badges (Sidebar / MobileNav / MobileDrawer).
 * One lightweight query — page.tsx calls it once and passes the total down,
 * so the badge stays live even when ChatRoom isn't mounted.
 * Instant on local actions (ChatRoom notifies via notifyChannelsChanged after
 * read/send/switch); polls as a safety net because the Pages /api proxy
 * can't forward the /api/events WebSocket upgrade, so WS live can be dead in
 * production while direct-worker dev still gets instant events.
 */
export function useChatUnread(enabled: boolean) {
  const q = useLiveQuery<Channel[]>(
    async () => {
      if (!enabled) return [];
      try {
        return await fetchChannels();
      } catch {
        return [];
      }
    },
    {
      events: chatListChanged,
      deps: [enabled],
      pollMs: 10000,
    },
  );
  const refreshRef = useRef(q.refresh);
  refreshRef.current = q.refresh;
  useEffect(() => onChannelsChanged(() => refreshRef.current()), []);
  const total = (q.data ?? []).reduce((n, c) => n + (c.unread ?? 0), 0);
  return { total, refresh: q.refresh };
}
