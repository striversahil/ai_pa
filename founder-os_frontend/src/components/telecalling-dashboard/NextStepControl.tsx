"use client";

// Extracted verbatim from TelecallingDashboard.tsx by scripts/refactor/split-module.mjs.
// TelecallingDashboard.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import type { FollowUp } from "./types";
import { localIsoDay } from "./helpers";

/** Dated next step (customer commitment) editor. While the date is today-or-
 *  future the estimate is protected from red-risk no matter the AI verdict;
 *  a past date reads red until chased. Region staff or root only
 *  (server-enforced); max 30 days out. */
export function NextStepControl({ f, onSaved }: { f: FollowUp; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(() => f.nextStepDate ?? localIsoDay(1));
  const [note, setNote] = useState(() => f.nextStep ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const minDay = localIsoDay(0);
  const maxDay = localIsoDay(30);
  const chipBase = "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold text-[11px]";

  const save = async (d: string | null, n: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(f.estimateId)}/next-step`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: d, note: n }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Save failed (HTTP ${res.status})`);
      setEditing(false);
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (f.nextStepDate && !editing) {
    const overdue = f.nextStepDate < minDay;
    const dueToday = f.nextStepDate === minDay;
    return (
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <span
          title={overdue ? "Commitment date passed — red until chased" : "Customer commitment — protects this estimate from red-risk through this date"}
          className={`${chipBase} ${overdue ? "text-rose-500 dark:text-rose-400 border-rose-500/40 bg-rose-500/10" : "text-indigo-500 dark:text-indigo-400 border-indigo-500/40 bg-indigo-500/10"}`}
        >
          📌 {f.nextStepDate}{dueToday ? " · today" : ""}{overdue ? " · missed" : ""}
          {f.nextStep ? ` · ${f.nextStep}` : ""}
        </span>
        <button
          disabled={busy}
          onClick={() => { setDate(f.nextStepDate ?? localIsoDay(1)); setNote(f.nextStep ?? ""); setEditing(true); }}
          className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-50"
        >
          change
        </button>
        <button
          disabled={busy}
          onClick={() => void save(null, null)}
          title="Clear next step"
          className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 hover:text-rose-500 disabled:opacity-50"
        >
          ✕
        </button>
        {err && <span className="text-[10px] text-rose-500">{err}</span>}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <button
          disabled={busy}
          onClick={() => { setDate(localIsoDay(1)); setNote(""); setEditing(true); }}
          title="Set a dated customer commitment — protects this estimate from red-risk through that date"
          className={`${chipBase} text-zinc-500 dark:text-zinc-400 border-dashed border-zinc-400/40 bg-zinc-500/5 hover:opacity-80 disabled:opacity-50`}
        >
          📌 + Next step
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      <input
        type="date"
        value={date}
        min={minDay}
        max={maxDay}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-900 dark:text-zinc-100"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Commitment (e.g. client confirms)"
        maxLength={200}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-900 dark:text-zinc-100 w-44"
      />
      <button
        disabled={busy || !date}
        onClick={() => void save(date, note.trim() || null)}
        className="rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? "…" : "Save"}
      </button>
      <button disabled={busy} onClick={() => setEditing(false)} className="text-[10px] text-zinc-500 hover:text-rose-500 disabled:opacity-50">
        ✕
      </button>
      {err && <span className="text-[10px] text-rose-500">{err}</span>}
    </div>
  );
}
