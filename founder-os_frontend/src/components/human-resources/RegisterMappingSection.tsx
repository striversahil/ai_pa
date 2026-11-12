"use client";

// HR register mapping queue — the single writer for sales-roster membership.
// Composition, not a fork: fetches the live roster via the telecalling domain
// api module, then renders the shared RosterMappingSection verbatim (region +
// type pickers, Map via from-directory, 409 → Link via the scoped endpoint).
// Lives in HR (her active tool), not in the Controller — the Controller keeps
// rendering the same section for the sales head; both call the same endpoints
// under the same requireRosterManager gate.
import { RosterMappingSection } from "@/components/sales-controller-panel/RosterMappingSection";
import { fetchSalesRoster } from "@/telecalling/api";
import { useLiveDashboard } from "@/hooks/useLiveData";
import type { RosterRow } from "@/components/TelecallingDashboard";

export default function RegisterMappingSection() {
  const roster = useLiveDashboard(async () => {
    const telecallers = await fetchSalesRoster();
    return { telecallers: telecallers as RosterRow[] };
  });
  const rosterRows = roster.data?.telecallers ?? [];
  const refreshAll = () => roster.refresh();

  if (roster.loading && !roster.data) {
    return <div className="py-6 text-center text-sm text-zinc-500 animate-pulse">Loading roster…</div>;
  }
  if (roster.error) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">
        Roster failed to load: {String(roster.error)}{" "}
        <button onClick={() => roster.refresh()} className="ml-2 underline">Retry</button>
      </div>
    );
  }
  return <RosterMappingSection rosterRows={rosterRows} refreshAll={refreshAll} />;
}
