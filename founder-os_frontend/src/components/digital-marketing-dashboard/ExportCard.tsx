"use client";

// Extracted verbatim from DigitalMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import { csvCell } from "./helpers";

export function ExportCard() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setInfo(null);
    try {
      const res = await fetch(`/api/digital-marketing/export?days=${Math.min(93, Math.max(1, days || 30))}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const rows = (data.rows ?? []) as Record<string, any>[];
      const header = ["Date", "Task", "Template", "Frequency", "Lane", "Shared", "Due", "Status", "Completed / Not Completed", "Done By", "Manager", "Remark", "Time Spent", "Category", "Amount Spent", "From", "To", "Duration Days", "Inquiries", "Leads", "Data Source", "Attachments", "Updated At"];
      const lines = [header.map(csvCell).join(",")];
      for (const r of rows) {
        const files = (r.attachments ?? []).map((f: any) => `${f.name} (${f.url})`).join("; ");
        const result = r.result ?? (r.status === "done" ? "Completed" : "Not Completed");
        lines.push([
          r.date, r.task, r.templateId ?? "", r.frequency, r.lane, r.shared ? "yes" : "no", r.due,
          r.status, result, r.doneBy, r.accountant, r.remark, r.timeSpent ?? "",
          r.category ?? "", r.amountSpent ?? "", r.fromDate ?? "", r.toDate ?? "", r.durationDays ?? "",
          r.inquiries ?? "", r.leads ?? "", r.dataSource ?? "", files, r.updatedAt,
        ].map(csvCell).join(","));
      }
      const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `digital-marketing-export-${data.from}-to-${data.to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const done = (data as any).completed ?? rows.filter((r) => r.status === "done").length;
      const not = (data as any).notCompleted ?? (rows.length - done);
      const pct = (data as any).completionPct ?? (rows.length > 0 ? Math.round((done / rows.length) * 100) : 100);
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
          Past
          <input type="number" min={1} max={93} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-16 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" />
          days
        </label>
        <button disabled={busy} onClick={run} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 cursor-pointer border-0">
          {busy ? "Exporting…" : "⬇ Export CSV"}
        </button>
      </div>
      {info && <div className="text-[11px] text-zinc-500 mt-2">{info}</div>}
    </div>
  );
}
