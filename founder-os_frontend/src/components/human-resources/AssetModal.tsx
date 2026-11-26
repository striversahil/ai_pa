"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import { saveAsset } from "@/hr/api";
import type { HrAsset, HrAssetType } from "@/hr/assets";
import type { HrMember } from "@/hr/types";
import { todayIST } from "@/hr/format";

const STATUS: Array<{ value: HrAsset["status"]; label: string }> = [
  { value: "assigned", label: "Assigned" },
  { value: "in_repair", label: "In repair" },
  { value: "returned", label: "Returned" },
  { value: "lost", label: "Lost" },
];

export default function AssetModal({
  asset, members, types, onClose, onSaved,
}: {
  asset?: HrAsset | null;
  members: HrMember[];
  types: HrAssetType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!asset;
  const [memberId, setMemberId] = useState(asset?.memberId ?? "");
  const [assetTypeId, setAssetTypeId] = useState(asset?.assetTypeId ?? (types.find((t) => t.active)?.id ?? ""));
  const [label, setLabel] = useState(asset?.label ?? "");
  const [identifier, setIdentifier] = useState(asset?.identifier ?? "");
  const [specs, setSpecs] = useState(asset?.specs ?? "");
  const [status, setStatus] = useState<HrAsset["status"]>(asset?.status ?? "assigned");
  const [assignedOn, setAssignedOn] = useState(asset?.assignedOn ?? todayIST());
  const [returnedOn, setReturnedOn] = useState(asset?.returnedOn ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId) { setErr("Pick an employee."); return; }
    if (!assetTypeId) { setErr("Pick an asset type."); return; }
    if (!assignedOn) { setErr("Assigned date is required."); return; }
    setBusy(true); setErr(null);
    try {
      await saveAsset({
        memberId, assetTypeId, label: label.trim(), identifier: identifier.trim(),
        specs: specs.trim(), status, assignedOn, returnedOn: returnedOn || null, notes: notes.trim(),
      }, asset?.id);
      onSaved(); onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  };

  const field = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <Modal title={editing ? "Edit asset" : "Assign asset"} subtitle="What this employee holds, with its configuration." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Employee</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={field}>
              <option value="">Select employee…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.displayName || m.name}{m.designation ? " · " + m.designation : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Asset type</label>
            <select value={assetTypeId} onChange={(e) => setAssetTypeId(e.target.value)} className={field}>
              <option value="">Select type…</option>
              {types.filter((t) => t.active || t.id === assetTypeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="e.g. Office laptop" className={field} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Serial / identifier</label>
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} maxLength={120} placeholder="Serial, IMEI or SIM number" className={field} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Specifications</label>
          <textarea value={specs} onChange={(e) => setSpecs(e.target.value)} maxLength={500} rows={2}
            placeholder="RAM, storage, configuration, model…" className={field} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as HrAsset["status"])} className={field}>
              {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Assigned on</label>
            <input type="date" value={assignedOn} onChange={(e) => setAssignedOn(e.target.value)} className={field} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Returned on</label>
            <input type="date" value={returnedOn} onChange={(e) => setReturnedOn(e.target.value)} className={field} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className={field} />
        </div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button type="submit" disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "Saving…" : editing ? "Save asset" : "Assign asset"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
