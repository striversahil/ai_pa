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
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-2.5 py-2 flex items-center gap-2 overflow-hidden">
      <div className="flex items-center gap-1 text-[10px] font-bold tracking-widest text-zinc-500 uppercase shrink-0 pr-2 border-r border-zinc-200 dark:border-zinc-800">
        <svg className="w-3 h-3 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        Dates
      </div>
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1">
        {dateTabs.map((d) => {
          const isSelected = selectedDate === d.dateStr;
          const isToday = d.dateStr === todayStr;
          return (
            <button key={d.dateStr} onClick={() => setSelectedDate(d.dateStr)} type="button"
              className={`shrink-0 flex items-center gap-2 px-2.5 py-1.5 rounded-full border text-[11px] font-semibold cursor-pointer
                ${isSelected ? "bg-indigo-600 border-indigo-600 text-white" : isToday ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 text-indigo-700" : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300"}`}>
              <span className="text-[10px] font-bold opacity-70">{d.dayOfWeek.slice(0,2).toUpperCase()}</span>
              <span className="text-xs font-extrabold">{d.dayOfMonth}</span>
              <span className={`text-[10px] ${isSelected ? "text-white/80" : "text-zinc-500"}`}>{d.count}</span>
            </button>
          );
        })}
      </div>
      <div className="shrink-0">
        <input type="date" ref={dateInputRef} value={selectedDate || todayStr} onChange={(e) => e.target.value && setSelectedDate(e.target.value)} className="absolute opacity-0 pointer-events-none w-0 h-0" />
        <button type="button" onClick={handleCalendarClick} className="w-7 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-indigo-600 cursor-pointer" title="Jump"><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></button>
      </div>
    </div>
  );
}
