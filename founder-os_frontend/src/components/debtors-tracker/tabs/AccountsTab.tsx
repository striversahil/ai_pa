"use client";

import type { ImportKind } from "../ImportModal";
import { Card } from "../ui";

const DEBTOR_COLUMNS = [
  "Customer Name", "Invoice No.", "Invoice Date", "Credit Period (Days)",
  "Due Date", "Invoice Amount", "Amount Received", "Balance Receivable",
];

const COLLECTION_COLUMNS = [
  "Collection Date", "Customer Name", "Invoice No.", "Amount Received",
  "Mode of Receipt", "Remarks", "Receipt No. / Txn ID (optional)",
];

const AUTOMATIC = [
  "Due date — from the invoice date + credit period when the sheet omits it",
  "Age, days overdue and the ageing bucket (Not Due / 0–30 / 31–60 / 61–90 / 91–180 / 180+)",
  "Due month and invoice/due week-start helpers",
  "Effective received = the greater of the sheet's received money and the receipts history (paste either sheet first)",
  "Advance receipts (invoice no “Advance”) count as customer advances and reduce Net Due",
  "Collections matched by invoice no, else the customer's oldest open invoice",
  "Customer contacts (phone / email / region / WhatsApp opt-in) are stored once per normalized customer name; region is mirrored onto every invoice",
];

export default function AccountsTab({
  invoiceCount, collectionCount, customerCount, lastImportAt, lastCollectionDate,
  onImport, onReset, resetting,
}: {
  invoiceCount: number;
  collectionCount: number;
  customerCount: number;
  lastImportAt: string | null;
  lastCollectionDate: string | null;
  onImport: (kind: ImportKind) => void;
  onReset: () => void;
  resetting: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-500/10 via-transparent to-emerald-500/10 px-5 py-5 dark:from-indigo-500/10 dark:to-emerald-500/10">
          <h2 className="text-base font-medium text-zinc-900 dark:text-zinc-100">Accounts desk</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Paste the two accounts sheets here. Ageing, due dates and every helper column are calculated
            automatically — you only need the columns listed below.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            </svg>
            Only accounts-scope users can import, edit or delete this data.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:max-w-md">
            <HeaderStat label="Invoices" value={invoiceCount} />
            <HeaderStat label="Customers" value={customerCount} />
            <HeaderStat label="Receipts" value={collectionCount} />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <PasteCard
          tone="indigo"
          title="Debtors ageing sheet"
          description="The outstanding list from Tally / Zoho. Re-pasting updates existing invoices; the same invoice no. under another customer is reported as a conflict instead of being merged."
          columns={DEBTOR_COLUMNS}
          lastLabel={lastImportAt ? `Last import ${lastImportAt}` : "No debtor data yet"}
          button="Paste debtors data"
          onClick={() => onImport("debtors")}
        />
        <PasteCard
          tone="emerald"
          title="Collections received"
          description="Receipts from the accounts team. Each row is matched to an invoice and immediately reflected in the live balance; “Advance” rows are counted as customer advances. Re-pasting is idempotent (receipt no. first)."
          columns={COLLECTION_COLUMNS}
          lastLabel={lastCollectionDate ? `Latest receipt ${lastCollectionDate}` : "No collections recorded yet"}
          button="Paste collection received"
          onClick={() => onImport("collections")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Calculated for you</h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {AUTOMATIC.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="border-rose-200/70 p-5 lg:col-span-2 dark:border-rose-900/50">
          <h3 className="text-sm font-medium text-rose-700 dark:text-rose-300">Danger zone</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Wipes every invoice and collection, then starts fresh. Use this before pasting a completely new
            dataset; normal sheet updates do not need a reset.
          </p>
          <button
            onClick={onReset}
            disabled={resetting}
            className="mt-3 rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            {resetting ? "Resetting…" : "Reset all data"}
          </button>
        </Card>
      </div>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200/70 bg-white/70 px-3 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">{value}</div>
    </div>
  );
}

function PasteCard({
  tone, title, description, columns, lastLabel, button, onClick,
}: {
  tone: "indigo" | "emerald";
  title: string;
  description: string;
  columns: string[];
  lastLabel: string;
  button: string;
  onClick: () => void;
}) {
  const styles = tone === "indigo"
    ? { accent: "text-indigo-600 dark:text-indigo-400", dot: "bg-indigo-500", btn: "bg-indigo-600 hover:bg-indigo-500" }
    : { accent: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500", btn: "bg-emerald-600 hover:bg-emerald-500" };
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
            {title}
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {columns.map((c) => (
          <span key={c} className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{c}</span>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800/70">
        <span className={`text-[11px] ${styles.accent}`}>{lastLabel}</span>
        <button onClick={onClick} className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${styles.btn}`}>{button}</button>
      </div>
    </Card>
  );
}
