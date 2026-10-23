"use client";

import { useMemo, useState } from "react";
import type { LiveInvoice } from "@/payment-tracker/types";
import { BUCKET_LABELS, formatDays, formatINR, shortDate } from "@/payment-tracker/types";
import { Card, Chip, EmptyState, SearchInput, TDC, TDCR, THC, THCR, TableShell, bucketBadge } from "../ui";

const BUCKET_CHIPS = ["ALL", "NOT_DUE", "D0", "D31", "D61", "D91", "D181", "PAID"] as const;

export default function InvoicesTab({
  invoices, onEdit, onGoToAccounts,
}: {
  invoices: LiveInvoice[];
  onEdit: (inv: LiveInvoice) => void;
  onGoToAccounts: () => void;
}) {
  const [bucket, setBucket] = useState<string>("ALL");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const m: Record<string, number> = { ALL: invoices.length };
    for (const inv of invoices) m[inv.bucket] = (m[inv.bucket] || 0) + 1;
    return m;
  }, [invoices]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return invoices
      .filter((inv) => bucket === "ALL" || inv.bucket === bucket)
      .filter((inv) =>
        !needle ||
        inv.customerName.toLowerCase().includes(needle) ||
        String(inv.invoiceNo).toLowerCase().includes(needle) ||
        (inv.employee || "").toLowerCase().includes(needle) ||
        (inv.state || "").toLowerCase().includes(needle) ||
        (inv.region || "").toLowerCase().includes(needle))
      .sort((a, b) => {
        const aDate = a.invoiceDate || a.dueDate || "";
        const bDate = b.invoiceDate || b.dueDate || "";
        return bDate.localeCompare(aDate) || b.balance - a.balance;
      });
  }, [invoices, bucket, q]);

  return (
    <div className="space-y-3">
      <Card className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search customer, invoice, owner, state…" />
          <div className="flex-1" />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">Newest invoice date first · {filtered.length} of {invoices.length}</span>
        </div>
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
        <TableShell minWidth={1160} dense>
          <thead>
            <tr>
              <th className={THC}>Customer</th>
              <th className={THC}>Invoice</th>
              <th className={THC}>Date ↓</th>
              <th className={THC}>Due</th>
              <th className={THCR}>Age</th>
              <th className={THC}>Due Month</th>
              <th className={THCR}>Amount</th>
              <th className={THCR}>Received</th>
              <th className={THCR}>Balance</th>
              <th className={THCR}>Overdue</th>
              <th className={THC}>Bucket</th>
              <th className={THC}>Call / Payment</th>
              <th className={THC}>Owner</th>
              <th className={THC}>State / Region</th>
              <th className={THC}>Remarks</th>
              <th className={THC} aria-label="Edit" />
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
                <td className={`${TDC} max-w-[220px] truncate font-medium text-zinc-800 dark:text-zinc-200`} title={inv.customerName}>{inv.customerName}</td>
                <td className={`${TDC} max-w-[140px] truncate font-mono`}>{inv.invoiceNo}</td>
                <td className={`${TDC} whitespace-nowrap`}>{shortDate(inv.invoiceDate)}</td>
                <td className={`${TDC} whitespace-nowrap`}>{shortDate(inv.dueDate)}</td>
                <td className={`${TDCR} text-zinc-500 dark:text-zinc-400`}>{formatDays(inv.daysSinceInvoice)}</td>
                <td className={`${TDC} whitespace-nowrap`}>{inv.dueMonth || "—"}</td>
                <td className={`${TDCR} text-zinc-800 dark:text-zinc-200`}>{formatINR(inv.invoiceAmount, false)}</td>
                <td className={TDCR}>{formatINR(inv.effectiveReceived)}</td>
                <td className={`${TDCR} font-medium ${inv.balance < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-800 dark:text-zinc-200"}`}>{formatINR(inv.balance, false)}</td>
                <td className={`${TDCR} ${(inv.daysOverdue ?? 0) > 90 ? "text-rose-600 dark:text-rose-400" : ""}`}>{formatDays(inv.daysOverdue)}</td>
                <td className={TDC}>
                  <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0 text-[10px] ${bucketBadge(inv.bucket)}`}>{BUCKET_LABELS[inv.bucket]}</span>
                </td>
                <td className={`${TDC} max-w-[220px] truncate`} title={[inv.callStatus, inv.paymentStatus, inv.lastCallDate].filter(Boolean).join(" · ")}>
                  {[inv.callStatus, inv.paymentStatus].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className={`${TDC} whitespace-nowrap`}>{inv.employee || "—"}</td>
                <td className={`${TDC} whitespace-nowrap`}>{[inv.state, inv.region].filter(Boolean).join(" / ") || "—"}</td>
                <td className={`${TDC} max-w-[240px] truncate`} title={[inv.remarks, inv.accountsRemarks].filter(Boolean).join(" · ")}>
                  {[inv.remarks, inv.accountsRemarks].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className={TDC}>
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-zinc-300 transition-colors group-hover:text-indigo-500 dark:text-zinc-600" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z" strokeLinejoin="round" /><path d="m13.5 6.5 4 4" strokeLinecap="round" />
                  </svg>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={16} className="px-2 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No invoices match the current filter.</td></tr>
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
