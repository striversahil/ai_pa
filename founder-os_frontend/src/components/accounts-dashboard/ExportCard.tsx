"use client";

// Extracted verbatim from AccountsDashboard.tsx by scripts/refactor/split-module.mjs.
// AccountsDashboard.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import { shiftDay, istToday, csvCell } from "./helpers";

export function ExportCard() {
  const [from, setFrom] = useState(() => shiftDay(istToday(), -29));
  const [to, setTo] = useState(() => istToday());
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setInfo(null);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error("Pick both dates");
      if (from > to) throw new Error("From must be on or before To");
      const res = await fetch(`/api/accounts/export?from=${from}&to=${to}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const rows = (data.rows ?? []) as Record<string, any>[];
      const header = ["Date", "Task", "Frequency", "Lane", "Shared", "Due", "Status", "Completed / Not Completed", "Done By", "Accountant", "Remark", "Attachments", "Updated At"];
      const lines = [header.map(csvCell).join(",")];
      for (const r of rows) {
        const files = (r.attachments ?? []).map((f: any) => `${f.name} (${f.url})`).join("; ");
        const result = r.result ?? (r.status === "done" ? "Completed" : "Not Completed");
        lines.push([
          r.date, r.task, r.frequency, r.lane, r.shared ? "yes" : "no", r.due,
          r.status, result, r.doneBy, r.accountant, r.remark, files, r.updatedAt,
        ].map(csvCell).join(","));
      }
      const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `accounts-export-${data.from}-to-${data.to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const done = data.completed ?? rows.filter((r) => r.status === "done").length;
      const not = data.notCompleted ?? (rows.length - done);
      const pct = data.completionPct ?? (rows.length > 0 ? Math.round((done / rows.length) * 100) : 100);
      setInfo(`Exported ${rows.length} rows (${data.from} → ${data.to}): ✓ ${done} completed, ✕ ${not} not completed (${pct}%).`);
    } catch (e) {
      console.error(e);
      setInfo(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 lg:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-sm">📤 Root export — completed vs not completed</h3>
          <div className="text-[11px] text-zinc-500 mt-0.5">Every due task per day with lane, completed / not completed result, who did it, remarks and attachment links. Opens in Excel.</div>
        </div>
        <label className="text-[11px] text-zinc-500 flex items-center gap-1.5">
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" />
          To
          <input type="date" value={to} min={from} max={istToday()} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" />
        </label>
        <button disabled={busy} onClick={run} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 cursor-pointer border-0">
          {busy ? "Exporting…" : "⬇ Export CSV"}
        </button>
      </div>
      {info && <div className="text-[11px] text-zinc-500 mt-2">{info}</div>}
    </div>
  );
}
