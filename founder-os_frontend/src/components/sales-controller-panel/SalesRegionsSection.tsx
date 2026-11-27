"use client";

// SalesRegionsSection — the Sales Controller's region catalog.
// Region codes are fixed (R1–R4) because estimates and customer masters store
// them; the sales head edits the name, target tier and states here. Which
// regions a person holds is picked on that person from the Sales team chart —
// the old position-wise allotment table retired in mig 0179.
import { useState } from "react";
import { type SalesRegion, type SalesRegionsData } from "@/sales/regions";
import RegionModal from "./RegionModal";

export default function SalesRegionsSection({ data, onChanged }: {
  data: SalesRegionsData;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<SalesRegion | null>(null);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold">Sales regions</h4>
          <p className="mt-0.5 max-w-2xl text-[11px] text-zinc-500">
            The four region codes are fixed (estimates and customer masters store them). Edit a name, its states or its target tier here — people and the regions they cover are assigned on the Sales team chart above.
          </p>
        </div>
      </div>

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
                <p className="mt-1 text-[10px] text-zinc-500">{r.tlLevel} target tier · {r.seats} active seat{r.seats === 1 ? "" : "s"}</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-400">{r.states.join(", ") || "No states listed"}</p>
                {(r.staff.teamLeads.length > 0 || r.staff.members.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.staff.teamLeads.map((t) => (
                      <span key={t.id} className="rounded-full bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 dark:text-indigo-300" title="Team Lead">TL · {t.name}</span>
                    ))}
                    {r.staff.members.map((m) => (
                      <span key={m.id} className="rounded-full bg-zinc-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-600 dark:text-zinc-300" title={m.type === "field_staff" ? "Field Staff" : "Telecaller"}>
                        {m.type === "field_staff" ? "Field" : "TC"} · {m.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => setEditing(r)} className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-indigo-500 hover:bg-indigo-500/10">Edit</button>
            </div>
          </div>
        ))}
      </div>

      {editing && <RegionModal region={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </section>
  );
}
