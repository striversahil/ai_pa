"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import type { HrInventoryItem } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { todayIST } from "@/hr/format";

const UNITS = ["pcs", "kg", "g", "litre", "ml", "pack", "box", "dozen", "roll", "bottle"];

export default function InventoryItemModal({ item, onClose, onSaved }: {
  item?: HrInventoryItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!item;
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "pcs");
  const [reorderLevel, setReorderLevel] = useState(item ? String(item.reorderLevel) : "0");
  const [unitCost, setUnitCost] = useState(item?.unitCost != null ? String(item.unitCost) : "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [openingQty, setOpeningQty] = useState("0");
  const [openingDate, setOpeningDate] = useState(todayIST());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Item name is required"); return; }
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        category: category.trim() || null,
        unit: unit.trim() || "pcs",
        reorderLevel: Number(reorderLevel) || 0,
        unitCost: unitCost.trim() ? Number(unitCost) : null,
        notes: notes.trim() || null,
      };
      if (!editing) {
        body.openingQty = Number(openingQty) || 0;
        body.openingDate = openingDate;
      }
      const res = editing
        ? await jsonRequest(`/api/human-resources/inventory/items/${item!.id}`, "PATCH", body)
        : await jsonRequest("/api/human-resources/inventory/items", "POST", body);
      if (!res.ok) throw new Error(await readError(res));
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  };

  const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
  const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

  return (
    <Modal
      title={editing ? "Edit inventory item" : "Add inventory item"}
      subtitle={editing ? item?.name : "Daily-use stock item, its unit and reorder level"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Item name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Floor cleaner, tea bags, A4 paper" className={field} autoFocus />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Category (optional)</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Pantry, cleaning, stationery" className={field} />
          </div>
          <div>
            <label className={label}>Unit</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} list="hr-inventory-units" className={field} />
            <datalist id="hr-inventory-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          </div>
          <div>
            <label className={label}>Reorder level</label>
            <input value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} inputMode="decimal" className={field} />
          </div>
          <div>
            <label className={label}>Unit cost (optional)</label>
            <input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} inputMode="decimal" placeholder="₹ per unit" className={field} />
          </div>
          {!editing && (
            <>
              <div>
                <label className={label}>Opening stock</label>
                <input value={openingQty} onChange={(e) => setOpeningQty(e.target.value)} inputMode="decimal" className={field} />
              </div>
              <div>
                <label className={label}>Opening date</label>
                <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className={field} />
              </div>
            </>
          )}
        </div>
        <div>
          <label className={label}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Pack size, supplier or storage note" className={field} />
        </div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? "Saving…" : editing ? "Save changes" : "Add item"}</button>
        </div>
      </form>
    </Modal>
  );
}
