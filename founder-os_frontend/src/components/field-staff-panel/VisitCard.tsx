"use client";

// Extracted verbatim from FieldStaffPanel.tsx by scripts/refactor/split-module.mjs.
// FieldStaffPanel.tsx re-exports everything public here, so existing imports keep working.
import { isVisitOpen } from "@/field-staff/types";
import type { FieldVisit } from "@/field-staff/types";
import { useState } from "react";
import { deleteVisit } from "@/field-staff/api";
import { StatusDot } from "./StatusDot";

export function VisitCard({ v, active, canManage, onPick, onChanged }: {
  v: FieldVisit; active: boolean; canManage: boolean;
  onPick: () => void; onChanged: () => void;
}) {
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);

  const del = async () => {
    if (!arming) { setArming(true); return; }
    setBusy(true);
    try { await deleteVisit(v.id); onChanged(); }
    catch { setBusy(false); setArming(false); }
  };

  return (
    <div className={`w-full rounded-xl border p-2.5 text-left transition ${
      active
        ? "border-brand-indigo bg-brand-indigo/5 shadow"
        : "border-[var(--border-card)] bg-[var(--bg-card)] hover:border-brand-indigo/50"
    }`}>
      <button onClick={onPick} title={(v.mills ?? []).map((m) => m.millName).join(", ") || "No mills yet"} className="w-full text-left">
        <div className="flex items-center gap-2">
          <StatusDot v={v} />
          <span className="truncate text-xs font-extrabold text-[var(--text-primary)]">{v.city || "—"}</span>
          {!isVisitOpen(v) && <span className="rounded-full bg-zinc-500/10 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500">closed</span>}
          <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">{v.day.slice(5)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-secondary)]">
          <span className="font-bold">{v.staffName}</span>
          {v.region && <span>{v.region}</span>}
          <span>· {(v.mills ?? []).length} mills</span>
          {(v.followups ?? []).filter((f) => f.status === "open").length > 0 && (
            <span className="font-bold text-amber-600 dark:text-amber-400">
              · {(v.followups ?? []).filter((f) => f.status === "open").length} follow-up
            </span>
          )}
          {v.expenseTotal > 0 && <span>· ₹{Math.round(v.expenseTotal).toLocaleString("en-IN")}</span>}
        </div>
        {(v.mills ?? []).length > 0 && (
          <div className="mt-1 truncate text-[10px] text-[var(--text-tertiary)]">
            {(v.mills ?? []).map((m) => m.millName).filter(Boolean).join(" · ").slice(0, 90)}
          </div>
        )}
      </button>
      {canManage && (
        <div className="mt-1.5 flex justify-end">
          <button
            disabled={busy}
            onClick={del}
            className={`rounded-lg px-2 py-1 text-[10px] font-bold ring-1 disabled:opacity-50 ${
              arming ? "bg-red-600 text-white ring-red-600" : "text-red-600 ring-red-500/30 hover:bg-red-500/10"
            }`}
          >
            {busy ? "Deleting…" : arming ? "Confirm delete visit?" : "Delete"}
          </button>
          {arming && (
            <button onClick={() => setArming(false)} className="ml-1 rounded-lg px-2 py-1 text-[10px] font-bold text-[var(--text-secondary)]">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
