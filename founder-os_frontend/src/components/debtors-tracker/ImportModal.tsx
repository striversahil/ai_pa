"use client";

import { useMemo, useState } from "react";
import {
  parseCollectionsTsv, parseDebtorsTsv, type DebtorRow, type CollectionRow,
} from "@/debtors-tracker/parse";
import { formatINR } from "@/debtors-tracker/types";
import { importChunk, type ImportKind as ApiImportKind, type ImportReport } from "@/debtors-tracker/api";

/**
 * Paste-import modal for the Debtors Tracker (Excel copy → TSV → preview →
 * confirm). Preview runs the FRONTEND parser (mirror of the backend parser)
 * so what you see is exactly what the import will upsert.
 */
export type ImportKind = ApiImportKind;

/**
 * Apply the paste in BOUNDED slices (server cap ~1,500 rows per call) and add
 * every slice's counters up. Without this a 1,000-row paste was one ~2,000-query
 * Worker invocation: the edge killed it with a bare 503 and left half the sheet
 * applied. Each slice is idempotent, so a failed run can simply be repeated.
 */
async function runImport(
  kind: ImportKind,
  text: string,
  onProgress: (done: number, total: number) => void,
): Promise<ImportReport> {
  let acc: ImportReport = { parsed: 0, created: 0, updated: 0 };
  let cursor = 0;
  for (;;) {
    const slice = await importChunk(kind, text, cursor);
    acc = mergeReports(acc, slice);
    const total = slice.total ?? cursor + (slice.parsed ?? 0);
    cursor += slice.parsed ?? 0;
    onProgress(Math.min(cursor, total), total);
    if (slice.done !== false || !slice.parsed) return { ...acc, done: true, cursor, total };
  }
}

function mergeReports(a: ImportReport, b: ImportReport): ImportReport {
  return {
    parsed: (a.parsed ?? 0) + (b.parsed ?? 0),
    created: (a.created ?? 0) + (b.created ?? 0),
    updated: (a.updated ?? 0) + (b.updated ?? 0),
    rebooked: (a.rebooked ?? 0) + (b.rebooked ?? 0),
    restored: (a.restored ?? 0) + (b.restored ?? 0),
    pdfsRelinked: (a.pdfsRelinked ?? 0) + (b.pdfsRelinked ?? 0),
    duplicated: (a.duplicated ?? 0) + (b.duplicated ?? 0),
    merged: (a.merged ?? 0) + (b.merged ?? 0),
    matchedByInvoice: (a.matchedByInvoice ?? 0) + (b.matchedByInvoice ?? 0),
    matchedByCustomer: (a.matchedByCustomer ?? 0) + (b.matchedByCustomer ?? 0),
    advances: (a.advances ?? 0) + (b.advances ?? 0),
    unmatched: (a.unmatched ?? 0) + (b.unmatched ?? 0),
    skippedLines: (a.skippedLines ?? 0) + (b.skippedLines ?? 0),
    skipped: [...(a.skipped ?? []), ...(b.skipped ?? [])],
    conflicts: [...(a.conflicts ?? []), ...(b.conflicts ?? [])],
    cursor: b.cursor,
    total: b.total,
    done: b.done,
  };
}

interface Props {
  kind: ImportKind | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}

const TITLES: Record<ImportKind, string> = {
  debtors: "Import debtors ageing sheet",
  collections: "Import collections received",
};

const EXPECT: Record<ImportKind, string> = {
  debtors: 'Copy the ageing sheet in Excel — the header row + data rows: Customer Name, Invoice No., Invoice Date, Credit Period (Days), Due Date, Invoice Amount, Amount Received, Balance Receivable. Everything else (call status, remarks, owner, state/region…) is filled in from the dashboard row editor.',
  collections: 'Copy the collections sheet in Excel (header row + data rows: Collection Date, Customer Name, Invoice No., Amount Received, Mode of Receipt, Remarks, optional Receipt No. / Transaction ID). Re-pasting is idempotent; receipt no. is the strongest duplicate key.',
};

