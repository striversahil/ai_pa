"use client";

import React, { useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { archiveLookup, fetchController } from "@/hr/api";
import type { HrLookup, LookupKind } from "@/hr/lookups";
import LookupModal from "./LookupModal";

const SECTIONS: Array<{ kind: LookupKind; title: string; hint: string }> = [
  { kind: "document-types", title: "Employee documents", hint: "The checklist every employee must provide. Required items are flagged." },
  { kind: "expense-categories", title: "Expense categories", hint: "The only categories available on a new expense." },
  { kind: "asset-types", title: "Asset types", hint: "Laptop, phone, SIM and anything else HR issues to employees." },
];

export default function ControllerTab() {
  const dash = useLiveDashboard(fetchController, { events: ["human-resources"], pollMs: 60000 });
  const [modal, setModal] = useState<{ kind: LookupKind; item: HrLookup | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = (kind: LookupKind): HrLookup[] => {
    if (!dash.data) return [];
    if (kind === "document-types") return dash.data.documentTypes;
    if (kind === "expense-categories") return dash.data.expenseCategories;
    return dash.data.assetTypes;
  };

  const archive = async (kind: LookupKind, item: HrLookup) => {
    if (!confirm('Archive "' + item.name + '"? Existing records keep their history.')) return;
    setBusy(true); setErr(null);
    try { await archiveLookup(kind, item.id); dash.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Archive failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Controller</h3>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">HR owns these lists. Add, rename or archive an item and every employee form updates immediately.</p>
        </div>
        <button onClick={() => dash.refresh()} className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">Refresh</button>
      </div>

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-500">{err}</div>}
      {dash.loading && !dash.data && <div className="py-10 text-center text-sm text-zinc-500 animate-pulse">Loading controller…</div>}
      {Boolean(dash.error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-500">{String(dash.error)}</div>}

      <div className="grid gap-4 xl:grid-cols-3">
        {SECTIONS.map((section) => {
          const rows = items(section.kind);
          return (
            <section key={section.kind} className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold">{section.title}</h4>
                  <p className="mt-0.5 text-[11px] text-zinc-500">{section.hint}</p>
                </div>
                <button onClick={() => setModal({ kind: section.kind, item: null })} disabled={busy}
                  className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-50">+ Add</button>
              </div>
              <div className="mt-3 space-y-1.5">
                {rows.length === 0 ? <p className="py-4 text-center text-xs text-zinc-400">Nothing here yet.</p> : rows.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 rounded-lg border border-zinc-100 px-2.5 py-2 dark:border-zinc-800">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-bold">{item.name}</span>
                        {item.required && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-amber-600">Required</span>}
                        {!item.active && <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-zinc-500">Archived</span>}
                      </div>
                      {(item.description || item.defaultSpecs) && <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{item.description || item.defaultSpecs}</p>}
                    </div>
                    <button onClick={() => setModal({ kind: section.kind, item })} disabled={busy} title="Edit"
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold text-indigo-500 hover:bg-indigo-500/10">Edit</button>
                    {item.active && <button onClick={() => archive(section.kind, item)} disabled={busy} title="Archive"
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold text-zinc-400 hover:bg-rose-500/10 hover:text-rose-500">Archive</button>}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {modal && (
        <LookupModal kind={modal.kind} item={modal.item} onClose={() => setModal(null)} onSaved={() => dash.refresh()} />
      )}
    </div>
  );
}
