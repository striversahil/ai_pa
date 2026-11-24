"use client";

// NotificationDrawer — the bell panel: newest 200 notifications, newest first.
//
// 200 is the server cap too (`GET /api/notifications?limit=200`), so the panel
// never lies about "everything": the footer states the cap explicitly.
// Filters are client-side over that one payload (no extra request per chip).
import React, { useMemo, useState } from "react";
import { Drawer, Button, EmptyState, TabBar } from "@/components/ui";
import { useNotifications } from "@/notifications/NotificationProvider";
import { relTime } from "@/notifications/helpers";
import { LevelChip, LevelDot } from "./LevelDot";
import type { NotificationPanelItem } from "@/notifications/types";

type Filter = "all" | "unread" | "2" | "3" | "4" | "5";

function Row({ item, onRead, readOnly }: { item: NotificationPanelItem; onRead: (id: string) => void; readOnly?: boolean }) {
  const unread = item.status === "QUEUED";
  return (
    <li>
      <button
        type="button"
        onClick={() => !readOnly && unread && onRead(item.id)}
        title={readOnly ? "Read-only — this is someone else's inbox" : undefined}
        className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${readOnly ? "cursor-default" : "hover:bg-[var(--surface-sunken)]"} ${unread ? "bg-[var(--surface-sunken)]" : ""}`}
        style={{ borderLeftColor: item.colorHex || "transparent" }}
      >
        <div className="flex items-start gap-2">
          <LevelDot hex={item.colorHex} size={8} ring={unread} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className={`truncate text-label ${unread ? "font-bold" : "font-medium"} text-[var(--text-primary)]`}>{item.title || "(no title)"}</p>
              <LevelChip level={item.level} hex={item.colorHex} label={item.levelLabel} />
              <span className="ml-auto shrink-0 text-[10px] font-medium text-[var(--text-tertiary)]">{relTime(item.createdAt)}</span>
            </div>
            {item.body ? <p className="mt-0.5 line-clamp-2 text-caption text-[var(--text-secondary)]">{item.body}</p> : null}
            <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              {item.ruleKey ? item.ruleKey : "system"}
              {item.value !== null ? ` · value ${item.value}` : ""}
              {unread ? " · unread" : ""}
            </p>
          </div>
        </div>
      </button>
    </li>
  );
}

export function NotificationDrawer() {
  const { panelOpen, closePanel, items, unread, loading, refreshing, error, markRead, markAllRead, maxRows, levels, viewOnly } = useNotifications();
  const [filter, setFilter] = useState<Filter>("all");
  if (!panelOpen) return null;

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter((n) => n.status === "QUEUED");
    const level = Number(filter);
    return items.filter((n) => n.level === level);
  }, [items, filter]);

  return (
    <Drawer
      title="Notifications"
      subtitle={`${unread} unread · showing newest ${Math.min(items.length, maxRows)} of max ${maxRows}${viewOnly ? " · read-only" : ""}`}
      onClose={closePanel}
      width="max-w-xl"
      headerRight={
        viewOnly ? null : <Button size="sm" variant="ghost" onClick={markAllRead} disabled={unread === 0}>Mark all read</Button>
      }
    >
      <div className="border-b border-[var(--border-card)] px-3 py-2">
        <TabBar
          variant="pill"
          active={filter}
          onChange={(k: string) => setFilter(k as Filter)}
          items={[
            { key: "all", label: `All ${items.length}` },
            { key: "unread", label: `Unread ${unread}` },
            ...levels.filter((l) => l.level >= 2).map((l) => ({ key: String(l.level), label: `${l.level} ${l.label.split(" / ")[0]}` })),
          ]}
        />
      </div>
      {refreshing ? <div className="px-4 py-1 text-[10px] font-medium text-[var(--text-tertiary)]">Refreshing…</div> : null}
      {error && items.length === 0 ? (
        <div className="p-4">
          <EmptyState title="Could not load notifications" description={String((error as any)?.message ?? "Try again in a moment.")} />
        </div>
      ) : loading && items.length === 0 ? (
        <p className="p-4 text-caption text-[var(--text-tertiary)]">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title={filter === "all" ? "No notifications yet" : "Nothing in this filter"}
            description={filter === "all" ? "Position-wise escalations will land here the moment a rule fires." : "Switch the filter to see the rest."}
          />
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-card)]">
          {filtered.map((n) => <Row key={n.id} item={n} onRead={markRead} readOnly={viewOnly} />)}
        </ul>
      )}
      <p className="border-t border-[var(--border-card)] px-4 py-2 text-[10px] text-[var(--text-tertiary)]">
        {viewOnly
          ? "Read-only — these are someone else's notifications. Their unread state is untouched while you view as them."
          : `Audit is capped at the newest ${maxRows} rows. Level 1 (Normal / Resolved) is recorded here but never popped as a toast.`}
      </p>
    </Drawer>
  );
}
