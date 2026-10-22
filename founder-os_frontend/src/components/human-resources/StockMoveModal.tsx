"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import {
  EXPENSE_TYPES, EXPENSE_TYPE_LABEL, INVENTORY_MOVE_LABEL, PAYMENT_MODES, PAYMENT_MODE_LABEL,
  type ExpenseType, type HrInventoryItem, type InventoryMoveType, type PaymentMode,
} from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { qty, todayIST } from "@/hr/format";

export default function StockMoveModal({ item, mode, onClose, onSaved }: {
  item: HrInventoryItem;
  mode: InventoryMoveType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [txnDate, setTxnDate] = useState(todayIST());
  const [notes, setNotes] = useState("");
  const [logExpense, setLogExpense] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseType, setExpenseType] = useState<ExpenseType>("variable");
  const [expenseCategory, setExpenseCategory] = useState(item.category ?? "");
  const [paymentMode, setPaymentMode] = useState<PaymentMode | "">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onQuantity = (v: string) => {
    setQuantity(v);
    if (mode === "purchase" && logExpense && item.unitCost != null) {
      setExpenseAmount(String(Math.round((Number(v) || 0) * item.unitCost * 100) / 100));
    }
  };

  const toggleExpense = (checked: boolean) => {
    setLogExpense(checked);
    if (checked && !expenseAmount && item.unitCost != null) {
      setExpenseAmount(String(Math.round((Number(quantity) || 0) * item.unitCost * 100) / 100));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(quantity);
    if (!Number.isFinite(n) || n === 0) { setErr("Enter a non-zero quantity"); return; }
    if (mode !== "adjustment" && n < 0) { setErr("Quantity must be greater than 0"); return; }
    if (mode === "consumption" && Math.abs(n) > item.currentQty) {
      setErr(`Only ${qty(item.currentQty, item.unit)} in stock`);
      return;
    }
    if (mode === "purchase" && logExpense && (!Number(expenseAmount) || Number(expenseAmount) <= 0)) {
      setErr("Enter the purchase amount to record as an expense");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const body: Record<string, unknown> = {
        itemId: item.id,
        txnType: mode,
        quantity: n,
        txnDate,
        notes: notes.trim() || null,
        logExpense: mode === "purchase" && logExpense,
      };
      if (mode === "purchase" && logExpense) {
        body.expenseAmount = Number(expenseAmount);
        body.expenseType = expenseType;
        body.expenseCategory = expenseCategory.trim() || null;
        body.paymentMode = paymentMode || null;
      }
      const res = await jsonRequest("/api/human-resources/inventory/transactions", "POST", body);
      if (!res.ok) throw new Error(await readError(res));
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  };

  const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
  const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";
  const title = mode === "purchase" ? `Stock in · ${item.name}` : mode === "consumption" ? `Use stock · ${item.name}` : `Adjust stock · ${item.name}`;

  return (
    <Modal title={title} subtitle={`Available: ${qty(item.currentQty, item.unit)} · reorder at ${qty(item.reorderLevel, item.unit)}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>{mode === "adjustment" ? "Quantity (+ or −)" : "Quantity"}</label>
            <input value={quantity} onChange={(e) => onQuantity(e.target.value)} inputMode="decimal" placeholder={`In ${item.unit}`} className={field} autoFocus />
          </div>
          <div>
            <label className={label}>Date</label>
            <input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className={field} />
          </div>
        </div>
        <div>
          <label className={label}>Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={mode === "consumption" ? "Where or why it was used" : "Supplier, bill number or correction reason"} className={field} />
        </div>

        {mode === "purchase" && (
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input type="checkbox" checked={logExpense} onChange={(e) => toggleExpense(e.target.checked)} className="accent-indigo-600" />
              Also record this stock-in as an expense
            </label>
            {logExpense && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className={label}>Amount (₹)</label>
                  <input value={expenseAmount} onChange={(e) => setExpenseAmount(e.target.value)} inputMode="decimal" className={field} />
                </div>
                <div>
                  <label className={label}>Expense type</label>
                  <select value={expenseType} onChange={(e) => setExpenseType(e.target.value as ExpenseType)} className={field}>
                    {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{EXPENSE_TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Category</label>
                  <input value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} className={field} />
                </div>
                <div>
                  <label className={label}>Payment mode</label>
                  <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as PaymentMode | "")} className={field}>
                    <option value="">Not specified</option>
                    {PAYMENT_MODES.map((m) => <option key={m} value={m}>{PAYMENT_MODE_LABEL[m]}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? "Saving…" : INVENTORY_MOVE_LABEL[mode]}</button>
        </div>
      </form>
    </Modal>
  );
}
