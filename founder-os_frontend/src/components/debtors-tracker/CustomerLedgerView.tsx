"use client";

import { useEffect, useMemo, useState } from "react";
import type { CustomerAgeingRow, CustomerLedger, CustomerLedgerEntry } from "@/debtors-tracker/types";
import { BUCKET_LABELS, formatINR, shortDate } from "@/debtors-tracker/types";
import { getCustomerLedger } from "@/debtors-tracker/api";
import { downloadLedgerCsv, printLedger } from "@/debtors-tracker/ledger";
import { TDCR, TDC, THCR, THC, TableShell } from "./ui";

function typeBadge(type: CustomerLedgerEntry["type"]): string {
  if (type === "invoice") return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
  if (type === "sheet_received") return "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400";
  return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function typeLabel(type: CustomerLedgerEntry["type"]): string {
  if (type === "invoice") return "Invoice";
  if (type === "sheet_received") return "Sheet received";
  return "Receipt";
}

const RECEIPT_LABEL: Record<string, string> = {
  invoice: "By invoice",
  customer: "By customer",
  advance: "Advance",
  unmatched: "Unmatched",
};

function statusLabel(entry: CustomerLedgerEntry): string {
  if (entry.type === "invoice") return BUCKET_LABELS[entry.status as keyof typeof BUCKET_LABELS] ?? entry.status;
  if (entry.type === "sheet_received") return "Per sheet";
  return RECEIPT_LABEL[entry.status] ?? entry.status;
}

function statusTone(entry: CustomerLedgerEntry): string {
  if (entry.status === "advance" || entry.status === "unmatched") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (entry.type === "invoice") return "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400";
  return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function SummaryCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${tone ?? "text-zinc-900 dark:text-zinc-100"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">{hint}</div>}
    </div>
  );
}

/** Complete invoice + receipt statement for one company (used by modal + Ledger tab). */
export default function CustomerLedgerView({
  customer, onClose,
}: {
  customer: CustomerAgeingRow | null;
  onClose?: () => void;
}) {
  const key = customer?.customerKey ?? "";
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!key) { setLedger(null); setErr(null); return; }
    let cancelled = false;
    setLoading(true);
    setLedger(null);
    setErr(null);
    getCustomerLedger(key)
      .then((data) => { if (!cancelled) setLedger(data); })
      .catch((e: any) => { if (!cancelled) setErr(e?.message ?? "Could not load ledger"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key]);

  const unapplied = useMemo(
    () => new Set(ledger?.unappliedReceiptIds ?? []),
    [ledger],
  );

  if (!customer) return null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{customer.customerName}</h2>
            {customer.region && (
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">{customer.region}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact on file"}
            {ledger ? ` · As of ${ledger.asOfIST}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => ledger && downloadLedgerCsv(ledger)}
            disabled={!ledger}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Download CSV
          </button>
          <button
            onClick={() => ledger && printLedger(ledger)}
            disabled={!ledger}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Print
          </button>
          {onClose && <button onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Close</button>}
        </div>
      </div>

      {loading && <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading client ledger…</div>}
      {err && <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">{err}</div>}

      {ledger && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            <SummaryCard label="Total invoiced" value={formatINR(ledger.totals.totalInvoiced, false)} hint={`${ledger.totals.invoiceCount} invoices`} />
            <SummaryCard label="Total received" value={formatINR(ledger.totals.totalReceived, false)} hint={`${ledger.totals.receiptCount} receipts`} />
            <SummaryCard label="Invoice balance" value={formatINR(ledger.totals.invoiceBalance, false)} tone="text-rose-600 dark:text-rose-400" hint="After allocated receipts" />
            <SummaryCard label="Unapplied receipts" value={formatINR(ledger.totals.unappliedReceived)} tone="text-amber-600 dark:text-amber-400" hint="Advances + unmatched" />
            <SummaryCard label="Net receivable" value={formatINR(ledger.totals.netReceivable, false)} tone="text-amber-700 dark:text-amber-300" hint="Invoice balance − unapplied" />
          </div>

          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            Debits are invoices; credits are receipts plus any un-itemized amount reported by the ageing sheet.
            Amber rows are advances or unmatched receipts, included in Net receivable.
          </p>

          <div className="mt-3">
            <TableShell minWidth={980} dense>
              <thead>
                <tr>
                  <th className={THC}>Date</th>
                  <th className={THC}>Type</th>
                  <th className={THC}>Reference</th>
                  <th className={THC}>Invoice No.</th>
                  <th className={THC}>Description</th>
                  <th className={THCR}>Debit</th>
                  <th className={THCR}>Credit</th>
                  <th className={THCR}>Balance</th>
                  <th className={THC}>Status</th>
                </tr>
              </thead>
              <tbody>
                {ledger.entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className={`${unapplied.has(entry.id) ? "bg-amber-50/60 dark:bg-amber-950/10" : "even:bg-zinc-50/50 dark:even:bg-zinc-900/20"} hover:bg-indigo-50/40 dark:hover:bg-indigo-500/5`}
                  >
                    <td className={`${TDC} whitespace-nowrap`}>{shortDate(entry.date)}</td>
                    <td className={TDC}>
                      <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0 text-[10px] font-medium ${typeBadge(entry.type)}`}>{typeLabel(entry.type)}</span>
                    </td>
                    <td className={`${TDC} max-w-[170px] truncate font-mono`} title={entry.reference}>{entry.reference}</td>
                    <td className={`${TDC} max-w-[140px] truncate font-mono`} title={entry.invoiceNo}>{entry.invoiceNo || "—"}</td>
                    <td className={`${TDC} max-w-[240px] truncate`} title={entry.description}>{entry.description}</td>
                    <td className={TDCR}>{entry.debit ? formatINR(entry.debit, false) : ""}</td>
                    <td className={`${TDCR} text-emerald-700 dark:text-emerald-400`}>{entry.credit ? formatINR(entry.credit, false) : ""}</td>
                    <td className={`${TDCR} font-medium ${entry.balance < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-800 dark:text-zinc-200"}`}>{formatINR(entry.balance, false)}</td>
                    <td className={TDC}>
                      <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0 text-[10px] ${statusTone(entry)}`}>{statusLabel(entry)}</span>
                    </td>
                  </tr>
                ))}
                {ledger.entries.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No ledger entries for this customer.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-zinc-200 bg-zinc-50 font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-100">
                  <td className="px-2 py-1" colSpan={5}>Net receivable</td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatINR(ledger.totals.totalInvoiced, false)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatINR(ledger.totals.totalReceived, false)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{formatINR(ledger.totals.netReceivable, false)}</td>
                  <td className="px-2 py-1" />
                </tr>
              </tfoot>
            </TableShell>
          </div>
        </>
      )}
    </div>
  );
}
