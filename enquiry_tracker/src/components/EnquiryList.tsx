import React, { useState, useMemo, useRef } from "react";
import { Agent, Enquiry } from "../mockData";

interface EnquiryListProps {
  enquiries: Enquiry[];
  agents: Agent[];
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
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    return new Date().toISOString().split("T")[0];
  });

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
    return enquiries.filter(e => {
      const query = searchQuery.toLowerCase();
      const matchSearch = e.clientCompany.toLowerCase().includes(query) ||
        e.title.toLowerCase().includes(query) ||
        e.contactName.toLowerCase().includes(query);

      const matchStatus = statusFilter === "all" || e.status === statusFilter;
      const matchPriority = priorityFilter === "all" || e.priority === priorityFilter;
      const matchAgent = agentFilter === "all" || e.assignedAgentId.toString() === agentFilter;
      
      const matchDate = !selectedDate || new Date(e.createdAt).toISOString().split("T")[0] === selectedDate;

      return matchSearch && matchStatus && matchPriority && matchAgent && matchDate;
    });
  }, [enquiries, searchQuery, statusFilter, priorityFilter, agentFilter, selectedDate]);

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
        </div>
      </div>

      {/* Horizontal Calendar Selector */}
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
            <span className="text-[9px] font-medium opacity-80 mt-0.5">{enquiries.length} Enq</span>
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
                }
              }}
              className="absolute pointer-events-none opacity-0 w-0 h-0"
            />
            <button
              onClick={handleCalendarClick}
              className={`px-4 py-2.5 rounded-xl border flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer h-[54px]
                ${selectedDate && !dateTabs.some(d => d.dateStr === selectedDate)
                  ? "bg-brand-indigo border-brand-indigo text-white shadow-md shadow-indigo-600/20"
                  : "bg-[var(--bg-input)] border-[var(--border-card)] hover:border-brand-indigo text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              type="button"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs font-bold text-center">
                {selectedDate && !dateTabs.some(d => d.dateStr === selectedDate)
                  ? new Date(selectedDate).toLocaleDateString("en-US", { month: 'short', day: 'numeric' })
                  : "Jump to Date"
                }
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-4 flex flex-col md:flex-row gap-4 items-stretch md:items-center">
        <div className="relative flex-grow">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input 
            type="text" 
            placeholder="Search company, title, contact..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo focus:bg-[var(--bg-card)] focus:ring-3 focus:ring-brand-indigo/15 text-sm transition-all duration-200"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select 
            className="px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-xs font-semibold cursor-pointer"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Stages</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="qualified">Qualified</option>
            <option value="proposal">Proposal</option>
            <option value="negotiation">Negotiation</option>
            <option value="won">Closed Won</option>
            <option value="lost">Closed Lost</option>
          </select>

          <select 
            className="px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-xs font-semibold cursor-pointer"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="all">All Priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select 
            className="px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-xs font-semibold cursor-pointer"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="all">All Agents</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

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
              <div 
                key={enq.id} 
                className="p-4 border border-[var(--border-card)] rounded-xl hover:border-brand-indigo flex flex-col md:grid md:grid-cols-[2fr_1fr_1fr_1fr_auto] items-start md:items-center gap-3 md:gap-6 cursor-pointer transition-all duration-200 bg-[var(--bg-card)] shadow-xs hover:shadow-md" 
                onClick={() => onViewDetail(enq.id)}
              >
                <div className="min-w-0">
                  <span className="block font-bold text-sm md:text-base truncate">{enq.title}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-[var(--text-secondary)] font-semibold">{enq.clientCompany}</span>
                    <span className="text-[var(--text-tertiary)] text-[10px]">•</span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">{new Date(enq.createdAt).toDateString()}</span>
                  </div>
                </div>

                <div>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider
                    ${enq.status === "new" ? "bg-[var(--bg-input)] text-[var(--text-secondary)]" : ""}
                    ${enq.status === "contacted" ? "bg-indigo-500/10 text-brand-indigo" : ""}
                    ${enq.status === "qualified" ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" : ""}
                    ${enq.status === "proposal" ? "bg-purple-500/10 text-purple-600 dark:text-purple-400" : ""}
                    ${enq.status === "negotiation" ? "bg-brand-amber/10 text-brand-amber" : ""}
                    ${enq.status === "won" ? "bg-brand-emerald/10 text-brand-emerald" : ""}
                    ${enq.status === "lost" ? "bg-brand-rose/10 text-brand-rose" : ""}
                  `}>
                    {enq.status}
                  </span>
                </div>

                <div className="flex items-center gap-1 text-xs">
                  <span className={`w-2 h-2 rounded-full 
                    ${enq.priority === "high" ? "bg-brand-rose" : ""}
                    ${enq.priority === "medium" ? "bg-brand-amber" : ""}
                    ${enq.priority === "low" ? "bg-brand-emerald" : ""}
                  `}></span>
                  <span className="capitalize font-medium">{enq.priority}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] text-white flex-shrink-0" style={{ backgroundColor: agent?.color }}>
                    {agent?.initials || "UN"}
                  </div>
                  <span className="text-xs font-semibold">{agent?.name.split(" ")[0]}</span>
                </div>

                <div className="w-full md:w-auto text-left md:text-right font-heading font-extrabold text-sm md:text-base text-brand-indigo flex items-center justify-between md:justify-end gap-3 mt-1 md:mt-0">
                  <span>₹{enq.estimatedValue.toLocaleString()}</span>
                  <svg className="w-4 h-4 text-[var(--text-tertiary)] hidden md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
