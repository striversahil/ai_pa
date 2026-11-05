"use client";

// PaymentCalendar — month view of payment dues.
//
// Every day is a round pill: red = something overdue that day, amber = due
// within the week window, grey = later, plain = nothing due. The number inside
// is the day of month; the badge on the corner is how many payments are due.
// Hover (desktop) or tap (touch) reveals the bill list for that day, and
// clicking a day filters the list below.
//
// All grouping/derivation lives in ./payment-calendar.ts.
import React, { useMemo, useState } from "react";
import type { PaymentDueRow } from "./PaymentDues";
import {
  awaitingStatement,
  carriedOverdue,
  countdownText,
  dayLabel,
  daySeverity,
  duesByDay,
  fmtDay,
  fmtDayLong,
  inr,
  istToday,
  monthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  statementsByDay,
  sumAmount,
} from "./payment-calendar";

const PILL: Record<string, string> = {
  none: "border border-zinc-200/70 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600",
  later:
    "border border-zinc-300/80 bg-zinc-100/70 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300",
  week:
    "border border-amber-500/60 bg-amber-500/15 text-amber-800 font-bold dark:border-amber-400/50 dark:bg-amber-400/15 dark:text-amber-200",
  overdue:
    "border border-rose-500/60 bg-rose-500/15 text-rose-700 font-bold dark:border-rose-400/50 dark:bg-rose-500/20 dark:text-rose-200",
};

const BADGE: Record<string, string> = {
  week: "bg-amber-500 text-amber-950",
  overdue: "bg-rose-600 text-white",
  later: "bg-zinc-500 text-white",
};

const DOT: Record<string, string> = {
  overdue: "bg-rose-500",
  week: "bg-amber-500",
  later: "bg-zinc-400",
};

