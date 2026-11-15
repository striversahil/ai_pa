"use client";

// views/workspace/WorkspaceView — root-only position builder (phase 1).
//
// Staff keep their automation sheets untouched. Root previews Sales Head +
// Telecaller packs here, composed from the same widgets staff will get later.
// Act-as = the existing audited writes (complete action, person save) with the
// preview banner on — never a silent write: the server stamps actor + audit.
import { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import { fetchOrgPeople } from "@/org/api";
import { completeAction, fetchNotifications, fetchTeamWork, markNotificationRead } from "@/personal/api";
import { isPhaseOneTitle, positionDashboard, type PositionWidgetKey } from "@/hr/position-dashboards";
import SeverityFeed from "@/position-widgets/SeverityFeed";
import MyTasksWidget from "@/position-widgets/MyTasksWidget";
import TargetTileWidget from "@/position-widgets/TargetTileWidget";
import PresenceDots from "@/position-widgets/PresenceDots";

const TITLES = ["Sales Head", "Telecaller"] as const;

export default function WorkspaceView() {
  const { me } = useAuth();
  const [title, setTitle] = useState<(typeof TITLES)[number]>("Sales Head");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const def = positionDashboard(title);
  const dash = useLiveDashboard(async () => {
    const [org, team, notes] = await Promise.all([fetchOrgPeople("Sales"), fetchTeamWork(), fetchNotifications()]);
    return { org, team, notes };
  }, { events: ["human-resources", "telecalling", "notifications"], pollMs: 60000 });

  const people = useMemo(() => {
    const list = dash.data?.org.people ?? [];
    return list.filter((p) => String(p.employee.designation ?? "").trim() === title);
  }, [dash.data, title]);

  const actions = useMemo(() => {
    const all = dash.data?.team.actions ?? [];
    if (people.length === 0) return all.slice(0, 20);
    const ids = new Set(people.map((p) => p.employee.id));
    // Preview-as: surface open actions assigned to anyone seated here, plus the
    // root's own queue head so the tile is never empty in preview.
    const mine = all.filter((a) => a.assigneeId && ids.has(a.assigneeId));
    return (mine.length > 0 ? mine : all).slice(0, 20);
  }, [dash.data, people]);

  const complete = async (id: string) => {
    setBusyId(id); setError(null);
    try {
      // Audited act-as: server stamps actor=root, notifies the assignee.
      await completeAction(id);
      dash.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Complete failed");
    } finally { setBusyId(null); }
  };

  const readNote = async (id: string) => {
    try { await markNotificationRead(id); dash.refresh(); } catch { /* best-effort */ }
  };

  if (me && !me.isRoot) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
        <div className="text-4xl">🔒</div>
        <p className="text-sm text-zinc-500">Position builder is root-only while staff use their automation sheets.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
        Root preview — staff still see their automation sheets. Every Done / save here writes as <b>root (audited)</b>, never as the position holder.
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {TITLES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTitle(t)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
              title === t
                ? "border-transparent bg-indigo-600 text-white"
                : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {t}{isPhaseOneTitle(t) ? "" : " · soon"}
          </button>
        ))}
        <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-zinc-400">code-config drafts · phase 1</span>
      </div>

      {def && (
        <p className="text-[11px] text-zinc-500">{def.description} · Widgets: {def.widgets.join(" · ")}</p>
      )}

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{error}</div>}
      {dash.loading && !dash.data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading position preview…</div>}
      {Boolean(dash.error) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">
          Preview failed: {String(dash.error)} <button onClick={() => dash.refresh()} className="ml-2 underline">retry</button>
        </div>
      )}

      {dash.data && def && (
        <div className="grid gap-2 lg:grid-cols-2">
          {def.widgets.map((w: PositionWidgetKey) => (
            <section key={w} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-zinc-400">{widgetTitle(w)}</h3>
              {w === "severity" && <SeverityFeed actions={actions} />}
              {w === "tasks" && <MyTasksWidget actions={actions} onComplete={complete} busyId={busyId} />}
              {w === "target" && (
                <TargetTileWidget label={`${title} · today`} value={`${actions.length} open`} sub="Preview figure — live target math plugs in next" />
              )}
              {w === "team" && (
                <div className="flex flex-wrap gap-1.5">
                  {people.length === 0 && <span className="text-[11px] text-zinc-500">Nobody seated — assign someone in HR to fill this tile.</span>}
                  {people.map((p) => (
                    <span key={p.employee.id} className="rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] dark:border-zinc-800">
                      <span className="font-semibold">{p.employee.name}</span>
                      <span className="text-zinc-400"> · {p.roster ? `${p.roster.type} ${p.roster.region}` : "no roster"}</span>
                    </span>
                  ))}
                </div>
              )}
              {w === "presence" && (
                <PresenceDots people={people.map((p) => ({ id: p.employee.id, name: p.employee.name, lastLoginAt: p.login?.lastLoginAt ?? null }))} />
              )}
              {w === "visits" && <p className="text-[11px] text-zinc-500">Mill-visit updater plugs in with the field-staff pack.</p>}
            </section>
          ))}

          <section className="rounded-xl border border-zinc-200 bg-white p-3 lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-950">
            <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-zinc-400">Notifications ({dash.data.notes.unread} unread)</h3>
            {(dash.data.notes.notifications ?? []).length === 0 ? (
              <p className="text-[11px] text-zinc-500">⚪ Info — no queued notifications.</p>
            ) : (
              <div className="space-y-1.5">
                {(dash.data.notes.notifications ?? []).slice(0, 6).map((n) => (
                  <div key={n.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1.5 text-[11px] dark:border-zinc-800">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{n.title}</div>
                      <div className="truncate text-zinc-500">{n.body}</div>
                    </div>
                    <button type="button" onClick={() => void readNote(n.id)} className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      Read
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function widgetTitle(w: PositionWidgetKey): string {
  return w === "severity" ? "Severity feed" : w === "tasks" ? "My tasks" : w === "target" ? "Target" : w === "team" ? "Team rail" : w === "presence" ? "Presence" : "Mill visits";
}
