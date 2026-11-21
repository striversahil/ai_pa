"use client";

// MasterDataView — the Customer Master dashboard (the Zoho customer book).
//
// Speaks the Dispatch Floor dialect: zinc type scale, pill tab nav with
// count badges, KPI cards with colored values, card rows. Founder paging
// standard (2026-11-21): the server filters/searches/sorts and serves one page
// of 50 + a COUNT total (usePagedQuery); tiles, region badges and filter
// options come from a cached COUNT/GROUP BY summary. Live `master-data`
// writes refresh the summary and show a "new changes" banner on the list.
import { useEffect, useMemo, useState } from "react";
import { Download, Inbox, Receipt, RefreshCw, ScanSearch, Search, SlidersHorizontal, Upload, UserCog, Users } from "lucide-react";
import { useLiveQuery } from "@/hooks/useLiveData";
import { usePagedQuery } from "@/hooks/usePagedQuery";
import { useAuth } from "@/auth/AuthContext";
import { CUSTOMERS_URL, exportCustomers, getCapabilities, getDuplicateRows, getMasterSummary } from "@/master-data/api";
import type { MasterCapabilities, MasterCustomer, MasterSummary } from "@/master-data/types";
import { masterCapabilities } from "@/master-data/permissions";
import {
  DEFAULT_SORT, EMPTY_FILTERS, filterParams, hasActiveFilters, toCsv,
  type MasterFilters, type SortState,
} from "@/master-data/filters";
import { formatDate, pct, regionLabel, relativeTime } from "@/master-data/normalize";
import { GhostButton, PrimaryButton } from "./ui";
import { FilterPanel } from "./master-data-view/FilterPanel";
import CustomersTab from "./CustomersTab";
import DuplicatesTab from "./DuplicatesTab";
import { Kpi } from "./master-data-view/Kpi";
import { CustomerDrawer, EditorsPanel, ImportModal } from "./master-data-view/helpers";

