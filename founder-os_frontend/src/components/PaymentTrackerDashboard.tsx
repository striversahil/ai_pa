"use client";

import { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import type {
  CustomerAgeingRow, LiveCollection, LiveInvoice, PaymentTrackerPayload, SummaryRow,
} from "@/payment-tracker/types";
import { BUCKET_LABELS, formatINR, formatDays, shortDate } from "@/payment-tracker/types";
import ImportModal, { type ImportKind } from "./payment-tracker/ImportModal";

type View = "summary" | "ageing" | "invoices" | "collections";

const TABS: { key: View; label: string }[] = [
  { key: "summary", label: "Summary (Horizontal)" },
  { key: "ageing", label: "Customer Ageing" },
  { key: "invoices", label: "Invoices" },
  { key: "collections", label: "Collections" },
];

/** The five due-buckets in display order (gross due columns). */
const DUE_COLS: { label: string; pick: (r: CustomerAgeingRow) => number }[] = [
  { label: BUCKET_LABELS.D0, pick: (r) => r.bucket0to30 },
  { label: BUCKET_LABELS.D31, pick: (r) => r.bucket31to60 },
  { label: BUCKET_LABELS.D61, pick: (r) => r.bucket61to90 },
  { label: BUCKET_LABELS.D91, pick: (r) => r.bucket91to180 },
  { label: BUCKET_LABELS.D181, pick: (r) => r.bucketAbove180 },
];

export default function PaymentTrackerDashboard() {
  const dash = useLiveDashboard<PaymentTrackerPayload>(
    () => fetch("/api/payment-tracker/data", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
      return r.json() as Promise<PaymentTrackerPayload>;
    }),
  );
  const [view, setView] = useState<View>("summary");
  const [importKind, setImportKind] = useState<ImportKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const data = dash.data ?? null;
  const loading = dash.loading && !data;
  const errorMsg = dash.error ? String(dash.error) : null;

  return (
    <div className="px-4 md:px-8 py-6 space-y-4 text-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-medium">Payment Tracker</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Pending payments control desk{data ? ` · as of ${data.meta.asOfIST} · ${data.summary.invoiceCount} invoices · ${data.summary.customerCount} customers` : ""}
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setImportKind("debtors")}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white"
        >
          Paste Debtors Data
        </button>
        <button
          onClick={() => setImportKind("collections")}
          className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-sm font-medium text-white"
        >
          Paste Collection Received
        </button>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              view === t.key
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
          <span>{toast}</span>
          <button onClick={() => setToast(null)} className="text-emerald-600 dark:text-emerald-400">✕</button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-2 text-sm text-rose-700 dark:text-rose-300">{errorMsg}</div>
      )}
      {loading && <div className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading payment tracker…</div>}

      {data && view === "summary" && <SummaryTab summary={data.summary} />}
      {data && view === "ageing" && <AgeingTab customers={data.customers} />}
      {data && view === "invoices" && <InvoicesTab invoices={data.invoices} />}
      {data && view === "collections" && <CollectionsTab collections={data.collections} />}

      <ImportModal
        kind={importKind}
        onClose={() => setImportKind(null)}
        onDone={(msg) => {
          setImportKind(null);
          setToast(msg);
          dash.refresh();
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary (Horizontal) — the founder's SUMMARY block, laid out as a
// horizontal strip of stat cards + bucket rows.
// ─────────────────────────────────────────────────────────────────────────────

function SummaryTab({ summary }: { summary: SummaryRow }) {
  const s = summary;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Total Debtors Receivable" value={formatINR(s.totalReceivable, false)} tone="text-zinc-900 dark:text-zinc-100" big />
        <StatCard label="Not Due" value={formatINR(s.notDue)} tone="text-sky-600 dark:text-sky-400" big />
        <StatCard label="Gross Due / Overdue" value={formatINR(s.grossDue, false)} tone="text-rose-600 dark:text-rose-400" big />
        <StatCard label="Advance Received" value={formatINR(s.advanceReceived)} tone="text-emerald-600 dark:text-emerald-400" big />
        <StatCard label="Net Due / Overdue (after Advance)" value={formatINR(s.netDue, false)} tone="text-amber-600 dark:text-amber-400" big />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="0–30 Days" value={formatINR(s.bucket0to30)} tone="text-zinc-700 dark:text-zinc-300" />
        <StatCard label="31–60 Days" value={formatINR(s.bucket31to60)} tone="text-zinc-700 dark:text-zinc-300" />
        <StatCard label="61–90 Days" value={formatINR(s.bucket61to90)} tone="text-zinc-700 dark:text-zinc-300" />
        <StatCard label="91–180 Days" value={formatINR(s.bucket91to180)} tone="text-orange-600 dark:text-orange-400" />
        <StatCard label="Above 180 Days" value={formatINR(s.bucketAbove180)} tone="text-rose-600 dark:text-rose-400" />
      </div>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 p-4 flex flex-wrap gap-6 text-sm">
        <MiniStat label="Above 90 Days total" value={formatINR(s.above90Total, false)} />
        <MiniStat label="Invoices" value={String(s.invoiceCount)} />
        <MiniStat label="Customers" value={String(s.customerCount)} />
        <MiniStat label="Collections ledger entries" value={String(s.collectionCount)} />
      </div>
    </div>
  );
}

function StatCard({ label, value, tone, big }: { label: string; value: string; tone?: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 p-4">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-1 font-semibold tabular-nums ${big ? "text-xl" : "text-lg"} ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-zinc-500 dark:text-zinc-400">{label}: </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer Ageing — the customer × bucket grid (mirrors the founder's second
// table), sorted by gross due desc.
// ─────────────────────────────────────────────────────────────────────────────

function AgeingTab({
  customers,
}: {
  customers: CustomerAgeingRow[];
}) {
  const [sortKey, setSortKey] = useState<"grossDue" | "totalReceivable" | "netDue">("grossDue");
  const sorted = useMemo(
    () => [...customers].sort((a, b) => b[sortKey] - a[sortKey]),
    [customers, sortKey],
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="px-3 py-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        Sorted by
        {(["grossDue", "totalReceivable", "netDue"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSortKey(k)}
            className={`rounded px-2 py-0.5 ${sortKey === k ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" : "hover:text-zinc-800 dark:hover:text-zinc-200"}`}
          >
            {k === "grossDue" ? "Gross Due" : k === "totalReceivable" ? "Total Receivable" : "Net Due"}
          </button>
        ))}
      </div>
      <table className="w-full text-xs min-w-[980px]">
        <thead>
          <tr className="text-left text-zinc-500 dark:text-zinc-400 border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Customer / Debtor</th>
            <th className="px-3 py-2 text-right">Total Receivable</th>
            <th className="px-3 py-2 text-right">Not Due</th>
            {DUE_COLS.map((c) => <th key={c.label} className="px-3 py-2 text-right whitespace-nowrap">{c.label}</th>)}
            <th className="px-3 py-2 text-right">Gross Due/Overdue</th>
            <th className="px-3 py-2 text-right">Advance Received</th>
            <th className="px-3 py-2 text-right">Net Due/Overdue</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.customerName} className="border-t border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
              <td className="px-3 py-2 text-zinc-400">{i + 1}</td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 max-w-[260px] truncate" title={r.customerName}>{r.customerName}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(r.totalReceivable, false)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-sky-600 dark:text-sky-400">{formatINR(r.notDue)}</td>
              {DUE_COLS.map((c) => (
                <td key={c.label} className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{formatINR(c.pick(r))}</td>
              ))}
              <td className="px-3 py-2 text-right tabular-nums font-medium text-rose-600 dark:text-rose-400">{formatINR(r.grossDue, false)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{formatINR(r.advanceReceived)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">{formatINR(r.netDue, false)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={11} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
              No debtor data yet — use “Paste Debtors Data” to import the ageing sheet.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoices — per-invoice drill-down with bucket / customer / search filters.
// ─────────────────────────────────────────────────────────────────────────────

function InvoicesTab({ invoices }: { invoices: LiveInvoice[] }) {
  const [bucket, setBucket] = useState<string>("ALL");
  const [q, setQ] = useState("");
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
      .sort((a, b) =>
        (b.daysOverdue ?? -1e9) - (a.daysOverdue ?? -1e9) ||
        b.balance - a.balance);
  }, [invoices, bucket, q]);

  const bucketChips = ["ALL", "NOT_DUE", "D0", "D31", "D61", "D91", "D181", "PAID"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customer / invoice / employee / state…"
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-sm w-72 outline-none focus:border-sky-500"
        />
        {bucketChips.map((b) => (
          <button
            key={b}
            onClick={() => setBucket(b)}
            className={`rounded-full px-3 py-1 ${
              bucket === b
                ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/40"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {b === "ALL" ? "All" : BUCKET_LABELS[b as keyof typeof BUCKET_LABELS] ?? b}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-zinc-400">{filtered.length} of {invoices.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs min-w-[1050px]">
          <thead>
            <tr className="text-left text-zinc-500 dark:text-zinc-400 border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Invoice</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2 text-right">Days</th>
              <th className="px-3 py-2">Bucket</th>
              <th className="px-3 py-2">Call / Payment Status</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">State / Region</th>
              <th className="px-3 py-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((inv) => (
              <tr key={inv.id} className="border-t border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 max-w-[200px] truncate" title={inv.customerName}>{inv.customerName}</td>
                <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400 max-w-[130px] truncate">{inv.invoiceNo}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{shortDate(inv.invoiceDate)}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{shortDate(inv.dueDate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatINR(inv.invoiceAmount, false)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatINR(inv.effectiveReceived)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${inv.balance < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-800 dark:text-zinc-200"}`}>{formatINR(inv.balance, false)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${(inv.daysOverdue ?? 0) > 90 ? "text-rose-600 dark:text-rose-400" : "text-zinc-500 dark:text-zinc-400"}`}>{formatDays(inv.daysOverdue)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-[11px] ${bucketBadge(inv.bucket)}`}>{BUCKET_LABELS[inv.bucket]}</span>
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400 max-w-[200px] truncate" title={[inv.callStatus, inv.paymentStatus, inv.lastCallDate].filter(Boolean).join(" · ")}>
                  {[inv.callStatus, inv.paymentStatus].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{inv.employee || "—"}</td>
                <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">{[inv.state, inv.region].filter(Boolean).join(" / ") || "—"}</td>
                <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400 max-w-[240px] truncate" title={[inv.remarks, inv.accountsRemarks].filter(Boolean).join(" · ")}>
                  {[inv.remarks, inv.accountsRemarks].filter(Boolean).join(" · ") || "—"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={13} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">No invoices match the current filter.</td></tr>
            )}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <div className="px-3 py-2 text-xs text-zinc-400 border-t border-zinc-100 dark:border-zinc-800/50">
            Showing first 500 of {filtered.length} — refine the filter to see more.
          </div>
        )}
      </div>
    </div>
  );
}

function bucketBadge(b: LiveInvoice["bucket"]): string {
  switch (b) {
    case "NOT_DUE": return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "D0": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "D31": return "bg-lime-500/10 text-lime-700 dark:text-lime-400";
    case "D61": return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "D91": return "bg-orange-500/10 text-orange-700 dark:text-orange-400";
    case "D181": return "bg-rose-500/10 text-rose-600 dark:text-rose-400";
    default: return "bg-zinc-400/10 text-zinc-500 dark:text-zinc-400";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Collections — the live receipts ledger (credit notes negative = debit).
// ─────────────────────────────────────────────────────────────────────────────

function CollectionsTab({ collections }: { collections: LiveCollection[] }) {
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

  const matchBadge = (status: string) => {
    switch (status) {
      case "invoice": return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
      case "customer": return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
      default: return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    }
  };
  const matchLabel = (status: string) =>
    status === "invoice" ? "By invoice" : status === "customer" ? "By customer (oldest open)" : "Unmatched";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search customer / invoice / mode / remarks…"
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-sm w-72 outline-none focus:border-sky-500"
        />
        <div className="flex-1" />
        <span className="text-zinc-400">{filtered.length} of {collections.length}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="text-left text-zinc-500 dark:text-zinc-400 border-y border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/80">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Invoice No.</th>
              <th className="px-3 py-2 text-right">Amount Received</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2">Remarks</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Imported</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((c) => (
              <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-900/60">
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">{shortDate(c.collectionDate)}</td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300 max-w-[220px] truncate" title={c.customerName}>{c.customerName}</td>
                <td className="px-3 py-2 font-mono text-zinc-600 dark:text-zinc-400 max-w-[150px] truncate">{c.invoiceNo || "—"}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${c.amount < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                  {formatINR(c.amount, false)}
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{c.mode || "—"}</td>
                <td className="px-3 py-2 text-zinc-500 dark:text-zinc-500 max-w-[280px] truncate" title={c.remarks}>{c.remarks || "—"}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-[11px] ${matchBadge(c.matchStatus)}`}>{matchLabel(c.matchStatus)}</span>
                </td>
                <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">{c.createdAt}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-zinc-500 dark:text-zinc-400">
                No collections yet — use “Paste Collection Received” to import the receipts sheet.
              </td></tr>
            )}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <div className="px-3 py-2 text-xs text-zinc-400 border-t border-zinc-100 dark:border-zinc-800/50">
            Showing first 500 of {filtered.length} — refine the search to see more.
          </div>
        )}
      </div>
    </div>
  );
}
