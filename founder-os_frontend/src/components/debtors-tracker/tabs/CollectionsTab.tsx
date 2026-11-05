"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { LiveCollection } from "@/debtors-tracker/types";
import { formatINR, shortDate } from "@/debtors-tracker/types";
import { describeSortSpecs, isDefaultSort, nextSortSpecs, type SortSpec } from "@/debtors-tracker/multi-sort";
import { useColumnOrder } from "@/hooks/useColumnOrder";
import { Card, EmptyState, SearchInput, SortableTh, TDC, TDCR, TableShell, matchBadge, matchLabel } from "../ui";

const COLLECTION_TEXT_FIRST = new Set(["customer", "invoice", "mode", "remarks", "match"]);
const DEFAULT_COLLECTION_SORT: SortSpec[] = [{ key: "date", dir: "desc" }];
const COLLECTION_SORT_LABELS: Record<string, string> = {
  date: "Date", customer: "Customer", invoice: "Invoice No.", amount: "Amount Received",
  mode: "Mode", remarks: "Remarks", match: "Match", imported: "Imported",
};
const MATCH_RANK: Record<string, number> = { invoice: 0, customer: 1, advance: 2 };

const DEFAULT_COLUMNS = [
  "date", "customer", "invoice", "amount", "mode", "remarks", "match", "imported", "actions",
] as const;

type CollectionColumn = {
  key: string;
  label?: string;
  align?: "right";
  ariaLabel?: string;
  render: (c: LiveCollection) => ReactNode;
};

