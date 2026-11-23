"use client";

// Apply for leave — full day / half day / short leave, with a mandatory purpose.
// The member is never chosen here: the server pins the request to the caller's
// own roster record. Day counts are computed server-side on submit.
import React, { useState } from "react";
import Modal from "@/components/Modal";
import { applyLeaveRequest } from "@/hr/api";
import { todayIST } from "@/hr/format";
import {
  LEAVE_DURATIONS, LEAVE_DURATION_LABEL, LEAVE_TYPES, LEAVE_TYPE_LABEL,
  type LeaveDuration, type LeaveType,
} from "@/hr/types";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500";

export default function LeaveApplyModal({ selfName, onClose, onSaved }: {
  selfName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = todayIST();
  const [durationType, setDurationType] = useState<LeaveDuration>("full_day");
  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ranged = durationType === "full_day";
  const timed = durationType !== "full_day";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) { setErr("Please mention the purpose of the leave"); return; }
    if (!startDate) { setErr("Pick the leave date"); return; }
    if (ranged && (!endDate || endDate < startDate)) { setErr("The end date cannot be before the start date"); return; }
    if (timed && fromTime && toTime && toTime <= fromTime) { setErr("The end time must be after the start time"); return; }
    setBusy(true); setErr(null);
    try {
      await applyLeaveRequest({
        durationType,
        leaveType,
        startDate,
        endDate: ranged ? endDate : startDate,
        fromTime: timed ? (fromTime || null) : null,
        toTime: timed ? (toTime || null) : null,
        reason: reason.trim(),
      });
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not submit the request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Apply for leave" subtitle={selfName} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 px-5 pb-5">
        <div>
          <span className={label}>Leave type</span>
          <div className="flex flex-wrap gap-1.5">
            {LEAVE_DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDurationType(d)}
                aria-pressed={durationType === d}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  durationType === d
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                }`}
              >
                {LEAVE_DURATION_LABEL[d]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            {durationType === "full_day"
              ? "Whole working days — Sundays and company holidays are not counted."
              : durationType === "half_day"
                ? "Half of one working day (0.5 day)."
                : "A couple of hours on one working day — recorded for HR, pay is unaffected."}
          </p>
        </div>

        <div className={`grid gap-3 ${ranged ? "sm:grid-cols-2" : ""}`}>
          <div>
            <label className={label}>{ranged ? "From date" : "Date"}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (ranged && endDate < e.target.value) setEndDate(e.target.value);
              }}
              className={field}
            />
          </div>
          {ranged && (
            <div>
              <label className={label}>To date</label>
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={field} />
            </div>
          )}
        </div>

        {timed && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>From time (optional)</label>
              <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>To time (optional)</label>
              <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} className={field} />
            </div>
          </div>
        )}

        <div>
          <label className={label}>Reason type</label>
          <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)} className={field}>
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}{t === "unpaid" ? " — no pay" : ""}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={label}>Purpose of leave</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why do you need this leave? HR sees this with your request."
            className={field}
          />
        </div>

        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40">
            {busy ? "Sending…" : "Send request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
