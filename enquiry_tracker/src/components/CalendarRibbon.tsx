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
  totalCount
}: CalendarRibbonProps) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
          <svg className="w-4 h-4 text-brand-indigo" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span>Calendar Navigation</span>
        </span>
        {selectedDate && (
          <button 
            onClick={() => setSelectedDate(null)} 
            className="text-xs font-bold text-brand-indigo hover:underline flex items-center gap-1 cursor-pointer bg-transparent border-0"
          >
            <span>Show All Days</span>
            <span>&times;</span>
          </button>
        )}
      </div>
      
      <div className="flex items-center gap-3 overflow-x-auto pb-1.5">
        {/* "All" button */}
        <button
          onClick={() => setSelectedDate(null)}
          className={`flex-shrink-0 px-4 py-2 rounded-xl border flex flex-col items-center justify-center min-w-[70px] cursor-pointer transition-all duration-200
            ${!selectedDate 
              ? "bg-brand-indigo border-brand-indigo text-white shadow-md shadow-indigo-600/20" 
              : "bg-[var(--bg-input)] border-[var(--border-card)] hover:border-brand-indigo text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          type="button"
        >
          <span className="text-[9px] font-bold uppercase tracking-wider">View</span>
          <span className="text-sm font-extrabold mt-0.5">All</span>
          <span className="text-[9px] font-medium opacity-80 mt-0.5">{totalCount} Enq</span>
        </button>

        {/* Date Cards */}
        {dateTabs.map(dateObj => {
          const isSelected = selectedDate === dateObj.dateStr;
          return (
            <button
              key={dateObj.dateStr}
              onClick={() => setSelectedDate(dateObj.dateStr)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl border flex flex-col items-center justify-center min-w-[75px] cursor-pointer transition-all duration-200
                ${isSelected 
                  ? "bg-brand-indigo border-brand-indigo text-white shadow-md shadow-indigo-600/20" 
                  : "bg-[var(--bg-input)] border-[var(--border-card)] hover:border-brand-indigo text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              type="button"
            >
              <span className="text-[9px] font-bold uppercase tracking-wider">{dateObj.dayOfWeek}</span>
              <span className="text-sm font-extrabold mt-0.5">{dateObj.dayOfMonth}</span>
              <span className="text-[9px] font-medium mt-0.5">{dateObj.monthStr} • {dateObj.count}</span>
            </button>
          );
        })}

        {/* Inline Date Picker Jump Box */}
        <div className="flex-shrink-0 relative">
          <input 
            type="date"
            ref={dateInputRef}
            value={selectedDate || ""}
            onChange={(e) => {
              if (e.target.value) {
                setSelectedDate(e.target.value);
              } else {
                setSelectedDate(null);
              }
            }}
            className="absolute inset-0 opacity-0 pointer-events-none w-0 h-0"
          />
          <button 
            type="button"
            onClick={handleCalendarClick}
            className="px-4 py-3 border border-[var(--border-card)] hover:border-brand-indigo rounded-xl bg-[var(--bg-input)] hover:bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all duration-200 flex items-center justify-center gap-1.5 min-w-[75px] cursor-pointer"
          >
            <svg className="w-5 h-5 text-brand-indigo" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-xs font-bold">Jump</span>
          </button>
        </div>
      </div>
    </div>
  );
}
