"use client";

// Extracted verbatim from FieldStaffPanel.tsx by scripts/refactor/split-module.mjs.
// FieldStaffPanel.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import { tomorrowIST, setMillFlag, istToday } from "@/field-staff/api";

export function FollowupToggle({ m, onDone }: { m: any; onDone: () => void }) {
  const [picking, setPicking] = useState(false);
  const [due, setDue] = useState(tomorrowIST());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (m.followUpNeeded) {
    return (
      <button
        onClick={async () => { await setMillFlag(m.id, m.isNewManual, false); onDone(); }}
        className="ml-auto rounded-lg bg-amber-500/15 px-2 py-1 text-[10px] font-extrabold text-amber-600 ring-1 ring-amber-500/40"
        title="Follow-up is on — click to cancel the open follow-up"
      >
        ★ Follow-up on
      </button>
    );
  }
  if (!picking) {
    return (
      <button
        onClick={() => { setPicking(true); setDue(tomorrowIST()); }}
        className="ml-auto rounded-lg px-2 py-1 text-[10px] font-extrabold text-[var(--text-secondary)] ring-1 ring-[var(--border-card)]"
      >
        ☆ Follow-up
      </button>
    );
  }
  return (
    <div className="ml-auto flex flex-wrap items-center gap-1 rounded-lg bg-amber-500/5 p-1.5 ring-1 ring-amber-500/30">
      <input type="date" value={due} min={istToday()} onChange={(e) => setDue(e.target.value)} className="rounded-md border border-[var(--border-card)] bg-[var(--bg-input)] px-1.5 py-1 text-[10px]" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-28 rounded-md border border-[var(--border-card)] bg-[var(--bg-input)] px-1.5 py-1 text-[10px]" />
      <button
        disabled={busy}
        onClick={async () => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return setErr("Pick a date.");
          if (due < istToday()) return setErr("No past dates.");
          setBusy(true); setErr("");
          try { await setMillFlag(m.id, m.isNewManual, true, { dueDate: due, note }); onDone(); }
          catch (e: any) { setErr(String(e?.message ?? "failed")); }
          finally { setBusy(false); }
        }}
        className="rounded-md bg-amber-500 px-2 py-1 text-[10px] font-extrabold text-white disabled:opacity-50"
      >
        Set
      </button>
      <button onClick={() => setPicking(false)} className="px-1 text-[10px] font-bold text-[var(--text-tertiary)]">✕</button>
      {err && <span className="w-full text-[10px] text-red-600">{err}</span>}
    </div>
  );
}
