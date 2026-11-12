"use client";

// Extracted verbatim from DigitalMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.
import React, { useState } from "react";
import type { TaskItem, RosterRow } from "./types";
import { FreqChip } from "./FreqChip";
import { StatusChip } from "./StatusChip";
import { fmtShort, fmtDur, fmtSize } from "./helpers";

export function TaskRow({ t, roster, identity, onLogged, today }: {
  t: TaskItem;
  roster: RosterRow[];
  // Inferred doer: the signed-in user's roster match (else the
  // server-resolved name). Shown optimistically on Done; the server stamps
  // the same identity authoritatively.
  identity: { id: string; name: string | null };
  onLogged: () => void;
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
  // Metrics for daily numeric tasks (Meta/B2B/Whatsapp/Email). Prefilled from saved metricsJson.
  const [metrics, setMetrics] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    const src = (t as any).metricsJson as Record<string, any> | null;
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src)) init[k] = v == null ? "" : String(v);
    }
    // Ensure all schema keys have an entry
    const schema = (t as any).metricsSchema as Array<{key:string}> | null;
    if (schema) for (const f of schema) if (!(f.key in init)) init[f.key] = "";
    return init;
  });
  // No per-row "who" picker: Done is credited to the inferred identity
  // (the signed-in user's roster match). The server resolves and stamps the
  // same identity — the client sends no who.
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lane = roster.filter((r) => t.ownerRole === "either" || r.role === t.ownerRole || (t.ownerRole === "manager" && r.role === "senior")); // legacy 'manager' = Senior (backend dmLaneMatches mirror)
  const isIncomplete = !!((t as any).incomplete ?? t.overdue);
  const metricsPayload = () => ((t as any).metricsSchema
    ? Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, v.trim() === "" ? null : (isNaN(Number(v)) ? v.trim() : Number(v))]))
    : undefined);

  // ── Autosave (no Save button): remark / time / metrics persist
  // ~800ms after the last keystroke with the row's current status. Status
  // transitions (Done / Pending buttons) save immediately via `save()`.
  const lastSent = React.useRef<string>("");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshot = JSON.stringify([remark, hrs, mins, metrics, t.status]);
  React.useEffect(() => {
    if (!t.logId) return;
    if (!lastSent.current) {
      lastSent.current = JSON.stringify([t.remark ?? "", initHrs, initMins, metrics, t.status]);
    }
    if (snapshot === lastSent.current) return;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    const payload = snapshot;
    timer.current = setTimeout(async () => {
      lastSent.current = payload;
      try {
        const res = await fetch(`/api/digital-marketing/logs/${t.logId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: t.status,
            remark: remark.trim() || null,
            timeSpentMin: timeTotal,
            metricsJson: metricsPayload(),
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        setSaveState("saved");
        onLogged();
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
    if (timer.current) clearTimeout(timer.current);
    // Attribution rides along: Done paints the inferred doer instantly, the
    // server stamps the same identity authoritatively; the live refetch
    // reconciles any difference.
    lastSent.current = JSON.stringify([remark, hrs, mins, metrics, status]);
    setBusy(true);
    try {
      const res = await fetch(`/api/digital-marketing/logs/${t.logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          remark: remark.trim() || null,
          timeSpentMin: timeTotal,
          metricsJson: metricsPayload(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaveState("saved");
      onLogged();
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
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/digital-marketing/logs/${t.logId}/files`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      onLogged();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/digital-marketing/files/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      onLogged();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const files = t.attachments ?? [];
  // dmm-06/08/09 retired (migration 0115) — remaining taskbar rows need only
  // the standard remark reason; the marketing proof gate is gone.
  const hasReason = remark.trim() !== "" || String(t.remark || "").trim() !== "";
  const needReason = !hasReason ? " — add a remark (reason) first" : "";
  const doneBlocked = !hasReason;

  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${isIncomplete && t.status !== "done" && t.status !== "skipped" ? "border-rose-500/40 bg-rose-500/[0.04]" : "border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-zinc-900 dark:text-white">{t.title}</div>
          {t.description && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t.description}</div>}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <FreqChip f={t.frequency} />
            <StatusChip status={t.status} overdue={t.overdue} incomplete={(t as any).incomplete} />
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
            {(t.missed ?? []).length > 0 && (
              <span title={`Not completed on: ${(t.missed ?? []).join(", ")}`} className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500 dark:text-rose-400">
                ⚠ missed {(t.missed ?? []).slice(0, 3).map(fmtShort).join(", ")}{(t.missed ?? []).length > 3 ? ` +${(t.missed ?? []).length - 3} more` : ""}
              </span>
            )}
            {((t as any).daysIncomplete ?? t.daysOverdue ?? 0) > 0 && (
              <span title={t.dueDate ? `Originally due ${t.dueDate}` : "Consecutive days missed"} className="inline-flex items-center gap-1 rounded-full border border-rose-500/50 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-600 dark:text-rose-300">
                ⏳ {((t as any).daysIncomplete ?? t.daysOverdue ?? 0)} day{((t as any).daysIncomplete ?? t.daysOverdue ?? 0) === 1 ? "" : "s"} missed
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
            <button disabled={busy || !t.logId || doneBlocked} title={`Mark done${needReason}`} onClick={() => save("done")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 cursor-pointer border-0">✓ Done</button>
          )}
        </div>
      </div>
      {(t as any).metricsSchema && Array.isArray((t as any).metricsSchema) && (t as any).metricsSchema.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 mt-2">
          {(t as any).metricsSchema.map((f: any) => (
            <label key={f.key} className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
              <span className="font-semibold">{f.label}</span>
              {f.type === "select" && Array.isArray(f.options) ? (
                <select
                  value={metrics[f.key] ?? ""}
                  onChange={(e) => setMetrics({ ...metrics, [f.key]: e.target.value })}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500 text-zinc-900 dark:text-zinc-100"
                >
                  <option value="">Select {f.label}…</option>
                  {f.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  value={metrics[f.key] ?? ""}
                  onChange={(e) => setMetrics({ ...metrics, [f.key]: e.target.value })}
                  placeholder={f.type === 'number' ? '0' : f.type === 'date' ? 'YYYY-MM-DD' : f.label}
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  inputMode={f.type === 'number' ? 'numeric' : undefined}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
                />
              )}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-1.5 mt-2">
        <input
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Remark — e.g. leads: 3 B2B…"
          className="flex-1 min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
        />
        <span title="Time taken to finish (hours + minutes) — optional, auto-saved" className="inline-flex items-center gap-1 shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1.5 py-1 text-xs text-zinc-500">
          ⏱
          <input value={hrs} onChange={(e) => setHrs(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} placeholder="h" inputMode="numeric" aria-label="Hours taken" className="w-7 bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400" />
          <span className="text-zinc-400">:</span>
          <input value={mins} onChange={(e) => setMins(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} placeholder="m" inputMode="numeric" aria-label="Minutes taken" className="w-7 bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400" />
        </span>
        <span className="inline-flex items-center px-1 text-[11px] font-semibold text-zinc-400 shrink-0" title="Remark, metrics and time save automatically while you type">
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
