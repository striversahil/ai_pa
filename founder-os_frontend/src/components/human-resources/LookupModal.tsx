"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import { createLookup, updateLookup } from "@/hr/api";
import type { HrLookup, LookupKind } from "@/hr/lookups";

const LABEL: Record<LookupKind, string> = {
  "document-types": "document type",
  "expense-categories": "expense category",
  "asset-types": "asset type",
};

export default function LookupModal({
  kind, item, onClose, onSaved,
}: {
  kind: LookupKind;
  item?: HrLookup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!item;
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [defaultSpecs, setDefaultSpecs] = useState(item?.defaultSpecs ?? "");
  const [required, setRequired] = useState(!!item?.required);
  const [order, setOrder] = useState(String(item?.order ?? 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Enter a name."); return; }
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { name: name.trim(), order: Number(order) || 0 };
      if (kind === "document-types") { body.description = description.trim(); body.required = required; }
      if (kind === "asset-types") body.defaultSpecs = defaultSpecs.trim();
      if (editing) await updateLookup(kind, item!.id, body);
      else await createLookup(kind, body);
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={(editing ? "Edit " : "Add ") + LABEL[kind]}
      subtitle="This list is owned by HR and appears in the matching employee form."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80}
            placeholder={kind === "document-types" ? "e.g. Aadhaar Card" : kind === "expense-categories" ? "e.g. Travel" : "e.g. Laptop"}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
        </div>
        {kind === "document-types" && (
          <>
            <div>
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300}
                placeholder="Shown under the document name"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
              Required for every employee
            </label>
          </>
        )}
        {kind === "asset-types" && (
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Default specification hint</label>
            <input value={defaultSpecs} onChange={(e) => setDefaultSpecs(e.target.value)} maxLength={300}
              placeholder="e.g. RAM, storage and model"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Order</label>
          <input type="number" min={0} max={9999} value={order} onChange={(e) => setOrder(e.target.value)}
            className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
        </div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button type="submit" disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "Saving…" : editing ? "Save" : "Add"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
