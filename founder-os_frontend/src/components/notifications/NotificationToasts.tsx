"use client";

// NotificationToasts — instant, animated, level-coloured popups.
//
// Stack rules: max 3 on screen (the provider caps the queue), 9 s auto-dismiss,
// hover pauses the timer, click opens the panel and marks the row read.
// Colours come from the level's own hex so severity reads at a glance.
import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useNotifications } from "@/notifications/NotificationProvider";
import { relTime } from "@/notifications/helpers";
import type { NotificationPanelItem } from "@/notifications/types";
import { LevelDot } from "./LevelDot";

const DISMISS_MS = 9000;

function Toast({ item, onOpen, onDismiss }: { item: NotificationPanelItem; onOpen: () => void; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(onDismiss, DISMISS_MS);
    return () => clearTimeout(t);
  }, [paused, onDismiss]);

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto w-[min(23rem,calc(100vw-2rem))] animate-scale-up overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-card)] bg-[var(--bg-card)] shadow-[var(--shadow-float)]"
      style={{ borderTopColor: item.colorHex, borderTopWidth: 3 }}
    >
      <button type="button" onClick={onOpen} className="block w-full cursor-pointer p-3.5 text-left">
        <div className="flex items-start gap-2.5">
          <LevelDot hex={item.colorHex} size={10} ring />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-label font-extrabold text-[var(--text-primary)]">{item.title || "Notification"}</p>
              <span
                className="ml-auto shrink-0 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ backgroundColor: `color-mix(in srgb, ${item.colorHex} 16%, transparent)`, color: item.colorHex }}
              >
                {item.levelLabel || `L${item.level}`}
              </span>
            </div>
            {item.body ? <p className="mt-1 line-clamp-3 text-caption text-[var(--text-secondary)]">{item.body}</p> : null}
            <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              {item.ruleKey || "system"} · {relTime(item.createdAt)}
            </p>
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-1.5 top-1.5 rounded-md p-1 text-[var(--text-tertiary)] transition hover:bg-[var(--bg-input)]"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export function NotificationToasts() {
  const { toasts, dismissToast, openPanel, markRead } = useNotifications();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 right-4 z-[60] flex flex-col items-end gap-2.5">
      {toasts.map((t) => (
        <div key={t.id} className="relative">
          <Toast
            item={t}
            onOpen={() => { markRead(t.id); openPanel(); }}
            onDismiss={() => dismissToast(t.id)}
          />
        </div>
      ))}
    </div>
  );
}
