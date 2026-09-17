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

export default function CalendarRibbon({
  selectedDate,
  setSelectedDate,
  dateTabs,
  dateInputRef,
  handleCalendarClick,
}: CalendarRibbonProps) {
  const todayStr = new Date().toISOString().split("T")[0];
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-3 py-3 flex items-center gap-2 overflow-hidden">
      <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-zinc-500 dark:text-zinc-400 uppercase shrink-0 pr-2 border-r border-zinc-200 dark:border-zinc-800">
        <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Dates
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1">
        {dateTabs.map((d) => {
          const isSelected = selectedDate === d.dateStr;
          const isToday = d.dateStr === todayStr;
          return (
            <button
              key={d.dateStr}
              onClick={() => setSelectedDate(d.dateStr)}
              type="button"
              className={`shrink-0 flex items-center gap-2.5 px-3.5 py-2 rounded-full border text-xs font-semibold transition-all duration-150 cursor-pointer
                ${isSelected
                  ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
                  : isToday
                    ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:border-indigo-300"
                    : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                }`}
            >
              <span className="flex flex-col items-center leading-none">
                <span className="text-[10px] font-extrabold tracking-widest opacity-70">{d.dayOfWeek.toUpperCase()}</span>
                <span className="text-sm font-extrabold -mt-0.5">{d.dayOfMonth}</span>
              </span>
              <span className="flex flex-col items-start leading-none pl-2 border-l border-current/15">
                <span className="text-[11px] font-bold">{d.monthStr}</span>
                <span className={`text-[10px] ${isSelected ? "text-white/80" : "text-zinc-500 dark:text-zinc-400"}`}>{d.count} enq</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="shrink-0 flex items-center gap-1">
        <input
          type="date"
          ref={dateInputRef}
          value={selectedDate || todayStr}
          onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
          className="absolute opacity-0 pointer-events-none w-0 h-0"
        />
        <button
          type="button"
          onClick={handleCalendarClick}
          className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-indigo-300 dark:hover:border-indigo-600 flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:text-indigo-600 transition-colors cursor-pointer"
          title="Jump to date"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
