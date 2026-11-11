"use client";

// FieldExpenseCalendar — day-wise spend log for field staff (global, not per-visit).
// Month grid (Monday-first) + day panel with log form. Pure grouping lives in
// ./expense-calendar.ts; this component only renders + calls onLog.

import React, { useMemo, useState } from "react";
import {
  expensesByDay, fmtDay, fmtDayLong, inr, inrShort,
  istToday, monthGrid, monthLabel, monthOf, shiftMonth, sumDay,
} from "@/field-staff/expense-calendar";
import type { DayCell } from "@/field-staff/expense-calendar";
import type { FieldExpense } from "@/field-staff/types";

const inputCls =
  "w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]";

export default function FieldExpenseCalendar({
  expenses,
  staff,
  expenseStaffId,
  onExpenseStaffChange,
  onLog,
}: {
  expenses: FieldExpense[];
  staff: Array<{ id: string; name: string; region: string }>;
  expenseStaffId: string;
  onExpenseStaffChange: (id: string) => void;
  onLog: (args: { day: string; staffId: string; amount: number; description: string }) => Promise<void>;
}) {
  const today = istToday();
  const [month, setMonth] = useState(monthOf(today));
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const staffName = staff.find((s) => s.id === expenseStaffId)?.name ?? "";
  const canLog = !!expenseStaffId;

  const byDay = useMemo(() => expensesByDay(expenses ?? []), [expenses]);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const dayRows = byDay.get(day) ?? [];
  const monthTotal = useMemo(() => {
    let t = 0;
    for (const [d, rows] of byDay) if (d.startsWith(month)) t += sumDay(rows);
    return t;
  }, [byDay, month]);

  const submit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return setErr("Enter a valid amount.");
    if (!desc.trim()) return setErr("Add a short description.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setErr("Pick a day first.");
    if (!expenseStaffId) return setErr("Pick a staffer above first.");
    setBusy(true); setErr("");
    try {
      await onLog({ day, staffId: expenseStaffId, amount: n, description: desc.trim() });
      setAmount(""); setDesc("");
    } catch (e: any) {
      setErr(String(e?.message ?? "save failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Staffer</span>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => onExpenseStaffChange(s.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
                s.id === expenseStaffId
                  ? "bg-emerald-600 text-white ring-emerald-600 shadow"
                  : "bg-[var(--bg-card)] text-[var(--text-secondary)] ring-[var(--border-card)] hover:ring-emerald-500/50"
              }`}
            >
              {s.name}{s.region ? ` · ${s.region}` : ""}
            </button>
          ))}
        </div>
        {staff.length === 0 && <span className="text-[11px] text-[var(--text-tertiary)]">No field staff in roster — add them in Controller → Roster (type = Field Staff).</span>}
      </div>
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className="rounded-lg px-2.5 py-1.5 text-sm font-bold ring-1 ring-[var(--border-card)] hover:bg-black/5">‹</button>
          <p className="text-sm font-extrabold text-[var(--text-primary)]">{monthLabel(month)}</p>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" className="rounded-lg px-2.5 py-1.5 text-sm font-bold ring-1 ring-[var(--border-card)] hover:bg-black/5">›</button>
          <button onClick={() => { setMonth(monthOf(today)); setDay(today); }} className="ml-auto text-[11px] font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Today</button>
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300" title="Spend in view month">{inrShort(monthTotal)}</span>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1.5 text-center text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="mt-1.5 space-y-1.5">
          {weeks.map((week: DayCell[], wi: number) => (
            <div key={wi} className="grid grid-cols-7 gap-1.5">
              {week.map((cell: DayCell) => {
                const rows = byDay.get(cell.date) ?? [];
                const total = sumDay(rows);
                const selected = cell.date === day;
                const isToday = cell.date === today;
                return (
                  <button
                    key={cell.date}
                    onClick={() => setDay(cell.date)}
                    title={rows.length ? `${fmtDayLong(cell.date)} — ${inr(total)} across ${rows.length}` : fmtDayLong(cell.date)}
                    aria-label={`${fmtDayLong(cell.date)}${rows.length ? `, ${inr(total)}` : ""}`}
                    className={`min-h-[58px] rounded-xl px-1.5 py-1.5 text-left ring-1 transition ${
                      selected
                        ? "bg-brand-indigo text-white shadow ring-2 ring-brand-indigo"
                        : isToday
                          ? "bg-[var(--bg-input)] shadow-[inset_0_0_0_2px_var(--brand-indigo)] ring-[var(--border-card)] hover:ring-brand-indigo/50"
                          : "bg-[var(--bg-input)]/50 ring-[var(--border-card)] hover:bg-[var(--bg-input)] hover:ring-brand-indigo/40"
                    } ${cell.inMonth ? "" : "opacity-40"}`}
                  >
                    <span className={`text-xs font-extrabold ${selected ? "text-white" : "text-[var(--text-primary)]"}`}>{cell.day}</span>
                    {total > 0 ? (
                      <span className={`mt-0.5 block truncate font-mono text-[10px] font-bold ${selected ? "text-white/90" : "text-emerald-600 dark:text-emerald-400"}`}>
                        ₹{Math.round(total).toLocaleString("en-IN")}
                      </span>
                    ) : (
                      <span className={`mt-0.5 block text-[10px] ${selected ? "text-white/50" : "text-transparent"}`}>·</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {staffName && <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">Showing {staffName} · {fmtDay(day)} selected · {inr(monthTotal)} this month</p>}
      </div>

      <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3 lg:sticky lg:top-4 lg:max-h-[72vh] lg:overflow-y-auto">
        <p className="text-sm font-extrabold text-[var(--text-primary)]">
          {fmtDayLong(day)} <span className="font-mono text-[var(--text-tertiary)]">{inr(sumDay(dayRows))}</span>
        </p>
        {staffName && <p className="mt-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{staffName}</p>}
        <div className="mt-2 max-h-[260px] space-y-1 overflow-y-auto lg:max-h-[30vh]">
          {dayRows.map((e: FieldExpense) => (
            <div key={e.id} className="flex items-baseline gap-2 rounded-lg bg-black/[0.02] px-2 py-1.5 text-[11px] dark:bg-white/[0.03]">
              <span className="truncate text-[var(--text-secondary)]" title={e.createdByName ? `logged by ${e.createdByName}` : undefined}>{e.description}</span>
              <span className="ml-auto flex-shrink-0 font-mono font-bold text-[var(--text-primary)]">₹{Number(e.amount).toLocaleString("en-IN")}</span>
            </div>
          ))}
          {dayRows.length === 0 && <p className="rounded-xl border border-dashed border-[var(--border-card)] p-4 text-center text-[11px] text-[var(--text-tertiary)]">No spends logged this day.</p>}
        </div>
        {canLog ? (
          <div className="mt-2 space-y-1.5 border-t border-[var(--border-card)] pt-2">
            <div className="flex gap-1.5">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹ amount" inputMode="decimal" className={inputCls} />
              <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What for? (fuel, food…)" className={inputCls} />
            </div>
            {err && <p className="text-[11px] text-red-600">{err}</p>}
            <button onClick={submit} disabled={busy} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50">
              {busy ? "Saving…" : `+ Log for ${fmtDay(day)}${staffName ? ` · ${staffName}` : ""}`}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-[10px] text-[var(--text-tertiary)]">Pick a staffer above to log spends.</p>
        )}
      </div>
    </div>
    </div>
  );
}
