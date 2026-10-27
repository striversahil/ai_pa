"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import type { HrHiringPosition } from "@/hr/types";
import { createHiringPosition, renameHiringPosition } from "@/hr/api";

/** Add or rename a hiring-kit position (job title). */
export default function HiringPositionModal({
  position,
  suggestions,
  onClose,
  onSaved,
}: {
  position?: HrHiringPosition | null;
  suggestions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!position;
  const [name, setName] = useState(position?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Enter a position name."); return; }
    setBusy(true);
    setErr(null);
    try {
      if (editing) await renameHiringPosition(position!.id, name.trim());
      else await createHiringPosition(name.trim());
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
      title={editing ? "Rename position" : "Add position"}
      subtitle="A position can hold several job descriptions and SOPs."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">Position name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            list="hiring-position-suggestions"
            autoFocus
            placeholder="e.g. Sales Executive"
            maxLength={80}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <datalist id="hiring-position-suggestions">
            {suggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
          <p className="mt-1 text-[11px] text-zinc-500">Suggestions come from employee designations and existing positions.</p>
        </div>

        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Saving…" : editing ? "Save" : "Add position"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
