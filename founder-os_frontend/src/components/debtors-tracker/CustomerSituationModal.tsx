"use client";

import { useEffect, useState } from "react";
import type { CustomerAgeingRow, CustomerRemark } from "@/debtors-tracker/types";
import { CUSTOMER_SITUATIONS, CUSTOMER_SITUATION_LABELS, formatINR } from "@/debtors-tracker/types";
import {
  PROMISE_PRESET_DAYS, MAX_PROMISE_DAYS, formatPromiseDate, normalizePromiseDays,
  promiseDateFromDays, promiseDaysFromDate, promiseStatus, promiseStatusLabel, todayIST,
} from "@/debtors-tracker/promise";
import {
  addCustomerRemark, deleteCustomerRemark, listCustomerRemarks, saveCustomerSituation,
} from "@/debtors-tracker/api";

const LABEL = "block text-xs text-zinc-500 dark:text-zinc-400";
const INPUT = "w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
const BTN = "rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500";

function presetLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}

function formatRemarkTime(iso: string, day: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return day || "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(t));
}

/**
 * CRM panel for one customer: situation dropdown, mandatory promised-to-pay
 * date, and the append-only daily remark history.
 *
 * The promise is kept when the situation changes to Not answering / Busy / etc.
 * (shown as "Last promise"), replaced by a newer promise, and cleared only on
 * Paid / Closed.
 */
