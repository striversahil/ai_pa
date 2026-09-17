import React, { useState, useMemo, useRef, useEffect } from "react";
import { Agent, Enquiry } from "../types";
import CalendarRibbon from "./CalendarRibbon";
import FilterControls from "./FilterControls";
import EnquiryRowItem from "./EnquiryRowItem";

interface EnquiryListProps {
  enquiries: Enquiry[];
  agents: Agent[];
  redacted?: boolean;
  /** Sales scoping: non-admin agents see own enquiries only unless searching. */
  currentAgentId?: string | null;
  isAdmin?: boolean;
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
  currentAgentId = null,
  isAdmin = false,
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
  const [agentFilter, setAgentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [ratesFilter, setRatesFilter] = useState("awaiting");
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [queueOnly, setQueueOnly] = useState(true);
  // Pagination: 50/100/200 per page for all filters to avoid tremendous growth
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
  const sentView = ratesFilter === "sent";

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

  // Filtered queries pipeline — search hits EST No. (with or without EST- prefix, partial digits), daily No, source, lead fields, title/description, items
  const filteredEnquiries = useMemo(() => {
    const inQueue = queueToggle && queueOnly ? enquiries.filter(queueToggle.isPending) : enquiries;
    const agentNameById = new Map(agents.map(a => [a.id, (a.name || "").toLowerCase()]));
    const todayStr = new Date().toISOString().split("T")[0];
    const isTodaySelected = selectedDate === todayStr;
    const rawSearch = searchQuery.trim();
    // Scoped view: non-admin sales agents see only own enquiries unless searching (search expands to all)
    const isScoped = !isAdmin && !!currentAgentId && !redacted && rawSearch === "";
    return inQueue.filter(e => {
      const rawQuery = rawSearch.toLowerCase();
      const query = rawQuery;
      // Empty query matches all
      let matchSearch = true;
      if (query) {
        const haystackParts: string[] = [
          e.clientCompany ?? "",
          e.title ?? "",
          e.contactName ?? "",
          e.estNumber ?? "",
          (e as any).enquiryNumber ?? "",
          (e as any).sourceLead ?? "",
          (e as any).location ?? "",
          e.contactPhone ?? "",
          (e as any).contactEmail ?? "",
          e.description ?? "",
          e.source ?? "",
          String(e.dailyNo ?? ""),
          // item names/specs as searchable text
          ...(((e as any).items ?? []) as any[]).flatMap((it: any) => [it?.name ?? "", it?.qty ?? "", it?.spec ?? "", it?.verbatim ?? ""]),
          agentNameById.get(e.assignedAgentId) ?? "",
        ];
        const haystack = haystackParts.join(" ").toLowerCase();
        // Direct substring match (covers "023460" inside "EST-023460")
        const direct = haystack.includes(query);
        // EST-normalized: allow "23460" to match "023460" and vice-versa via digit-only fallback
        const queryDigits = query.replace(/\D/g, "");
        const estDigits = (e.estNumber ?? "").replace(/\D/g, "");
        const digitMatch = queryDigits.length >= 3 && estDigits.includes(queryDigits);
        matchSearch = direct || digitMatch;
      }

      // Agent scoping: own-only when scoped and no search; otherwise respect agentFilter dropdown
      const matchAgent = isScoped
        ? e.assignedAgentId === currentAgentId
        : (agentFilter === "all" || e.assignedAgentId === agentFilter);
      const matchSource = sourceFilter === "all" || (e.source || "TL") === sourceFilter;
      const matchRates = ratesFilter === "all"
        || (ratesFilter === "ready" && (e.rateStatus ?? "") === "finalized")
        || (ratesFilter === "awaiting" && (e.rateStatus ?? "") !== "sent")
        || (ratesFilter === "sent" && (e.rateStatus ?? "") === "sent");

      // Calendar date: today tab re-appears overdue not-sent enquiries (created before today) every day until sent.
      // Search bypasses date as before. Scoped overdue respects own-only (via matchAgent above).
      let matchDate: boolean;
      if (rawQuery) {
        matchDate = true;
      } else if (!selectedDate) {
        matchDate = true;
      } else {
        const eDateStr = e.createdAt ? new Date(e.createdAt).toISOString().split("T")[0] : "";
        if (eDateStr === selectedDate) {
          matchDate = true;
        } else if (isTodaySelected && (e.rateStatus ?? "") !== "sent" && eDateStr && eDateStr < selectedDate) {
          // Overdue: not sent and created before today → line up on today tab every day
          matchDate = true;
        } else {
          matchDate = false;
        }
      }

      return matchSearch && matchAgent && matchSource && matchRates && matchDate;
    });
  }, [enquiries, agents, searchQuery, agentFilter, sourceFilter, ratesFilter, selectedDate, queueToggle, queueOnly, currentAgentId, isAdmin, redacted]);

  const pendingCount = queueToggle ? enquiries.filter(queueToggle.isPending).length : enquiries.length;

  // Reset page on any filter/search/pageSize change
  useEffect(() => { setPage(1); }, [ratesFilter, searchQuery, agentFilter, sourceFilter, selectedDate, queueOnly, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredEnquiries.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const visibleEnquiries = filteredEnquiries.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  // Header stats (today-aware)
  const todayStr = new Date().toISOString().split("T")[0];
  const stats = (() => {
    const total = enquiries.length;
    const todayCount = enquiries.filter(e => e.createdAt && new Date(e.createdAt).toISOString().split("T")[0] === todayStr).length;
    const pending = enquiries.filter(e => (e.rateStatus ?? "") !== "sent").length;
    const sent = enquiries.filter(e => (e.rateStatus ?? "") === "sent").length;
    const overdue = enquiries.filter(e => (e.rateStatus ?? "") !== "sent" && e.createdAt && new Date(e.createdAt).toISOString().split("T")[0] < todayStr).length;
    return { total, todayCount, pending, sent, overdue };
  })();

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Slim stats bar */}
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-2">
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-baseline gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-indigo-500"></span><span className="font-bold text-zinc-900 dark:text-white">{stats.todayCount}</span><span className="text-zinc-500">Today</span><span className="text-zinc-400">· {filteredEnquiries.length} shown</span></span>
          <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-700"></span>
          <span className="flex items-baseline gap-1"><span className="font-bold text-zinc-900 dark:text-white">{stats.pending}</span><span className="text-zinc-500">Pending</span>{stats.overdue>0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] font-bold">{stats.overdue} overdue</span>}</span>
          <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-700 hidden sm:block"></span>
          <span className="hidden sm:flex items-baseline gap-1"><span className="font-bold text-emerald-600">{stats.sent}</span><span className="text-zinc-500">Sent</span><span className="text-zinc-400">· {stats.total} total</span></span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={onExportCSV} className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer" type="button">Export</button>
          {!redacted && <button onClick={triggerCSVInput} className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer hidden sm:inline-flex" type="button">Import</button>}
          {!redacted && <button onClick={onOpenCreate} className="ml-1 px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer" type="button">+ New</button>}
        </div>
      </div>

      {/* Header actions moved into hero; keep hidden file input */}
      <div className="hidden">
        <input 
            type="file" 
            ref={fileInputRef} 
            onChange={onImportCSV} 
            accept=".csv" 
            className="hidden" 
          />
      </div>
      {/* Pending queue toggle (procurement/management work queues) */}
      {queueToggle && (
        <div className="flex flex-row flex-wrap gap-2">
          <span className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white shadow-sm">{queueToggle.pendingLabel} ({pendingCount})</span>
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
        agentFilter={agentFilter}
        setAgentFilter={setAgentFilter}
        agents={agents}
        hideAgentFilter={redacted}
        sourceFilter={sourceFilter}
        setSourceFilter={redacted ? undefined : setSourceFilter}
        ratesFilter={ratesFilter}
        setRatesFilter={redacted ? undefined : setRatesFilter}
      />

      {/* Page size + pagination header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="text-xs font-semibold text-[var(--text-secondary)]">
          {filteredEnquiries.length === 0 ? "0 enquiries" : `${filteredEnquiries.length} ${filteredEnquiries.length === 1 ? "enquiry" : "enquiries"}${sentView ? " · sent" : ""}`}
          {filteredEnquiries.length > 0 && totalPages > 1 && ` · page ${pageClamped} of ${totalPages}`}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Show</label>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg text-xs font-semibold text-[var(--text-primary)] focus:outline-hidden cursor-pointer">
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
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
          {visibleEnquiries.map(enq => {
            let agent = agents.find(a => a.id === enq.assignedAgentId);
            // Fallback: if agents fetch was empty/401 for root (telecaller roster filtered), still try to resolve via assignedAgentId prefix — avoids UN flash
            if (!agent && enq.assignedAgentId) {
              // keep UN but tooltip shows id for debugging; full name resolves after next agents fetch
            }
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
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Showing {(pageClamped - 1) * pageSize + 1}–{Math.min(pageClamped * pageSize, filteredEnquiries.length)} of {filteredEnquiries.length}</span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border-card)] text-xs font-bold disabled:opacity-40 cursor-pointer bg-transparent text-[var(--text-primary)]">‹ Previous</button>
                <span className="text-xs font-bold text-[var(--text-primary)]">Page {pageClamped} of {totalPages}</span>
                <button type="button" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)}
                  className="px-3 py-1.5 rounded-lg border border-[var(--border-card)] text-xs font-bold disabled:opacity-40 cursor-pointer bg-transparent text-[var(--text-primary)]">Next ›</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
