"use client";

// accounts-dashboard/ThreadEntryRow — one day of a task's thread.
//
// A missed day is written by the engine ("Task not done on <date>") and stays
// Not done; the Resolve composer records the late-work description, which is
// the audit trail — it never flips the day to Done (founder rule 2026-11-25).
import React, { useState } from "react";
import type { ThreadEntry } from "./types";
import { fmtShort, fmtDur, fmtSize } from "./helpers";

const CHIP: Record<string, string> = {
  done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  not_done: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  missed: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
  late: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

function label(e: ThreadEntry): string {
  if (e.bucket === "done") return "✓ Done";
  if (e.bucket === "late") return "⚠ Not done · explained";
  if (e.bucket === "pending") return "● Due";
  return "✕ Not done";
}

export function ThreadEntryRow({ entry, busy, onResolve }: {
  entry: ThreadEntry;
  busy: boolean;
  onResolve: (logId: string, note: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(entry.lateNote ?? "");
  const [err, setErr] = useState<string | null>(null);
  const unresolved = entry.bucket === "missed";
  const files = entry.attachments ?? [];

  const submit = async () => {
    const text = note.trim();
    if (text.length < 3) { setErr("Describe the late work (at least a few words)."); return; }
    setErr(null);
    try {
      await onResolve(entry.logId, text);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the note");
    }
  };

  return (
    <div className={`rounded-lg border px-2.5 py-2 ${unresolved ? "border-rose-500/30 bg-rose-500/[0.04]" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="w-[70px] shrink-0 font-mono font-semibold text-zinc-600 dark:text-zinc-300">{fmtShort(entry.dueDate)}</span>
        <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${CHIP[entry.bucket] ?? CHIP.pending}`}>
          {label(entry)}
        </span>
        <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300" title={entry.lateNote ?? entry.remark ?? entry.systemText ?? ""}>
          {entry.systemText && unresolved ? <span className="font-semibold text-rose-600 dark:text-rose-400">{entry.systemText}</span> : null}
          {entry.lateNote ? <span className="text-amber-700 dark:text-amber-300">{entry.lateNote}</span> : null}
          {!entry.lateNote && entry.remark ? entry.remark : null}
          {!entry.lateNote && !entry.remark && !unresolved ? <span className="text-zinc-400">—</span> : null}
        </span>
        {entry.doneBy && <span className="text-zinc-500">by {entry.doneBy}</span>}
        {fmtDur(entry.timeSpentMin) && <span className="text-teal-500">⏱ {fmtDur(entry.timeSpentMin)}</span>}
        {files.length > 0 && (
          <span className="flex items-center gap-1 text-zinc-500">
            {files.map((f) => (
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline" title={`${f.fileName} · ${fmtSize(f.size)}`}>📎</a>
            ))}
          </span>
        )}
        {(unresolved || entry.lateNote) && (
          <button
            onClick={() => { setErr(null); setOpen((v) => !v); }}
            aria-expanded={open}
            className="shrink-0 rounded-md border border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-500/10 dark:text-amber-300 cursor-pointer"
            title={entry.lateNote ? "Edit the late-work description" : "Explain why this day was missed"}
          >
            {entry.lateNote ? "Edit note" : "Resolve"}
          </button>
        )}
      </div>
      {entry.lateNoteBy && entry.lateNote && !open && (
        <div className="mt-0.5 text-[10px] text-zinc-400">
          explained by {entry.lateNoteBy}{entry.lateNoteAt ? ` · ${fmtShort(entry.lateNoteAt)}` : ""}
        </div>
      )}
      {open && (
        <div className="mt-2 space-y-1.5">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Late-work description
            <textarea
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="What happened, and what was done when — e.g. “Tally not updated on 15th, bank statement received late; entries posted on 17th.”"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-800 outline-none focus:border-amber-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            />
          </label>
          {err && <p className="text-[11px] text-rose-500">{err}</p>}
          <div className="flex gap-1.5">
            <button onClick={submit} disabled={busy} className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-50 cursor-pointer">
              {busy ? "Saving…" : "Save note"}
            </button>
            <button onClick={() => { setOpen(false); setNote(entry.lateNote ?? ""); setErr(null); }} className="rounded-md border border-zinc-300 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">
              Cancel
            </button>
            <span className="self-center text-[10px] text-zinc-400">The day stays “Not done” — this records why.</span>
          </div>
        </div>
      )}
    </div>
  );
}
