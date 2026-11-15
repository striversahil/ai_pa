"use client";

// SalesWorkspace — the ONE sales surface.
//
// Leaderboard, analyzer, enquiry pipeline, customer book, region dispatch and the
// Root/sales-head Controller behind a single sticky horizontal tab bar.
// Enquiries and Customer Master stay global (the whole book is visible to
// sales); only Dispatch is region-owned (server-enforced from the roster row).
//
// Tabs live in sales/tabs.ts (shared with the Sales Head dashboard) — this
// file only maps tab keys to its lazy panels.
import React from "react";
import dynamic from "next/dynamic";
import { useSalesTabs } from "@/sales/tabs";
import { TabBar } from "@/components/ui";

// Lazy panels: opening Sales must not parse the leaderboard + customer book +
// dispatch bundle at once. Next dynamic() keeps each in its own chunk.
const TelecallingDashboard = dynamic(() => import("./TelecallingDashboard"), { ssr: false });
const Analyzer = dynamic(() => import("./ZohoEstimates"), { ssr: false });
const EnquiryTracker = dynamic(() => import("./EnquiryTracker"), { ssr: false });
const MasterDataView = dynamic(() => import("./master-data/MasterDataView"), { ssr: false });
const SalesDispatchPanel = dynamic(() => import("./SalesDispatchPanel"), { ssr: false });
const FieldStaffPanel = dynamic(() => import("./FieldStaffPanel"), { ssr: false });
const SalesObjectionsPanel = dynamic(() => import("./SalesObjectionsPanel"), { ssr: false });
const SalesControllerPanel = dynamic(() => import("./SalesControllerPanel"), { ssr: false });

export default function SalesWorkspace() {
  const { tabs, active, setActive } = useSalesTabs();

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
            Leaderboard, analyzer, enquiry pipeline, customer book, region dispatch, field objections — one place.
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
          onChange={(k) => setActive(k as typeof active)}
          className="[&_button[aria-current=page]]:shadow-lg [&_button[aria-current=page]]:ring-2 [&_button[aria-current=page]]:ring-white/70"
        />
      </div>

      <div>
        {active === "leaderboard" && <TelecallingDashboard />}
        {active === "analyzer" && <Analyzer />}
        {active === "enquiries" && <EnquiryTracker />}
        {active === "master" && <MasterDataView />}
        {active === "dispatch" && <SalesDispatchPanel />}
        {active === "field" && <FieldStaffPanel />}
        {active === "objections" && <SalesObjectionsPanel />}
        {active === "controller" && <SalesControllerPanel />}
      </div>
    </div>
  );
}
