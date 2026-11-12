"use client";

// MyWorkPanel — the Sales → My Work tab (Phase 2).
//
// My queue (own OPEN follow-ups, projection converges them lazily on read)
// + team queue for managers (same scope rules as the dashboards). Completing
// an item marks it DONE; the projector never reopens DONE rows.
// Live via useLiveQuery with no events filter (refetch on any data-changed).
import React, { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useLiveQuery } from "@/hooks/useLiveData";
import { hasSalesManagerAccess } from "./SalesControllerPanel";
import { completeAction, fetchMyWork, fetchTeamWork, fetchNotifications, markNotificationRead, type WorkAction, type WorkPayload, type AppNotification } from "@/work/api";
import { groupByAssignee, isOverdue, sortWork } from "@/work/queue";

function istTodayYmd(): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date());
}

function priorityTone(p: string): string {
  switch (String(p ?? "").toUpperCase()) {
    case "URGENT": return "bg-red-100 text-red-800 ring-red-300";
    case "HIGH": return "bg-orange-100 text-orange-800 ring-orange-300";
    default: return "bg-slate-100 text-slate-600 ring-slate-300";
  }
}

function ActionRow({ a, today, busy, onDone }: { a: WorkAction; today: string; busy: boolean; onDone: (id: string) => void }) {
  const overdue = isOverdue(a, today);
  return (
    <li className="flex items-center gap-3 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{a.title}</p>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
          {a.dueAt ? <>due <span className={overdue ? "font-semibold text-red-600" : ""}>{a.dueAt.slice(0, 10)}</span>{overdue ? " · overdue" : ""}</> : "no due date"}
          {a.assigneeName ? <> · {a.assigneeName}</> : null}
        </p>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${priorityTone(a.priority)}`}>{a.priority}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => onDone(a.id)}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? "…" : "Done"}
      </button>
    </li>
  );
}

export default function MyWorkPanel() {
  const { me } = useAuth();
  const canManage = hasSalesManagerAccess(me as any);
  const today = useMemo(() => istTodayYmd(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const myQuery = useLiveQuery<WorkPayload>(fetchMyWork);
  const teamQuery = useLiveQuery<WorkPayload>(fetchTeamWork);
  // Phase 6a: in-app pull — unread notifications, live on any data-changed.
  const notesQuery = useLiveQuery<{ unread: number; notifications: AppNotification[] }>(fetchNotifications);
  const [readId, setReadId] = useState<string | null>(null);

  const markRead = useCallback(async (id: string) => {
    setReadId(id);
    try {
      await markNotificationRead(id);
      notesQuery.refresh();
    } catch { /* pull again on next event */ }
    finally {
      setReadId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notes = useMemo(() => notesQuery.data?.notifications ?? [], [notesQuery.data]);

  const myActions = useMemo(() => sortWork(myQuery.data?.actions ?? [], today), [myQuery.data, today]);
  const teamGroups = useMemo(
    () => groupByAssignee(sortWork(teamQuery.data?.actions ?? [], today)),
    [teamQuery.data, today],
  );
  const showTeam = canManage || (teamQuery.data?.actions?.length ?? 0) > 0;

  const done = useCallback(async (id: string) => {
    setBusyId(id);
    setMessage("");
    try {
      await completeAction(id);
      myQuery.refresh();
      teamQuery.refresh();
    } catch (e: any) {
      setMessage(e?.message ?? "could not complete");
    } finally {
      setBusyId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loading = myQuery.loading && !myQuery.data;
  const proj = myQuery.data?.projection;
  return (
    <div className="space-y-4">
      {message ? <p className="text-xs text-red-600">{message}</p> : null}

      {notes.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
            Notifications · {notesQuery.data?.unread ?? notes.length} unread
          </h2>
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="flex items-center gap-3 rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">{n.title}</p>
                  {n.body ? <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{n.body}</p> : null}
                </div>
                <button
                  type="button"
                  disabled={readId === n.id}
                  onClick={() => markRead(n.id)}
                  className="rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {readId === n.id ? "…" : "Mark read"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">My queue</h2>
        {loading ? (
          <p className="text-xs text-[var(--text-secondary)]">Loading…</p>
        ) : myActions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-card)] p-4 text-xs text-[var(--text-secondary)]">
            All clear — no open follow-ups. New assignments project here automatically.
          </p>
        ) : (
          <ul className="space-y-2">
            {myActions.map((a) => (
              <ActionRow key={a.id} a={a} today={today} busy={busyId === a.id} onDone={done} />
            ))}
          </ul>
        )}
        {proj && (proj.opened > 0 || proj.reassigned > 0 || proj.resolved > 0) ? (
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            Synced just now: {proj.opened} opened · {proj.reassigned} reassigned · {proj.resolved} resolved
          </p>
        ) : null}
      </section>

      {showTeam ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Team queue</h2>
          {teamQuery.loading && !teamQuery.data ? (
            <p className="text-xs text-[var(--text-secondary)]">Loading…</p>
          ) : teamGroups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border-card)] p-4 text-xs text-[var(--text-secondary)]">No open team items.</p>
          ) : (
            <div className="space-y-3">
              {teamGroups.map((g) => (
                <div key={g.name}>
                  <p className="mb-1 text-xs font-semibold text-[var(--text-secondary)]">{g.name} · {g.items.length}</p>
                  <ul className="space-y-2">
                    {g.items.map((a) => (
                      <ActionRow key={a.id} a={a} today={today} busy={busyId === a.id} onDone={done} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
