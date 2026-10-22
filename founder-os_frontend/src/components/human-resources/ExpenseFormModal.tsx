"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import {
  EXPENSE_TYPES, EXPENSE_TYPE_LABEL, PAYMENT_MODES, PAYMENT_MODE_LABEL,
  type ExpenseType, type HrExpense, type PaymentMode,
} from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { defaultDateForMonth } from "@/hr/format";

export default function ExpenseFormModal({ expense, month, initialType, onClose, onSaved }: {
  expense?: HrExpense | null;
  month: string;
  initialType: ExpenseType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!expense;
  const [title, setTitle] = useState(expense?.title ?? "");
  const [expenseType, setExpenseType] = useState<ExpenseType>(expense?.expenseType ?? initialType);
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? defaultDateForMonth(month));
  const [category, setCategory] = useState(expense?.category ?? "");
  const [paymentMode, setPaymentMode] = useState<PaymentMode | "">(expense?.paymentMode ?? "");
  const [notes, setNotes] = useState(expense?.notes ?? "");
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
        expenseType,
        amount: n,
        expenseDate,
        category: category.trim() || null,
        paymentMode: paymentMode || null,
        notes: notes.trim() || null,
      };
      const res = editing
        ? await jsonRequest(`/api/human-resources/expenses/${expense!.id}`, "PATCH", body)
        : await jsonRequest("/api/human-resources/expenses", "POST", body);
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
    <Modal title={editing ? "Edit expense" : "Add expense"} subtitle="Fixed costs recur; variable costs change month to month; field staff expenses are tracked separately." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Expense</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Office rent" className={field} autoFocus />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Type</label>
            <select value={expenseType} onChange={(e) => setExpenseType(e.target.value as ExpenseType)} className={field}>
              {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{EXPENSE_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Amount (₹)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" className={field} />
          </div>
          <div>
            <label className={label}>Date</label>
            <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Payment mode</label>
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode | "")} className={field}>
              <option value="">Not specified</option>
              {PAYMENT_MODES.map((m) => <option key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Category (optional)</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Rent, utilities, hiring, travel" className={field} />
          </div>
        </div>
        <div>
          <label className={label}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Invoice number or context" className={field} />
        </div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? "Saving…" : editing ? "Save changes" : "Add expense"}</button>
        </div>
      </form>
    </Modal>
  );
}
