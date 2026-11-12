"use client";

// Extracted verbatim from OrderPanel.tsx by scripts/refactor/split-module.mjs.
// OrderPanel.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";

/** One address block; Zoho keeps billing and shipping separately on the SO.
 *  A floor user with write access can correct either — the edit sets an
 *  edited marker and the Zoho sync leaves that address alone afterwards. */
export function AddressCard({ label, value, editedBy, canEdit, onSave, saving }: {
  label: string;
  value?: string | null;
  editedBy?: string | null;
  canEdit: boolean;
  onSave: (text: string) => void;
  saving: boolean;
}) {
  const text = String(value || "").trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  return (
    <div className="rounded-xl border border-zinc-200 px-3.5 py-2.5 dark:border-zinc-800">
      <p className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        <span className="flex items-center gap-1.5 normal-case">
          {editedBy && <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[9px] font-bold text-amber-600 dark:text-amber-400" title={`Corrected on the floor by ${editedBy} — the Zoho sync leaves this address alone`}>edited locally</span>}
          {canEdit && !editing && (
            <button onClick={() => { setDraft(text); setEditing(true); }} className="cursor-pointer border-0 bg-transparent p-0 text-[10px] font-bold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400" title="Correct this address">Edit</button>
          )}
        </span>
      </p>
      {editing ? (
        <div className="mt-1.5 space-y-1.5">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="Corrected address…" className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
          <div className="flex gap-1.5">
            <button disabled={saving} onClick={() => { onSave(draft.trim()); setEditing(false); }} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer border-0">Save</button>
            <button disabled={saving} onClick={() => setEditing(false)} className="rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 cursor-pointer">Cancel</button>
          </div>
        </div>
      ) : text ? (
        <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">{text}</p>
      ) : (
        <p className="mt-0.5 text-xs italic text-zinc-400 dark:text-zinc-500">Waiting for the Zoho detail sync…</p>
      )}
    </div>
  );
}