export default function CustomerSituationModal({
  customer, canAccounts, onClose, onSaved,
}: {
  customer: CustomerAgeingRow | null;
  canAccounts: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const key = customer?.customerKey ?? "";
  const [today] = useState(() => todayIST());
  const [situation, setSituation] = useState(customer?.situation ?? "");
  const [daysDraft, setDaysDraft] = useState<string>(() => {
    if (customer?.promisedDays != null) return String(customer.promisedDays);
    if (customer?.promisedDate) {
      const days = promiseDaysFromDate(todayIST(), customer.promisedDate);
      return days == null ? "" : String(days);
    }
    return "";
  });
  const [remarks, setRemarks] = useState<CustomerRemark[]>([]);
  const [loadingRemarks, setLoadingRemarks] = useState(false);
  const [newRemark, setNewRemark] = useState("");
  const [busySituation, setBusySituation] = useState(false);
  const [busyRemark, setBusyRemark] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setLoadingRemarks(true);
    setErr(null);
    listCustomerRemarks(key)
      .then((rows) => { if (!cancelled) setRemarks(rows); })
      .catch((e: any) => { if (!cancelled) setErr(e?.message ?? "Could not load remarks"); })
      .finally(() => { if (!cancelled) setLoadingRemarks(false); });
    return () => { cancelled = true; };
  }, [key]);

  if (!customer) return null;

  const showPromise = situation === "PROMISED_TO_PAY";
  const promiseDays = normalizePromiseDays(daysDraft);
  const promiseDate = promiseDays == null ? "" : promiseDateFromDays(today, promiseDays);
  const promiseMissing = showPromise && promiseDays == null;
  const lastPromiseState = promiseStatus(customer.promisedDate, today);

  const saveSituation = async () => {
    setErr(null);
    setNotice(null);
    if (promiseMissing) {
      setErr("Choose in how many days the client promised to pay.");
      return;
    }
    setBusySituation(true);
    try {
      await saveCustomerSituation(customer.customerKey, {
        situation,
        ...(showPromise && promiseDays != null ? { promisedDays: promiseDays } : {}),
      });
      const label = (CUSTOMER_SITUATION_LABELS as Record<string, string>)[situation] ?? "Unset";
      const msg = showPromise && promiseDate
        ? `Situation saved for ${customer.customerName} — ${label}, promise ${formatPromiseDate(promiseDate)}.`
        : `Situation saved for ${customer.customerName} — ${label}.`;
      setNotice(msg);
      onSaved(msg);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusySituation(false);
    }
  };

  const addRemark = async () => {
    const text = newRemark.trim();
    if (!text) return;
    setErr(null);
    setNotice(null);
    setBusyRemark(true);
    try {
      const created = await addCustomerRemark(customer.customerKey, text, customer.customerName);
      setRemarks((rows) => [created, ...rows]);
      setNewRemark("");
      const msg = `Remark added for ${customer.customerName}.`;
      setNotice(msg);
      onSaved(msg);
    } catch (e: any) {
      setErr(e?.message ?? "Could not add remark");
    } finally {
      setBusyRemark(false);
    }
  };

  const removeRemark = async (remark: CustomerRemark) => {
    if (!window.confirm("Delete this remark from the history?")) return;
    setErr(null);
    setNotice(null);
    try {
      await deleteCustomerRemark(customer.customerKey, remark.id);
      setRemarks((rows) => rows.filter((r) => r.id !== remark.id));
      const msg = "Remark deleted.";
      setNotice(msg);
      onSaved(msg);
    } catch (e: any) {
      setErr(e?.message ?? "Could not delete remark");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 py-8 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 space-y-4"
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

        {/* ── Situation + promised-to-pay date ── */}
        <div className="space-y-2">
          <label className={LABEL}>Client situation</label>
          <div className="flex items-center gap-2">
            <select
              value={situation}
              onChange={(e) => { setSituation(e.target.value); setErr(null); setNotice(null); }}
              className={INPUT}
            >
              <option value="">Unset</option>
              {CUSTOMER_SITUATIONS.map((s) => (
                <option key={s} value={s}>{CUSTOMER_SITUATION_LABELS[s]}</option>
              ))}
            </select>
            <button onClick={saveSituation} disabled={busySituation} className={`${BTN} shrink-0`}>
              {busySituation ? "Saving…" : "Save situation"}
            </button>
          </div>
        </div>

        {showPromise && (
          <div className={`space-y-2 rounded-xl border px-3 py-3 ${promiseMissing ? "border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/25" : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20"}`}>
            <div>
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                In how many days did the client promise to pay? <span className="text-rose-600 dark:text-rose-400">*</span>
              </div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Required when the situation is Promised to pay. 0 = today, max {MAX_PROMISE_DAYS}.
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PROMISE_PRESET_DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDaysDraft(String(d))}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    promiseDays === d
                      ? "border-indigo-500 bg-indigo-600 text-white"
                      : "border-zinc-300 bg-white text-zinc-600 hover:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                >
                  {presetLabel(d)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={MAX_PROMISE_DAYS}
                step={1}
                inputMode="numeric"
                value={daysDraft}
                onChange={(e) => setDaysDraft(e.target.value)}
                placeholder="or enter days"
                className={`${INPUT} max-w-[150px]`}
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {promiseDate
                  ? <>Promise date: <span className="font-medium text-zinc-800 dark:text-zinc-200">{formatPromiseDate(promiseDate, true)}</span></>
                  : "Pick a chip or enter a number of days"}
              </span>
            </div>
          </div>
        )}

        {!showPromise && customer.promisedDate && customer.netDue > 0 && situation !== "PAID_CLOSED" && (
          <div className={`rounded-xl border px-3 py-2 text-xs ${
            lastPromiseState === "overdue"
              ? "border-rose-200 bg-rose-50/60 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-300"
              : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300"
          }`}>
            <span className="font-semibold">Last promise: {formatPromiseDate(customer.promisedDate)}</span>
            {lastPromiseState !== "none" && <span> · {promiseStatusLabel(customer.promisedDate, today)}</span>}
            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
              Kept from when the client agreed to pay. A newer promise replaces it.
            </span>
          </div>
        )}

        {situation === "PAID_CLOSED" && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Saving Paid / Closed clears the stored promise date.
          </p>
        )}

        {/* ── Daily remarks ── */}
        <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Daily remarks</div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                One entry per call — older entries are never overwritten.
              </div>
            </div>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {remarks.length} entr{remarks.length === 1 ? "y" : "ies"}
            </span>
          </div>
          <textarea
            value={newRemark}
            onChange={(e) => setNewRemark(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="e.g. promised Friday, no answer, dispute reason, next call plan…"
            className={INPUT}
          />
          <div className="flex justify-end">
            <button onClick={addRemark} disabled={busyRemark || !newRemark.trim()} className={BTN}>
              {busyRemark ? "Adding…" : "Add remark"}
            </button>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {loadingRemarks && <p className="text-xs text-zinc-400">Loading remarks…</p>}
            {!loadingRemarks && remarks.length === 0 && (
              <p className="text-xs text-zinc-400">No remarks yet. Add the first one above.</p>
            )}
            {remarks.map((r) => (
              <div key={r.id} className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                      {formatRemarkTime(r.createdAt, r.day)}
                      {r.actor ? ` · ${r.actor}` : ""}
                    </div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200">{r.remark}</div>
                  </div>
                  {canAccounts && (
                    <button
                      onClick={() => removeRemark(r)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {err && <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">{err}</div>}
        {notice && !err && <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div>}

        <div className="flex items-center justify-end">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">Done</button>
        </div>
      </div>
    </div>
  );
}
