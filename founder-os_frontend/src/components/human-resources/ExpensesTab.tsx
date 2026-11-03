"use client";

import React, { useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import ExpenseFormModal from "./ExpenseFormModal";
import FundTopupModal from "./FundTopupModal";
import {
  EXPENSE_TYPES, EXPENSE_TYPE_LABEL, PAYMENT_MODE_LABEL,
  type ExpenseType, type HrDashboardData, type HrExpense, type HrFundTxn,
} from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { dateLabel, isOwnExpense, money } from "@/hr/format";

function SummaryCard({ label, amount, count, tone }: { label: string; amount: number; count: number; tone: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5">
      <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-lg font-extrabold ${tone}`}>{money(amount)}</div>
      <div className="text-[10px] text-zinc-500">{count} {count === 1 ? "entry" : "entries"}</div>
    </div>
  );
}

function ExpenseCard({ expense, canEdit, onEdit, onDelete }: {
  expense: HrExpense;
  canEdit: boolean;
  onEdit: (e: HrExpense) => void;
  onDelete: (e: HrExpense) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{expense.title}</h4>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${expense.expenseType === "fixed" ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400" : expense.expenseType === "field_staff" ? "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>{EXPENSE_TYPE_LABEL[expense.expenseType]}</span>
            {expense.category && <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">{expense.category}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span className="font-bold text-zinc-800 dark:text-zinc-200">{money(expense.amount)}</span>
            <span>{dateLabel(expense.expenseDate)}</span>
            {expense.paymentMode && <span>{PAYMENT_MODE_LABEL[expense.paymentMode]}</span>}
            {expense.createdBy && <span>by {expense.createdBy}</span>}
          </div>
          {expense.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">{expense.notes}</p>}
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => onEdit(expense)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Edit</button>
            <button onClick={() => onDelete(expense)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10">Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExpensesTab({ data, month, canManage, me, onRefresh }: {
  data: HrDashboardData;
  month: string;
  canManage: boolean;
  me: { user: { email: string; name: string } } | null;
  onRefresh: () => void;
}) {
  const [type, setType] = useState<ExpenseType>("fixed");
  const [form, setForm] = useState<{ open: boolean; expense: HrExpense | null }>({ open: false, expense: null });
  const [deleting, setDeleting] = useState<HrExpense | null>(null);
  const [fundForm, setFundForm] = useState<{ open: boolean; topup: HrFundTxn | null }>({ open: false, topup: null });
  const [deletingTopup, setDeletingTopup] = useState<HrFundTxn | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const lists: Record<ExpenseType, HrExpense[]> = {
    fixed: data.expenses.fixed,
    variable: data.expenses.variable,
    field_staff: data.expenses.fieldStaff,
  };
  const list = lists[type];
  const summary = data.expenses.summary;
  const fund = data.fund ?? { topups: [], summary: { topupTotal: 0, officeTotal: 0, balance: 0, topupCount: 0 } };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true); setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/expenses/${deleting.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      setDeleting(null);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  };

  const removeTopup = async () => {
    if (!deletingTopup) return;
    setBusy(true); setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/fund-topups/${deletingTopup.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      setDeletingTopup(null);
      onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* Office fund balance: lifetime funding minus lifetime fixed+variable spend */}
      <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Office balance</div>
            <div className={`mt-0.5 text-2xl font-extrabold ${fund.summary.balance < 0 ? "text-rose-500" : "text-emerald-600 dark:text-emerald-400"}`}>
              {money(fund.summary.balance)}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              Funded {money(fund.summary.topupTotal)} · Spent (office) {money(fund.summary.officeTotal)}
            </div>
          </div>
          <button onClick={() => setFundForm({ open: true, topup: null })} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white">+ Add funding</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCard label="Fixed" amount={summary.fixedTotal} count={summary.fixedCount} tone="text-indigo-500 dark:text-indigo-400" />
        <SummaryCard label="Variable" amount={summary.variableTotal} count={summary.variableCount} tone="text-amber-600 dark:text-amber-400" />
        <SummaryCard label="Field Staff" amount={summary.fieldStaffTotal} count={summary.fieldStaffCount} tone="text-sky-600 dark:text-sky-400" />
        <SummaryCard label="Total" amount={summary.total} count={summary.fixedCount + summary.variableCount + summary.fieldStaffCount} tone="text-zinc-900 dark:text-zinc-100" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {EXPENSE_TYPES.map((t) => {
            const active = type === t;
            const count = lists[t].length;
            return (
              <button key={t} onClick={() => setType(t)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${active ? "border-transparent bg-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                {EXPENSE_TYPE_LABEL[t]} ({count})
              </button>
            );
          })}
        </div>
        <button onClick={() => setForm({ open: true, expense: null })} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white">Add expense</button>
      </div>

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 px-3 py-8 text-center text-xs text-zinc-500">
          No {EXPENSE_TYPE_LABEL[type].toLowerCase()} expenses recorded for {data.expenses.month}.
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {list.map((e) => (
            <ExpenseCard
              key={e.id}
              expense={e}
              canEdit={isOwnExpense(e.createdBy, me, canManage)}
              onEdit={(expense) => setForm({ open: true, expense })}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      {fund.topups.length > 0 && (
        <details className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
          <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
            Funding history · {fund.summary.topupCount} {fund.summary.topupCount === 1 ? "entry" : "entries"} · {money(fund.summary.topupTotal)} received
          </summary>
          <div className="mt-2 space-y-1.5">
            {fund.topups.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-bold text-zinc-800 dark:text-zinc-100">{t.title}</div>
                  <div className="text-[10px] text-zinc-500">
                    {t.txnDate ? dateLabel(t.txnDate) : ""}
                    {t.createdBy ? ` · by ${t.createdBy}` : ""}
                    {t.notes ? ` · ${t.notes}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-xs font-extrabold text-emerald-600 dark:text-emerald-400">+{money(t.amount)}</span>
                {isOwnExpense(t.createdBy, me, canManage) && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => setFundForm({ open: true, topup: t })} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Edit</button>
                    <button onClick={() => setDeletingTopup(t)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10">Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {form.open && (
        <ExpenseFormModal
          expense={form.expense}
          month={month}
          initialType={type}
          onClose={() => setForm({ open: false, expense: null })}
          onSaved={onRefresh}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete expense?"
        message={<>Delete <b>{deleting?.title}</b> ({deleting ? money(deleting.amount) : ""}) from {data.expenses.month}?</>}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />

      {fundForm.open && (
        <FundTopupModal
          topup={fundForm.topup}
          onClose={() => setFundForm({ open: false, topup: null })}
          onSaved={onRefresh}
        />
      )}

      <ConfirmDialog
        open={!!deletingTopup}
        title="Delete funding entry?"
        message={<>Delete <b>{deletingTopup?.title}</b> ({deletingTopup ? money(deletingTopup.amount) : ""})? The office balance will go up by this amount.</>}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={removeTopup}
        onCancel={() => setDeletingTopup(null)}
      />
    </div>
  );
}
