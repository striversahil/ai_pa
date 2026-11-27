"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import { updateSalesRegion, type SalesRegion } from "@/sales/regions";

const field = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";
const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500";

export default function RegionModal({ region, onClose, onSaved }: {
  region: SalesRegion;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(region.name);
  const [tlLevel, setTlLevel] = useState(region.tlLevel);
  const [states, setStates] = useState(region.states.join(", "));
  const [order, setOrder] = useState(String(region.order));
  const [active, setActive] = useState(region.active);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Enter a region name."); return; }
    setBusy(true); setErr(null);
    try {
      await updateSalesRegion(region.code, {
        name: name.trim(), tlLevel, order: Number(order) || 0, active,
        states: states.split(",").map((s) => s.trim()).filter(Boolean),
      });
      onSaved(); onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Region ${region.code}`} subtitle="Sales owns the label, the target tier and the states served by this region." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={90} className={field} />
          <p className="mt-1 text-[10px] text-zinc-500">The code {region.code} never changes — estimates and customer masters store it.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className={label}>Target tier</label>
            <select value={tlLevel} onChange={(e) => setTlLevel(e.target.value as SalesRegion["tlLevel"])} className={field}>
              <option value="TL1">TL1</option>
              <option value="TL2">TL2</option>
            </select>
            <p className="mt-1 text-[10px] text-zinc-500">A label on the region, not a level on a person — people are Team Leads by their chart seat.</p>
          </div>
          <div>
            <label className={label}>Order</label>
            <input type="number" min={0} max={9999} value={order} onChange={(e) => setOrder(e.target.value)} className={field} />
          </div>
        </div>
        <div>
          <label className={label}>States served (comma separated)</label>
          <textarea value={states} onChange={(e) => setStates(e.target.value)} rows={3} className={field} />
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active {active ? "" : "· new postings cannot pick this region"}
        </label>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "Saving…" : "Save region"}</button>
        </div>
      </form>
    </Modal>
  );
}