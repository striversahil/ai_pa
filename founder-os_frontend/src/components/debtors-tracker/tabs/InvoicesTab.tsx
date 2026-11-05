"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { LiveInvoice } from "@/debtors-tracker/types";
import { BUCKET_LABELS, formatDays, formatINR, shortDate } from "@/debtors-tracker/types";
import { describeSortSpecs, isDefaultSort, nextSortSpecs, type SortSpec } from "@/debtors-tracker/multi-sort";
import { useColumnOrder } from "@/hooks/useColumnOrder";
import { Card, Chip, EmptyState, SearchInput, SortableTh, TDC, TDCR, TableShell, bucketBadge } from "../ui";

const BUCKET_CHIPS = ["ALL", "NOT_DUE", "D0", "D31", "D61", "D91", "D181", "PAID"] as const;

const INVOICE_TEXT_FIRST = new Set(["customer", "invoice", "dueMonth", "bucket", "status", "owner", "place", "remarks"]);
const DEFAULT_INVOICE_SORT: SortSpec[] = [{ key: "date", dir: "desc" }];
const INVOICE_SORT_LABELS: Record<string, string> = {
  customer: "Customer", invoice: "Invoice", date: "Date", due: "Due", dueMonth: "Due Month",
  amount: "Amount", received: "Received", balance: "Balance", overdue: "Overdue",
  bucket: "Bucket", status: "Call / Payment", owner: "Owner", place: "State / Region", remarks: "Remarks",
};

const DEFAULT_COLUMNS = [
  "customer", "invoice", "date", "due", "dueMonth", "amount", "received",
  "balance", "overdue", "bucket", "status", "owner", "place", "remarks", "edit",
] as const;

type InvoiceColumn = {
  key: string;
  label?: string;
  align?: "right";
  ariaLabel?: string;
  render: (inv: LiveInvoice) => ReactNode;
};

