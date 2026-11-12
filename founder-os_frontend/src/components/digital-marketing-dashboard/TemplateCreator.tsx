"use client";

// Extracted verbatim from DigitalMarketingDashboard.tsx by scripts/refactor/split-module.mjs.
// DigitalMarketingDashboard.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import type { PatternKey } from "./types";
import { buildTemplateBody, PATTERNS, PATTERN_WEEKDAYS, PATTERN_MONTHS } from "./helpers";

export function TemplateCreator({ onChanged }: { onChanged: () => void }) {
  const [title, setTitle] = useState("");
  // Single manager, no lanes — every template is visible to everyone.
  const owner = "either";
  const [shared, setShared] = useState(false);
  const [pattern, setPattern] = useState<PatternKey>("monthly_fixed");
  const [day, setDay] = useState("15");
  const [daysText, setDaysText] = useState("8, 11, 13");
  const [startDay, setStartDay] = useState("15");
  const [endDay, setEndDay] = useState("18");
  const [weekday, setWeekday] = useState("Thursday");
  const [month, setMonth] = useState("January");
  const [yDay, setYDay] = useState("15");
  const [sMonth, setSMonth] = useState("September");
  const [sDay, setSDay] = useState("30");
  const [eMonth, setEMonth] = useState("October");
  const [eDay, setEDay] = useState("31");
  const [weekNum, setWeekNum] = useState("1");
  const [occs, setOccs] = useState<{ month: string; day: string }[]>([{ month: "June", day: "15" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = (() => {
    const r = buildTemplateBody({ title: title || "…", ownerRole: owner, shared, pattern, day, daysText, startDay, endDay, weekday, month, yDay, sMonth, sDay, eMonth, eDay, weekNum, occs });
    if (r.error) return r.error;
    const b = r.body!;
    return `Shows ${String(b.rawText ?? "as reference (no fixed date)")} · ${b.frequency} · ${shared ? "shared" : owner}`;
  })();

  const submit = async () => {
    const r = buildTemplateBody({ title, ownerRole: owner, shared, pattern, day, daysText, startDay, endDay, weekday, month, yDay, sMonth, sDay, eMonth, eDay, weekNum, occs });
    if (r.error || !r.body) { setErr(r.error ?? "Invalid"); return; }
    setErr(null);
    setBusy(true);
    try {
      const { _months, ...body } = r.body as Record<string, unknown>;
      void _months;
      const res = await fetch("/api/digital-marketing/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      setTitle("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const num = "w-16 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500";
  const sel = "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs";

  return (
    <div className="space-y-1.5">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title — e.g. Meta ads performance check" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" />
      <select value={pattern} onChange={(e) => setPattern(e.target.value as PatternKey)} className={sel} title="Schedule pattern">
        {PATTERNS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
      {pattern === "monthly_fixed" && (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">Day of month <input value={day} onChange={(e) => setDay(e.target.value)} className={num} inputMode="numeric" /></label>
      )}
      {pattern === "monthly_multiple" && (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">Days <input value={daysText} onChange={(e) => setDaysText(e.target.value)} placeholder="8, 11, 13" className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" /></label>
      )}
      {pattern === "monthly_range" && (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">From <input value={startDay} onChange={(e) => setStartDay(e.target.value)} className={num} inputMode="numeric" /> to <input value={endDay} onChange={(e) => setEndDay(e.target.value)} className={num} inputMode="numeric" /></label>
      )}
      {pattern === "weekly" && (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">Every <select value={weekday} onChange={(e) => setWeekday(e.target.value)} className={sel}>{PATTERN_WEEKDAYS.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
      )}
      {(pattern === "yearly_fixed" || pattern === "week_of_month") && (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          {pattern === "week_of_month" ? (
            <>Week <input value={weekNum} onChange={(e) => setWeekNum(e.target.value)} className={num} inputMode="numeric" /> of</>
          ) : (
            <>Day <input value={yDay} onChange={(e) => setYDay(e.target.value)} className={num} inputMode="numeric" /> of</>
          )}
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={sel}>{PATTERN_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </div>
      )}
      {pattern === "yearly_range" && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          <input value={sDay} onChange={(e) => setSDay(e.target.value)} className={num} inputMode="numeric" />
          <select value={sMonth} onChange={(e) => setSMonth(e.target.value)} className={sel}>{PATTERN_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <span>→</span>
          <input value={eDay} onChange={(e) => setEDay(e.target.value)} className={num} inputMode="numeric" />
          <select value={eMonth} onChange={(e) => setEMonth(e.target.value)} className={sel}>{PATTERN_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </div>
      )}
      {pattern === "multi" && (
        <div className="space-y-1">
          {occs.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span>#{i + 1}</span>
              <select value={o.month} onChange={(e) => setOccs(occs.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))} className={sel}>{PATTERN_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              <input value={o.day} onChange={(e) => setOccs(occs.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} className={num} inputMode="numeric" />
              <button onClick={() => setOccs(occs.filter((_, j) => j !== i))} className="text-rose-500 hover:text-rose-400 cursor-pointer border-0 bg-transparent" title="Remove date">✕</button>
            </div>
          ))}
          <button onClick={() => setOccs([...occs, { month: "January", day: "15" }])} className="text-[11px] text-indigo-400 hover:underline cursor-pointer border-0 bg-transparent">+ Add date</button>
        </div>
      )}
      <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="accent-indigo-600" /> 👥 Shared (whole team)
      </label>
      <div className="text-[11px] text-zinc-500 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1">→ {preview}</div>
      {err && <div className="text-[11px] text-rose-500">{err}</div>}
      <button disabled={busy || !title.trim()} onClick={submit} className="w-full px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer border-0">{busy ? "Adding…" : "Add recurring task"}</button>
    </div>
  );
}
