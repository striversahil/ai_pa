"use client";

// Extracted verbatim from SalesControllerPanel.tsx by scripts/refactor/split-module.mjs.
// SalesControllerPanel.tsx re-exports everything public here, so existing imports keep working.
import { fmtNum } from "../TelecallingDashboard";
import type { DashData } from "../TelecallingDashboard";
import { useState } from "react";
import { REGIONS } from "@/telecalling/regions";
import type { RegionId } from "@/telecalling/regions";

export function UnmappedSection({
  unmapped,
  unmappedAccepted,
  busy,
  setBusy,
  setError,
  refreshAll,
}: {
  unmapped: DashData["unmapped"];
  unmappedAccepted: DashData["unmappedAccepted"];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  refreshAll: () => void;
}) {
  const [regionBy, setRegionBy] = useState<Record<string, RegionId | "">>({});
  const link = async (estimateId: string) => {
    const region = regionBy[estimateId];
    if (!region) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}/region`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Link failed (${res.status})`);
      setRegionBy((prev) => { const { [estimateId]: _omit, ...rest } = prev; return rest; });
      refreshAll();
    } catch (e: any) {
      setError(e?.message ?? "Link failed");
    } finally {
      setBusy(false);
    }
  };
  const items = unmapped?.items ?? [];
  return (
    <section className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-lg font-bold mb-1 text-amber-700 dark:text-amber-400">🧭 Unmapped estimates</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {items.length > 0
              ? "Estimates with no region — sent, accepted or declined — link each one so its region owns the deal."
              : "Every estimate has a region."}
          </p>
        </div>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{unmapped?.count ?? 0}</span> unmapped · ₹{fmtNum(unmapped?.value ?? 0)}
        </span>
      </div>
      {items.length > 0 && (
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {items.map((it) => (
            <div key={it.estimateId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-white dark:bg-zinc-950 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{it.customerName ?? "—"}</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                  {it.estimateNumber ?? it.estimateId} · ₹{fmtNum(Number(it.total ?? 0))}
                  {it.status ? ` · ${it.status}` : ""}
                  {it.generatedBy ? ` · by ${it.generatedBy}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={regionBy[it.estimateId] ?? ""}
                  onChange={(e) => setRegionBy((prev) => ({ ...prev, [it.estimateId]: e.target.value as RegionId }))}
                  className="px-2 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200"
                >
                  <option value="">Region…</option>
                  {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                </select>
                <button
                  onClick={() => void link(it.estimateId)}
                  disabled={busy || !regionBy[it.estimateId]}
                  className="text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 disabled:opacity-50"
                >
                  Link
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {unmappedAccepted && unmappedAccepted.count > 0 && (
        <div className="mt-4 pt-4 border-t border-amber-500/20">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <h4 className="text-sm font-bold text-amber-700 dark:text-amber-400">Accepted, no lead region</h4>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Accepted deals outside every region — they add no points or wins until linked.
                Rows without a lead creator stay uncredited even after a region is picked.
              </p>
            </div>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono">
              {unmappedAccepted.count} · ₹{fmtNum(unmappedAccepted.value)} · {fmtNum(unmappedAccepted.points)} pts unlinked
            </span>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {(unmappedAccepted.items ?? []).map((it) => (
              <div key={it.estimateId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-white dark:bg-zinc-950 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate flex items-center gap-1.5">
                    {it.customerName ?? "—"}
                    {!it.hasCreator && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-500 font-bold">No lead creator</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                    {it.estimateNumber ?? it.estimateId} · ₹{fmtNum(Number(it.total ?? 0))} · {it.status ?? ""}
                    {it.date ? ` · ${it.date}` : ""}
                    {it.generatedBy ? ` · by ${it.generatedBy}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={regionBy[it.estimateId] ?? ""}
                    onChange={(e) => setRegionBy((prev) => ({ ...prev, [it.estimateId]: e.target.value as RegionId }))}
                    className="px-2 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200"
                  >
                    <option value="">Region…</option>
                    {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                  </select>
                  <button
                    onClick={() => void link(it.estimateId)}
                    disabled={busy || !regionBy[it.estimateId]}
                    className="text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 disabled:opacity-50"
                  >
                    Link
                  </button>
                </div>
              </div>
            ))}
          </div>
          {unmappedAccepted.count > (unmappedAccepted.items?.length ?? 0) && (
            <p className="text-[10px] text-zinc-500 dark:text-zinc-600 mt-1">
              Showing the first {unmappedAccepted.items?.length ?? 0} of {unmappedAccepted.count}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