export default function InvoicesTab({
  invoices, onEdit, onGoToAccounts,
}: {
  invoices: LiveInvoice[];
  onEdit: (inv: LiveInvoice) => void;
  onGoToAccounts: () => void;
}) {
  const [bucket, setBucket] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [sortSpecs, setSortSpecs] = useState<SortSpec[]>(DEFAULT_INVOICE_SORT);
  const { order, move } = useColumnOrder("pt:invoice-columns:v1", DEFAULT_COLUMNS);

  const changeSort = (key: string) => {
    if (key === "edit") return;
    setSortSpecs((prev) => nextSortSpecs(prev, key, DEFAULT_INVOICE_SORT, INVOICE_TEXT_FIRST));
  };
  const customSort = !isDefaultSort(sortSpecs, DEFAULT_INVOICE_SORT);

  const counts = useMemo(() => {
    const m: Record<string, number> = { ALL: invoices.length };
    for (const inv of invoices) m[inv.bucket] = (m[inv.bucket] || 0) + 1;
    return m;
  }, [invoices]);

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
    const overdueCmp = (a: number | null, b: number | null) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    };
    const BUCKET_ORDER = ["NOT_DUE", "D0", "D31", "D61", "D91", "D181", "PAID"] as const;
    const bucketRank = (b: string) => {
      const i = (BUCKET_ORDER as readonly string[]).indexOf(b);
      return i === -1 ? BUCKET_ORDER.length : i;
    };
    const compareByKey = (a: LiveInvoice, b: LiveInvoice, key: string): number => {
      switch (key) {
        case "customer": return strCmp(a.customerName, b.customerName);
        case "invoice": return strCmp(String(a.invoiceNo), String(b.invoiceNo));
        case "date": return dateCmp(a.invoiceDate, b.invoiceDate);
        case "due": return dateCmp(a.dueDate, b.dueDate);
        case "dueMonth": return strCmp(a.dueMonth || "", b.dueMonth || "");
        case "amount": return numCmp(a.invoiceAmount, b.invoiceAmount);
        case "received": return numCmp(a.effectiveReceived, b.effectiveReceived);
        case "balance": return numCmp(a.balance, b.balance);
        case "overdue": return overdueCmp(a.daysOverdue, b.daysOverdue);
        case "bucket": return bucketRank(a.bucket) - bucketRank(b.bucket);
        case "status": return strCmp([a.callStatus, a.paymentStatus].filter(Boolean).join(" · "), [b.callStatus, b.paymentStatus].filter(Boolean).join(" · "));
        case "owner": return strCmp(a.employee || "", b.employee || "");
        case "place": return strCmp([a.state, a.region].filter(Boolean).join(" / "), [b.state, b.region].filter(Boolean).join(" / "));
        case "remarks": return strCmp([a.remarks, a.accountsRemarks].filter(Boolean).join(" · "), [b.remarks, b.accountsRemarks].filter(Boolean).join(" · "));
        default: return 0;
      }
    };
    const rows = invoices
      .filter((inv) => bucket === "ALL" || inv.bucket === bucket)
      .filter((inv) =>
        !needle ||
        inv.customerName.toLowerCase().includes(needle) ||
        String(inv.invoiceNo).toLowerCase().includes(needle) ||
        (inv.employee || "").toLowerCase().includes(needle) ||
        (inv.state || "").toLowerCase().includes(needle) ||
        (inv.region || "").toLowerCase().includes(needle));
    return [...rows].sort((a, b) => {
      for (const spec of sortSpecs) {
        const cmp = compareByKey(a, b, spec.key);
        if (cmp !== 0) return spec.dir === "asc" ? cmp : -cmp;
      }
      // Stable fallback: newest invoice first, then largest balance.
      const fb = (b.invoiceDate || b.dueDate || "").localeCompare(a.invoiceDate || a.dueDate || "");
      return fb !== 0 ? fb : b.balance - a.balance;
    });
  }, [invoices, bucket, q, sortSpecs]);

  const columns: InvoiceColumn[] = [
    {
      key: "customer", label: "Customer",
      render: (inv) => <td key="customer" className={`${TDC} max-w-[220px] truncate font-medium text-zinc-800 dark:text-zinc-200`} title={inv.customerName}>{inv.customerName}</td>,
    },
    {
      key: "invoice", label: "Invoice",
      render: (inv) => <td key="invoice" className={`${TDC} max-w-[140px] truncate font-mono`}>{inv.invoiceNo}</td>,
    },
    {
      key: "date", label: "Date",
      render: (inv) => <td key="date" className={`${TDC} whitespace-nowrap`}>{shortDate(inv.invoiceDate)}</td>,
    },
    {
      key: "due", label: "Due",
      render: (inv) => <td key="due" className={`${TDC} whitespace-nowrap`}>{shortDate(inv.dueDate)}</td>,
    },
    {
      key: "dueMonth", label: "Due Month",
      render: (inv) => <td key="dueMonth" className={`${TDC} whitespace-nowrap`}>{inv.dueMonth || "—"}</td>,
    },
    {
      key: "amount", label: "Amount", align: "right",
      render: (inv) => <td key="amount" className={`${TDCR} text-zinc-800 dark:text-zinc-200`}>{formatINR(inv.invoiceAmount, false)}</td>,
    },
    {
      key: "received", label: "Received", align: "right",
      render: (inv) => <td key="received" className={TDCR}>{formatINR(inv.effectiveReceived)}</td>,
    },
    {
      key: "balance", label: "Balance", align: "right",
      render: (inv) => <td key="balance" className={`${TDCR} font-medium ${inv.balance <= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-800 dark:text-zinc-200"}`}>{formatINR(inv.balance, false)}</td>,
    },
    {
      key: "overdue", label: "Overdue", align: "right",
      render: (inv) => <td key="overdue" className={`${TDCR} ${(inv.daysOverdue ?? 0) > 90 ? "text-rose-600 dark:text-rose-400" : ""}`}>{formatDays(inv.daysOverdue)}</td>,
    },
    {
      key: "bucket", label: "Bucket",
      render: (inv) => (
        <td key="bucket" className={TDC}>
          <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0 text-[10px] ${bucketBadge(inv.bucket)}`}>{BUCKET_LABELS[inv.bucket]}</span>
        </td>
      ),
    },
    {
      key: "status", label: "Call / Payment",
      render: (inv) => (
        <td key="status" className={`${TDC} max-w-[220px] truncate`} title={[inv.callStatus, inv.paymentStatus, inv.lastCallDate].filter(Boolean).join(" · ")}>
          {[inv.callStatus, inv.paymentStatus].filter(Boolean).join(" · ") || "—"}
        </td>
      ),
    },
    {
      key: "owner", label: "Owner",
      render: (inv) => <td key="owner" className={`${TDC} whitespace-nowrap`}>{inv.employee || "—"}</td>,
    },
    {
      key: "place", label: "State / Region",
      render: (inv) => <td key="place" className={`${TDC} whitespace-nowrap`}>{[inv.state, inv.region].filter(Boolean).join(" / ") || "—"}</td>,
    },
    {
      key: "remarks", label: "Remarks",
      render: (inv) => (
        <td key="remarks" className={`${TDC} max-w-[240px] truncate`} title={[inv.remarks, inv.accountsRemarks].filter(Boolean).join(" · ")}>
          {[inv.remarks, inv.accountsRemarks].filter(Boolean).join(" · ") || "—"}
        </td>
      ),
    },
    {
      key: "edit", ariaLabel: "Edit",
      render: (inv) => (
        <td key="edit" className={TDC}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-zinc-300 transition-colors group-hover:text-indigo-500 dark:text-zinc-600" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z" strokeLinejoin="round" /><path d="m13.5 6.5 4 4" strokeLinecap="round" />
          </svg>
        </td>
      ),
    },
  ];
  const columnByKey = new Map(columns.map((col) => [col.key, col]));

  return (
    <div className="space-y-3">
      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search customer, invoice, owner, state…" />
          <div className="flex-1" />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">Click headers to stack sorts · again to flip · third click clears · drag to reorder · {filtered.length} of {invoices.length}</span>
        </div>
        {customSort && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="rounded-full bg-indigo-500/10 px-2.5 py-1 font-medium tabular-nums text-indigo-600 dark:text-indigo-400">
              Sort: {describeSortSpecs(sortSpecs, (k) => INVOICE_SORT_LABELS[k] ?? k)}
            </span>
            <button
              onClick={() => setSortSpecs(DEFAULT_INVOICE_SORT)}
              className="rounded-full px-2.5 py-1 font-medium text-zinc-500 ring-1 ring-zinc-300 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              Reset
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {BUCKET_CHIPS.map((b) => (
            <Chip key={b} active={bucket === b} onClick={() => setBucket(b)} count={counts[b]}>
              {b === "ALL" ? "All" : BUCKET_LABELS[b as keyof typeof BUCKET_LABELS] ?? b}
            </Chip>
          ))}
        </div>
      </Card>

      {invoices.length === 0 ? (
        <EmptyState
          title="No invoices imported yet"
          hint="Paste the debtors ageing sheet from the Accounts tab. Money columns come from the paste; everything else is calculated or edited per row."
          action={<button onClick={onGoToAccounts} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go to Accounts</button>}
        />
      ) : (
        <TableShell minWidth={1040} dense>
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
                    sortActive={key !== "edit" && !!active}
                    sortDir={active?.dir ?? "asc"}
                    sortIndex={active ? activeIdx + 1 : null}
                    sortCount={sortSpecs.length}
                    onSort={key === "edit" ? undefined : changeSort}
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
            {filtered.slice(0, 500).map((inv) => (
              <tr
                key={inv.id}
                onClick={() => onEdit(inv)}
                title="Click to edit contact / status / owner / remarks"
                className="group cursor-pointer even:bg-zinc-50/50 hover:bg-indigo-50/40 dark:even:bg-zinc-900/20 dark:hover:bg-indigo-500/5"
              >
                {order.map((key) => columnByKey.get(key)?.render(inv))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={order.length} className="px-2 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No invoices match the current filter.</td></tr>
            )}
          </tbody>
        </TableShell>
      )}
      {filtered.length > 500 && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Showing first 500 of {filtered.length} — refine the filter to see more.</p>
      )}
    </div>
  );
}
