"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import { savePositionAsset } from "@/hr/api";
import type { HrAssetPosition, HrAssetType, HrPositionAsset } from "@/hr/assets";

export default function StandardModal({
  positions, types, standard, onClose, onSaved,
}: {
  positions: HrAssetPosition[];
  types: HrAssetType[];
  standard?: HrPositionAsset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!standard;
  const [orgPositionId, setOrgPositionId] = useState(standard?.orgPositionId ?? positions[0]?.id ?? "");
  const [assetTypeId, setAssetTypeId] = useState(standard?.assetTypeId ?? types.find((t) => t.active)?.id ?? "");
  const [quantity, setQuantity] = useState(String(standard?.quantity ?? 1));
  const [specNote, setSpecNote] = useState(standard?.specNote ?? "");
  const [required, setRequired] = useState(standard?.required ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgPositionId || !assetTypeId) { setErr("Pick a position and asset type."); return; }
    setBusy(true); setErr(null);
    try {
      const body = editing
        ? { quantity: Number(quantity) || 1, specNote: specNote.trim(), required }
        : { orgPositionId, assetTypeId, quantity: Number(quantity) || 1, specNote: specNote.trim(), required };
      await savePositionAsset(body, standard?.id);
      onSaved(); onClose();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const field = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <Modal title={editing ? "Edit role standard" : "Add role standard"} subtitle="The kit a person in this position is expected to hold." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Position</label>
          <select value={orgPositionId} onChange={(e) => setOrgPositionId(e.target.value)} disabled={editing} className={field}>
            {positions.map((p) => <option key={p.id} value={p.id}>{p.title}{p.department ? " · " + p.department : ""}</option>)}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Asset type</label>
            <select value={assetTypeId} onChange={(e) => setAssetTypeId(e.target.value)} disabled={editing} className={field}>
              {types.filter((t) => t.active || t.id === assetTypeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Quantity</label>
            <input type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={field} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Specification note</label>
          <input value={specNote} onChange={(e) => setSpecNote(e.target.value)} maxLength={300} placeholder="e.g. 16 GB RAM, 512 GB SSD" className={field} />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required for this role
        </label>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button type="submit" disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "Saving…" : editing ? "Save standard" : "Add standard"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
