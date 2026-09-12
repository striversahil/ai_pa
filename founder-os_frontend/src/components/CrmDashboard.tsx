"use client";

import React, { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getExpandedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ExpandedState,
} from "@tanstack/react-table";
import { useLiveQuery } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import SoAttachments from "@/components/SoAttachments";
import { PackageCheck, FileCheck, Truck, CreditCard, CheckCircle2, RefreshCw } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtINR = (n: number | null | undefined): string =>
  `₹${Number(n || 0).toLocaleString("en-IN")}`;

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

const shortTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

function ageClass(age: number | null | undefined): string {
  if (age === null || age === undefined) return "text-zinc-400";
  if (age > 15) return "text-red-400 font-bold";
  if (age > 7) return "text-amber-400 font-semibold";
  return "text-zinc-400";
}

const ageText = (age: number | null | undefined): string =>
  age === null || age === undefined ? "—" : `${age}d`;

// ── CSV export (exports the currently filtered rows, raw values) ─────────────
function exportCSV(rows: any[], columns: ColumnDef<any, any>[], name: string) {
  const keys = columns
    .map((c: any) => (typeof c.accessorKey === "string" ? c.accessorKey : null))
    .filter(Boolean) as string[];
  const header = keys.join(",");
  const lines = rows.map((r) =>
    keys
      .map((k) => {
        const v = r.original?.[k] ?? r.getValue?.(k) ?? "";
        const s = Array.isArray(v) ? v.length : String(v ?? "");
        return `"${String(s).replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Manual order actions (MIS-only; backend enforces the scope) ───────────────
const STAGE_ACTIONS: Record<string, { label: string; action: string; toStage: string; danger?: boolean }[]> = {
  confirm: [
    { label: "✓ Confirmed", action: "invoice", toStage: "invoice" },
    { label: "✕ Cancel", action: "cancel", toStage: "complete", danger: true },
  ],
  invoice: [
    { label: "✓ Invoiced", action: "ship", toStage: "ship" },
    { label: "✕ Cancel", action: "cancel", toStage: "complete", danger: true },
  ],
  ship: [
    { label: "✓ Shipped", action: "payment", toStage: "payment" },
    { label: "✕ Cancel", action: "cancel", toStage: "complete", danger: true },
  ],
  payment: [
    { label: "✓ Paid", action: "payment", toStage: "complete" },
    { label: "✕ Cancel", action: "cancel", toStage: "complete", danger: true },
  ],
};

function ActionButtons({ so, stage }: { so: string; stage: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const defs = STAGE_ACTIONS[stage] || STAGE_ACTIONS.confirm;

  const run = async (d: { label: string; action: string; toStage: string; danger?: boolean }) => {
    if (busy || done) return;
    if (d.danger && !window.confirm(`Mark ${so} as cancelled?`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/crm/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soNumber: so, action: d.action, toStage: d.toStage }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setDone(true); // live event refetches the tables; next snapshot scores points
    } catch (e: any) {
      setErr(e?.message || "failed");
    } finally {
      setBusy(false);
    }
  };

  if (done) return <span className="text-[9px] text-emerald-400 font-bold">✓ saved</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {defs.map((d) => (
        <button
          key={d.label}
          onClick={() => run(d)}
          disabled={busy}
          title={d.label}
          className={`px-1.5 py-0.5 text-[9px] rounded border font-bold whitespace-nowrap disabled:opacity-40 ${
            d.danger
              ? "text-red-400 bg-red-500/10 border-red-500/30 hover:bg-red-500/20"
              : "text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20"
          }`}
        >
          {d.label}
        </button>
      ))}
      {err && <span className="text-[9px] text-red-400" title={err}>!</span>}
    </span>
  );
}

function StatusPill({ status, accent }: { status: string | null | undefined; accent: string }) {
  if (!status) return <span className="text-zinc-400">—</span>;
  return (
    <span className={`px-1.5 py-0.5 text-[8px] rounded font-extrabold uppercase tracking-wide border ${accent}`}>
      {status}
    </span>
  );
}

const PAID_PILL: Record<string, string> = {
  paid: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  partial: "text-amber-400 bg-amber-500/10 border-amber-500/30",
};

const STAGE_PILL: Record<string, string> = {
  draft: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  confirmed: "text-sky-400 bg-sky-500/10 border-sky-500/30",
  approved: "text-sky-400 bg-sky-500/10 border-sky-500/30",
};

// ── Metadata ──────────────────────────────────────────────────────────────────
const PROCESS_META: Record<string, { label: string; icon: React.ElementType; accent: string; desc: string }> = {
  confirm: { label: "Confirm", icon: FileCheck, accent: "text-amber-400 bg-amber-500/10 border-amber-500/30", desc: "Draft — needs confirmation" },
  invoice: { label: "Invoice", icon: PackageCheck, accent: "text-sky-400 bg-sky-500/10 border-sky-500/30", desc: "Confirmed — needs invoicing" },
  ship: { label: "Ship", icon: Truck, accent: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30", desc: "Invoiced — needs shipping" },
  payment: { label: "Payment", icon: CreditCard, accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", desc: "Shipped — awaiting payment" },
};

const STEP_ORDER = ["confirm", "invoice", "ship", "payment"];

const DEPT_META: Record<string, { label: string; icon: string; accent: string }> = {
  crm: { label: "CRM Desk", icon: "🤝", accent: "text-indigo-400" },
  accounts: { label: "Accounts", icon: "💰", accent: "text-emerald-400" },
  dispatch: { label: "Dispatch", icon: "🚚", accent: "text-amber-400" },
  procurement: { label: "SO Materials", icon: "📦", accent: "text-sky-400" },
};

type View = "overview" | "crm" | "accounts" | "dispatch" | "procurement";

const TABS: { key: View; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "📊" },
  { key: "crm", label: "CRM Desk", icon: "🤝" },
  { key: "accounts", label: "Accounts", icon: "💰" },
  { key: "dispatch", label: "Dispatch", icon: "🚚" },
  { key: "procurement", label: "SO Materials", icon: "📦" },
];

// ── KPI card ──────────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, accent, title }: { label: string; value: string; sub?: string; accent?: string; title?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4" title={title}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">{label}</span>
      <span className={`text-2xl font-extrabold ${accent || "text-white"}`}>{value}</span>
      {sub && <span className="text-[10px] text-zinc-500 block mt-0.5">{sub}</span>}
    </div>
  );
}

// ── Safe primitives (Zoho sometimes returns objects for scalar fields) ───────
const txt = (v: any): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s && s !== "{}" && s !== "[]" ? s : "—";
  }
  const s = String(v);
  return s === "" ? "—" : s;
};

const numINR = (v: any): string => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return isNaN(n) ? "—" : `₹${n.toLocaleString("en-IN")}`;
};

// ── Line items sub-row (SO detail on row click) ───────────────────────────────
function OrderItems({ order, canManage, onChanged }: { order: any; canManage: boolean; onChanged: () => void }) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const docs = (
    <SoAttachments
      so={String(order?.so || "")}
      attachments={Array.isArray(order?.attachments) ? order.attachments : []}
      canManage={canManage}
      onChanged={onChanged}
    />
  );
  if (items.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-zinc-500 italic">
        No line-item detail for this order{order?.lineCount ? ` (${order.lineCount} line(s) reported, detail not in Zoho response)` : ""}.
        {docs}
      </div>
    );
  }
  return (
    <div className="px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
        📦 {order.lineCount || items.length} line item{Number(order.lineCount || items.length) === 1 ? "" : "s"} · {order.so}
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wide text-zinc-500">
            <th className="py-1 pr-2 font-bold">Item</th>
            <th className="py-1 pr-2 font-bold">SKU</th>
            <th className="py-1 pr-2 font-bold text-right">Qty</th>
            <th className="py-1 pr-2 font-bold text-right">Rate</th>
            <th className="py-1 font-bold text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((li: any, i: number) => {
            const title = txt(li.name || li.item_name || li.description);
            const desc = txt(li.description);
            return (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800/50">
                <td className="py-1 pr-2 text-zinc-800 dark:text-zinc-200">
                  {title}
                  {title !== "—" && desc !== "—" && desc !== title && (
                    <span className="block text-[10px] text-zinc-500">{desc}</span>
                  )}
                </td>
                <td className="py-1 pr-2 font-mono text-[10px] text-zinc-500">{txt(li.sku || li.item_code)}</td>
                <td className="py-1 pr-2 text-right text-zinc-700 dark:text-zinc-300">
                  {txt(li.quantity ?? li.qty)}{txt(li.unit) !== "—" ? <span className="text-zinc-500"> {txt(li.unit)}</span> : null}
                </td>
                <td className="py-1 pr-2 text-right text-zinc-700 dark:text-zinc-300">{numINR(li.rate)}</td>
                <td className="py-1 text-right font-semibold text-zinc-800 dark:text-zinc-200">
                  {numINR(li.item_total ?? li.amount ?? li.total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {docs}
    </div>
  );
}

// ── Reusable TanStack table ───────────────────────────────────────────────────
function DataTable({
  columns,
  data,
  searchPlaceholder = "Search…",
  emptyState = "Nothing here yet.",
  initialSorting,
  exportName,
  expandable,
  expandRender,
}: {
  columns: ColumnDef<any, any>[];
  data: any[];
  searchPlaceholder?: string;
  emptyState?: React.ReactNode;
  initialSorting?: SortingState;
  exportName?: string;
  // When true, clicking a row expands it to show the SO's line items.
  expandable?: boolean;
  // Custom expanded-row renderer (defaults to line items without doc management).
  expandRender?: (order: any) => React.ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
  const [globalFilter, setGlobalFilter] = useState("");
  const [expanded, setExpanded] = useState<ExpandedState>({});

  // Auto expander column (no accessorKey → skipped by CSV export).
  const cols = useMemo(
    () =>
      expandable
        ? [
            {
              id: "exp",
              header: "",
              size: 24,
              enableSorting: false,
              cell: ({ row }: any) => (
                <span className="text-zinc-500 text-[10px]">{row.getIsExpanded() ? "▾" : "▸"}</span>
              ),
            } as ColumnDef<any, any>,
            ...columns,
          ]
        : columns,
    [expandable, columns]
  );

  const table = useReactTable({
    data,
    columns: cols,
    state: { sorting, globalFilter, expanded },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => !!expandable,
    initialState: { pagination: { pageSize: 25 } },
  });

  const rows = table.getRowModel().rows;
  const filteredRows = table.getFilteredRowModel().rows.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-64 max-w-full px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
        />
        <span className="text-[10px] text-zinc-500">{filteredRows} / {data.length} rows</span>
        {exportName && filteredRows > 0 && (
          <button
            onClick={() => exportCSV(table.getFilteredRowModel().rows, columns, exportName)}
            className="ml-auto px-2 py-1 text-[10px] rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold"
          >
            ⬇ Export CSV
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200/80 dark:border-zinc-800/80">
        <table className="w-full text-[11px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-zinc-50 dark:bg-zinc-900/80 border-b border-zinc-200 dark:border-zinc-800">
                {hg.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className={`px-2.5 py-2 text-left font-bold uppercase tracking-wide text-[9px] text-zinc-500 dark:text-zinc-400 select-none ${
                        header.column.getCanSort() ? "cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-200" : ""
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span className="text-[8px]">{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}</span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-3 py-6 text-center text-zinc-500 italic">
                  {emptyState}
                </td>
              </tr>
            ) : (
              rows.flatMap((row) => {
                const main = (
                  <tr
                    key={row.id}
                    onClick={expandable ? () => row.toggleExpanded() : undefined}
                    title={expandable ? "Click to see line items" : undefined}
                    className={`border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-100/40 dark:hover:bg-zinc-800/40 ${
                      expandable ? "cursor-pointer" : ""
                    }`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200"
                        onClick={cell.column.id === "actions" ? (e) => e.stopPropagation() : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
                if (expandable && row.getIsExpanded()) {
                  return [
                    main,
                    <tr key={`${row.id}-items`} className="border-b border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/60 dark:bg-zinc-900/40">
                      <td colSpan={cols.length} className="p-0">
                        {expandRender ? expandRender(row.original) : <OrderItems order={row.original} canManage={false} onChanged={() => {}} />}
                      </td>
                    </tr>,
                  ];
                }
                return [main];
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredRows > table.getState().pagination.pageSize && (
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <div className="flex items-center gap-2">
            <select
              value={table.getState().pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="px-1.5 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
            >
              {[10, 25, 50].map((n) => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </select>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Prev
            </button>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function CrmDashboard() {
  const [view, setView] = useState<View>("overview");
  const { me } = useAuth();
  const canManageDocs = !!me && (me.isAdmin || (me.scopes ?? []).includes("mis"));
  const crm = useLiveQuery<any>(
    () => fetch("/api/automations/crm/data").then((r) => r.json()),
    { events: ["crm", "automation"] },
  );
  const refreshDocs = () => { try { crm.refresh(); } catch { /* refetch on next live event */ } };

  const data = crm.data;
  const stages = data?.stages || {};
  const depts = data?.departments || {};
  const scores = data?.scores || {};
  const meta = data?.meta || null;
  const [orderSearch, setOrderSearch] = useState("");

  // Flatten salesperson stage splits so table sort + CSV export see plain fields.
  const salespeopleFlat = useMemo(
    () =>
      (data?.salespeople || []).map((s: any) => ({
        name: s.name,
        openOrders: s.openOrders,
        pipelineValue: s.pipelineValue,
        confirm: s.byStage?.confirm ?? 0,
        invoice: s.byStage?.invoice ?? 0,
        ship: s.byStage?.ship ?? 0,
        payment: s.byStage?.payment ?? 0,
      })),
    [data]
  );

  // Cross-stage order search (SO / customer / salesperson across all stages).
  const searchResults = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: any[] = [];
    for (const step of STEP_ORDER) {
      for (const o of stages?.[step]?.orders || []) {
        if (
          String(o.so || "").toLowerCase().includes(q) ||
          String(o.customer || "").toLowerCase().includes(q) ||
          String(o.salesperson || "").toLowerCase().includes(q)
        ) {
          out.push({ ...o, step });
          if (out.length >= 20) return out;
        }
      }
    }
    return out;
  }, [orderSearch, stages]);

  if (!data || (!data.fresh && !data.stale)) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-8 text-center">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-400" />
        <p className="mt-3 text-sm text-zinc-400">Waiting for first CRM snapshot (every 5 min)…</p>
        {crm.error ? <p className="mt-1 text-[11px] text-red-400">{String(crm.error)}</p> : null}
      </div>
    );
  }

  const todayPts = scores.today || {};
  const todayCnt = scores.todayByDeptCount || {};
  const weekPts = scores.week || {};
  const crmPending = depts.crm?.pending || { count: 0, value: 0, orders: [] };
  const toInvoice = depts.accounts?.toInvoice || { count: 0, value: 0, orders: [] };
  const awaitingPayment = depts.accounts?.awaitingPayment || { count: 0, value: 0, orders: [] };
  const dispatchPending = depts.dispatch?.pending || { count: 0, value: 0, orders: [] };
  const procurement = depts.procurement || { materials: [], distinctMaterials: 0, totalQty: 0, openOrders: 0 };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">📦 CRM Control Room</h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {data.date} · Zoho fetch {data.fetchedAt ? shortTime(data.fetchedAt) : data.computedAt ? shortTime(data.computedAt) : "—"} · {data.totalActive} active SO
          </p>
          {scores.ledgerOk === false && (
            <p className="text-[11px] text-amber-400 mt-1">⚠️ Points ledger unavailable — scores may read zero. Pipeline data above is unaffected.</p>
          )}
          {data.stale && (
            <p className="text-[11px] text-amber-400 mt-1">
              ⚠️ Zoho sync is down — showing last-known snapshot from {data.staleSince ? shortTime(data.staleSince) : data.date}. Pipeline may be outdated; scores below are still live.
            </p>
          )}
        </div>
      </div>

      <nav className="flex flex-row flex-wrap gap-2">
        {TABS.map((t) => {
          const active = view === t.key;
          return (
            <button key={t.key} onClick={() => setView(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${active ? "bg-indigo-600 text-white shadow-sm" : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>
              <span className="text-base leading-none">{t.icon}</span>{t.label}
            </button>
          );
        })}
      </nav>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {view === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Active SOs" value={String(data.totalActive || 0)} accent="text-white" />
            <Kpi label="Pipeline Value" value={fmtINR(data.totalValue)} accent="text-white" />
            <Kpi label="🤝 CRM Pts" value={signed(todayPts.crm || 0)} sub={`${todayCnt.crm || 0} events`} accent="text-indigo-400" />
            <Kpi label="💰 Accts Pts" value={signed(todayPts.accounts || 0)} sub={`${todayCnt.accounts || 0} events`} accent="text-emerald-400" />
            <Kpi label="🚚 Dispatch Pts" value={signed(todayPts.dispatch || 0)} sub={`${todayCnt.dispatch || 0} events`} accent="text-amber-400" />
            <Kpi label="📦 Procur. Pts" value={signed(todayPts.procurement || 0)} sub={`${todayCnt.procurement || 0} events`} accent="text-sky-400" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {STEP_ORDER.map((step) => {
              const pm = PROCESS_META[step];
              const Icon = pm.icon;
              const grp = stages[step] || { count: 0, value: 0 };
              return (
                <div key={step} className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${pm.accent.split(" ")[0]}`} />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{pm.label}</span>
                  </div>
                  <div className={`text-2xl font-extrabold mt-1 ${pm.accent.split(" ")[0]}`}>{grp.count}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{fmtINR(grp.value)}</div>
                  <div className="text-[9px] text-zinc-600 mt-1">{pm.desc}</div>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">🔍 Find Order (all stages)</h3>
            <input
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder="Type SO number, customer, or salesperson (min 2 chars)…"
              className="w-full max-w-md px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            {orderSearch.trim().length >= 2 && (
              <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">No matching orders.</p>
                ) : (
                  searchResults.map((o: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[11px] py-1 border-b border-zinc-800/50 last:border-0">
                      <span className="px-1.5 py-0.5 rounded font-bold text-[9px] text-sky-400 bg-sky-500/10 uppercase">{o.step}</span>
                      <span className="font-mono text-zinc-300">{o.so}</span>
                      <span className="text-zinc-400 truncate flex-1">{o.customer}</span>
                      {o.salesperson && <span className="text-zinc-500">{o.salesperson}</span>}
                      <span className="text-zinc-500">{fmtINR(o.total)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">👥 Salesperson Pipeline</h3>
            <DataTable
              columns={[
                { accessorKey: "name", header: "Salesperson" },
                { accessorKey: "openOrders", header: "Open" },
                { accessorKey: "pipelineValue", header: "Pipeline", cell: ({ getValue }: any) => fmtINR(getValue()), sortingFn: (a: any, b: any) => (a.original.pipelineValue || 0) - (b.original.pipelineValue || 0) },
                { accessorKey: "confirm", header: "Confirm" },
                { accessorKey: "invoice", header: "Invoice" },
                { accessorKey: "ship", header: "Ship" },
                { accessorKey: "payment", header: "Payment" },
              ]}
              data={salespeopleFlat}
              searchPlaceholder="Search salespeople…"
              emptyState="No salesperson data yet."
              initialSorting={[{ id: "pipelineValue", desc: true }]}
              exportName="crm-salespeople"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">✅ Recently Closed (paid / cancelled)</h3>
            <DataTable
              columns={[
                { accessorKey: "so", header: "SO", cell: ({ getValue, row }: any) => (<span className="font-mono">{getValue()}{Number(row?.original?.attachmentCount || 0) > 0 ? <span title={`${row.original.attachmentCount} document(s) attached`}> 📎</span> : null}</span>) },
                { accessorKey: "customer", header: "Customer" },
                { accessorKey: "salesperson", header: "Salesperson" },
                { accessorKey: "total", header: "Value", cell: ({ getValue }: any) => fmtINR(getValue()), sortingFn: (a: any, b: any) => (a.original.total || 0) - (b.original.total || 0) },
                { accessorKey: "status", header: "Status", cell: ({ getValue }: any) => <StatusPill status={getValue()} accent={String(getValue()) === "cancelled" || String(getValue()) === "void" ? "text-red-400 bg-red-500/10 border-red-500/30" : "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"} /> },
                { accessorKey: "paidStatus", header: "Paid" },
                { accessorKey: "date", header: "Date" },
              ]}
              data={data.closed || []}
              searchPlaceholder="Search closed orders…"
              emptyState="No recently closed orders."
              exportName="crm-closed"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">⚡ Recent Movements</h3>
            {(scores.recent || []).length === 0 ? (
              <p className="text-xs text-zinc-500 italic">No movements recorded yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {(scores.recent || []).map((r: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] py-1 border-b border-zinc-800/50 last:border-0">
                    <span className={`px-1.5 py-0.5 rounded font-bold text-[9px] ${r.points > 0 ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"}`}>
                      {signed(r.points)}
                    </span>
                    <span>{DEPT_META[r.dept]?.icon || "•"}</span>
                    <span className="font-mono text-zinc-300">{r.soNumber}</span>
                    <span className="text-zinc-400 truncate flex-1">{r.reason}</span>
                    {r.actor && <span className="text-zinc-500">{r.actor}</span>}
                    <span className="text-zinc-600 text-[9px]">{shortTime(r.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {/* ── CRM Desk ─────────────────────────────────────────────────────── */}
      {view === "crm" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Pending Confirm" value={String(crmPending.count)} sub={fmtINR(crmPending.value)} accent="text-amber-400" />
            <Kpi label="Points Today" value={signed(todayPts.crm || 0)} accent="text-indigo-400" />
            <Kpi label="Points This Week" value={signed(weekPts.crm || 0)} accent="text-indigo-300" />
            <Kpi label="Confirmed Today" value={String(todayCnt.crm || 0)} sub="events" accent="text-sky-400" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">🏆 CRM Leaderboard (7d)</h3>
            <DataTable
              columns={[
                { id: "rank", header: "#", cell: ({ row }: any) => row.index + 1, size: 40 },
                { accessorKey: "actor", header: "Salesperson" },
                { accessorKey: "points", header: "Points", cell: ({ getValue }: any) => <span className="font-bold text-emerald-400">{signed(getValue())}</span> },
                { accessorKey: "events", header: "Events" },
                { accessorKey: "created", header: "Created" },
                { accessorKey: "confirmed", header: "Confirmed" },
              ]}
              data={scores.crmLeaderboard || []}
              searchPlaceholder="Search leaderboard…"
              emptyState="No CRM points this week yet."
              initialSorting={[{ id: "points", desc: true }]}
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">📋 Orders Awaiting Confirmation</h3>
            <DataTable
              columns={[
                { accessorKey: "so", header: "SO", cell: ({ getValue, row }: any) => (<span className="font-mono">{getValue()}{Number(row?.original?.attachmentCount || 0) > 0 ? <span title={`${row.original.attachmentCount} document(s) attached`}> 📎</span> : null}</span>) },
                { accessorKey: "ref", header: "Ref" },
                { accessorKey: "customer", header: "Customer" },
                { accessorKey: "salesperson", header: "Salesperson" },
                { accessorKey: "total", header: "Value", cell: ({ getValue }: any) => fmtINR(getValue()), sortingFn: (a: any, b: any) => (a.original.total || 0) - (b.original.total || 0) },
                { accessorKey: "ageDays", header: "Age", cell: ({ getValue }: any) => <span className={ageClass(getValue())}>{ageText(getValue())}</span> },
                { id: "status", header: "Status", cell: ({ row }: any) => <StatusPill status={row.original.orderStatus} accent={STAGE_PILL[row.original.orderStatus] || "text-zinc-400 bg-zinc-500/10 border-zinc-500/30"} /> },
                { id: "actions", header: "Actions", enableSorting: false, cell: ({ row }: any) => <ActionButtons so={row.original.so} stage="confirm" /> },
              ]}
              data={crmPending.orders || []}
              searchPlaceholder="Search orders…"
              emptyState="No orders awaiting confirmation."
              initialSorting={[{ id: "ageDays", desc: true }]}
              exportName="crm-confirm"
              expandRender={(order: any) => <OrderItems order={order} canManage={canManageDocs} onChanged={refreshDocs} />}
              expandable
            />
          </div>
        </div>
      )}

      {/* ── Accounts ─────────────────────────────────────────────────────── */}
      {view === "accounts" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="To Invoice" value={String(toInvoice.count)} sub={fmtINR(toInvoice.value)} accent="text-sky-400" />
            <Kpi label="Awaiting Payment" value={String(awaitingPayment.count)} sub={fmtINR(awaitingPayment.value)} accent="text-emerald-400" />
            <Kpi label="Points Today" value={signed(todayPts.accounts || 0)} accent="text-emerald-400" />
            <Kpi label="Points This Week" value={signed(weekPts.accounts || 0)} accent="text-emerald-300" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">📄 To Invoice</h3>
            <DataTable
              columns={[
                { accessorKey: "so", header: "SO", cell: ({ getValue, row }: any) => (<span className="font-mono">{getValue()}{Number(row?.original?.attachmentCount || 0) > 0 ? <span title={`${row.original.attachmentCount} document(s) attached`}> 📎</span> : null}</span>) },
                { accessorKey: "ref", header: "Ref" },
                { accessorKey: "customer", header: "Customer" },
                { accessorKey: "salesperson", header: "Salesperson" },
                { accessorKey: "total", header: "Value", cell: ({ getValue }: any) => fmtINR(getValue()), sortingFn: (a: any, b: any) => (a.original.total || 0) - (b.original.total || 0) },
                { accessorKey: "ageDays", header: "Age", cell: ({ getValue }: any) => <span className={ageClass(getValue())}>{ageText(getValue())}</span> },
                { id: "invoice", header: "Invoice", cell: ({ row }: any) => <StatusPill status={row.original.invoicedStatus} accent={STAGE_PILL[row.original.invoicedStatus] || "text-zinc-400 bg-zinc-500/10 border-zinc-500/30"} /> },
                { id: "actions", header: "Actions", enableSorting: false, cell: ({ row }: any) => <ActionButtons so={row.original.so} stage="invoice" /> },
              ]}
              data={toInvoice.orders || []}
              searchPlaceholder="Search…"
              emptyState="No orders to invoice."
              initialSorting={[{ id: "ageDays", desc: true }]}
              exportName="crm-invoice"
              expandRender={(order: any) => <OrderItems order={order} canManage={canManageDocs} onChanged={refreshDocs} />}
              expandable
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">💳 Awaiting Payment</h3>
            <DataTable
              columns={[
                { accessorKey: "so", header: "SO", cell: ({ getValue, row }: any) => (<span className="font-mono">{getValue()}{Number(row?.original?.attachmentCount || 0) > 0 ? <span title={`${row.original.attachmentCount} document(s) attached`}> 📎</span> : null}</span>) },
                { accessorKey: "ref", header: "Ref" },
                { accessorKey: "customer", header: "Customer" },
                { accessorKey: "salesperson", header: "Salesperson" },
                { accessorKey: "total", header: "Value", cell: ({ getValue }: any) => fmtINR(getValue()), sortingFn: (a: any, b: any) => (a.original.total || 0) - (b.original.total || 0) },
                { accessorKey: "ageDays", header: "Age", cell: ({ getValue }: any) => <span className={ageClass(getValue())}>{ageText(getValue())}</span> },
                { id: "paid", header: "Paid", cell: ({ row }: any) => <StatusPill status={row.original.paidStatus} accent={PAID_PILL[row.original.paidStatus] || "text-zinc-400 bg-zinc-500/10 border-zinc-500/30"} /> },
                { id: "actions", header: "Actions", enableSorting: false, cell: ({ row }: any) => <ActionButtons so={row.original.so} stage="payment" /> },
              ]}
              data={awaitingPayment.orders || []}
              searchPlaceholder="Search…"
              emptyState="No orders awaiting payment."
              initialSorting={[{ id: "ageDays", desc: true }]}
              exportName="crm-payment"
              expandRender={(order: any) => <OrderItems order={order} canManage={canManageDocs} onChanged={refreshDocs} />}
              expandable
            />
          </div>
        </div>
      )}

      {/* ── Dispatch ─────────────────────────────────────────────────────── */}
      {view === "dispatch" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Pending Ship" value={String(dispatchPending.count)} sub={fmtINR(dispatchPending.value)} accent="text-indigo-400" />
            <Kpi label="Points Today" value={signed(todayPts.dispatch || 0)} accent="text-amber-400" />
            <Kpi label="Points This Week" value={signed(weekPts.dispatch || 0)} accent="text-amber-300" />
            <Kpi label="Shipped Today" value={String(todayCnt.dispatch || 0)} sub="events" accent="text-indigo-300" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">🚚 Orders to Ship</h3>
            <DataTable
              columns={[
                { accessorKey: "so", header: "SO", cell: ({ getValue, row }: any) => (<span className="font-mono">{getValue()}{Number(row?.original?.attachmentCount || 0) > 0 ? <span title={`${row.original.attachmentCount} document(s) attached`}> 📎</span> : null}</span>) },
                { accessorKey: "ref", header: "Ref" },
                { accessorKey: "customer", header: "Customer" },
                { accessorKey: "salesperson", header: "Salesperson" },
                { accessorKey: "total", header: "Value", cell: ({ getValue }: any) => fmtINR(getValue()), sortingFn: (a: any, b: any) => (a.original.total || 0) - (b.original.total || 0) },
                { accessorKey: "ageDays", header: "Age", cell: ({ getValue }: any) => <span className={ageClass(getValue())}>{ageText(getValue())}</span> },
                { id: "shipped", header: "Shipped", cell: ({ row }: any) => <StatusPill status={row.original.shippedStatus} accent={STAGE_PILL[row.original.shippedStatus] || "text-zinc-400 bg-zinc-500/10 border-zinc-500/30"} /> },
                { id: "actions", header: "Actions", enableSorting: false, cell: ({ row }: any) => <ActionButtons so={row.original.so} stage="ship" /> },
              ]}
              data={dispatchPending.orders || []}
              searchPlaceholder="Search…"
              emptyState="No orders to ship."
              initialSorting={[{ id: "ageDays", desc: true }]}
              exportName="crm-ship"
              expandRender={(order: any) => <OrderItems order={order} canManage={canManageDocs} onChanged={refreshDocs} />}
              expandable
            />
          </div>
        </div>
      )}

      {/* ── SO Materials (post-sale; distinct from the pre-sale Sourcing Queue) ── */}
      {view === "procurement" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Distinct Materials" value={String(procurement.distinctMaterials)} accent="text-sky-400" />
            <Kpi label="Total Qty" value={String(procurement.totalQty)} accent="text-sky-300" />
            <Kpi label="Open Orders" value={String(procurement.openOrders)} accent="text-indigo-400" />
            <Kpi label="Points Today" value={signed(todayPts.procurement || 0)} accent="text-sky-400" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111726]/80 p-4">
            <h3 className="text-sm font-bold text-white mb-3">📦 Materials (from line items)</h3>
            {meta && meta.withLineItems === false && (
              <p className="text-[11px] text-amber-400 mb-3">⚠️ Zoho response did not include line items — materials may be empty.</p>
            )}
            <DataTable
              columns={[
                { accessorKey: "item", header: "Item" },
                { accessorKey: "sku", header: "SKU", cell: ({ getValue }: any) => <span className="font-mono text-[10px]">{getValue()}</span> },
                { accessorKey: "qty", header: "Qty", sortingFn: (a: any, b: any) => (a.original.qty || 0) - (b.original.qty || 0) },
                { id: "orders", header: "Orders", cell: ({ row }: any) => Array.isArray(row.original.orders) ? row.original.orders.length : row.original.orders },
                { accessorKey: "value", header: "Value", cell: ({ getValue }: any) => fmtINR(getValue()), sortingFn: (a: any, b: any) => (a.original.value || 0) - (b.original.value || 0) },
              ]}
              data={procurement.materials || []}
              searchPlaceholder="Search materials…"
              emptyState="No materials data yet."
              initialSorting={[{ id: "qty", desc: true }]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

