"use client";

import { useState } from "react";
import type { LiveInvoice } from "@/payment-tracker/types";
import { formatINR } from "@/payment-tracker/types";
import { patchInvoice, deleteInvoice, FOLLOW_UP_FIELDS, type InvoiceEditableField } from "@/payment-tracker/api";
import { REGIONS } from "@/telecalling/regions";

interface Props {
  invoice: LiveInvoice | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  /** Accounts users edit everything; sales edit follow-up fields only. */
  canAccounts: boolean;
}

interface FieldSpec {
  key: InvoiceEditableField;
  label: string;
  placeholder?: string;
  type?: "text" | "date";
  wide?: boolean;
}

const FIELDS: FieldSpec[] = [
  { key: "contactName", label: "Contact Name" },
  { key: "contactPhone", label: "Contact Number" },
  { key: "contactMail", label: "Mail ID" },
  { key: "lastCallDate", label: "Last Call Date", type: "date" },
  { key: "callStatus", label: "Call Status" },
  { key: "paymentStatus", label: "Payment Status" },
  { key: "accountStatus", label: "Status" },
  { key: "mis", label: "MIS" },
  { key: "employee", label: "Employee / Owner" },
  { key: "state", label: "State" },
  { key: "region", label: "Region (customer-wide)" },
  { key: "ledgerLink", label: "Ledger Link" },
  { key: "remarks", label: "Remarks", wide: true },
  { key: "accountsRemarks", label: "Accounts Remarks", wide: true },
];

/**
 * Row editor for the fields the paste does NOT carry (contact, call/payment
 * status, owner, state/region, remarks…). Money columns stay import-owned.
 */
export default function InvoiceEditModal({ invoice, onClose, onSaved, canAccounts }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of FIELDS) out[f.key] = String((invoice as any)?.[f.key] ?? "");
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!invoice) return null;

  const set = (key: string, value: string) => setValues({ ...values, [key]: value });

  const visibleFields = canAccounts
    ? FIELDS
    : FIELDS.filter((f) => (FOLLOW_UP_FIELDS as readonly string[]).includes(f.key));

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const patch: Record<string, string> = {};
      for (const f of visibleFields) patch[f.key] = values[f.key] ?? "";
      await patchInvoice(invoice.id, patch);
      onSaved(`Invoice ${invoice.invoiceNo} updated.`);
    } catch (e: any) {
      setErr(e?.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete invoice ${invoice.invoiceNo} (${invoice.customerName})? Its collections will become unmatched.`)) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteInvoice(invoice.id);
      onSaved(`Invoice ${invoice.invoiceNo} deleted.`);
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 py-8 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {invoice.customerName}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Invoice <span className="font-mono">{invoice.invoiceNo}</span>
              {" · "}Amount {formatINR(invoice.invoiceAmount, false)}
              {" · "}Effective received {formatINR(invoice.effectiveReceived, false)}
              {" · "}Balance {formatINR(invoice.balance, false)}
              {" · "}Due {invoice.dueDate ?? "—"}
            </p>
          </div>
          <button onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Close</button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {canAccounts
            ? "Money columns (amount, received, balance) stay import-owned — re-paste the ageing sheet to change them. These fields are manual; region is shared by every invoice for this customer."
            : "Sales follow-up only: last call date, call status, payment status and remarks. Contacts and money columns are managed by accounts."}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visibleFields.map((f) => (
            <label key={f.key} className={f.wide ? "sm:col-span-2 space-y-1" : "space-y-1"}>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{f.label}</span>
              {f.key === "region" ? (
                <select
                  value={values[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:border-sky-500"
                >
                  <option value="">Unassigned</option>
                  {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.name}</option>)}
                </select>
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 text-sm text-zinc-800 dark:text-zinc-200 outline-none focus:border-sky-500"
                />
              )}
            </label>
          ))}
        </div>

        {err && <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{err}</div>}

        <div className="flex items-center gap-3">
          {canAccounts && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-rose-300 dark:border-rose-800 px-4 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
            >
              Delete invoice
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">Cancel</button>
          <button
            onClick={save}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${busy ? "bg-zinc-400 dark:bg-zinc-700 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-500"}`}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