export default function ImportModal({ kind, onClose, onDone }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const preview = useMemo(() => {
    if (!kind) return null;
    try {
      return kind === "debtors" ? parseDebtorsTsv(text) : parseCollectionsTsv(text);
    } catch {
      return null;
    }
  }, [text, kind]);

  if (!kind) return null;

  const rows = (preview?.rows ?? []) as unknown[];
  const canSubmit = rows.length > 0 && !busy;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setProgress({ done: 0, total: rows.length });
    let saved = 0;
    try {
      const r = await runImport(kind, text, (done) => {
        saved = done;
        setProgress({ done, total: rows.length });
      });
      const restored = r.restored ? `, ${r.restored} restored` : "";
      const merged = r.merged ? `, ${r.merged} advance duplicate${r.merged === 1 ? "" : "s"} merged` : "";
      const conflicts = r.conflicts?.length ? `, ${r.conflicts.length} invoice-no conflicts flagged (not merged)` : "";
      const msg = kind === "debtors"
        ? `Debtors imported — ${r.created ?? 0} new, ${r.updated ?? 0} updated${restored}${r.rebooked ? `, ${r.rebooked} collections re-booked` : ""}${r.pdfsRelinked ? `, ${r.pdfsRelinked} invoice PDF${r.pdfsRelinked === 1 ? "" : "s"} re-linked` : ""}${conflicts}${r.skippedLines ? `, ${r.skippedLines} lines skipped` : ""}.`
        : `Collections imported — ${r.created ?? 0} new, ${r.duplicated ?? 0} duplicates skipped${merged}${restored}, ${r.matchedByInvoice ?? 0} by invoice no, ${r.matchedByCustomer ?? 0} by customer fallback, ${r.advances ?? 0} customer advances, ${r.unmatched ?? 0} unmatched${conflicts}.`;
      onDone(msg);
    } catch (e: any) {
      const partial = saved > 0 ? `${saved} of ${rows.length} rows are saved — ` : "";
      setErr(`${partial}${e?.message ?? "Import failed"}. Press Import again; saved rows just update.`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 py-8 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{TITLES[kind]}</h2>
          <button onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Close</button>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{EXPECT[kind]}</p>

        <textarea
          className="w-full rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-sm text-zinc-800 outline-none transition-colors focus:border-sky-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:bg-zinc-900"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ctrl+V the Excel selection here (tab-separated rows paste automatically)…"
        />

        <div className="flex items-center gap-4 text-sm">
          <span className={rows.length > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}>
            {rows.length > 0 ? `${rows.length} row${rows.length === 1 ? "" : "s"} ready to import` : "No rows parsed yet"}
          </span>
          {preview && !preview.headerRowFound && text.trim().length > 4 && (
            <span className="text-amber-600 dark:text-amber-400">Header row not detected — include the header row from Excel.</span>
          )}
          <div className="flex-1" />
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${canSubmit ? "bg-emerald-600 hover:bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-700 cursor-not-allowed"}`}
          >
            {busy
              ? (progress && progress.total > 0 ? `Importing ${progress.done}/${progress.total}…` : "Importing…")
              : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
          </button>
        </div>

        {busy && progress && progress.total > 0 && (
          <div className="h-1 w-full overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full bg-emerald-600 transition-all" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
        )}

        {err && <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{err}</div>}
        {preview && preview.skipped.length > 0 && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 max-h-24 overflow-y-auto">
            {preview.skipped.slice(0, 8).join(" · ")}{preview.skipped.length > 8 ? ` … +${preview.skipped.length - 8} more skipped lines` : ""}
          </div>
        )}

        <PreviewTable kind={kind} rows={rows} />
      </div>
    </div>
  );
}

function PreviewTable({ kind, rows }: { kind: ImportKind; rows: unknown[] }) {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, 6);
  if (kind === "debtors") {
    return (
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-zinc-500 dark:text-zinc-400">
              <th className="px-2 py-1.5">Customer</th><th className="px-2 py-1.5">Invoice</th><th className="px-2 py-1.5">Due</th>
              <th className="px-2 py-1.5 text-right">Amount</th><th className="px-2 py-1.5 text-right">Received</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const d = r as DebtorRow;
              const received = d.baseReceived > 0
                ? d.baseReceived
                : (d.balanceReceivable != null && d.invoiceAmount > 0
                  ? Math.max(0, d.invoiceAmount - d.balanceReceivable)
                  : 0);
              return (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800/50">
                  <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300 max-w-[220px] truncate">{d.customerName}</td>
                  <td className="px-2 py-1.5 font-mono text-zinc-600 dark:text-zinc-400">{d.invoiceNo}</td>
                  <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{d.dueDate ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right text-zinc-700 dark:text-zinc-300">{formatINR(d.invoiceAmount)}</td>
                  <td className="px-2 py-1.5 text-right text-zinc-600 dark:text-zinc-400">{formatINR(received)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500 dark:text-zinc-400">
            <th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Customer</th><th className="px-2 py-1.5">Invoice</th>
            <th className="px-2 py-1.5">Receipt</th>
            <th className="px-2 py-1.5 text-right">Amount</th><th className="px-2 py-1.5">Mode</th><th className="px-2 py-1.5">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            const c = r as CollectionRow;
            return (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800/50">
                <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{c.collectionDate ?? "—"}</td>
                <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-300 max-w-[220px] truncate">{c.customerName}</td>
                <td className="px-2 py-1.5 font-mono text-zinc-600 dark:text-zinc-400 max-w-[140px] truncate">{c.invoiceNo || "—"}</td>
                <td className="px-2 py-1.5 font-mono text-zinc-600 dark:text-zinc-400 max-w-[120px] truncate">{c.receiptNo || "—"}</td>
                <td className={`px-2 py-1.5 text-right ${c.amount < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{formatINR(c.amount, false)}</td>
                <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{c.mode || "—"}</td>
                <td className="px-2 py-1.5 text-zinc-500 dark:text-zinc-500 max-w-[260px] truncate">{c.remarks || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
