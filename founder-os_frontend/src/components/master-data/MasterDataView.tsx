"use client";

// MasterDataView — the Customer Master dashboard (the Zoho customer book).
//
// One KV-cached payload (regions + ~2.6k compact rows + totals); filtering,
// sorting and paging happen client-side. Detail (address/provenance/notes) is
// fetched per row by the drawer. Subscribes ONLY to the typed `master-data`
// live event — the payload is ~1.2 MB raw and must not reload on every
// unrelated `data-changed` broadcast.
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import { getCapabilities, getMasterData } from "@/master-data/api";
import type { MasterCapabilities, MasterCustomer, MasterDataPayload } from "@/master-data/types";
import { masterCapabilities } from "@/master-data/permissions";
import {
  EMPTY_FILTERS, applyFilters, buildFilterOptions, hasActiveFilters, summarizeRows, toCsv,
  type MasterFilters,
} from "@/master-data/filters";
import { formatDate, pct, regionLabel, relativeTime } from "@/master-data/normalize";
import { Card, EmptyState, ErrorState, KpiCard, Skeleton, TabBar } from "@/components/ui";
import { Chip, FilterSelect, GhostButton, PrimaryButton, inputClass } from "./ui";
import CustomersTab from "./CustomersTab";
import DuplicatesTab from "./DuplicatesTab";

const CustomerDrawer = dynamic(() => import("./CustomerDrawer"), { ssr: false });
const EditorsPanel = dynamic(() => import("./EditorsPanel"), { ssr: false });
const ImportModal = dynamic(() => import("./ImportModal"), { ssr: false });

const DUPLICATE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All rows" },
  { value: "all", label: "All duplicates" },
  { value: "open", label: "Needs review" },
  { value: "reviewed", label: "Reviewed" },
  { value: "High", label: "High confidence" },
  { value: "Medium", label: "Medium confidence" },
  { value: "Review", label: "Review tier" },
];

