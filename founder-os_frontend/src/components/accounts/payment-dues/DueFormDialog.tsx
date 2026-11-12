"use client";

// Extracted verbatim from PaymentDues.tsx by scripts/refactor/split-module.mjs.
// PaymentDues.tsx re-exports everything public here, so existing imports keep working.
import { useState } from "react";
import type { PaymentDueRow } from "./types";
import { identifierMeta, inputCls, PAYMENT_CATEGORIES } from "./helpers";
import { Modal } from "./Modal";

export function DueFormDialog({ row, busy, onClose, onSave, onDelete, confirmDel, setConfirmDel }: {
  row: PaymentDueRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>, id: string | null) => void;
  onDelete: (id: string) => void;
  confirmDel: PaymentDueRow | null;
  setConfirmDel: (r: PaymentDueRow | null) => void;
}) {
  const [title, setTitle] = useState(row?.title ?? "");
  const [biller, setBiller] = useState(row?.biller ?? "");
  const [identifier, setIdentifier] = useState(row?.identifier ?? "");
  const [category, setCategory] = useState(row?.category ?? "Credit Card");
  const idMeta = identifierMeta(category);
  const [amount, setAmount] = useState(row?.amount ?? "" as number | "");
  const [frequency, setFrequency] = useState(row?.frequency ?? "monthly");
  // Schedule inputs adapt to the repeat choice (daily needs nothing, weekly
  // takes a weekday, monthly/quarterly a day-of-month, yearly a month + day).
  const initDay = row?.frequency === "weekly" ? "" : (row?.dueDay ?? "");
  const [schedDay, setSchedDay] = useState(initDay as number | "");
  const [schedMonth, setSchedMonth] = useState(row?.dueMonth ?? "" as number | "");
  const [schedWeekday, setSchedWeekday] = useState(
    row?.frequency === "weekly" && row?.dueDay !== null && row?.dueDay !== undefined ? String(row.dueDay) : "4",
  );
  const [remindDays, setRemindDays] = useState((row?.remindDays ?? [7, 3, 1]).join(","));
  const [statementDay, setStatementDay] = useState(row?.statementDay ?? "" as number | "");
  // Credit-card billing model: fixed day vs N days after the statement.
  const [dueMode, setDueMode] = useState((row as any)?.dueMode === "after_statement" ? "after_statement" : "fixed");
  const [graceDays, setGraceDays] = useState((row as any)?.graceDays ?? "" as number | "");
  const [localErr, setLocalErr] = useState<string | null>(null);
  const showDueModel = category === "Credit Card" && frequency === "monthly";
  return (
    <Modal title={row ? `Edit bill — ${row.title}` : "Add payment due"} onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 sm:col-span-2">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. HDFC Credit Card bill" maxLength={200} />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Biller
          <input value={biller} onChange={(e) => setBiller(e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. HDFC Bank" maxLength={200} />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          {idMeta.label}
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} className={`${inputCls} mt-1`} placeholder={idMeta.placeholder} maxLength={100} />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} mt-1`}>
            {PAYMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Amount (₹, expected)
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "") as any)} inputMode="decimal" className={`${inputCls} mt-1`} placeholder="Leave blank if it varies" />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Repeats
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={`${inputCls} mt-1`}>
            {["daily", "weekly", "monthly", "quarterly", "yearly"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        {frequency === "daily" && (
          <p className="self-end rounded-lg bg-zinc-100 px-3 py-2 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Runs every working day (Mon–Sat) — no date needed.
          </p>
        )}
        {frequency === "weekly" && (
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Due weekday
            <select value={schedWeekday} onChange={(e) => setSchedWeekday(e.target.value)} className={`${inputCls} mt-1`}>
              {[["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"], ["6", "Saturday"], ["0", "Sunday"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
        {(frequency === "monthly" || frequency === "quarterly") && !(showDueModel && dueMode === "after_statement" && frequency === "monthly") && (
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Due day of month{frequency === "quarterly" ? " (in the quarter-start month)" : ""}
            <input value={schedDay} onChange={(e) => setSchedDay(e.target.value.replace(/[^0-9]/g, "").slice(0, 2) as any)} inputMode="numeric" className={`${inputCls} mt-1`} placeholder="e.g. 5" />
          </label>
        )}
        {showDueModel && (
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-2 sm:col-span-2">
            <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300">Due date rule</p>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${dueMode === "fixed" ? "border-indigo-500 bg-white dark:bg-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}>
                <input type="radio" checked={dueMode === "fixed"} onChange={() => setDueMode("fixed")} className="mt-0.5" />
                <span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-100">Fixed day</span>
                  <span className="block font-normal text-zinc-500">Due on the same date every month (e.g. 5th).</span>
                </span>
              </label>
              <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${dueMode === "after_statement" ? "border-indigo-500 bg-white dark:bg-zinc-900" : "border-zinc-300 dark:border-zinc-700"}`}>
                <input type="radio" checked={dueMode === "after_statement"} onChange={() => setDueMode("after_statement")} className="mt-0.5" />
                <span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-100">Days after statement</span>
                  <span className="block font-normal text-zinc-500">Statement + grace (e.g. stmt 18 + 20 days).</span>
                </span>
              </label>
            </div>
            {dueMode === "after_statement" && (
              <label className="mt-2 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                Grace days after statement (1–60)
                <input value={graceDays} onChange={(e) => setGraceDays(e.target.value.replace(/[^0-9]/g, "").slice(0, 2) as any)} inputMode="numeric" className={`${inputCls} mt-1`} placeholder="e.g. 20" />
              </label>
            )}
          </div>
        )}
        {frequency === "yearly" && (
          <>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Due month
              <select value={schedMonth} onChange={(e) => setSchedMonth(e.target.value as any)} className={`${inputCls} mt-1`}>
                <option value="">Select…</option>
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Due day of month
              <input value={schedDay} onChange={(e) => setSchedDay(e.target.value.replace(/[^0-9]/g, "").slice(0, 2) as any)} inputMode="numeric" className={`${inputCls} mt-1`} placeholder="e.g. 5" />
            </label>
          </>
        )}
        {category === "Credit Card" && (
          <label
            className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400"
            title="Day the credit-card statement generates — the amount is known from then"
          >
            Statement day of month{showDueModel && dueMode === "after_statement" ? " (required)" : ""}
            <input
              value={statementDay}
              onChange={(e) => setStatementDay(e.target.value.replace(/[^0-9]/g, "").slice(0, 2) as any)}
              inputMode="numeric"
              className={`${inputCls} mt-1`}
              placeholder="e.g. 18"
            />
          </label>
        )}
      </div>
      <label className="mt-2 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        Reminder days before due (comma-separated)
        <input value={remindDays} onChange={(e) => setRemindDays(e.target.value.replace(/[^0-9,]/g, ""))} className={`${inputCls} mt-1`} placeholder="7,3,1" />
      </label>
      {localErr && <p className="mt-2 text-xs text-rose-500">{localErr}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div>
          {row && (confirmDel ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">Remove this bill (all cycles)?</span>
              <button onClick={() => onDelete(row.templateId)} disabled={busy} className="rounded-lg bg-rose-600 px-2.5 py-1.5 font-bold text-white disabled:opacity-50 cursor-pointer">Yes, remove</button>
              <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">Keep</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDel(row)} className="rounded-lg border border-rose-500/40 px-2.5 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer">Remove</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">Cancel</button>
          <button
            disabled={busy}
            onClick={() => {
              if (!title.trim()) { setLocalErr("Title is required"); return; }
              const useOffset = showDueModel && dueMode === "after_statement";
              let day: number | null = null;
              let month: number | null = null;
              if (frequency === "weekly") {
                day = Number(schedWeekday);
              } else if (frequency === "monthly" || frequency === "quarterly") {
                if (!useOffset) {
                  if (schedDay === "") { setLocalErr("Enter the due day of month"); return; }
                  day = Number(schedDay);
                  if (!Number.isInteger(day) || day < 1 || day > 31) { setLocalErr("Due day must be 1–31"); return; }
                }
              } else if (frequency === "yearly") {
                if (schedMonth === "") { setLocalErr("Pick the due month"); return; }
                month = Number(schedMonth);
                if (schedDay === "") { setLocalErr("Enter the due day of month"); return; }
                day = Number(schedDay);
                if (!Number.isInteger(day) || day < 1 || day > 31) { setLocalErr("Due day must be 1–31"); return; }
              }
              const sDay = statementDay === "" ? null : Number(statementDay);
              if (category === "Credit Card" && sDay !== null && (!Number.isInteger(sDay) || sDay < 1 || sDay > 31)) {
                setLocalErr("Statement day must be 1–31"); return;
              }
              let grace: number | null = null;
              if (useOffset) {
                if (sDay === null) { setLocalErr("Statement day is required for days-after-statement"); return; }
                if (graceDays === "") { setLocalErr("Enter grace days after the statement"); return; }
                grace = Number(graceDays);
                if (!Number.isInteger(grace) || grace < 1 || grace > 60) { setLocalErr("Grace days must be 1–60"); return; }
              }
              const body: Record<string, unknown> = {
                title: title.trim(), biller: biller.trim() || null, identifier: identifier.trim() || null, category,
                amount: amount === "" ? null : Number(amount),
                frequency, dueDay: day, dueMonth: month,
                ownerRole: "either", remindDays: remindDays || "7,3,1",
                statementDay: category === "Credit Card" ? sDay : null,
                dueMode: useOffset ? "after_statement" : "fixed",
                graceDays: useOffset ? grace : null,
              };
              onSave(body, row?.templateId ?? null);
            }}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Saving…" : row ? "Save changes" : "Add due"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
