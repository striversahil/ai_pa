"use client";

// Extracted verbatim from DigitalMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import type { RosterRow } from "./types";

export function RosterRowEditor({ row, busy, onSave, onRemove, onRestore }: {
  row: RosterRow;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
  onRestore?: () => void;
}) {
  const [email, setEmail] = useState(row.email ?? "");
  const [role, setRole] = useState(row.role === "junior" ? "junior" : "senior");
  const dirty = email !== (row.email ?? "") || role !== (row.role === "junior" ? "junior" : "senior");
  if (row.deleted) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs opacity-70">
        <span className="font-semibold flex-1 truncate">{row.name} <span className="font-normal text-zinc-500">(removed)</span></span>
        {onRestore && <button disabled={busy} onClick={onRestore} className="px-2 py-1 text-[11px] font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 cursor-pointer border-0">Restore</button>}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="font-semibold flex-1 truncate">{row.name} <span className="font-normal text-zinc-500">· {row.role === "junior" ? "Junior" : "Senior"}</span></span>
        <button disabled={busy} onClick={onRemove} className="text-rose-500 hover:text-rose-400 cursor-pointer border-0 bg-transparent text-sm" title="Remove">✕</button>
      </div>
      <div className="flex gap-1.5">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email — maps this person" className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-indigo-500" />
        <select value={role} onChange={(e) => setRole(e.target.value)} title="Senior or Junior"
          className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1.5 py-1 text-[11px] outline-none">
          <option value="senior">Senior</option>
          <option value="junior">Junior</option>
        </select>
        <button disabled={busy || !dirty} onClick={() => onSave({ email: email.trim() || null, role })} className="px-2 py-1 text-[11px] font-bold rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer border-0">Save</button>
      </div>
      {row.phone && <div className="text-[10px] text-zinc-400">{row.phone}</div>}
    </div>
  );
}
