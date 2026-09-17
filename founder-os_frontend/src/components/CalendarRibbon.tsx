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
    <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-2 py-2 overflow-hidden">
      <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-zinc-400 uppercase shrink-0 pr-2 border-r border-zinc-200 dark:border-zinc-700">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        {new Date(selectedDate || todayStr).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
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
              className={`shrink-0 flex flex-col items-center justify-center min-w-[56px] py-1.5 rounded-lg border transition-colors cursor-pointer
                ${isSelected ? "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 border-zinc-900 dark:border-white" : isToday ? "bg-white dark:bg-zinc-800 border-zinc-900 dark:border-zinc-600 text-zinc-900 dark:text-white" : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300"}`}
            >
              <span className="text-[9px] font-bold tracking-widest opacity-60">{d.dayOfWeek.slice(0, 3).toUpperCase()}</span>
              <span className="text-sm font-bold leading-none">{d.dayOfMonth}</span>
              <span className={`text-[10px] leading-none mt-0.5 ${isSelected ? "opacity-70" : "opacity-50"}`}>{d.count}</span>
            </button>
          );
        })}
      </div>
      <input type="date" ref={dateInputRef} value={selectedDate || todayStr} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} className="absolute opacity-0 pointer-events-none w-0 h-0" />
      <button type="button" onClick={handleCalendarClick} className="shrink-0 w-7 h-7 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-zinc-900 cursor-pointer" title="Pick date">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
      </button>
    </div>
  );
}
