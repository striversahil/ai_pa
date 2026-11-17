"use client";

// views/workspace/SalesHeadDashboard — the Sales Head live preview.
//
// Mounted ONLY by the root-only position gallery (/workspace) so root can
// peek into the Sales Head dashboard + take control (audited). The tile grid
// (/session) is dashboard-based — no forced single home.
// The shared Sales tabs (same TabBar + same gates as SalesWorkspace, via
// sales/tabs.ts) rendering the REAL panels — one at a time, animated in.
// The NotificationDock rides along. Below: nothing — tabs replaced the scroll.
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/auth/AuthContext";
import { IMPLIED_SCOPES } from "@/auth/permissions";
import { useSalesTabs, type SalesTab } from "@/sales/tabs";
import { TabBar } from "@/components/ui";
import { useNotifications } from "@/hooks/useNotifications";
import NotificationDock from "@/position-widgets/NotificationDock";
import { MotionStyle, TabPanel } from "@/components/ui/motion";
import { useWorkspaces } from "@/workspaces/useWorkspaces";
import { WorkspaceRenderer } from "@/workspaces/registry";

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

export default function SalesHeadDashboard({ initialSlug }: { initialSlug?: string | null }) {
  const { me } = useAuth();
  const isRootPreview = !!me?.isRoot;
  const { tabs, active, setActive } = useSalesTabs();
  const notes = useNotifications();

  // Admin-granted sheets beyond Sales (accounts, stock, reporting-sheet, …).
  // The server list is already scope-filtered; 'sales' itself is the custom
  // dashboard above, never a duplicate tab. Other roles reach these through
  // the tile grid — sales-head used to drop them entirely.
  // Root preview sees through HER eyes, not root omniscience: extras are
  // scoped to the sales-head bundle (same set useSalesTabs gates on), so the
  // peek shows her sheets instead of every dashboard.
  const { workspaces } = useWorkspaces();
  const headBundle = useMemo(
    () => new Set(["sales-head", ...(IMPLIED_SCOPES["sales-head"] ?? [])]),
    [],
  );
  const extras = useMemo(
    () =>
      workspaces.filter(
        (w) => w.slug !== "sales" && (!isRootPreview || w.scopes.some((s) => headBundle.has(s))),
      ),
    [workspaces, isRootPreview, headBundle],
  );
  const [extraSlug, setExtraSlug] = useState<string | null>(null);
  useEffect(() => {
    if (initialSlug && extras.some((w) => w.slug === initialSlug)) setExtraSlug(initialSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlug, extras.map((w) => w.slug).join(",")]);
  const extra = extraSlug ? extras.find((w) => w.slug === extraSlug) ?? null : null;

  const Panel = PANELS[active];

  return (
    <div className="space-y-3">
      <MotionStyle />
      {isRootPreview && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          Root preview of the Sales Head dashboard — her bundle sheets only (personal grants may add more). Every Done / save writes as <b>root (audited)</b>.
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-extrabold tracking-tight">Sales Head</h1>
          <p className="text-[11px] text-zinc-500">The floor — delays in the bell.</p>
        </div>
      </div>

      {/* The floor — same tabs as Sales, one panel at a time, plus any
          admin-granted sheets beyond Sales (same renderer other roles get). */}
      {(tabs.length > 0 || extras.length > 0) && (
        <div className="sticky top-0 z-10 -mx-1 border-b border-zinc-200 bg-white/95 px-1 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <TabBar
            ariaLabel="Sales Head sections"
            items={[
              ...tabs.map((t) => ({ key: t.key, label: t.label, icon: t.icon })),
              ...extras.map((w) => ({ key: `ws:${w.slug}`, label: w.name, icon: "📊" })),
            ]}
            active={extra ? `ws:${extra.slug}` : active}
            onChange={(k) => {
              if (k.startsWith("ws:")) setExtraSlug(k.slice(3));
              else { setExtraSlug(null); setActive(k as SalesTab); }
            }}
          />
        </div>
      )}
      {extra ? (
        <TabPanel tabKey={extra.slug}>
          <WorkspaceRenderer slug={extra.slug} />
        </TabPanel>
      ) : (
        tabs.length > 0 && Panel && (
          <TabPanel tabKey={active}>
            <Panel />
          </TabPanel>
        )
      )}

      <NotificationDock notes={notes.notes} unread={notes.unread} onRead={(id) => void notes.read(id)} />
    </div>
  );
}
