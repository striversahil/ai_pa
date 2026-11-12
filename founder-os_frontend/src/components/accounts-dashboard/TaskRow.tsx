"use client";

// Extracted verbatim from AccountsDashboard.tsx by scripts/refactor/split-module.mjs.
// AccountsDashboard.tsx re-exports everything public here, so existing imports keep working.
import React, { useState } from "react";
import type { TaskItem, RosterRow } from "./types";
import { FreqChip } from "./FreqChip";
import { StatusChip } from "./StatusChip";
import { fmtShort, fmtDur, fmtSize } from "./helpers";

export function TaskRow({ t, roster, identity, onSave, onAttach, onDetach, today }: {
  t: TaskItem;
  roster: RosterRow[];
  // Inferred doer: the device's "Acting as" identity, else the signed-in
  // user's roster match, else the server-resolved name. Shown optimistically
  // on Done; the server stamps the same identity authoritatively.
  identity: { id: string; name: string | null; as: string };
  onSave: (logId: string, body: Record<string, unknown>, patch: Partial<TaskItem>) => Promise<unknown>;
  onAttach: (logId: string, file: File) => Promise<unknown>;
  onDetach: (logId: string, fileId: string) => Promise<unknown>;
  today?: string;
}) {
  const [remark, setRemark] = useState(t.remark ?? "");
  // Time taken, entered as hours + minutes, stored as integer minutes.
  // Prefilled from the recorded value so it can be corrected later.
  const initHrs = t.timeSpentMin != null ? String(Math.floor(Number(t.timeSpentMin) / 60)) : "";
  const initMins = t.timeSpentMin != null ? String(Math.floor(Number(t.timeSpentMin) % 60)) : "";
  const [hrs, setHrs] = useState(initHrs);
  const [mins, setMins] = useState(initMins);
  const timeTotal = (() => {
    if (hrs.trim() === "" && mins.trim() === "") return null;
    const h = Math.max(0, Math.floor(Number(hrs) || 0));
    const m = Math.max(0, Math.floor(Number(mins) || 0));
    return h * 60 + m;
  })();
  // No per-row "who" picker: Done is credited to the inferred identity
  // (device's "Acting as", else the signed-in user's roster match). The
  // server resolves and stamps the same identity — the client sends no who.
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lane = roster.filter((r) => t.ownerRole === "either" || r.role === t.ownerRole);
  const isIncomplete = !!(t.incomplete ?? t.overdue);

  // ── Autosave (no Save button): remark / time persist
  // optimistically ~800ms after the last keystroke. Status transitions
  // (Done / Pending buttons) save immediately via `save()`.
  const lastSent = React.useRef<string>("");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshot = JSON.stringify([remark, hrs, mins, t.status]);
  React.useEffect(() => {
    if (!t.logId) return;
    // Baseline on mount / log switch — don't write back what we just loaded.
    if (!lastSent.current) {
      lastSent.current = JSON.stringify([t.remark ?? "", initHrs, initMins, t.status]);
    }
    if (snapshot === lastSent.current) return;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const body = {
        status: t.status,
        remark: remark.trim() || null,
        timeSpentMin: timeTotal,
      };
      lastSent.current = snapshot;
      try {
        await onSave(t.logId!, body, {
          remark: remark.trim() || t.remark,
          timeSpentMin: timeTotal,
          updatedAt: new Date().toISOString(),
        });
        setSaveState("saved");
      } catch (e) {
        console.error(e);
        setSaveState("error");
      }
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);
  // Reset the autosave baseline when switching to a different log row.
  React.useEffect(() => {
    lastSent.current = "";
    setSaveState("idle");
  }, [t.logId]);

  const save = async (status: string) => {
    if (!t.logId) return;
    // Shared optimistic module: paint instantly (per-log serialized in the
    // parent), reconcile in background; failure resyncs + alerts.
    // Attribution rides along: Done paints the inferred doer, the server
    // stamps the same identity authoritatively.
    const nextRemark = remark.trim() || t.remark;
    const nextName = status === "done" ? (identity.name ?? t.doneBy) : t.doneBy;
    if (timer.current) clearTimeout(timer.current);
    lastSent.current = JSON.stringify([remark, hrs, mins, status]);
    setBusy(true);
    try {
      await onSave(t.logId, {
        status,
        remark: remark.trim() || null,
        ...(identity.as ? { as: identity.as } : {}),
        timeSpentMin: timeTotal,
      }, {
        status,
        remark: nextRemark,
        doneBy: nextName,
        accountantId: status === "done" ? (identity.id || t.accountantId) : t.accountantId,
        accountantName: status === "done" ? (identity.name ?? t.accountantName) : t.accountantName,
        timeSpentMin: timeTotal,
        updatedAt: new Date().toISOString(),
        overdue: status === "done" || status === "skipped" ? false : t.overdue,
        incomplete: status === "done" || status === "skipped" ? false : isIncomplete,
      });
      setSaveState("saved");
    } catch (e) {
      console.error(e);
      setSaveState("error");
      alert("Save failed — try again");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file || !t.logId) return;
    setUploading(true);
    try {
      await onAttach(t.logId, file);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (id: string) => {
    if (!t.logId) return;
    setBusy(true);
    try {
      await onDetach(t.logId, id);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const files = t.attachments ?? [];
  // Status bar with mandatory reason: a transition is only clickable when a
  // remark is present (typed now or already recorded) — the server enforces it.
  const hasReason = remark.trim() !== "" || String(t.remark || "").trim() !== "";
  const needReason = !hasReason ? " — add a remark (reason) first" : "";

  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${isIncomplete && t.status !== "done" && t.status !== "skipped" ? "border-rose-500/40 bg-rose-500/[0.04]" : "border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-zinc-900 dark:text-white text-sm">{t.title}</div>
          {t.description && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t.description}</div>}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <FreqChip f={t.frequency} />
            <StatusChip status={t.status} overdue={t.overdue} incomplete={t.incomplete} />
            {t.isShared ? (
              <span title={`Shared task${t.employeeRaw ? ` · sheet: ${t.employeeRaw}` : ""}`} className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">
                👥 shared
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">{t.ownerRole}</span>
            )}
            {t.dueLabel && (
              <span title="Expected completion from the follow-up sheet" className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">
                📌 {t.dueLabel}
              </span>
            )}
            {t.dueDate && t.dueDate !== today && (
              <span title={`Originally due ${t.dueDate} — still unresolved`} className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500 dark:text-rose-400">
                📅 due {fmtShort(t.dueDate)}
              </span>
            )}
            {(t.daysIncomplete ?? t.daysOverdue ?? 0) > 0 && (
              <span title={t.dueDate ? `Originally due ${t.dueDate}` : "Consecutive days missed"} className="inline-flex items-center gap-1 rounded-full border border-rose-500/50 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-600 dark:text-rose-300">
                ⏳ {(t.daysIncomplete ?? t.daysOverdue ?? 0)} day{(t.daysIncomplete ?? t.daysOverdue ?? 0) === 1 ? "" : "s"} missed
              </span>
            )}
            {t.doneBy && <span className="text-[11px] text-zinc-500">by {t.doneBy}</span>}
            {t.accountantName && t.accountantName !== t.doneBy && <span className="text-[11px] text-zinc-500">· {t.accountantName}</span>}
            {fmtDur(t.timeSpentMin) && (
              <span title="Time taken to finish this task" className="inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-500 dark:text-teal-400">
                ⏱ {fmtDur(t.timeSpentMin)}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {t.status !== "pending" && (
            <button disabled={busy || !t.logId} onClick={() => save("pending")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 cursor-pointer border-0" title="Back to pending">↩ Pending</button>
          )}
          {(t.status === "pending" || t.status === "overdue" || t.status === "inprogress") && (
            <button disabled={busy || !t.logId || !hasReason} title={`Mark not done${needReason}`} onClick={() => save("not_done")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 cursor-pointer border-0">✕ Not Done</button>
          )}
          {(t.status === "pending" || t.status === "overdue" || t.status === "inprogress" || t.status === "not_done") && (
            <button disabled={busy || !t.logId || !hasReason} title={`Mark done${needReason}`} onClick={() => save("done")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 cursor-pointer border-0">✓ Done</button>
          )}
        </div>
      </div>
      <div className="flex gap-1.5 mt-2">
        <input
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Remark — e.g. paid via HDFC, ref 4821…"
          className="flex-1 min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
        />
        <span title="Time taken to finish (hours + minutes) — optional, auto-saved" className="inline-flex items-center gap-1 shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1.5 py-1 text-xs text-zinc-500">
          ⏱
          <input value={hrs} onChange={(e) => setHrs(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} placeholder="h" inputMode="numeric" aria-label="Hours taken" className="w-7 bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400" />
          <span className="text-zinc-400">:</span>
          <input value={mins} onChange={(e) => setMins(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} placeholder="m" inputMode="numeric" aria-label="Minutes taken" className="w-7 bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400" />
        </span>
        <span className="inline-flex items-center px-1 text-[11px] font-semibold text-zinc-400 shrink-0" title="Remark and time save automatically while you type">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : saveState === "error" ? "⚠ Retry" : ""}
        </span>
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {files.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-zinc-300 dark:border-zinc-700 pl-1.5 pr-1 py-0.5 text-[11px]">
              <a href={f.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline max-w-[180px] truncate" title={`${f.fileName}${f.uploadedBy ? ` · by ${f.uploadedBy}` : ""}`}>
                📎 {f.fileName} <span className="text-zinc-500">{fmtSize(f.size)}</span>
              </a>
              <button disabled={busy} onClick={() => removeFile(f.id)} className="text-rose-500 hover:text-rose-400 cursor-pointer border-0 bg-transparent text-xs px-0.5" title="Remove file">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2">
        <label className={`inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer ${uploading ? "opacity-50" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
          📎 {uploading ? "Uploading…" : "Attach proof (PDF / image / sheet / ZIP, ≤20MB)"}
          <input type="file" className="hidden" disabled={uploading || !t.logId} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>
      {lane.length > 0 && (
        <div className="text-[10px] text-zinc-400 mt-1">Team: {lane.map((r) => r.name).join(", ")}</div>
      )}
    </div>
  );
}
