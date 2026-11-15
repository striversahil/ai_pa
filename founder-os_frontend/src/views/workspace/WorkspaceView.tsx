"use client";

// views/workspace/WorkspaceView — the ONE position gallery (root-only).
//
// Root picks a position card → jumps into that position's LIVE custom
// dashboard (the same component the holder opens — SalesHeadDashboard for
// Sales Head) with a preview banner, and takes control through the same
// audited writes (Done, saves). Unbuilt packs show as "soon" — the gallery
// grows one card at a time, never a second sidebar pile.
import { useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { fetchOrgPeople } from "@/org/api";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { ORG_POSITIONS } from "@/hr/organization";
import { isLiveDashboardTitle, positionDashboard } from "@/hr/position-dashboards";
import SalesHeadDashboard from "./SalesHeadDashboard";
import { MotionStyle, Skeleton } from "@/components/ui/motion";

export default function WorkspaceView() {
  const { me } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const dash = useLiveDashboard(() => fetchOrgPeople(), { events: ["human-resources"], pollMs: 60000 });

  const seats = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of dash.data?.people ?? []) {
      if (!p.employee.active) continue;
      const key = String(p.employee.designation ?? "").trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [dash.data]);

  if (me && !me.isRoot) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
        <div className="text-4xl">🔒</div>
        <p className="text-sm text-zinc-500">Position gallery is root-only.</p>
      </div>
    );
  }

  if (open === "Sales Head") {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setOpen(null)}
          className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          ← All positions
        </button>
        <SalesHeadDashboard />
      </div>
    );
  }
  if (open) {
    const def = positionDashboard(open);
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setOpen(null)}
          className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          ← All positions
        </button>
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
          <div className="text-4xl">🛠️</div>
          <h2 className="mt-2 font-heading text-lg font-extrabold">{open}</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
            {def?.description ?? "Custom pack not built yet."} Packs ship one position at a time — Sales Head is live.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <MotionStyle />
      <div>
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">Positions</h1>
        <p className="text-[11px] text-zinc-500">Pick a position to peek into its live dashboard and take control. Every write is audited as root.</p>
      </div>
      {dash.loading && !dash.data ? (
        <Skeleton lines={4} />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {ORG_POSITIONS.map((p) => {
            const live = isLiveDashboardTitle(p.title);
            const count = seats.get(p.title) ?? 0;
            return (
              <button
                key={p.title}
                type="button"
                onClick={() => setOpen(p.title)}
                className={`rounded-xl border bg-white p-3 text-left transition-colors dark:bg-zinc-950 ${
                  live
                    ? "border-indigo-500/50 hover:border-indigo-400"
                    : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold">{p.title}</span>
                  {live ? (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">● Live</span>
                  ) : (
                    <span className="rounded-full bg-zinc-500/15 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500">Soon</span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500">{p.department} · reports to {p.reportsTo}</div>
                <div className="mt-1 text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                  {count} seated{count === 1 ? "" : "s"}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
