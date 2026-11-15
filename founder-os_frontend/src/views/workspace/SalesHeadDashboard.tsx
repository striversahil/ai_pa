"use client";

// views/workspace/SalesHeadDashboard — the Sales Head's ONE custom dashboard.
//
// My Day hero (target + severity + tasks + streak) pinned on top, then the
// shared Sales tabs (same TabBar + same gates as SalesWorkspace, via
// sales/tabs.ts) rendering the REAL panels — one at a time, animated in.
// The NotificationDock rides along. Below: nothing — tabs replaced the scroll.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/auth/AuthContext";
import { useSalesTabs, type SalesTab } from "@/sales/tabs";
import { TabBar } from "@/components/ui";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { useNotifications } from "@/hooks/useNotifications";
import { completeAction, fetchTeamWork } from "@/personal/api";
import { recordDoneToday, streakDays } from "@/personal/rewards";
import SeverityFeed from "@/position-widgets/SeverityFeed";
import MyTasksWidget from "@/position-widgets/MyTasksWidget";
import TargetTileWidget from "@/position-widgets/TargetTileWidget";
import NotificationDock from "@/position-widgets/NotificationDock";
import { MotionStyle, ProgressRing, Skeleton, TabPanel } from "@/components/ui/motion";

// Same chunks as SalesWorkspace — one network copy, two compositions.
const TelecallingDashboard = dynamic(() => import("@/components/TelecallingDashboard"), { ssr: false });
const Analyzer = dynamic(() => import("@/components/ZohoEstimates"), { ssr: false });
const EnquiryTracker = dynamic(() => import("@/components/EnquiryTracker"), { ssr: false });
const MasterDataView = dynamic(() => import("@/components/master-data/MasterDataView"), { ssr: false });
const SalesDispatchPanel = dynamic(() => import("@/components/SalesDispatchPanel"), { ssr: false });
const FieldStaffPanel = dynamic(() => import("@/components/FieldStaffPanel"), { ssr: false });
const SalesObjectionsPanel = dynamic(() => import("@/components/SalesObjectionsPanel"), { ssr: false });
const SalesControllerPanel = dynamic(() => import("@/components/SalesControllerPanel"), { ssr: false });

const PANELS: Record<SalesTab, React.ComponentType> = {
  leaderboard: TelecallingDashboard,
  analyzer: Analyzer,
  enquiries: EnquiryTracker,
  master: MasterDataView,
  dispatch: SalesDispatchPanel,
  field: FieldStaffPanel,
  objections: SalesObjectionsPanel,
  controller: SalesControllerPanel,
};

export default function SalesHeadDashboard() {
  const { me } = useAuth();
  const isRootPreview = !!me?.isRoot;
  const { tabs, active, setActive } = useSalesTabs();
  const notes = useNotifications();
  const team = useLiveDashboard(fetchTeamWork, { events: ["telecalling", "human-resources", "notifications"], pollMs: 60000 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  useEffect(() => { setStreak(streakDays()); }, []);

  const actions = team.data?.actions ?? [];

  const complete = async (id: string) => {
    setBusyId(id);
    try {
      await completeAction(id); // audited server-side (actor + notify)
      setStreak(recordDoneToday());
      team.refresh();
    } finally { setBusyId(null); }
  };

  const Panel = PANELS[active];

  return (
    <div className="space-y-3">
      <MotionStyle />
      {isRootPreview && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          Root preview of the Sales Head dashboard — every Done / save writes as <b>root (audited)</b>.
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Sales Head</h1>
          <p className="text-[11px] text-zinc-500">Today first, then the floor — delays in the bell.</p>
        </div>
        {streak > 0 && (
          <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/5 px-2.5 py-1">
            <ProgressRing value={Math.min(1, streak / 7)} size={28} />
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">🔥 {streak}-day streak</span>
          </div>
        )}
      </div>

      {/* My Day hero — always live, always first. */}
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

      {/* The floor — same tabs as Sales, one panel at a time. */}
      {tabs.length > 0 && (
        <div className="sticky top-0 z-10 -mx-1 border-b border-zinc-200 bg-white/95 px-1 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <TabBar
            ariaLabel="Sales Head sections"
            items={tabs.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
            active={active}
            onChange={(k) => setActive(k as SalesTab)}
          />
        </div>
      )}
      {tabs.length > 0 && Panel && (
        <TabPanel tabKey={active}>
          <Panel />
        </TabPanel>
      )}

      <NotificationDock notes={notes.notes} unread={notes.unread} onRead={(id) => void notes.read(id)} />
    </div>
  );
}
