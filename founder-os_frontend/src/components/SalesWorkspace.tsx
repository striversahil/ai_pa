"use client";

// SalesWorkspace — the ONE sales surface.
//
// Leaderboard, enquiry pipeline, customer book, region dispatch and the
// MIS/sales-head Controller behind a single sticky horizontal tab bar.
// Enquiries and Customer Master stay global (the whole book is visible to
// sales); only Dispatch is region-owned (server-enforced from the roster row).
import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "@/auth/AuthContext";
import { canView } from "@/auth/permissions";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { masterCapabilities } from "@/master-data/permissions";
import { hasSalesManagerAccess } from "./SalesControllerPanel";
import { TabBar } from "@/components/ui";

// Lazy panels: opening Sales must not parse the leaderboard + customer book +
// dispatch bundle at once. Next dynamic() keeps each in its own chunk.
const TelecallingDashboard = dynamic(() => import("./TelecallingDashboard"), { ssr: false });
const EnquiryTracker = dynamic(() => import("./EnquiryTracker"), { ssr: false });
const MasterDataView = dynamic(() => import("./master-data/MasterDataView"), { ssr: false });
const SalesDispatchPanel = dynamic(() => import("./SalesDispatchPanel"), { ssr: false });
const CallsPanel = dynamic(() => import("./CallsPanel"), { ssr: false });
const FieldStaffPanel = dynamic(() => import("./FieldStaffPanel"), { ssr: false });
const SalesObjectionsPanel = dynamic(() => import("./SalesObjectionsPanel"), { ssr: false });
const MyWorkPanel = dynamic(() => import("./MyWorkPanel"), { ssr: false });
const LeadsPanel = dynamic(() => import("./LeadsPanel"), { ssr: false });
const SalesControllerPanel = dynamic(() => import("./SalesControllerPanel"), { ssr: false });

type SalesTab = "mywork" | "leads" | "leaderboard" | "enquiries" | "master" | "dispatch" | "calls" | "field" | "objections" | "controller";

interface WorkspaceTab {
  key: SalesTab;
  label: string;
  icon: string;
}

const SALES_TAB_STORAGE_KEY = "sales_tab";

export default function SalesWorkspace() {
  const { me } = useAuth();
  const caps = masterCapabilities(me);
  const canManage = hasSalesManagerAccess(me);
  const [storedTab, setStoredTab] = useLocalStorage<SalesTab>(SALES_TAB_STORAGE_KEY, "mywork");

  const tabs = useMemo<WorkspaceTab[]>(() => {
    const out: WorkspaceTab[] = [];
    // My Work first: this login's queue (projected from open assignments).
    // Same audience as the leaderboard — server scopes every row.
    if (canView(me, "telecalling") || canManage) out.push({ key: "mywork", label: "My Work", icon: "📌" });
    // Leaderboard: everyone on the `sales` automation holds `telecalling`.
    if (canView(me, "telecalling")) out.push({ key: "leaderboard", label: "Leaderboard", icon: "🏆" });
    if (canView(me, "enquiry-tracker")) out.push({ key: "enquiries", label: "Enquiries", icon: "📋" });
    if (caps.canView) out.push({ key: "master", label: "Customer Master", icon: "👥" });
    // Dispatch reads are open to sales agents too (server-region-scoped); the
    // floor-only actions stay hidden inside the panel via the viewer flags.
    if (canView(me, "crm") || canView(me, "telecalling") || canView(me, "dispatch")) {
      out.push({ key: "dispatch", label: "Dispatch", icon: "🚚" });
    }
    // TEMPORARY Call Log (manual connected calls + screenshot proof): same
    // audience as the leaderboard. Delete with ManualCallsPanel when NeoDove
    // is trusted again.
    if (canView(me, "telecalling") || canManage) {
      out.push({ key: "calls", label: "Calls", icon: "📞" });
    }
    // Field Staff: daily visit tracking for the field force (mobile-web
    // check-in + mill rows + expenses + follow-ups). Same audience as the
    // leaderboard — agents log visits for field staff like field enquiries.
    if (canView(me, "telecalling") || canManage) {
      out.push({ key: "field", label: "Field Staff", icon: "🧑‍🌾" });
    }
    // Objections: what the field is hearing — same audience as the
    // leaderboard, every agent sees every objection. Controller stays last.
    if (canView(me, "telecalling") || canManage) {
      out.push({ key: "objections", label: "Objections", icon: "🛡️" });
    }
    // Leads: unqualified triage queue + lost-quote rates. Same audience as
    // My Work (server scopes every row); qualify buttons are TL/head-only.
    if (canView(me, "telecalling") || canManage) {
      out.push({ key: "leads", label: "Leads", icon: "🎯" });
    }
    // Controller is MIS/sales-head only and sits LAST so agents' tabs never shift.
    if (canManage) out.push({ key: "controller", label: "Controller", icon: "🎛️" });
    return out;
  }, [me, caps.canView, canManage]);

  // Never land on a tab this user cannot open (e.g. an agent without the
  // customer-master grant still gets Leaderboard → Enquiries → Dispatch).
  // The pick persists across reloads so the highlight always matches the view.
  const active = tabs.find((t) => t.key === storedTab)?.key ?? tabs[0]?.key ?? "leaderboard";

  if (tabs.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-8 text-center">
        <p className="text-sm font-semibold text-[var(--text-primary)]">No sales panels are available to this login</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-[var(--text-secondary)]">
          Ask root for the telecalling scope (Sales workspace) or the dispatch scope.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-[var(--text-primary)]">Sales</h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Leaderboard, enquiry pipeline, customer book, region dispatch, field objections — one place.
          </p>
        </div>
      </header>

      {/* Sticky section switch: stays visible while the board scrolls. The
          active pill gets a ring + shadow so the current section is obvious. */}
      <div className="sticky top-0 z-10 -mx-1 border-b border-[var(--border-card)] bg-[var(--bg-app)]/95 px-1 py-2 backdrop-blur">
        <TabBar
          ariaLabel="Sales sections"
          items={tabs.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
          active={active}
          onChange={(k) => setStoredTab(k as SalesTab)}
          className="[&_button[aria-current=page]]:shadow-lg [&_button[aria-current=page]]:ring-2 [&_button[aria-current=page]]:ring-white/70"
        />
      </div>

      <div>
        {active === "mywork" && <MyWorkPanel />}
        {active === "leaderboard" && <TelecallingDashboard />}
        {active === "enquiries" && <EnquiryTracker />}
        {active === "master" && <MasterDataView />}
        {active === "dispatch" && <SalesDispatchPanel />}
        {active === "calls" && <CallsPanel />}
        {active === "field" && <FieldStaffPanel />}
        {active === "objections" && <SalesObjectionsPanel />}
        {active === "leads" && <LeadsPanel />}
        {active === "controller" && <SalesControllerPanel />}
      </div>
    </div>
  );
}
