"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import type { HrFundTxn } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { todayIST } from "@/hr/format";

export default function FundTopupModal({ topup, onClose, onSaved }: {
  topup?: HrFundTxn | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!topup;
  const [title, setTitle] = useState(topup?.title ?? "");
  const [amount, setAmount] = useState(topup ? String(topup.amount) : "");
  const [txnDate, setTxnDate] = useState(topup?.txnDate ?? todayIST());
  const [notes, setNotes] = useState(topup?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!title.trim()) { setErr("Title is required"); return; }
    if (!Number.isFinite(n) || n <= 0) { setErr("Enter an amount greater than 0"); return; }
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        amount: n,
        txnDate,
        notes: notes.trim() || null,
      };
      const res = editing
        ? await jsonRequest(`/api/human-resources/fund-topups/${topup!.id}`, "PATCH", body)
        : await jsonRequest("/api/human-resources/fund-topups", "POST", body);
      if (!res.ok) throw new Error(await readError(res));
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
  const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

  return (
    <Modal title={editing ? "Edit funding" : "Add funding"} subtitle="Money HR receives for office expenses. The balance is funding received minus fixed + variable expenses." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Received from / note</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Office fund received" className={field} autoFocus />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Amount (₹)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className={field} />
          </div>
          <div>
            <label className={label}>Date</label>
            <input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className={field} />
          </div>
        </div>
        <div>
          <label className={label}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Reference or context" className={field} />
        </div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? "Saving…" : editing ? "Save changes" : "Add funding"}</button>
        </div>
      </form>
    </Modal>
  );
}
