"use client";

import { useMemo, useState } from "react";
import type { LiveCollection } from "@/payment-tracker/types";
import { formatINR, shortDate } from "@/payment-tracker/types";
import { Card, EmptyState, SearchInput, TDC, TDCR, THC, THCR, TableShell, matchBadge, matchLabel } from "../ui";

export default function CollectionsTab({
  collections, onDelete, onGoToAccounts, canDelete,
}: {
  collections: LiveCollection[];
  onDelete: (c: LiveCollection) => void;
  onGoToAccounts: () => void;
  canDelete: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return collections.filter((c) =>
      !needle ||
      c.customerName.toLowerCase().includes(needle) ||
      (c.invoiceNo || "").toLowerCase().includes(needle) ||
      (c.mode || "").toLowerCase().includes(needle) ||
      (c.remarks || "").toLowerCase().includes(needle));
  }, [collections, q]);

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search customer, invoice, mode, remarks…" />
        <div className="flex-1" />
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{filtered.length} of {collections.length}</span>
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
        <TableShell minWidth={1040} dense>
          <thead>
            <tr>
              <th className={THC}>Date</th>
              <th className={THC}>Customer</th>
              <th className={THC}>Invoice No.</th>
              <th className={THC}>Receipt No.</th>
              <th className={THCR}>Amount Received</th>
              <th className={THC}>Mode</th>
              <th className={THC}>Remarks</th>
              <th className={THC}>Match</th>
              <th className={THC}>Imported</th>
              {canDelete && <th className={THC} aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((c) => (
              <tr key={c.id} className="group even:bg-zinc-50/50 hover:bg-emerald-50/40 dark:even:bg-zinc-900/20 dark:hover:bg-emerald-500/5">
                <td className={`${TDC} whitespace-nowrap`}>{shortDate(c.collectionDate)}</td>
                <td className={`${TDC} max-w-[240px] truncate font-medium text-zinc-800 dark:text-zinc-200`} title={c.customerName}>{c.customerName}</td>
                <td className={`${TDC} max-w-[150px] truncate font-mono`}>{c.invoiceNo || "—"}</td>
                <td className={`${TDC} max-w-[140px] truncate font-mono`}>{c.receiptNo || "—"}</td>
                <td className={`${TDCR} font-medium ${c.amount < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{formatINR(c.amount, false)}</td>
                <td className={TDC}>{c.mode || "—"}</td>
                <td className={`${TDC} max-w-[280px] truncate`} title={c.remarks}>{c.remarks || "—"}</td>
                <td className={TDC}>
                  <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0 text-[10px] ${matchBadge(c.matchStatus)}`}>{matchLabel(c.matchStatus)}</span>
                </td>
                <td className={`${TDC} whitespace-nowrap text-zinc-400 dark:text-zinc-500`}>{shortDate(c.createdAt)}</td>
                {canDelete && (
                  <td className={`${TDC} text-right`}>
                    <button
                      onClick={() => onDelete(c)}
                      className="rounded px-2 py-1 text-[10px] text-rose-600 opacity-0 transition-opacity hover:bg-rose-50 focus:opacity-100 group-hover:opacity-100 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={canDelete ? 10 : 9} className="px-2 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No collections match the search.</td></tr>
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
