"use client";

// views/workspace/SalesHeadDashboard — the Sales Head's ONE custom dashboard.
//
// Built by composing every Sales section (leaderboard, analyzer, enquiries,
// customer book, dispatch, field, objections, controller) as animated stacked
// sections on a single scroll page — the REAL panels (same dynamic imports as
// SalesWorkspace, never copies), gated by the same canView rules. My Day hero
// (target + severity + tasks + streak) leads; the NotificationDock rides along.
// Below-fold sections lazy-mount so first paint stays fast.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/auth/AuthContext";
import { canView, grantedScopes } from "@/auth/permissions";
import { masterCapabilities } from "@/master-data/permissions";
import { hasSalesManagerAccess } from "@/components/SalesControllerPanel";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { useNotifications } from "@/hooks/useNotifications";
import { completeAction, fetchTeamWork } from "@/personal/api";
import { recordDoneToday, streakDays } from "@/personal/rewards";
import SeverityFeed from "@/position-widgets/SeverityFeed";
import MyTasksWidget from "@/position-widgets/MyTasksWidget";
import TargetTileWidget from "@/position-widgets/TargetTileWidget";
import NotificationDock from "@/position-widgets/NotificationDock";
import { LazySection, MotionStyle, ProgressRing, Skeleton } from "@/components/ui/motion";

// Same chunks as SalesWorkspace — one network copy, two compositions.
const TelecallingDashboard = dynamic(() => import("@/components/TelecallingDashboard"), { ssr: false });
const Analyzer = dynamic(() => import("@/components/ZohoEstimates"), { ssr: false });
const EnquiryTracker = dynamic(() => import("@/components/EnquiryTracker"), { ssr: false });
const MasterDataView = dynamic(() => import("@/components/master-data/MasterDataView"), { ssr: false });
const SalesDispatchPanel = dynamic(() => import("@/components/SalesDispatchPanel"), { ssr: false });
const FieldStaffPanel = dynamic(() => import("@/components/FieldStaffPanel"), { ssr: false });
const SalesObjectionsPanel = dynamic(() => import("@/components/SalesObjectionsPanel"), { ssr: false });
const SalesControllerPanel = dynamic(() => import("@/components/SalesControllerPanel"), { ssr: false });

export default function SalesHeadDashboard() {
  const { me } = useAuth();
  const isRootPreview = !!me?.isRoot;
  const notes = useNotifications();
  const team = useLiveDashboard(fetchTeamWork, { events: ["telecalling", "human-resources", "notifications"], pollMs: 60000 });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  useEffect(() => { setStreak(streakDays()); }, []);

  const caps = masterCapabilities(me);
  const canManage = hasSalesManagerAccess(me);
  const has = (slug: string) => canView(me, slug);
  const showLeaderboard = has("telecalling");
  const showAnalyzer = has("telecalling");
  const showEnquiries = has("enquiry-tracker");
  const showMaster = caps.canView;
  const showDispatch = has("crm") || has("telecalling") || has("dispatch");
  const showField = has("telecalling") || canManage;
  const showObjections = has("telecalling") || canManage;
  const showController = canManage;

  const actions = team.data?.actions ?? [];
  const _held = grantedScopes(me); // hierarchy gate lives here when packs multiply

  const complete = async (id: string) => {
    setBusyId(id);
    try {
      await completeAction(id); // audited server-side (actor + notify)
      setStreak(recordDoneToday());
      team.refresh();
    } finally { setBusyId(null); }
  };

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
          <p className="text-[11px] text-zinc-500">Targets, team, book and floor — one page, delays in the bell.</p>
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

      {showLeaderboard && (
        <SectionCard title="Leaderboard" hint="Team performance">
          <LazySection eager label="Leaderboard"><TelecallingDashboard /></LazySection>
        </SectionCard>
      )}
      {showAnalyzer && (
        <SectionCard title="Analyzer" hint="Sent-estimate analysis">
          <LazySection label="Analyzer"><Analyzer /></LazySection>
        </SectionCard>
      )}
      {showEnquiries && (
        <SectionCard title="Enquiries" hint="Pipeline">
          <LazySection label="Enquiries"><EnquiryTracker /></LazySection>
        </SectionCard>
      )}
      {showMaster && (
        <SectionCard title="Customer Master" hint="The book">
          <LazySection label="Customer Master"><MasterDataView /></LazySection>
        </SectionCard>
      )}
      {showDispatch && (
        <SectionCard title="Dispatch" hint="Region floor">
          <LazySection label="Dispatch"><SalesDispatchPanel /></LazySection>
        </SectionCard>
      )}
      {showField && (
        <SectionCard title="Field Staff" hint="Visits + check-ins">
          <LazySection label="Field Staff"><FieldStaffPanel /></LazySection>
        </SectionCard>
      )}
      {showObjections && (
        <SectionCard title="Objections" hint="What the field hears">
          <LazySection label="Objections"><SalesObjectionsPanel /></LazySection>
        </SectionCard>
      )}
      {showController && (
        <SectionCard title="Controller" hint="Sales-head controls">
          <LazySection label="Controller"><SalesControllerPanel /></LazySection>
        </SectionCard>
      )}

      <NotificationDock notes={notes.notes} unread={notes.unread} onRead={(id) => void notes.read(id)} />
    </div>
  );
}

function SectionCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-extrabold">{title}</h2>
        <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">{hint}</span>
      </div>
      {children}
    </section>
  );
}