export default function MasterDataView({ onStats }: { onStats?: (total: number) => void }) {
  const { me } = useAuth();
  const caps = useMemo(() => masterCapabilities(me), [me]);
  const [serverCaps, setServerCaps] = useState<MasterCapabilities | null>(null);

  const [filters, setFilters] = useState<MasterFilters>(EMPTY_FILTERS);
  const [subTab, setSubTab] = useState<"customers" | "duplicates">("customers");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [showEditors, setShowEditors] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);

  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const summaryQuery = useLiveQuery<MasterSummary>(
    () => getMasterSummary(filters.region, filters.state),
    { events: ["master-data"], deps: [filters.region, filters.state] },
  );
  const { data, loading, error } = summaryQuery;
  const list = usePagedQuery<MasterCustomer>(CUSTOMERS_URL, {
    events: ["master-data"], filters: filterParams(filters, sort), enabled: subTab === "customers",
  });
  const dupQuery = useLiveQuery<MasterCustomer[]>(
    () => (subTab === "duplicates" ? getDuplicateRows(filters.region) : Promise.resolve([])),
    { events: ["master-data"], deps: [filters.region, subTab] },
  );
  const dupRows = useMemo(() => dupQuery.data ?? [], [dupQuery.data]);
  const refresh = () => { summaryQuery.refresh(); list.refresh(); dupQuery.refresh(); };

  // Server truth for the action buttons (the client mirror only hides them).
  useEffect(() => {
    let alive = true;
    getCapabilities()
      .then((c) => { if (alive) setServerCaps(c); })
      .catch(() => { /* read-only fallback: buttons stay hidden */ });
    return () => { alive = false; };
  }, []);

  const canEdit = serverCaps?.canEdit ?? caps.canEdit;
  const canManage = caps.canAppoint;
  const canAppoint = serverCaps?.canAppoint ?? caps.canAppoint;
  const canImport = serverCaps?.canImport ?? caps.canImport;
  // Delete defaults to hidden until the server confirms sales-head — the
  // client mirror can only narrow, and a stale mirror must never show it.
  const canDelete = serverCaps?.canDelete ?? false;

  useEffect(() => {
    if (data?.total != null) onStats?.(data.total);
  }, [data, onStats]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const regions = useMemo(() => data?.regions ?? [], [data]);
  // Tiles + filter options follow the region tab only — search never moves
  // them (server summary scoped by region; districts by the picked state).
  const options = data?.options ?? { types: [], states: [], districts: [], subAreas: [], owners: [], pipelines: [] };
  const summary = data?.summary ?? {
    total: 0, active: 0, inactive: 0, neverTouched: 0, withOrders: 0, duplicateGroups: 0,
    duplicateOpenGroups: 0, noPhone: 0, noEmail: 0, noGstin: 0, noPincode: 0,
  };
  const openGroups = summary.duplicateOpenGroups;
  const shownFilters = { ...filters, q: list.q };

  const set = <K extends keyof MasterFilters>(key: K, value: MasterFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  // Changing state re-scopes the district list — districts belong to a state,
  // so a state change always drops the district instead of filtering to zero.
  const setState = (state: string) =>
    setFilters((f) => ({ ...f, state, district: "" }));

  // Export = every row the server filters match (not just this page).
  const exportCsv = async () => {
    let rows: MasterCustomer[];
    try {
      rows = await exportCustomers({ ...filterParams(filters, sort), q: list.q.trim() });
    } catch (e) {
      setToast({ title: "Export failed", message: e instanceof Error ? e.message : "Could not export" });
      return;
    }
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-master${filters.region ? `-${filters.region}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openRow = (row: MasterCustomer) => setDrawerId(row.id);
  const seed = useMemo(() => list.rows.find((r) => r.id === drawerId) ?? dupRows.find((r) => r.id === drawerId) ?? null, [list.rows, dupRows, drawerId]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (list.q) n++;
    if (filters.status) n++;
    if (filters.pipeline) n++;
    if (filters.typeBase) n++;
    if (filters.state) n++;
    if (filters.district) n++;
    if (filters.subArea) n++;
    if (filters.owner) n++;
    if (filters.duplicates) n++;
    if (filters.hasEmail) n++;
    if (filters.hasPhone) n++;
    if (filters.hasGstin) n++;
    if (filters.hasPincode) n++;
    return n;
  }, [filters, list.q]);

  if (loading && !data) {
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-2.5 px-4 py-6">
        <div className="h-[52px] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[86px] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40" />
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40" />
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-4 py-6">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Could not load the customer master</p>
          <p className="mt-1 text-xs text-zinc-500">{error instanceof Error ? error.message : "The summary failed to load."}</p>
          <button
            onClick={refresh}
            className="mt-4 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const regionItems: Array<{ key: string; label: string; count: number; title?: string }> = [
    { key: "", label: "All regions", count: data.total },
    ...data.regionIds.map((id) => {
      const meta = regions.find((r) => r.region === id);
      return {
        key: id,
        label: meta?.zone ? `${id} · ${meta.zone}` : regionLabel(id),
        count: data.byRegion[id] ?? 0,
        title: meta?.coverage || undefined,
      };
    }),
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-6 text-zinc-900 dark:text-zinc-100">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customer Master</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            The Zoho customer book — {data.total.toLocaleString("en-IN")} customers across {regions.length} zone{regions.length === 1 ? "" : "s"}
            {data.updatedAt ? ` · updated ${relativeTime(data.updatedAt)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live{data.updatedAt ? ` · ${formatDate(data.updatedAt.slice(0, 10))}` : ""}
          </div>
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading || summaryQuery.refreshing || list.loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <GhostButton onClick={() => void exportCsv()} title="Download exactly what the filters show (every page)">
            <span className="inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" />Export CSV</span>
          </GhostButton>
          {canAppoint && (
            <GhostButton onClick={() => setShowEditors(true)}>
              <span className="inline-flex items-center gap-1.5"><UserCog className="h-3.5 w-3.5" />Editors</span>
            </GhostButton>
          )}
          {canImport && (
            <PrimaryButton onClick={() => setShowImport(true)}>
              <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" />Import JSON</span>
            </PrimaryButton>
          )}
        </div>
      </header>

      {!canEdit && (
        <p className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          Read-only for you — only editors appointed by the sales-head can change customer records.
        </p>
      )}

      <nav className="flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60" aria-label="Customer regions">
        {regionItems.map((item) => (
          <button
            key={item.key}
            onClick={() => set("region", item.key)}
            title={item.title}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              filters.region === item.key
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {item.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${filters.region === item.key ? "bg-white/20" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>
              {(item.count ?? 0).toLocaleString("en-IN")}
            </span>
          </button>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Customers" value={summary.total} accent="text-indigo-600 dark:text-indigo-400" icon={Users}
          sub={`${summary.active.toLocaleString("en-IN")} active · ${summary.inactive.toLocaleString("en-IN")} inactive`} />
        <Kpi label="Never quoted" value={summary.neverTouched} accent="text-amber-600 dark:text-amber-400" icon={Inbox}
          sub={`${pct(summary.neverTouched, summary.total)} of view · no estimates, no orders`} />
        <Kpi label="With orders" value={summary.withOrders} accent="text-emerald-600 dark:text-emerald-400" icon={Receipt}
          sub={`${pct(summary.withOrders, summary.total)} of view have a sales order`} />
        <button type="button" onClick={() => setSubTab("duplicates")} className="text-left" title="Open duplicate review">
          <Kpi label="Needs review" value={`${openGroups} / ${summary.duplicateGroups}`} accent="text-rose-600 dark:text-rose-400" icon={ScanSearch}
            sub={openGroups === 0 ? "All groups reviewed" : `${openGroups} group${openGroups === 1 ? "" : "s"} need a decision`} />
        </button>
      </div>
      {(summary.noPhone > 0 || summary.noGstin > 0) && (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {summary.noPhone.toLocaleString("en-IN")} without phone · {summary.noGstin.toLocaleString("en-IN")} without GSTIN — use the filters below to list them.
        </p>
      )}

      {subTab === "duplicates" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            Duplicate review · {openGroups} open group{openGroups === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            onClick={() => setSubTab("customers")}
            className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            ← Back to customers
          </button>
        </div>
      ) : openGroups > 0 ? (
        <button
          type="button"
          onClick={() => setSubTab("duplicates")}
          className="w-full rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-left text-xs text-zinc-500 transition-colors hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <strong>{openGroups} duplicate group{openGroups === 1 ? "" : "s"}</strong> need{openGroups === 1 ? "s" : ""} a decision — open review →
        </button>
      ) : null}

      {subTab === "customers" ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
              <input
                className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100"
                placeholder="Search name, company, contact, city, phone, GSTIN, Zoho id…"
                value={list.q}
                onChange={(e) => list.setQ(e.target.value)}
                aria-label="Search customers"
              />
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
            {hasActiveFilters(shownFilters) && (
              <button
                type="button"
                onClick={() => { setFilters((f) => ({ ...EMPTY_FILTERS, region: f.region })); list.setQ(""); }}
                className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Clear
              </button>
            )}
          </div>
          {filtersOpen && <FilterPanel filters={filters} set={set} setState={setState} options={options} />}
          {!filtersOpen && hasActiveFilters(shownFilters) && (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} on · {list.total.toLocaleString("en-IN")} of {summary.total.toLocaleString("en-IN")} match
            </p>
          )}

          <CustomersTab list={list} sort={sort} setSort={setSort} onOpen={openRow} />
        </div>
      ) : dupQuery.loading && !dupQuery.data ? (
        <div className="h-[104px] animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40" />
      ) : (
        <DuplicatesTab rows={dupRows} canEdit={canEdit} onOpen={openRow} onChanged={refresh} />
      )}

      {drawerId && (
        <CustomerDrawer
          customerId={drawerId}
          seed={seed}
          canEdit={canEdit}
          canManage={canManage}
          canDelete={canDelete}
          onClose={() => setDrawerId(null)}
          onSaved={() => { refresh(); }}
          onDeleted={(name) => {
            setDrawerId(null);
            refresh();
            setToast({ title: "Client deleted", message: `“${name}” is out of the Customer Master.` });
          }}
        />
      )}

      {showEditors && <EditorsPanel open onClose={() => setShowEditors(false)} />}
      {showImport && (
        <ImportModal
          open
          onClose={() => setShowImport(false)}
          onDone={(res) => { setToast({ title: "Import complete", message: `Imported ${res.received.toLocaleString("en-IN")} customers (${res.inserted} new, ${res.updated} updated)` }); refresh(); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-[110] max-w-sm rounded-2xl border border-emerald-500/40 bg-white p-4 shadow-2xl dark:bg-zinc-950">
          <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">{toast.title}</p>
          <p className="mt-0.5 text-sm font-bold text-zinc-900 dark:text-zinc-100">{toast.message}</p>
        </div>
      )}
    </div>
  );
}
