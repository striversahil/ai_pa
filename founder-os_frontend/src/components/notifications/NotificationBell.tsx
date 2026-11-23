"use client";

// NotificationBell — the unread badge + panel opener.
//
// Two shapes, one component: a full-width sidebar row (label + count) and a
// compact mobile-header icon. Both read the shared NotificationProvider, so no
// prop drilling through Sidebar/page.tsx.
import React from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "@/notifications/NotificationProvider";

export function NotificationBadge({ unread, className = "" }: { unread: number; className?: string }) {
  if (unread <= 0) return null;
  return (
    <span
      className={`inline-flex min-w-[18px] items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-bold leading-[18px] text-white ${className}`}
    >
      {unread > 99 ? "99+" : unread}
    </span>
  );
}

export function NotificationBell({ expanded = true, header = false }: { expanded?: boolean; header?: boolean }) {
  const { unread, openPanel } = useNotifications();
  const label = unread > 0 ? `Notifications — ${unread} unread` : "Notifications";

  if (header) {
    return (
      <button
        type="button"
        onClick={openPanel}
        aria-label={label}
        title={label}
        className="relative rounded-lg p-2 text-[var(--text-secondary)] transition hover:bg-[var(--bg-input)]"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openPanel}
      title={expanded ? undefined : label}
      aria-label={label}
      className={`flex w-full items-center gap-3 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] py-2.5 text-label font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] ${expanded ? "px-3" : "px-1"}`}
    >
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[var(--color-danger)] ring-2 ring-[var(--surface-sunken)]" />}
      </span>
      {expanded && <span className="truncate whitespace-nowrap">Notifications</span>}
      {unread > 0 && <NotificationBadge unread={unread} className={expanded ? "ml-auto" : "absolute right-1 top-1 !min-w-[16px] !leading-4"} />}
    </button>
  );
}