export default function CollectionsTab({
  collections, onDelete, onGoToAccounts, canDelete,
}: {
  collections: LiveCollection[];
  onDelete: (c: LiveCollection) => void;
  onGoToAccounts: () => void;
  canDelete: boolean;
}) {
  const [q, setQ] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [sortSpecs, setSortSpecs] = useState<SortSpec[]>(DEFAULT_COLLECTION_SORT);
  const columnKeys = useMemo(
    () => DEFAULT_COLUMNS.filter((key) => key !== "actions" || canDelete),
    [canDelete],
  );
  const { order, move } = useColumnOrder("pt:collection-columns:v1", columnKeys);

  const changeSort = (key: string) => {
    if (key === "actions") return;
    setSortSpecs((prev) => nextSortSpecs(prev, key, DEFAULT_COLLECTION_SORT, COLLECTION_TEXT_FIRST));
  };
  const customSort = !isDefaultSort(sortSpecs, DEFAULT_COLLECTION_SORT);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const strCmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    const dateCmp = (a: string | null, b: string | null) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    };
    const numCmp = (a: number, b: number) => (a || 0) - (b || 0);
    const matchRank = (s: string) => MATCH_RANK[s] ?? 3;
    const compareByKey = (a: LiveCollection, b: LiveCollection, key: string): number => {
      switch (key) {
        case "date": return dateCmp(a.collectionDate, b.collectionDate);
        case "customer": return strCmp(a.customerName, b.customerName);
        case "invoice": return strCmp(a.invoiceNo || "", b.invoiceNo || "");
        case "amount": return numCmp(a.amount, b.amount);
        case "mode": return strCmp(a.mode || "", b.mode || "");
        case "remarks": return strCmp(a.remarks || "", b.remarks || "");
        case "match": return matchRank(a.matchStatus) - matchRank(b.matchStatus);
        case "imported": return dateCmp(a.createdAt || null, b.createdAt || null);
        default: return 0;
      }
    };
    const rows = collections.filter((c) =>
      !needle ||
      c.customerName.toLowerCase().includes(needle) ||
      (c.invoiceNo || "").toLowerCase().includes(needle) ||
      (c.mode || "").toLowerCase().includes(needle) ||
      (c.remarks || "").toLowerCase().includes(needle));
    return [...rows].sort((a, b) => {
      for (const spec of sortSpecs) {
        const cmp = compareByKey(a, b, spec.key);
        if (cmp !== 0) return spec.dir === "asc" ? cmp : -cmp;
      }
      // Stable fallback: newest receipt first, then largest amount.
      const fb = (b.collectionDate || b.createdAt || "").localeCompare(a.collectionDate || a.createdAt || "");
      return fb !== 0 ? fb : b.amount - a.amount;
    });
  }, [collections, q, sortSpecs]);

  const columns: CollectionColumn[] = [
    {
      key: "date", label: "Date",
      render: (c) => <td key="date" className={`${TDC} whitespace-nowrap`}>{shortDate(c.collectionDate)}</td>,
    },
    {
      key: "customer", label: "Customer",
      render: (c) => <td key="customer" className={`${TDC} max-w-[240px] truncate font-medium text-zinc-800 dark:text-zinc-200`} title={c.customerName}>{c.customerName}</td>,
    },
    {
      key: "invoice", label: "Invoice No.",
      render: (c) => <td key="invoice" className={`${TDC} max-w-[150px] truncate font-mono`}>{c.invoiceNo || "—"}</td>,
    },
    {
      key: "amount", label: "Amount Received", align: "right",
      render: (c) => <td key="amount" className={`${TDCR} font-medium ${c.amount < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{formatINR(c.amount, false)}</td>,
    },
    {
      key: "mode", label: "Mode",
      render: (c) => <td key="mode" className={TDC}>{c.mode || "—"}</td>,
    },
    {
      key: "remarks", label: "Remarks",
      render: (c) => <td key="remarks" className={`${TDC} max-w-[280px] truncate`} title={c.remarks}>{c.remarks || "—"}</td>,
    },
    {
      key: "match", label: "Match",
      render: (c) => (
        <td key="match" className={TDC}>
          <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0 text-[10px] ${matchBadge(c.matchStatus)}`}>{matchLabel(c.matchStatus)}</span>
        </td>
      ),
    },
    {
      key: "imported", label: "Imported",
      render: (c) => <td key="imported" className={`${TDC} whitespace-nowrap text-zinc-400 dark:text-zinc-500`}>{shortDate(c.createdAt)}</td>,
    },
    ...(canDelete ? [{
      key: "actions", ariaLabel: "Actions",
      render: (c: LiveCollection) => (
        <td key="actions" className={`${TDC} text-right`}>
          <button
            onClick={() => onDelete(c)}
            className="rounded px-2 py-1 text-[10px] text-rose-600 opacity-0 transition-opacity hover:bg-rose-50 focus:opacity-100 group-hover:opacity-100 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            Delete
          </button>
        </td>
      ),
    }] : []),
  ];
  const columnByKey = new Map(columns.map((col) => [col.key, col]));

  return (
    <div className="space-y-3">
      <Card className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search customer, invoice, mode, remarks…" />
          <div className="flex-1" />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">Click headers to stack sorts · again to flip · third click clears · drag to reorder · {filtered.length} of {collections.length}</span>
        </div>
        {customSort && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
              Sort: {describeSortSpecs(sortSpecs, (k) => COLLECTION_SORT_LABELS[k] ?? k)}
            </span>
            <button
              onClick={() => setSortSpecs(DEFAULT_COLLECTION_SORT)}
              className="rounded-full px-2.5 py-1 font-medium text-zinc-500 ring-1 ring-zinc-300 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              Reset
            </button>
          </div>
        )}
      </Card>

      {collections.length === 0 ? (
        <EmptyState
          title="No collections recorded yet"
          hint={canDelete
            ? "Paste the receipts sheet from the Accounts tab. Receipts match to invoices by invoice number, else the customer's oldest open invoice."
            : "The accounts team has not imported the receipts sheet yet."}
          action={canDelete
            ? <button onClick={onGoToAccounts} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">Go to Accounts</button>
            : undefined}
        />
      ) : (
        <TableShell minWidth={900} dense>
          <thead>
            <tr>
              {order.map((key) => {
                const col = columnByKey.get(key);
                if (!col) return null;
                const activeIdx = sortSpecs.findIndex((s) => s.key === key);
                const active = activeIdx >= 0 ? sortSpecs[activeIdx] : undefined;
                return (
                  <SortableTh
                    key={key}
                    id={key}
                    label={col.label}
                    align={col.align}
                    ariaLabel={col.ariaLabel}
                    dragging={dragKey === key}
                    over={overKey === key}
                    sortActive={!!active}
                    sortDir={active?.dir ?? "asc"}
                    sortIndex={active ? activeIdx + 1 : null}
                    sortCount={sortSpecs.length}
                    onSort={key === "actions" ? undefined : changeSort}
                    onDragStart={setDragKey}
                    onDragOver={setOverKey}
                    onDrop={(to) => {
                      if (dragKey) move(dragKey, to);
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((c) => (
              <tr key={c.id} className="group even:bg-zinc-50/50 hover:bg-emerald-50/40 dark:even:bg-zinc-900/20 dark:hover:bg-emerald-500/5">
                {order.map((key) => columnByKey.get(key)?.render(c))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={order.length} className="px-2 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No collections match the search.</td></tr>
            )}
          </tbody>
        </TableShell>
      )}
      {filtered.length > 500 && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Showing first 500 of {filtered.length} — refine the search to see more.</p>
      )}
    </div>
  );
}
