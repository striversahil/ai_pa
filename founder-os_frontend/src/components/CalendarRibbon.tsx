import React from "react";

interface DateTab {
  dateStr: string;
  dayOfWeek: string;
  dayOfMonth: string;
  monthStr: string;
  count: number;
}

interface CalendarRibbonProps {
  selectedDate: string | null;
  setSelectedDate: (date: string | null) => void;
  dateTabs: DateTab[];
  dateInputRef: React.RefObject<HTMLInputElement | null>;
  handleCalendarClick: () => void;
  totalCount: number;
}

const isoDay = (d: Date) => d.toISOString().split("T")[0];
const shiftDay = (iso: string, by: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + by);
  return isoDay(d);
};

const navBtn =
  "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer";

// Day navigator: ‹ prev · last days as compact chips (count per day) · next ›
// · "Pick date". "Today" also carries overdue unsent rows (EnquiryList rule).
export default function CalendarRibbon({ selectedDate, setSelectedDate, dateTabs, dateInputRef, handleCalendarClick }: CalendarRibbonProps) {
  const today = isoDay(new Date());
  const current = selectedDate ?? today;
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={navBtn} onClick={() => setSelectedDate(shiftDay(current, -1))} aria-label="Previous day" title="Previous day">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.25"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Enquiry day">
        {dateTabs.map((d) => {
          const isSelected = selectedDate === d.dateStr;
          const isToday = d.dateStr === today;
          return (
            <button
              key={d.dateStr}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelectedDate(d.dateStr)}
              title={isToday ? "Today — also lists older enquiries not yet sent" : undefined}
              className={`flex flex-shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-left transition-colors cursor-pointer ${
                isSelected
                  ? "border-[var(--color-brand-indigo)] bg-[color-mix(in_srgb,var(--color-brand-indigo)_10%,transparent)] text-[var(--color-brand-indigo)]"
                  : "border-[var(--border-card)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[color-mix(in_srgb,var(--color-brand-indigo)_45%,transparent)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span className="flex flex-col leading-tight">
                <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{isToday ? "Today" : d.dayOfWeek}</span>
                <span className="text-label font-bold">{d.dayOfMonth} {d.monthStr}</span>
              </span>
              <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                isSelected ? "bg-[var(--color-brand-indigo)] text-white" : d.count > 0 ? "bg-[var(--surface-soft)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
              }`}>
                {d.count}
              </span>
            </button>
          );
        })}
      </div>

      <button type="button" className={navBtn} onClick={() => setSelectedDate(shiftDay(current, 1))} disabled={current >= today} aria-label="Next day" title="Next day">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.25"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>

      <div className="relative flex-shrink-0">
        <input
          type="date"
          ref={dateInputRef}
          value={selectedDate || ""}
          max={today}
          onChange={(e) => { if (e.target.value) setSelectedDate(e.target.value); }}
          className="pointer-events-none absolute inset-0 h-0 w-0 opacity-0"
          tabIndex={-1}
          aria-hidden
        />
        <button
          type="button"
          onClick={handleCalendarClick}
          className="flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-card)] px-3 text-caption font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <svg className="h-4 w-4 text-[var(--color-brand-indigo)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="hidden sm:inline">Pick date</span>
        </button>
      </div>
    </div>
  );
}
