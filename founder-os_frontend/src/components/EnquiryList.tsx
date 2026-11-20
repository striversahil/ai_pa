import React, { useState, useMemo, useRef, useEffect } from "react";
import { Agent, Enquiry } from "../types";
import CalendarRibbon from "./CalendarRibbon";
import FilterControls from "./FilterControls";
import EnquiryRowItem from "./EnquiryRowItem";
import { Button, Card, EmptyState, TabBar } from "./ui";
import { hasOpenLoop, needsActionThread } from "@/enquiry/queue";

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
  // Thread tabs: all | open threads | needs action (spec-fix + awaiting reply/approval)
  const [threadTab, setThreadTab] = useState<"all" | "open" | "action">("all");
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

  // Open threads count — bilateral until resolved
  const openThreadCount = useMemo(() => enquiries.filter(hasOpenLoop as any).length, [enquiries]);
  // Needs action count — actionable subset (spec-fix + awaiting reply/approval)
  const needsActionCount = useMemo(() => enquiries.filter(needsActionThread as any).length, [enquiries]);

  // Filtered queries pipeline — search hits EST No. (with or without EST- prefix, partial digits), daily No, source, lead fields, title/description, items
  const filteredEnquiries = useMemo(() => {
    const afterThread = threadTab === "open" ? enquiries.filter(hasOpenLoop as any)
      : threadTab === "action" ? enquiries.filter(needsActionThread as any)
      : enquiries;
    const inQueue = queueToggle && queueOnly ? afterThread.filter(queueToggle.isPending) : afterThread;
    const agentNameById = new Map(agents.map(a => [a.id, (a.name || "").toLowerCase()]));
    const todayStr = new Date().toISOString().split("T")[0];
    const isTodaySelected = selectedDate === todayStr;
    const rawSearch = searchQuery.trim();
    // Founder decision 2026-09-22: no scoping — everyone sees everyone even without search
    const isScoped = false;
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
  }, [enquiries, agents, searchQuery, agentFilter, sourceFilter, ratesFilter, selectedDate, queueToggle, queueOnly, threadTab, currentAgentId, isAdmin, redacted]);

  const pendingCount = queueToggle ? enquiries.filter(queueToggle.isPending).length : enquiries.length;

  // Reset page on any filter/search/pageSize change
  useEffect(() => { setPage(1); }, [ratesFilter, searchQuery, agentFilter, sourceFilter, selectedDate, queueOnly, threadTab, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredEnquiries.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const visibleEnquiries = filteredEnquiries.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  const shown = filteredEnquiries.length;
  const viewNote = `${sentView ? " · sent" : ""}${threadTab === "open" ? " · open threads" : threadTab === "action" ? " · needs action" : ""}`;

  return (
    <div className="space-y-4 animate-fade-in">
      <input type="file" ref={fileInputRef} onChange={onImportCSV} accept=".csv" className="hidden" />

      {/* Page header: what this is + the one primary action */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-section tracking-tight text-[var(--text-primary)]">Daily enquiries</h2>
          <p className="mt-0.5 text-caption text-[var(--text-secondary)]">Pick a day, filter, then open an enquiry to quote it. Today also lists older enquiries not yet sent.</p>
        </div>
        {!redacted && (
          <Button variant="primary" onClick={onOpenCreate} icon={<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>}>
            New enquiry
          </Button>
        )}
      </div>

      {/* Toolbar: day navigator over search + filters, one card */}
      <Card padded={false} className="divide-y divide-[var(--border-card)]">
        <div className="p-3 md:px-4">
          <CalendarRibbon
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            dateTabs={dateTabs}
            dateInputRef={dateInputRef}
            handleCalendarClick={handleCalendarClick}
            totalCount={enquiries.length}
          />
        </div>
        <div className="p-3 md:px-4">
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
        </div>
      </Card>

      {/* Results bar: thread view (only when threads exist) · count · page size */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {openThreadCount > 0 && (
            <TabBar
              variant="segmented"
              size="sm"
              ariaLabel="Thread view"
              items={[
                { key: "all", label: "All" },
                { key: "open", label: "Open threads", count: openThreadCount },
                { key: "action", label: "Needs action", count: needsActionCount, tone: "danger" },
              ]}
              active={threadTab}
              onChange={setThreadTab}
            />
          )}
          <span className="text-caption font-medium text-[var(--text-secondary)]">
            <span className="font-bold text-[var(--text-primary)]">{shown}</span> {shown === 1 ? "enquiry" : "enquiries"}{viewNote}
          </span>
        </div>
        <label className="flex items-center gap-2 text-caption font-medium text-[var(--text-secondary)]">
          Rows
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-8 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-card)] bg-[var(--bg-input)] px-2 text-caption font-semibold text-[var(--text-primary)] outline-none">
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {shown === 0 ? (
        <EmptyState
          icon={<svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75"><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m20 20-3.5-3.5" /></svg>}
          title="No enquiries for this view"
          description="Try another day, clear a filter, or search by EST No. or client."
        />
      ) : (
        <div className="space-y-3">
          <Card padded={false} className="divide-y divide-[var(--border-card)] overflow-hidden">
            {visibleEnquiries.map(enq => (
              <EnquiryRowItem
                key={enq.id}
                enq={enq}
                agent={agents.find(a => a.id === enq.assignedAgentId)}
                hideIdentity={redacted}
                onViewDetail={onViewDetail}
              />
            ))}
          </Card>
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-caption font-medium text-[var(--text-secondary)]">Showing {(pageClamped - 1) * pageSize + 1}–{Math.min(pageClamped * pageSize, shown)} of {shown}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)}>‹ Previous</Button>
                <span className="text-caption font-semibold text-[var(--text-primary)] tabular-nums">{pageClamped} / {totalPages}</span>
                <Button size="sm" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)}>Next ›</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
