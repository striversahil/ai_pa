"use client";

import { useMemo, useState } from "react";
import type { CustomerAgeingRow, LiveReminder, DebtorsTrackerPayload } from "@/debtors-tracker/types";
import { formatINR, shortDate } from "@/debtors-tracker/types";
import { Card, EmptyState, MiniStat, SearchInput, TD, TDR, TH, THR, TableShell } from "../ui";

function statusStyle(status: string): string {
  if (status === "sent") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (status === "failed") return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
  if (status === "skipped") return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
}

function statusLabel(status: string): string {
  return status === "sent" ? "Sent" : status === "failed" ? "Failed" : status === "skipped" ? "Skipped" : "Dry-run";
}

export default function RemindersTab({
  reminders, customers, meta, canAccounts, onRun, running,
}: {
  reminders: LiveReminder[];
  customers: CustomerAgeingRow[];
  meta: DebtorsTrackerPayload["meta"];
  canAccounts: boolean;
  onRun: () => void;
  running: boolean;
}) {
  const [q, setQ] = useState("");
  const eligible = useMemo(
    () => customers.filter((c) => c.grossDue > 0.005 && c.netDue > 0.005),
    [customers],
  );
  const withPhone = eligible.filter((c) => !!c.phone);
  const optedIn = eligible.filter((c) => !!c.phone && c.whatsappOptIn);
  const previews = reminders.filter((r) => r.runDay === meta.reminderRunDay);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reminders.filter((r) =>
      !needle ||
      r.customerName.toLowerCase().includes(needle) ||
      r.phone.includes(needle) ||
      r.invoiceNos.toLowerCase().includes(needle) ||
      r.status.toLowerCase().includes(needle));
  }, [reminders, q]);

  return (
    <div className="space-y-3">
      <Card className={`flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/60 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-300 ${meta.reminderMode === "live" ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-300" : ""}`}>
        <div>
          <div className="font-semibold">
            {meta.reminderMode === "live" ? "Live WhatsApp reminders enabled" : "Reminder dry-run"}
          </div>
          <div className="mt-0.5 opacity-80">
            {meta.reminderMode === "live"
              ? "Approved template + opt-in customers only. One reminder per customer per IST day."
              : meta.reminderConfigured
                ? "WhatsApp credentials detected, but live sending is still disabled (PAYMENT_REMINDER_LIVE is off). One preview row per customer per IST day."
                : "WhatsApp Cloud API is not configured yet, so nothing is sent. Previews are logged daily at 10:00 IST so you can verify the message and contact gaps."}
          </div>
        </div>
        {canAccounts && (
          <button
            onClick={onRun}
            disabled={running}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Running…" : "Log today's dry-run"}
          </button>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="px-4 py-3"><MiniStat label="Overdue customers" value={String(eligible.length)} /></Card>
        <Card className="px-4 py-3"><MiniStat label="Has phone" value={String(withPhone.length)} /></Card>
        <Card className="px-4 py-3"><MiniStat label="WhatsApp opt-in" value={String(optedIn.length)} /></Card>
        <Card className="px-4 py-3"><MiniStat label={`Logged ${shortDate(meta.reminderRunDay)}`} value={String(previews.length)} /></Card>
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search customer, phone, invoice, status…" />
        <div className="flex-1" />
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {filtered.length} of {reminders.length} reminders · eligible amount {formatINR(withPhone.reduce((s, c) => s + c.netDue, 0), false)}
        </span>
      </Card>

      {reminders.length === 0 ? (
        <EmptyState
          title="No reminder previews yet"
          hint={canAccounts
            ? "The daily dry-run logs at 10:00 IST, or use the button above to log today's preview now. Add customer phone numbers from Customer Ageing to make a customer eligible."
            : "The accounts team runs the daily reminder preview at 10:00 IST. Add phone + WhatsApp opt-in details from the Customer Ageing tab."}
        />
      ) : (
        <TableShell minWidth={1100}>
          <thead>
            <tr>
              <th className={TH}>Logged</th>
              <th className={TH}>Customer</th>
              <th className={TH}>Phone</th>
              <th className={THR}>Amount</th>
              <th className={THR}>Invoices</th>
              <th className={TH}>Oldest due</th>
              <th className={TH}>Status</th>
              <th className={TH}>Message preview</th>
              <th className={TH}>Trigger</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((r) => (
              <tr key={r.id} className="even:bg-zinc-50/50 hover:bg-indigo-50/40 dark:even:bg-zinc-900/20 dark:hover:bg-indigo-500/5">
                <td className={`${TD} whitespace-nowrap`}>{r.createdAt ? r.createdAt.slice(0, 16).replace("T", " ") : shortDate(r.runDay)}</td>
                <td className={`${TD} max-w-[220px] truncate font-medium text-zinc-800 dark:text-zinc-200`} title={r.customerName}>{r.customerName}</td>
                <td className={`${TD} whitespace-nowrap font-mono`}>{r.phone || "—"}</td>
                <td className={`${TDR} font-medium`}>{formatINR(r.amount, false)}</td>
                <td className={TDR}>{r.invoiceCount}</td>
                <td className={`${TD} whitespace-nowrap`}>{shortDate(r.oldestDueDate)}</td>
                <td className={TD}>
                  <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-[11px] ${statusStyle(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                  {r.error && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400" title={r.error}>!</span>}
                </td>
                <td className={`${TD} max-w-[420px] truncate`} title={r.message}>{r.message}</td>
                <td className={`${TD} whitespace-nowrap capitalize`}>{r.trigger}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">No reminders match the search.</td></tr>
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