export default function MasterDataView({ onStats }: { onStats?: (total: number) => void }) {
  const { me } = useAuth();
  const caps = useMemo(() => masterCapabilities(me), [me]);
  const [serverCaps, setServerCaps] = useState<MasterCapabilities | null>(null);

  const [filters, setFilters] = useState<MasterFilters>(EMPTY_FILTERS);
  const [subTab, setSubTab] = useState<"customers" | "duplicates">("customers");
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [showEditors, setShowEditors] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const query = useLiveQuery<MasterDataPayload>(getMasterData, { events: ["master-data"] });
  const { data, loading, error, refresh } = query;

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

  useEffect(() => {
    if (data?.totals?.total != null) onStats?.(data.totals.total);
  }, [data, onStats]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const regions = useMemo(() => data?.regions ?? [], [data]);

  // Tiles + filter options follow the region tab only — search never moves them.
  const regionBase = useMemo(
    () => (filters.region ? rows.filter((r) => r.region === filters.region) : rows),
    [rows, filters.region],
  );
  const options = useMemo(() => buildFilterOptions(regionBase), [regionBase]);
  const summary = useMemo(() => summarizeRows(regionBase), [regionBase]);
  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const openGroups = summary.duplicateOpenGroups;

  const set = <K extends keyof MasterFilters>(key: K, value: MasterFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const exportCsv = () => {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `customer-master${filters.region ? `-${filters.region}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openRow = (row: MasterCustomer) => setDrawerId(row.id);
  const seed = useMemo(() => filtered.find((r) => r.id === drawerId) ?? rows.find((r) => r.id === drawerId) ?? null, [filtered, rows, drawerId]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <ErrorState
        title="Could not load the customer master"
        message={error instanceof Error ? error.message : "The cached payload failed to load."}
        onRetry={refresh}
      />
    );
  }

  if (!data) return null;

  const regionItems = [
    { key: "", label: `All regions`, count: data.totals.total },
    ...data.totals.regionIds.map((id) => {
      const meta = regions.find((r) => r.region === id);
      return {
        key: id,
        label: meta?.zone ? `${id} · ${meta.zone}` : regionLabel(id),
        count: data.totals.byRegion[id] ?? 0,
        title: meta?.coverage || undefined,
      };
    }),
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Customer Master</h1>
          <p className="mt-0.5 text-caption text-[var(--text-secondary)]">
            The Zoho customer book — {data.totals.total.toLocaleString("en-IN")} customers across {regions.length} zones
            {data.updatedAt ? ` · updated ${relativeTime(data.updatedAt)}` : ""}
            {data.updatedAt ? <span className="text-[var(--text-tertiary)]"> ({formatDate(data.updatedAt.slice(0, 10))})</span> : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <GhostButton onClick={exportCsv} title="Download exactly what the filters show">
            ⬇ Export CSV
          </GhostButton>
          {canAppoint && <GhostButton onClick={() => setShowEditors(true)}>👤 Editors</GhostButton>}
          {canImport && <PrimaryButton onClick={() => setShowImport(true)}>Import JSON</PrimaryButton>}
        </div>
      </div>

      {!canEdit && (
        <p className="rounded-[var(--radius-control)] bg-[var(--surface-soft)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
          Read-only for you — only editors appointed by the sales-head can change customer records.
        </p>
      )}

      {/* Region tabs */}
      <TabBar
        items={regionItems}
        active={filters.region}
        onChange={(key) => set("region", key)}
        ariaLabel="Customer regions"
      />

      {/* KPI tiles — explainable from the table below */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="Customers" value={summary.total.toLocaleString("en-IN")} icon={<span>👥</span>} accent="brand"
          hint={`${summary.active.toLocaleString("en-IN")} active · ${summary.inactive.toLocaleString("en-IN")} inactive`} />
        <KpiCard title="Never quoted" value={summary.neverTouched.toLocaleString("en-IN")} icon={<span>📭</span>} accent="warning"
          hint={`No estimates and no orders · ${pct(summary.neverTouched, summary.total)} of view`} />
        <KpiCard title="With orders" value={summary.withOrders.toLocaleString("en-IN")} icon={<span>🧾</span>} accent="success"
          hint={`${pct(summary.withOrders, summary.total)} of view have a sales order`} />
        <div onClick={() => setSubTab("duplicates")} className="cursor-pointer" title="Open duplicate review">
          <KpiCard title="Duplicate groups" value={`${openGroups} / ${summary.duplicateGroups}`} icon={<span>🔍</span>} accent="danger"
            hint={openGroups === 0 ? "All groups reviewed" : `${openGroups} group${openGroups === 1 ? "" : "s"} need a decision`} />
        </div>
        <KpiCard title="No phone" value={summary.noPhone.toLocaleString("en-IN")} icon={<span>📵</span>} accent="warning"
          hint="Rows with no phone number" />
        <KpiCard title="No GSTIN" value={summary.noGstin.toLocaleString("en-IN")} icon={<span>📄</span>} accent="info"
          hint="Rows with no GSTIN on file" />
      </div>

      {/* View tabs */}
      <TabBar
        items={[
          { key: "customers", label: "Customers", icon: "📋", count: filtered.length },
          { key: "duplicates", label: "Duplicate review", icon: "🔍", count: openGroups, tone: openGroups > 0 ? "danger" : undefined },
        ]}
        active={subTab}
        onChange={setSubTab}
        ariaLabel="Customer master views"
      />

      {subTab === "customers" ? (
        <div className="space-y-3">
          {/* Search + filters */}
          <Card padded={false} className="space-y-3 p-4">
            <input
              className={inputClass}
              placeholder="Search name, company, contact, city, phone, GSTIN, Zoho id…"
              value={filters.q}
              onChange={(e) => set("q", e.target.value)}
              aria-label="Search customers"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <FilterSelect label="Status" value={filters.status} onChange={(v) => set("status", v)} options={["Active", "Inactive"]} allLabel="Any status" />
              <FilterSelect label="Type" value={filters.typeBase} onChange={(v) => set("typeBase", v)} options={options.types} allLabel="Any type" />
              <FilterSelect label="State" value={filters.state} onChange={(v) => set("state", v)} options={options.states} allLabel="Any state" />
              <FilterSelect label="Sub-area" value={filters.subArea} onChange={(v) => set("subArea", v)} options={options.subAreas} allLabel="Any sub-area" />
              <FilterSelect label="Owner" value={filters.owner} onChange={(v) => set("owner", v)} options={options.owners} allLabel="Any owner" />
              <FilterSelect label="Pipeline" value={filters.pipeline} onChange={(v) => set("pipeline", v)} options={options.pipelines} allLabel="Any stage" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Duplicates</span>
                <select value={filters.duplicates} onChange={(e) => set("duplicates", e.target.value)} className={`${inputClass} py-1.5`}>
                  {DUPLICATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-1.5 pt-4">
                <Chip active={filters.hasPhone} onClick={() => set("hasPhone", !filters.hasPhone)} title="Only rows with a phone number">With phone</Chip>
                <Chip active={filters.hasEmail} onClick={() => set("hasEmail", !filters.hasEmail)} title="Only rows with an email">With email</Chip>
                <Chip active={filters.hasGstin} onClick={() => set("hasGstin", !filters.hasGstin)} title="Only rows with a GSTIN">With GSTIN</Chip>
                <Chip active={filters.hasPincode} onClick={() => set("hasPincode", !filters.hasPincode)} title="Only rows with a pincode">With pincode</Chip>
              </div>
              <div className="flex-1" />
              {hasActiveFilters(filters) && (
                <button
                  type="button"
                  onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, region: f.region }))}
                  className="text-[11px] font-semibold text-[var(--color-brand-indigo)] hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </Card>

          <CustomersTab rows={filtered} onOpen={openRow} />
        </div>
      ) : (
        <DuplicatesTab rows={regionBase} canEdit={canEdit} onOpen={openRow} onChanged={refresh} />
      )}

      {drawerId && (
        <CustomerDrawer
          customerId={drawerId}
          seed={seed}
          canEdit={canEdit}
          canManage={canManage}
          onClose={() => setDrawerId(null)}
          onSaved={() => { refresh(); }}
        />
      )}

      {showEditors && <EditorsPanel open onClose={() => setShowEditors(false)} />}
      {showImport && (
        <ImportModal
          open
          onClose={() => setShowImport(false)}
          onDone={(res) => { setToast(`Imported ${res.received.toLocaleString("en-IN")} customers (${res.inserted} new, ${res.updated} updated)`); refresh(); }}
        />
      )}

      {toast && (
        <div className="fixed bottom-5 right-5 z-[110] max-w-sm rounded-2xl border border-emerald-500/40 bg-[var(--bg-card)] p-4 shadow-2xl">
          <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">Import complete</p>
          <p className="mt-0.5 text-sm font-bold text-[var(--text-primary)]">{toast}</p>
        </div>
      )}
    </div>
  );
}
