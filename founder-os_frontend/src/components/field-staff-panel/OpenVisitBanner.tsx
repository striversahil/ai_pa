"use client";

// Extracted verbatim from FieldStaffPanel.tsx by scripts/refactor/split-module.mjs.
// FieldStaffPanel.tsx re-exports everything public here, so existing imports keep working.
import type { FieldVisit } from "@/field-staff/types";
import { useState } from "react";
import { checkOut } from "@/field-staff/api";
import { StatusDot } from "./StatusDot";

export function OpenVisitBanner({ visit, onDone }: { visit: FieldVisit; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (visit.checkOutAt) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
      <StatusDot v={visit} />
      <span className="text-[11px] font-bold text-[var(--text-primary)]">
        Open since {visit.checkInAt ? new Date(visit.checkInAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
      </span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await checkOut(visit.id); onDone(`Checked out of ${visit.city}.`); }
          catch (e: any) { onDone(String(e?.message ?? "check-out failed")); }
          finally { setBusy(false); }
        }}
        className="ml-auto rounded-lg bg-[var(--bg-card)] px-2.5 py-1 text-[11px] font-extrabold ring-1 ring-[var(--border-card)] hover:bg-black/5"
      >
        Check out
      </button>
    </div>
  );
}
