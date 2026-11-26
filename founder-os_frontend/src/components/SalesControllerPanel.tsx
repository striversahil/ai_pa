"use client";

import { useState, useCallback } from "react";
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import NeoDoveCampaignSection from "@/components/telecalling/NeoDoveCampaignSection";
import AutoDialerSection from "@/components/telecalling/auto-dialer/AutoDialerSection";
import RehomeEstimateSection from "@/components/telecalling/RehomeEstimateSection";
import SalesHolidaysSection from "@/components/telecalling/SalesHolidaysSection";
import ClientSegmentSection from "@/components/telecalling/ClientSegmentSection";
import OrganizationTab from "@/components/human-resources/OrganizationTab";
import SalesRegionsSection from "./sales-controller-panel/SalesRegionsSection";
import { fetchSalesRegions } from "@/sales/regions";
import { type RosterRow } from "./TelecallingDashboard";
import { workspaceDataUrl } from "@/workspaces/api";
import { hasSalesManagerAccess, TELECALLING_EVENTS } from "./sales-controller-panel/helpers";
import { UnmappedSection } from "./sales-controller-panel/UnmappedSection";
import { HistoryResetSection } from "./sales-controller-panel/HistoryResetSection";
import { ExportDataSection } from "./sales-controller-panel/ExportDataSection";

// Pieces split into ./sales-controller-panel/ (importable on their own); re-exported for compat.
export { hasSalesManagerAccess } from "./sales-controller-panel/helpers";

export default function SalesControllerPanel() {
  const { me } = useAuth();
  const canManage = hasSalesManagerAccess(me);
  const [busy, setBusy] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  // Period-free telecalling read: unmapped bucket + epoch (never the leaderboard).
  const tele = useLiveQuery<any>(
    async () => {
      const res = await fetch(workspaceDataUrl("telecalling"));
      if (!res.ok) throw new Error("Controller load failed");
      return res.json();
    },
    { events: TELECALLING_EVENTS, clearOnError: true },
  );
  const unmapped = tele.data?.unmapped ?? null;
  const unmappedAccepted = tele.data?.unmappedAccepted ?? null;
  const epoch = tele.data?.epoch ?? null;

  // Read-only roster for the Export section (the roster editor retired
  // 2026-11-14 — writes live in the Organization chart below).
  const roster = useLiveQuery<{ telecallers: RosterRow[] }>(
    async () => {
      const res = await fetch("/api/telecallers");
      if (!res.ok) throw new Error("roster load failed");
      return res.json();
    },
    { events: TELECALLING_EVENTS },
  );

  // Region catalog + chart-seat allotment: the sales head owns these here.
  const regions = useLiveQuery(fetchSalesRegions, { events: TELECALLING_EVENTS, pollMs: 60000 });

  const refreshAll = useCallback(() => {
    tele.refresh();
    roster.refresh();
    regions.refresh();
  }, [tele, roster, regions]);

  if (!canManage) {
    return (
      <p className="px-1 text-xs text-zinc-500 dark:text-zinc-600">
        🔒 Controller is restricted to root and Sales Head users.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-1 text-lg font-bold">🎛️ Controller</h3>
        <p className="mb-0 text-xs text-zinc-500 dark:text-zinc-400">
          Root/sales-head control of the region model — unmapped estimate
          linking, history reset and the sales team.
        </p>
      </section>
      {!!tele.error && !tele.loading && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
          Controller failed to load — {String((tele.error as any)?.message ?? tele.error)}{" "}
          <button type="button" onClick={() => tele.refresh()} className="underline">retry</button>
        </p>
      )}
      <UnmappedSection
        unmapped={unmapped}
        unmappedAccepted={unmappedAccepted}
        busy={busy}
        setBusy={setBusy}
        setError={setRosterError}
        refreshAll={refreshAll}
      />
      <AutoDialerSection rosterRows={roster.data?.telecallers ?? []} />
      <NeoDoveCampaignSection canManage={canManage} />
      <RehomeEstimateSection
        busy={busy}
        setBusy={setBusy}
        setError={setRosterError}
        refreshAll={refreshAll}
      />
      <ClientSegmentSection refreshAll={refreshAll} />
      <SalesHolidaysSection refreshAll={refreshAll} />
      <HistoryResetSection
        epoch={epoch}
        busy={busy}
        setBusy={setBusy}
        setError={setRosterError}
        refreshAll={refreshAll}
      />
      <ExportDataSection rosterRows={roster.data?.telecallers ?? []} showRisk />
      {!!regions.error && !regions.loading && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
          Region catalog failed to load — {String((regions.error as any)?.message ?? regions.error)}
        </p>
      )}
      {regions.data && <SalesRegionsSection data={regions.data} onChanged={() => regions.refresh()} />}
      {/* Sales team & access — the Organization chart scoped to Sales. There is
          no separate roster: a person save owns the seat, and the chart itself
          is HR-owned (read-only here — no add/edit/delete position). */}
      <section className="space-y-3">
        <h3 className="text-lg font-bold">Sales team &amp; access</h3>
        <p className="text-xs text-zinc-500">
          The region catalog above drives the form. Edit a person here to seat them; their employee record is the roster, and the chart structure stays with HR.
        </p>
        {rosterError && (
          <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-semibold text-rose-600 dark:text-rose-300">{rosterError}</p>
        )}
        <OrganizationTab department="Sales" chartEditable={false} />
      </section>
    </div>
  );
}
