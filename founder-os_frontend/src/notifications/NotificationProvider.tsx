"use client";

// ─────────────────────────────────────────────────────────────────────────────
// notifications/NotificationProvider.tsx — ONE live source for the bell, the
// panel and the toasts.
//
// · Single fetch (`GET /api/notifications`, newest 200) shared by every surface.
// · Live: refetches on the `notifications` LiveEvent (the cron engine broadcasts
//   it after each dispatch). A 30 s poll is the safety net — the Pages /api proxy
//   cannot forward the WebSocket upgrade in production (same reason chat polls).
// · New arrivals become toasts; PRE-EXISTING history never toasts (the first
//   payload only seeds the "seen" set).
// · Level 1 = "Normal / Resolved" — it is in the panel/audit but never toasted.
// ─────────────────────────────────────────────────────────────────────────────
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "@/hooks/useLiveData";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "./api";
import { DEFAULT_LEVELS } from "./levels";
import type { NotificationLevelDef, NotificationPanelItem, NotificationsPayload } from "./types";

export interface NotificationContextValue {
  items: NotificationPanelItem[];
  unread: number;
  levels: NotificationLevelDef[];
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  canAuthor: boolean;
  unlinked: boolean;
  maxRows: number;
  refresh: () => void;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  toasts: NotificationPanelItem[];
  dismissToast: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const TOAST_MAX = 3;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const q = useLiveQuery<NotificationsPayload>(fetchNotifications, {
    events: ["notifications"],
    pollMs: 30_000,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [toasts, setToasts] = useState<NotificationPanelItem[]>([]);
  const seen = useRef<Set<string> | null>(null);

  const items = q.data?.notifications ?? [];

  useEffect(() => {
    const list = q.data?.notifications;
    if (!list) return;
    if (seen.current === null) {
      // First paint: everything already there is history, not news.
      seen.current = new Set(list.map((n) => n.id));
      return;
    }
    const fresh = list.filter((n) => !seen.current!.has(n.id) && n.status === "QUEUED" && Number(n.level) >= 2);
    for (const n of list) seen.current.add(n.id);
    if (fresh.length === 0) return;
    setToasts((prev) => [...fresh, ...prev].slice(0, TOAST_MAX));
  }, [q.data]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markRead = useCallback((id: string) => {
    q.setData((prev) => {
      if (!prev) return prev;
      const hit = prev.notifications.find((n) => n.id === id);
      if (!hit || hit.status === "READ") return prev;
      return {
        ...prev,
        unread: Math.max(0, prev.unread - 1),
        notifications: prev.notifications.map((n) => (n.id === id ? { ...n, status: "READ" as const } : n)),
      };
    });
    setToasts((prev) => prev.filter((t) => t.id !== id));
    void markNotificationRead(id).catch(() => q.refresh());
  }, [q]);

  const markAllRead = useCallback(() => {
    q.setData((prev) => (prev ? {
      ...prev,
      unread: 0,
      notifications: prev.notifications.map((n) => ({ ...n, status: "READ" as const })),
    } : prev));
    setToasts([]);
    void markAllNotificationsRead().catch(() => q.refresh());
  }, [q]);

  const value = useMemo<NotificationContextValue>(() => ({
    items,
    unread: q.data?.unread ?? 0,
    levels: q.data?.levels?.length ? q.data.levels : (DEFAULT_LEVELS as NotificationLevelDef[]),
    loading: q.loading,
    refreshing: q.refreshing,
    error: q.error,
    canAuthor: !!q.data?.canAuthor,
    unlinked: !!q.data?.unlinked,
    maxRows: q.data?.limit ?? 200,
    refresh: q.refresh,
    panelOpen,
    openPanel: () => setPanelOpen(true),
    closePanel: () => setPanelOpen(false),
    toasts,
    dismissToast,
    markRead,
    markAllRead,
  }), [items, q.data, q.loading, q.refreshing, q.error, q.refresh, panelOpen, toasts, dismissToast, markRead, markAllRead]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    // Safe fallback: a surface rendered outside the provider (e.g. a login
    // screen preview) must never crash the page.
    return {
      items: [], unread: 0, levels: DEFAULT_LEVELS as NotificationLevelDef[], loading: false, refreshing: false,
      error: null, canAuthor: false, unlinked: false, maxRows: 200, refresh: () => {},
      panelOpen: false, openPanel: () => {}, closePanel: () => {}, toasts: [], dismissToast: () => {},
      markRead: () => {}, markAllRead: () => {},
    };
  }
  return ctx;
}
