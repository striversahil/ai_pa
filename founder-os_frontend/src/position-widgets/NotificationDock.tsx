"use client";

// position-widgets/NotificationDock — the persistent bottom-right delay bell.
// Presentational: notes/unread in via props (useNotifications owns fetching),
// read callbacks out. Severity chips reuse SEVERITY_META so colors can't drift.
import { useMemo, useState } from "react";
import { SEVERITY_META, severityFor, type Severity } from "@/hr/position-dashboards";
import type { PersonalNotification } from "@/personal/api";

function worst(notes: PersonalNotification[]): Severity | null {
  let out: Severity | null = null;
  for (const n of notes) {
    const s = severityFor({ dueAt: null, priority: /urgent|critical/i.test(`${n.title} ${n.body}`) ? "URGENT" : null });
    if (!out || rank(s) < rank(out)) out = s;
  }
  return out;
}

function rank(s: Severity): number {
  return s === "critical" ? 0 : s === "high" ? 1 : s === "medium" ? 2 : s === "low" ? 3 : 4;
}

export default function NotificationDock({ notes, unread, onRead }: {
  notes: PersonalNotification[];
  unread: number;
  onRead: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const top = useMemo(() => worst(notes.slice(0, 20)), [notes]);
  const critical = notes.length > 0 && top === "critical";

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="pw-tab-enter w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="text-xs font-extrabold">Delays & escalations</span>
            <span className="text-[10px] font-bold text-zinc-400">{unread} unread</span>
          </div>
          <div className="max-h-80 space-y-1.5 overflow-y-auto p-2">
            {notes.length === 0 && <p className="px-1 py-3 text-center text-[11px] text-zinc-500">⚪ Info — nothing delayed.</p>}
            {notes.slice(0, 20).map((n) => {
              const s = severityFor({ dueAt: null, priority: /urgent|critical/i.test(`${n.title} ${n.body}`) ? "URGENT" : null });
              const meta = SEVERITY_META[s];
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onRead(n.id)}
                  className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                >
                  <span className={`inline-block rounded-full px-1.5 py-px text-[10px] font-bold ${meta.chip}`}>{meta.label}</span>
                  <span className="mt-0.5 block truncate text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">{n.title}</span>
                  <span className="block truncate text-[10px] text-zinc-500">{n.body}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close notifications" : "Open notifications"}
        className={`relative flex h-11 w-11 items-center justify-center rounded-full bg-indigo-600 text-lg text-white shadow-lg hover:bg-indigo-500 ${critical && !open ? "animate-pulse" : ""}`}
      >
        {open ? "✕" : "🔔"}
        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-extrabold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
        {!open && top && (
          <span className={`absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-white ${SEVERITY_META[top].dot}`} />
        )}
      </button>
    </div>
  );
}
