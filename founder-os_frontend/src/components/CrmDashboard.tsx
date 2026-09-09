"use client";

import React, { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useLiveQuery } from "@/hooks/useLiveData";
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
  procurement: { label: "Procurement", icon: "📦", accent: "text-sky-400" },
};

type View = "overview" | "crm" | "accounts" | "dispatch" | "procurement";

const TABS: { key: View; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "📊" },
  { key: "crm", label: "CRM Desk", icon: "🤝" },
  { key: "accounts", label: "Accounts", icon: "💰" },
  { key: "dispatch", label: "Dispatch", icon: "🚚" },
  { key: "procurement", label: "Procurement", icon: "📦" },
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

// ── Reusable TanStack table ───────────────────────────────────────────────────
function DataTable({
  columns,
  data,
  searchPlaceholder = "Search…",
  emptyState = "Nothing here yet.",
  initialSorting,
}: {
  columns: ColumnDef<any, any>[];
  data: any[];
  searchPlaceholder?: string;
  emptyState?: React.ReactNode;
  initialSorting?: SortingState;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
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
                <td colSpan={columns.length} className="px-3 py-6 text-center text-zinc-500 italic">
                  {emptyState}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-100/40 dark:hover:bg-zinc-800/40">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-2.5 py-1.5 text-zinc-800 dark:text-zinc-200">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
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