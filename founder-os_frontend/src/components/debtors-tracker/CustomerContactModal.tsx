"use client";

import { useState } from "react";
import type { CustomerAgeingRow } from "@/debtors-tracker/types";
import { formatINR } from "@/debtors-tracker/types";
import { saveCustomerContact } from "@/debtors-tracker/api";
import { REGIONS } from "@/telecalling/regions";

/** Customer contact master: phone/email/notes for all tracker viewers; region + opt-in accounts only. */
export default function CustomerContactModal({
  customer, canAccounts, onClose, onSaved,
}: {
  customer: CustomerAgeingRow | null;
  canAccounts: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [region, setRegion] = useState(customer?.region ?? "");
  const [optIn, setOptIn] = useState(!!customer?.whatsappOptIn);
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!customer) return null;

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await saveCustomerContact(customer.customerKey, {
        phone,
        email,
        notes,
        ...(canAccounts ? { region, whatsappOptIn: optIn } : {}),
      });
      onSaved(`Contact saved for ${customer.customerName}.`);
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
              {customer.phone ? ` · ${customer.phone}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">Close</button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          One contact per customer (normalized name). {canAccounts
            ? "Region applies to every invoice for the customer. Used by the daily WhatsApp reminder dry-run; email is stored for reference only — nothing is emailed from this dashboard."
            : "Fix the phone/email/notes so the follow-up team can reach the client. Region and WhatsApp opt-in are managed by accounts."}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">Phone (WhatsApp)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98765 43210"
              inputMode="tel"
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-800 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">Email (store only)</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="accounts@customer.com"
              inputMode="email"
              className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-800 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            />
          </label>
          {canAccounts && (
            <label className="space-y-1 sm:col-span-2">
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">Region</span>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-800 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                <option value="">Unassigned</option>
                {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.name}</option>)}
              </select>
            </label>
          )}
        </div>

        {canAccounts ? (
          <label className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">WhatsApp opt-in recorded</span>
              <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                Required before a live business-initiated reminder can be sent. Dry-run previews are logged regardless.
              </span>
            </span>
          </label>
        ) : (
          <p className="rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Region{region ? ` (${region})` : ""} and WhatsApp opt-in{optIn ? " (recorded)" : " (not recorded)"} are managed by accounts.
          </p>
        )}

        <label className="block space-y-1">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Accounts note (optional)"
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
            {busy ? "Saving…" : "Save contact"}
          </button>
        </div>
      </div>
    </div>
  );
}
