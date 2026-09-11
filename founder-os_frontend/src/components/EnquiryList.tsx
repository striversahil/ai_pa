import React, { useState, useMemo, useRef } from "react";
import { Agent, Enquiry } from "../mockData";
import CalendarRibbon from "./CalendarRibbon";
import FilterControls from "./FilterControls";
import EnquiryRowItem from "./EnquiryRowItem";

interface EnquiryListProps {
  enquiries: Enquiry[];
  agents: Agent[];
  redacted?: boolean;
  /** Pending-only queue (procurement/management): {label, predicate}. When
   *  provided, the list defaults to pending items with an "All" toggle. */
  queueToggle?: { pendingLabel: string; isPending: (e: Enquiry) => boolean };
  onViewDetail: (enquiryId: string) => void;
  onOpenCreate: () => void;
  onExportCSV: () => void;
  onImportCSV: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  triggerCSVInput: () => void;
}

export default function EnquiryList({
  enquiries,
  agents,
  redacted = false,
  queueToggle,
  onViewDetail,
  onOpenCreate,
  onExportCSV,
  onImportCSV,
  fileInputRef,
  triggerCSVInput
}: EnquiryListProps) {
  // Localized filters state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [ratesFilter, setRatesFilter] = useState("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [queueOnly, setQueueOnly] = useState(true);

  const dateInputRef = useRef<HTMLInputElement>(null);

  const handleCalendarClick = () => {
    if (dateInputRef.current) {
      try {
        dateInputRef.current.showPicker();
      } catch {
        dateInputRef.current.click();
      }
    }
  };

  // Generate date list for ribbon
  const dateTabs = useMemo(() => {
    const datesMap: Record<string, number> = {};
    
    // Initialize last 5 days with 0 counts
    const today = new Date();
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      datesMap[dateStr] = 0;
    }

    // Append selected date dynamically if it is outside the last 5 days
    if (selectedDate && datesMap[selectedDate] === undefined) {
      datesMap[selectedDate] = 0;
    }

    // Count enquiries per day
    enquiries.forEach(e => {
      if (e.createdAt) {
        const dateStr = new Date(e.createdAt).toISOString().split("T")[0];
        if (datesMap[dateStr] !== undefined) {
          datesMap[dateStr]++;
        }
      }
    });

    // Convert to sorted array (newest first)
    return Object.keys(datesMap)
      .sort((a, b) => b.localeCompare(a))
      .map(dateStr => {
        const dateObj = new Date(dateStr);
        const dayOfWeek = dateObj.toLocaleDateString("en-US", { weekday: "short" }); // e.g. "Mon"
        const dayOfMonth = dateObj.toLocaleDateString("en-US", { day: "numeric" }); // e.g. "26"
        const monthStr = dateObj.toLocaleDateString("en-US", { month: "short" }); // e.g. "Jun"
        return {
          dateStr,
          dayOfWeek,
          dayOfMonth,
          monthStr,
          count: datesMap[dateStr]
        };
      });
  }, [enquiries, selectedDate]);

  // Filtered queries pipeline
  const filteredEnquiries = useMemo(() => {
    const inQueue = queueToggle && queueOnly ? enquiries.filter(queueToggle.isPending) : enquiries;
    return inQueue.filter(e => {
      const query = searchQuery.toLowerCase();
      const matchSearch = e.clientCompany.toLowerCase().includes(query) ||
        e.title.toLowerCase().includes(query) ||
        e.contactName.toLowerCase().includes(query);

      const matchStatus = statusFilter === "all" || e.status === statusFilter;
      const matchPriority = priorityFilter === "all" || e.priority === priorityFilter;
      const matchAgent = agentFilter === "all" || e.assignedAgentId === agentFilter;
      const matchSource = sourceFilter === "all" || (e.source || "TL") === sourceFilter;
      const matchRates = ratesFilter === "all"
        || (ratesFilter === "ready" && (e.rateStatus ?? "") === "finalized")
        || (ratesFilter === "awaiting" && (e.rateStatus ?? "") !== "finalized");

      const matchDate = !selectedDate || new Date(e.createdAt).toISOString().split("T")[0] === selectedDate;

      return matchSearch && matchStatus && matchPriority && matchAgent && matchSource && matchRates && matchDate;
    });
  }, [enquiries, searchQuery, statusFilter, priorityFilter, agentFilter, sourceFilter, ratesFilter, selectedDate, queueToggle, queueOnly]);

  const pendingCount = queueToggle ? enquiries.filter(queueToggle.isPending).length : enquiries.length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold font-heading tracking-tight">Daily Enquiries</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">Track and confirm incoming client requests.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={onExportCSV} 
            className="inline-flex items-center justify-center gap-1.5 bg-[var(--bg-card)] border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs px-3.5 py-2.5 rounded-xl transition-all duration-200 cursor-pointer"
            type="button"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>Export CSV</span>
          </button>

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={onImportCSV} 
            accept=".csv" 
            className="hidden" 
          />
          {!redacted && (
          <>
          <button 
            onClick={triggerCSVInput} 
            className="inline-flex items-center justify-center gap-1.5 bg-[var(--bg-card)] border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs px-3.5 py-2.5 rounded-xl transition-all duration-200 cursor-pointer"
            type="button"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Import CSV</span>
          </button>

          {!redacted && (
          <button 
            onClick={onOpenCreate} 
            className="inline-flex items-center justify-center gap-2 bg-brand-indigo hover:opacity-90 text-white font-bold text-sm px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-600/20 transition-all duration-200 cursor-pointer"
            type="button"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>New Enquiry</span>
          </button>
          )}
          </>
          )}
        </div>
      </div>

      {/* Pending queue toggle (procurement/management work queues) */}
      {queueToggle && (
        <div className="flex flex-row flex-wrap gap-2">
          <button onClick={() => setQueueOnly(true)} type="button"
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${queueOnly ? "bg-indigo-600 text-white shadow-sm" : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>
            {queueToggle.pendingLabel} ({pendingCount})
          </button>
          <button onClick={() => setQueueOnly(false)} type="button"
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${!queueOnly ? "bg-indigo-600 text-white shadow-sm" : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>
            All enquiries ({enquiries.length})
          </button>
        </div>
      )}

      {/* Horizontal Calendar Selector */}
      <CalendarRibbon
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        dateTabs={dateTabs}
        dateInputRef={dateInputRef}
        handleCalendarClick={handleCalendarClick}
        totalCount={enquiries.length}
      />

      {/* Filters Form */}
      <FilterControls
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        priorityFilter={priorityFilter}
        setPriorityFilter={setPriorityFilter}
        agentFilter={agentFilter}
        setAgentFilter={setAgentFilter}
        agents={agents}
        hideAgentFilter={redacted}
        hideStatusFilter={redacted}
        sourceFilter={sourceFilter}
        setSourceFilter={redacted ? undefined : setSourceFilter}
        ratesFilter={ratesFilter}
        setRatesFilter={redacted ? undefined : setRatesFilter}
      />

      {/* List */}
      {filteredEnquiries.length === 0 ? (
        <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-3">
          <svg className="w-12 h-12 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="font-heading font-extrabold text-base md:text-lg">No enquiries found</h3>
          <p className="text-xs text-[var(--text-secondary)]">Try widening your filters or search keywords.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEnquiries.map(enq => {
            const agent = agents.find(a => a.id === enq.assignedAgentId);
            return (
              <EnquiryRowItem
                key={enq.id}
                enq={enq}
                agent={agent}
                hideIdentity={redacted}
                onViewDetail={onViewDetail}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
