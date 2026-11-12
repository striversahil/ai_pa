"use client";

// Extracted verbatim from PaymentDues.tsx by scripts/refactor/split-module.mjs.
// PaymentDues.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import { fmtDay as fmtDue } from "../payment-calendar";
import type { PaymentDueRow } from "./types";
import { Modal } from "./Modal";
import { Amount } from "./Amount";
import { inputCls } from "./helpers";

export function PayDialog({ row, busy, onClose, onPay }: {
  row: PaymentDueRow;
  busy: boolean;
  onClose: () => void;
  onPay: (amount: number, ref: string) => void;
}) {
  const [amount, setAmount] = useState(row.paidAmount ?? row.amount ?? "" as number | "");
  const [ref, setRef] = useState(row.paidRef ?? "");
  const [localErr, setLocalErr] = useState<string | null>(null);
  return (
    <Modal title={`Mark paid — ${row.title}`} onClose={onClose}>
      <p className="text-xs text-zinc-500">
        Due {fmtDue(row.dueDate)}{row.identifier ? ` · ${row.identifier}` : ""}{row.logId ? "" : " · projected cycle (paying creates it)"} · expected <Amount value={row.amount} />
        {row.statementDate && (
          <span
            className="ml-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-1.5 py-px text-[10px] font-bold text-indigo-600 dark:text-indigo-300"
            title="Statement date — the card amount is known from here, so enter the figure printed on the statement"
          >
            💳 Stmt {fmtDue(row.statementDate)}
          </span>
        )}
      </p>
      <label className="mt-3 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        Amount paid (₹)
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "") as any)} inputMode="decimal" className={`${inputCls} mt-1`} placeholder="e.g. 12500" />
      </label>
      <label className="mt-2 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        UTR / transaction reference (required)
        <input value={ref} onChange={(e) => setRef(e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. UTR / UPI ref no." maxLength={200} />
      </label>
      {localErr && <p className="mt-2 text-xs text-rose-500">{localErr}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">Cancel</button>
        <button
          disabled={busy}
          onClick={() => {
            const n = Number(amount);
            if (!Number.isFinite(n) || n <= 0) { setLocalErr("Enter the amount paid"); return; }
            if (!ref.trim()) { setLocalErr("Enter the UTR / transaction reference"); return; }
            onPay(Math.round(n * 100) / 100, ref.trim());
          }}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Saving…" : "Mark paid"}
        </button>
      </div>
    </Modal>
  );
}
