"use client";

import { useMemo, useState } from "react";
import type { CustomerAgeingRow } from "@/payment-tracker/types";
import { BUCKET_LABELS, formatINR, shortDate } from "@/payment-tracker/types";
import { Chip, EmptyState, TD, TDR, TH, THR, TableShell } from "../ui";

const DUE_COLS = [
  { label: BUCKET_LABELS.D0, pick: (r: CustomerAgeingRow) => r.bucket0to30 },
  { label: BUCKET_LABELS.D31, pick: (r: CustomerAgeingRow) => r.bucket31to60 },
  { label: BUCKET_LABELS.D61, pick: (r: CustomerAgeingRow) => r.bucket61to90 },
  { label: BUCKET_LABELS.D91, pick: (r: CustomerAgeingRow) => r.bucket91to180 },
  { label: BUCKET_LABELS.D181, pick: (r: CustomerAgeingRow) => r.bucketAbove180 },
] as const;

type SortKey = "grossDue" | "totalReceivable" | "netDue";

export default function AgeingTab({
  customers, onGoToAccounts, onEditContact, onFollowUp, onViewLedger, canAccounts,
}: {
  customers: CustomerAgeingRow[];
  onGoToAccounts: () => void;
  onEditContact: (customer: CustomerAgeingRow) => void;
  onFollowUp: (customerName: string) => void;
  onViewLedger: (customer: CustomerAgeingRow) => void;
  canAccounts: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("grossDue");
  const sorted = useMemo(
    () => [...customers].sort((a, b) => b[sortKey] - a[sortKey]),
    [customers, sortKey],
  );
  const totals = useMemo(() => sorted.reduce((acc, r) => {
    acc.totalReceivable += r.totalReceivable;
    acc.notDue += r.notDue;
    for (const c of DUE_COLS) acc.buckets[c.label] = (acc.buckets[c.label] || 0) + c.pick(r);
    acc.grossDue += r.grossDue;
    acc.advanceReceived += r.advanceReceived;
    acc.netDue += r.netDue;
    return acc;
  }, { totalReceivable: 0, notDue: 0, buckets: {} as Record<string, number>, grossDue: 0, advanceReceived: 0, netDue: 0 }), [sorted]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Sort by</span>
        {([
          ["grossDue", "Gross due"],
          ["totalReceivable", "Total receivable"],
          ["netDue", "Net due"],
        ] as const).map(([key, label]) => (
          <Chip key={key} active={sortKey === key} onClick={() => setSortKey(key)}>{label}</Chip>
        ))}
        <div className="flex-1" />
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{sorted.length} customers</span>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="No customer ageing yet"
          hint={canAccounts
            ? "Import the debtors ageing sheet from the Accounts tab — the buckets are calculated automatically from each invoice's due date."
            : "The accounts team has not imported the debtors sheet yet. Ageing, dues and follow-up status will appear here once it is loaded."}
          action={canAccounts
            ? <button onClick={onGoToAccounts} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go to Accounts</button>
            : undefined}
        />
      ) : (
        <TableShell minWidth={1320}>
          <thead>
            <tr>
              <th className={TH}>#</th>
              <th className={TH}>Customer / Debtor</th>
              <th className={TH}>Contact</th>
              <th className={TH}>Last follow-up</th>
              <th className={THR}>Total Receivable</th>
              <th className={THR}>Not Due</th>
              {DUE_COLS.map((c) => <th key={c.label} className={THR}>{c.label}</th>)}
              <th className={THR}>Gross Due</th>
              <th className={THR}>Advance</th>
              <th className={THR}>Net Due</th>
              <th className={TH} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.customerName} className="even:bg-zinc-50/50 hover:bg-indigo-50/40 dark:even:bg-zinc-900/20 dark:hover:bg-indigo-500/5">
                <td className={`${TD} w-10 text-zinc-400`}>{i + 1}</td>
                <td className={`${TD} max-w-[280px]`} title={r.customerName}>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{r.customerName}</span>
                    {r.region && (
                      <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                        {r.region}
                      </span>
                    )}
                  </div>
                </td>
                <td className={TD}>
                  <div className="max-w-[220px] truncate" title={[r.phone, r.email].filter(Boolean).join(" · ")}>
                    {r.phone || r.email || <span className="text-amber-600 dark:text-amber-400">No contact</span>}
                  </div>
                  {r.phone && (
                    <div className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
                      {r.whatsappOptIn ? "WhatsApp opt-in" : "No WhatsApp opt-in"}
                    </div>
                  )}
                </td>
                <td className={TD}>
                  {r.lastFollowUpDate
                    ? <><div>{shortDate(r.lastFollowUpDate)}</div><div className="text-[10px] text-zinc-400 dark:text-zinc-500">{r.lastFollowUpStatus || "—"}</div></>
                    : <span className="text-zinc-400 dark:text-zinc-500">Not called</span>}
                </td>
                <td className={`${TDR} font-medium text-zinc-800 dark:text-zinc-200`}>{formatINR(r.totalReceivable, false)}</td>
                <td className={`${TDR} text-sky-600 dark:text-sky-400`}>{formatINR(r.notDue)}</td>
                {DUE_COLS.map((c) => (
                  <td key={c.label} className={TDR}>{formatINR(c.pick(r))}</td>
                ))}
                <td className={`${TDR} font-medium text-rose-600 dark:text-rose-400`}>{formatINR(r.grossDue, false)}</td>
                <td className={`${TDR} text-emerald-600 dark:text-emerald-400`}>{formatINR(r.advanceReceived)}</td>
                <td className={`${TDR} font-medium text-amber-600 dark:text-amber-400`}>{formatINR(r.netDue, false)}</td>
                <td className={`${TD} whitespace-nowrap text-right`}>
                  <button onClick={() => onViewLedger(r)} className="rounded px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Ledger</button>
                  <button onClick={() => onFollowUp(r.customerName)} className="ml-1 rounded px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10">Follow up</button>
                  {canAccounts && (
                    <button onClick={() => onEditContact(r)} className="ml-1 rounded px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">Contact</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-200 bg-zinc-50 font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-100">
              <td className="px-3 py-2" />
              <td className="px-3 py-2 whitespace-nowrap">Total</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.totalReceivable, false)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.notDue, false)}</td>
              {DUE_COLS.map((c) => <td key={c.label} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.buckets[c.label] || 0, false)}</td>)}
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.grossDue, false)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.advanceReceived, false)}</td>
              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatINR(totals.netDue, false)}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </TableShell>
      )}
    </div>
  );
}
