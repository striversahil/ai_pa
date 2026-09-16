"use client";

import React, { useEffect, useMemo, useState } from "react";

export interface AdminColumn<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  /** Sort accessor — column is sortable when provided. */
  sortValue?: (row: T) => string | number;
  className?: string;
}

interface AdminTableProps<T> {
  rows: T[];
  columns: AdminColumn<T>[];
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  toSearchText: (row: T) => string;
  emptyText?: string;
  pageSizes?: number[];
  /** Extra toolbar controls (e.g. a role filter) rendered beside search. */
  toolbarExtra?: React.ReactNode;
  /** Row click (e.g. open the manage drawer). */
  onRowClick?: (row: T) => void;
}

/** Generic scale-ready table: search + sortable columns + pagination. */
export default function AdminTable<T>({
  rows, columns, rowKey, searchPlaceholder, toSearchText, emptyText,
  pageSizes = [10, 25, 50], toolbarExtra, onRowClick,
}: AdminTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(pageSizes[0]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? rows.filter((r) => toSearchText(r).toLowerCase().includes(q)) : rows;
    if (!sortKey) return base;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return base;
    const get = col.sortValue;
    return [...base].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return cmp * sortDir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [query, rows, pageSize]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  // Compact windowed page numbers: 1 … window … n
  const pageNums = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const win = new Set([1, 2, totalPages - 1, totalPages, page - 1, page, page + 1]);
    return [...win].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  }, [page, totalPages]);

  const flipSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir(1); }
    else setSortDir((d) => (d === 1 ? -1 : 1));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder ?? "Search…"}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500 sm:max-w-xs"
        />
        {toolbarExtra}
        <span className="ml-auto text-xs text-zinc-500">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-zinc-100 dark:bg-zinc-800/60 text-left">
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2.5 text-xs font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 ${c.className ?? ""}`}>
                  {c.sortValue ? (
                    <button onClick={() => flipSort(c.key)} className="inline-flex items-center gap-1 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer border-0 bg-transparent p-0 text-inherit font-inherit uppercase tracking-wider text-[inherit]">
                      {c.header}
                      <span className="text-[10px]">{sortKey === c.key ? (sortDir === 1 ? "▲" : "▼") : "⇅"}</span>
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {paged.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`bg-white dark:bg-zinc-950 ${onRowClick ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900" : ""}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2.5 align-middle ${c.className ?? ""}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-zinc-500">
                  {emptyText ?? "Nothing here yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>
          Showing {filtered.length === 0 ? 0 : start + 1}–{Math.min(start + pageSize, filtered.length)} of {filtered.length}
        </span>
        <label className="ml-auto flex items-center gap-1.5">
          Per page
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-xs outline-none"
          >
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 font-bold disabled:opacity-40 cursor-pointer disabled:cursor-default bg-white dark:bg-zinc-950">‹</button>
          {pageNums.map((n, i, arr) => (
            <React.Fragment key={n}>
              {i > 0 && arr[i - 1] !== n - 1 && <span className="px-0.5">…</span>}
              <button onClick={() => setPage(n)}
                className={`min-w-[28px] rounded-lg border px-2 py-1 font-bold cursor-pointer ${n === page ? "bg-indigo-600 text-white border-transparent" : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"}`}>
                {n}
              </button>
            </React.Fragment>
          ))}
          <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 font-bold disabled:opacity-40 cursor-pointer disabled:cursor-default bg-white dark:bg-zinc-950">›</button>
        </div>
      </div>
    </div>
  );
}
