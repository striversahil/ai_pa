"use client";

import { useState } from "react";
import type { CustomerAgeingRow } from "@/debtors-tracker/types";
import { CUSTOMER_SITUATIONS, CUSTOMER_SITUATION_LABELS, formatINR } from "@/debtors-tracker/types";
import { saveCustomerSituation } from "@/debtors-tracker/api";

/** CRM + accounts: situation dropdown + free-text remarks for one customer. */
export default function CustomerSituationModal({
  customer, onClose, onSaved,
}: {
  customer: CustomerAgeingRow | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [situation, setSituation] = useState(customer?.situation ?? "");
  const [remarks, setRemarks] = useState(customer?.situationRemarks ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!customer) return null;

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await saveCustomerSituation(customer.customerKey, { situation, situationRemarks: remarks });
      const label = (CUSTOMER_SITUATION_LABELS as Record<string, string>)[situation] ?? "Unset";
      onSaved(`Situation saved for ${customer.customerName} — ${label}.`);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 py-8 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{customer.customerName}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Net due {formatINR(customer.netDue, false)} · {customer.invoiceCount} invoice{customer.invoiceCount === 1 ? "" : "s"}
            </p>
          </div>
          <button onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Close</button>
        </div>

        <label className="block space-y-1">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Client situation</span>
          <select
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-800 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <option value="">Unset</option>
            {CUSTOMER_SITUATIONS.map((s) => (
              <option key={s} value={s}>{CUSTOMER_SITUATION_LABELS[s]}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">CRM remarks</span>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            placeholder="e.g. promised to pay by Friday, dispute reason, next call plan…"
            className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-800 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
        </label>

        {err && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">{err}</div>}

        <div className="flex items-center gap-3">
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">Cancel</button>
          <button
            onClick={save}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${busy ? "cursor-not-allowed bg-zinc-400 dark:bg-zinc-700" : "bg-indigo-600 hover:bg-indigo-500"}`}
          >
            {busy ? "Saving…" : "Save situation"}
          </button>
        </div>
      </div>
    </div>
  );
}
