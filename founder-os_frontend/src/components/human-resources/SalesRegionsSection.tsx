"use client";

// SalesRegionsSection — the HR Controller's region table + position allotment.
// Region codes are fixed (R1–R4); HR edits the name, the TL tier, the states
// and which chart seats may hold each region. An empty tick row = every region,
// so untouched chart positions keep working.
import React, { useState } from "react";
import { savePositionRegions } from "@/hr/api";
import type { HrRegion, HrRegionsData } from "@/hr/regions";
import RegionModal from "./RegionModal";

export default function SalesRegionsSection({ data, onChanged }: {
  data: HrRegionsData;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<HrRegion | null>(null);
  const [matrix, setMatrix] = useState<Record<string, string[]>>(data.allotment);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const codes = data.regions.map((r) => r.code);

  const toggle = async (positionId: string, code: string) => {
    const current = matrix[positionId] ?? [];
    const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
    setMatrix((m) => ({ ...m, [positionId]: next }));
    setBusy(positionId); setErr(null);
    try {
      await savePositionRegions(positionId, next);
      onChanged();
    } catch (e) {
      setMatrix((m) => ({ ...m, [positionId]: current }));
      setErr(e instanceof Error ? e.message : "Allotment save failed");
    } finally { setBusy(null); }
  };

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold">Sales regions & team-lead hierarchy</h4>
          <p className="mt-0.5 max-w-2xl text-[11px] text-zinc-500">
            The four region codes are fixed (estimates and customer masters store them). HR owns each name, its TL tier and the states it serves.
          </p>
        </div>
      </div>

      {err && <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {data.regions.map((r) => (
          <div key={r.code} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-extrabold text-indigo-500">{r.code}</span>
                  <span className="truncate text-xs font-bold">{r.name}</span>
                  {!r.active && <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-zinc-500">Inactive</span>}
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">{r.tlLevel} tier · {r.seats} active seat{r.seats === 1 ? "" : "s"}</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-400">{r.states.join(", ") || "No states listed"}</p>
              </div>
              <button onClick={() => setEditing(r)} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-indigo-500 hover:bg-indigo-500/10">Edit</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500">Position-wise allotment</h5>
        <p className="mt-0.5 text-[11px] text-zinc-500">Which regions each chart seat may hold. No tick = every region is allowed; the employee form hides the rest.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="py-1.5 pr-2 font-bold">Chart position</th>
                {codes.map((c) => <th key={c} className="px-2 py-1.5 text-center font-bold">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.positions.filter((p) => p.active).map((p) => {
                const picked = matrix[p.id] ?? [];
                return (
                  <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="py-1.5 pr-2">
                      <div className="font-semibold">{p.title}</div>
                      {p.department && <div className="text-[10px] text-zinc-400">{p.department}</div>}
                    </td>
                    {codes.map((c) => (
                      <td key={c} className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={picked.includes(c)} disabled={busy === p.id}
                          onChange={() => toggle(p.id, c)} aria-label={`${p.title} — ${c}`} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[10px] text-zinc-400">A region cannot be removed from a seat while an active employee there holds it — move them first.</p>
      </div>

      {editing && <RegionModal region={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </section>
  );
}