export default function PaymentCalendar({ dues, selectedDay, onSelectDay, onPay }: {
  dues: PaymentDueRow[];
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  onPay: (row: PaymentDueRow) => void;
}) {
  const today = useMemo(() => istToday(), []);
  const [month, setMonth] = useState<string>(() => monthOf(istToday()));
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  // Hover-preview is a pointer-device affordance only. On touch, selecting a
  // day re-flows the page and the synthetic mouseenter that follows the tap
  // would preview whichever pill happens to land under the lifted finger —
  // so the panel would describe a different day than the one selected.
  const canHover = useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover)").matches,
    [],
  );
  const preview = (day: string) => { if (canHover) setHoverDay(day); };

  const byDay = useMemo(() => duesByDay(dues), [dues]);
  const statements = useMemo(() => statementsByDay(dues), [dues]);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const backdated = useMemo(() => carriedOverdue(dues, `${month}-01`), [dues, month]);

  const panelDay = hoverDay ?? selectedDay;
  const panelRows = panelDay ? (byDay.get(panelDay) ?? []) : [];
  const panelStatements = panelDay ? (statements.get(panelDay) ?? []) : [];

  const monthTotals = useMemo(() => {
    let count = 0;
    let total = 0;
    let overdue = 0;
    for (const [date, rows] of byDay) {
      if (!date.startsWith(month)) continue;
      count += rows.length;
      total += sumAmount(rows);
      overdue += rows.filter((r) => r.bucket === "overdue").length;
    }
    return { count, total, overdue };
  }, [byDay, month]);

  return (
    <section className="flex flex-col rounded-xl border border-zinc-200/80 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 lg:max-h-[72vh] lg:overflow-hidden">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-bold text-zinc-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-300 cursor-pointer"
            aria-label="Previous month"
            title="Previous month"
          >
            ‹
          </button>
          <button
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-bold text-zinc-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-300 cursor-pointer"
            aria-label="Next month"
            title="Next month"
          >
            ›
          </button>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-zinc-900 dark:text-white">{monthLabel(month)}</p>
          <p className="text-[11px] text-zinc-500">
            {monthTotals.count === 0
              ? "nothing due this month"
              : `${monthTotals.count} due${monthTotals.total > 0 ? ` · ${inr(monthTotals.total)}` : ""}${monthTotals.overdue ? ` · ${monthTotals.overdue} overdue` : ""}`}
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setMonth(monthOf(today))}
          className="rounded-lg border border-zinc-300 px-2 py-1 text-[11px] font-bold text-zinc-600 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-300 cursor-pointer"
          title="Jump to the current month"
        >
          Today
        </button>
        <ul className="flex w-full flex-wrap items-center gap-2 text-[10px] font-semibold text-zinc-500">
          <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />Overdue</li>
          <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />This week</li>
          <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-zinc-400" />Later</li>
          <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500" />Statement</li>
        </ul>
      </div>

      {/* ── backdate log: unpaid bills from earlier months ─────────────── */}
      {backdated.length > 0 && (
        <div className="shrink-0 space-y-1 border-b border-zinc-100 bg-rose-500/5 px-3 py-2 dark:border-zinc-800">
          <p className="text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
            ⚠ Still unpaid from earlier
          </p>
          {/* A narrow rail can't fit chips side by side without cutting one off,
              so these are full-width rows that truncate cleanly. */}
          {backdated.slice(0, 3).map((r) => (
            <button
              key={`${r.templateId}-${r.dueDate}-${r.logId ?? "proj"}`}
              onClick={() => setMonth(monthOf(r.dueDate))}
              title={`${r.title}${r.biller ? ` · ${r.biller}` : ""} · ${r.amount === null ? "amount TBD" : inr(r.amount)} · was due ${fmtDayLong(r.dueDate)} (${r.daysOverdue}d ago) — click to open that month`}
              className="flex w-full items-center gap-1.5 rounded-lg border border-rose-500/30 bg-white px-2 py-1 text-left text-[10px] font-bold text-rose-700 hover:bg-rose-500/10 dark:bg-zinc-900 dark:text-rose-300 cursor-pointer"
            >
              <span className="shrink-0 font-mono">{fmtDay(r.dueDate)}</span>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="shrink-0 font-mono text-rose-600/80 dark:text-rose-400/80">
                {r.amount === null ? "TBD" : inr(r.amount)}
              </span>
            </button>
          ))}
          {backdated.length > 3 && (
            <button
              onClick={() => setMonth(monthOf(backdated[3].dueDate))}
              className="text-[10px] font-semibold text-rose-600/80 hover:underline dark:text-rose-400/80 cursor-pointer"
              title={`Jump to ${monthLabel(monthOf(backdated[3].dueDate))}`}
            >
              +{backdated.length - 3} more from earlier months
            </button>
          )}
        </div>
      )}

      {/* ── grid ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-2 pb-1 pt-2" onMouseLeave={() => setHoverDay(null)}>
        <div className="grid grid-cols-7 gap-x-1">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="pb-1 text-center text-[10px] font-bold uppercase tracking-wide text-zinc-400">
              {d.slice(0, 1)}
              <span className="sr-only">{d}</span>
            </div>
          ))}
          {weeks.flat().map((cell) => {
            const rows = byDay.get(cell.date) ?? [];
            const stmts = statements.get(cell.date) ?? [];
            const severity = daySeverity(rows, today, cell.date);
            const isToday = cell.date === today;
            const isSelected = cell.date === selectedDay;
            const label = dayLabel(cell.date, rows, stmts, today);
            return (
              <div key={cell.date} className="flex items-center justify-center p-1">
                <button
                  onClick={() => onSelectDay(isSelected ? null : cell.date)}
                  onMouseEnter={() => preview(cell.date)}
                  onFocus={() => preview(cell.date)}
                  aria-pressed={isSelected}
                  aria-label={label}
                  title={label}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full text-xs transition-colors sm:h-9 sm:w-9 cursor-pointer ${
                    cell.inMonth ? PILL[severity] : "text-zinc-300 dark:text-zinc-700"
                  } ${
                    // Both markers are INSET rings: they paint inside the pill,
                    // so nothing is ever clipped by the tight grid rows and
                    // "today" always shows as a whole circle. Mutually
                    // exclusive so the two ring colours can never fight.
                    isSelected
                      ? "ring-2 ring-inset ring-indigo-600 dark:ring-indigo-400"
                      : isToday
                        ? "ring-2 ring-inset ring-zinc-400 dark:ring-zinc-500"
                        : ""
                  } ${rows.length ? "hover:brightness-105" : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"}`}
                >
                  {cell.day}
                  {rows.length > 0 && (
                    <span
                      className={`absolute -right-1 -top-1 min-w-[15px] rounded-full px-1 text-[9px] font-extrabold leading-[15px] ${BADGE[severity] ?? BADGE.later}`}
                      aria-hidden="true"
                    >
                      {rows.length}
                    </span>
                  )}
                  {stmts.length > 0 && (
                    <span
                      className="absolute -bottom-0.5 h-1.5 w-1.5 rounded-full bg-indigo-500 ring-1 ring-white dark:ring-zinc-900"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── day detail: hover on desktop, tap on touch ─────────────────── */}
      {/* Stable height: if the panel grew/shrank with its content, the grid
          above would shift under the pointer and hover would land on a
          different day right after a click. Fixed on desktop + inner scroll. */}
      <div className="min-h-[92px] border-t border-zinc-100 px-3 py-2 dark:border-zinc-800 lg:h-40 lg:min-h-0 lg:overflow-y-auto">
        {!panelDay && (
          <p className="text-[11px] text-zinc-500">Hover or tap a day to see what is due.</p>
        )}
        {panelDay && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold text-zinc-900 dark:text-white">{fmtDayLong(panelDay)}</p>
              <span className="text-[11px] text-zinc-500">
                {panelRows.length
                  ? `${panelRows.length} payment${panelRows.length === 1 ? "" : "s"}${sumAmount(panelRows) > 0 ? ` · ${inr(sumAmount(panelRows))}` : ""}`
                  : "no payments due"}
              </span>
              {selectedDay === panelDay && (
                <button
                  onClick={() => onSelectDay(null)}
                  className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-bold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300 cursor-pointer"
                  title="Clear the day filter"
                >
                  Clear filter ×
                </button>
              )}
            </div>
            {panelRows.map((r) => (
              <div
                key={`${r.templateId}-${r.dueDate}-${r.logId ?? "proj"}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[r.bucket] ?? DOT.later}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                  {r.title}
                  {r.biller && r.biller !== r.title && (
                    <span className="ml-1 font-normal text-zinc-500">· {r.biller}</span>
                  )}
                </span>
                <span className={`text-[10px] font-bold ${r.bucket === "overdue" ? "text-rose-600 dark:text-rose-400" : r.bucket === "week" ? "text-amber-700 dark:text-amber-300" : "text-zinc-500"}`}>
                  {countdownText(r)}
                </span>
                <span className="font-mono text-xs font-bold text-zinc-900 dark:text-white">
                  {r.amount === null || awaitingStatement(r, today) ? "Amount TBD" : inr(r.amount)}
                </span>
                <button
                  onClick={() => onPay(r)}
                  className="rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-500 cursor-pointer"
                >
                  Mark paid
                </button>
              </div>
            ))}
            {panelStatements.map((s) => (
              <div
                key={`stmt-${s.templateId}-${s.dueDate}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-2 py-1.5"
                title={`Statement date — the card amount is known from ${fmtDayLong(s.statementDate ?? s.dueDate)}; bill due ${fmtDayLong(s.dueDate)}`}
              >
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300">💳 Statement date</span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
                  {s.title}
                  {s.biller && s.biller !== s.title && <span className="ml-1 font-normal text-zinc-500">· {s.biller}</span>}
                </span>
              </div>
            ))}
            {!panelRows.length && !panelStatements.length && (
              <p className="text-[11px] text-zinc-500">Nothing scheduled on this day.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
