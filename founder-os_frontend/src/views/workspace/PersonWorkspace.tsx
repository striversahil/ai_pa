"use client";

// views/workspace/PersonWorkspace — THE Workspace: one tabbed dashboard per
// login, replacing the pile of individually-granted automation sheets.
//
// Tabs = the viewer's server-filtered workspaces (GET /api/session/workspaces
// — the same list that used to be sidebar rows), rendered with the REAL
// components (WorkspaceRenderer, never copies). Sales-head holders get a
// leading "My Day" tab (target + severity + tasks + streak). The
// NotificationDock rides every tab. Deep links (/session/<slug>) select the
// matching tab instead of a separate single-sheet page.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { grantedScopes } from "@/auth/permissions";
import { useWorkspaces } from "@/workspaces/useWorkspaces";
import { WorkspaceRenderer } from "@/workspaces/registry";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { useNotifications } from "@/hooks/useNotifications";
import { completeAction, fetchTeamWork } from "@/personal/api";
import { recordDoneToday, streakDays } from "@/personal/rewards";
import SeverityFeed from "@/position-widgets/SeverityFeed";
import MyTasksWidget from "@/position-widgets/MyTasksWidget";
import TargetTileWidget from "@/position-widgets/TargetTileWidget";
import NotificationDock from "@/position-widgets/NotificationDock";
import { MotionStyle, ProgressRing, Skeleton, TabPanel } from "@/components/ui/motion";

const TAB_KEY = "pw-tab";

export default function PersonWorkspace({ initialSlug }: { initialSlug?: string | null }) {
  const { me } = useAuth();
  const { workspaces, loading } = useWorkspaces();
  const notes = useNotifications();
  const team = useLiveDashboard(fetchTeamWork, { events: ["telecalling", "human-resources", "notifications"], pollMs: 60000 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);

  const isSalesHead = !!me && (me.isRoot || grantedScopes(me).has("sales-head"));
  const tabs = useMemo(() => workspaces.map((w) => w.slug), [workspaces]);

  const [tab, setTab] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved) return saved;
    } catch { /* SSR/private mode */ }
    return "my-day";
  });

  // Deep link (/session/<slug>) or first paint: pick a valid tab once the
  // server-filtered list arrives. Never fight the user's own tab taps after.
  useEffect(() => {
    if (tabs.length === 0) return;
    if (initialSlug && tabs.includes(initialSlug)) { setTab(initialSlug); return; }
    setTab((cur) => {
      if (cur === "my-day") return isSalesHead ? "my-day" : tabs[0];
      return tabs.includes(cur) ? cur : isSalesHead ? "my-day" : tabs[0];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.join(","), initialSlug]);

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* noop */ }
  }, [tab]);
  useEffect(() => { setStreak(streakDays()); }, []);

  const actions = team.data?.actions ?? [];

  const complete = async (id: string) => {
    setBusyId(id);
    try {
      await completeAction(id); // audited server-side (actor + notify)
      setStreak(recordDoneToday());
      team.refresh();
    } catch { /* MyTasksWidget shows the error via refresh state; keep simple */ }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-3">
      <MotionStyle />
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Workspace</h1>
          <p className="text-[11px] text-zinc-500">One dashboard — your sheets as tabs, delays in the bell.</p>
        </div>
        {streak > 0 && (
          <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/5 px-2.5 py-1">
            <ProgressRing value={Math.min(1, streak / 7)} size={28} />
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">🔥 {streak}-day streak</span>
          </div>
        )}
      </div>

      {loading && tabs.length === 0 ? (
        <Skeleton lines={4} />
      ) : tabs.length === 0 && !isSalesHead ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
          <div className="text-4xl">🗂️</div>
          <p className="max-w-md text-sm text-zinc-500">No dashboards are assigned to your account yet. Ask the administrator to grant access.</p>
        </div>
      ) : (
        <>
          <div className="sticky top-0 z-10 -mx-1 overflow-x-auto px-1 py-1">
            <div className="flex gap-1.5">
              {isSalesHead && (
                <TabButton active={tab === "my-day"} onClick={() => setTab("my-day")} label="My Day" hot={actions.length > 0} />
              )}
              {tabs.map((slug) => (
                <TabButton key={slug} active={tab === slug} onClick={() => setTab(slug)} label={tabLabel(slug)} />
              ))}
            </div>
          </div>

          <TabPanel tabKey={tab}>
            {tab === "my-day" && isSalesHead ? (
              <div className="grid gap-2 lg:grid-cols-2">
                <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-zinc-400">Today</h3>
                  <TargetTileWidget label="Open follow-ups" value={String(actions.length)} sub="Target math plugs in next — count is live" />
                </section>
                <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-zinc-400">Needs attention</h3>
                  {team.loading && actions.length === 0 ? <Skeleton lines={2} /> : <SeverityFeed actions={actions} />}
                </section>
                <section className="rounded-xl border border-zinc-200 bg-white p-3 lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-950">
                  <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-zinc-400">My tasks</h3>
                  {team.loading && actions.length === 0 ? <Skeleton lines={3} /> : <MyTasksWidget actions={actions} onComplete={complete} busyId={busyId} />}
                </section>
              </div>
            ) : (
              <WorkspaceRenderer slug={tab} />
            )}
          </TabPanel>
        </>
      )}

      <NotificationDock notes={notes.notes} unread={notes.unread} onRead={(id) => void notes.read(id)} />
    </div>
  );
}

function TabButton({ active, onClick, label, hot }: { active: boolean; onClick: () => void; label: string; hot?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
        active
          ? "border-transparent bg-indigo-600 text-white"
          : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      {hot && !active && <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />}
      {label}
    </button>
  );
}

function tabLabel(slug: string): string {
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
