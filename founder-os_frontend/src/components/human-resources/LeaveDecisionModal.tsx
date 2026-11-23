"use client";

// HR decision on one employee leave application. Approving asks for an optional
// note; rejecting REQUIRES one — the employee reads it on their Leave page, so a
// rejection can never be silent (the backend enforces the same rule).
import React, { useState } from "react";
import Modal from "@/components/Modal";
import { decideLeaveRequest } from "@/hr/api";
import { dateLabel, shortDate, timeLabel } from "@/hr/format";
import {
  LEAVE_DURATION_LABEL, LEAVE_TYPE_LABEL, type HrLeave,
} from "@/hr/types";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";

export default function LeaveDecisionModal({ leave, mode, onClose, onSaved }: {
  leave: HrLeave;
  mode: "approve" | "reject";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reject = mode === "reject";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reject && note.trim().length < 3) { setErr("A rejection note is required"); return; }
    setBusy(true); setErr(null);
    try {
      await decideLeaveRequest(leave.id, mode, note);
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not save the decision");
    } finally {
      setBusy(false);
    }
  };

  const duration = leave.durationType ?? "full_day";
  const window = leave.fromTime && leave.toTime ? ` · ${timeLabel(leave.fromTime)} – ${timeLabel(leave.toTime)}` : "";

  return (
    <Modal
      title={reject ? "Reject leave request" : "Approve leave request"}
      subtitle={leave.memberName ?? "Employee"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3 px-5 pb-5">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
          <div className="flex flex-wrap items-center gap-1.5 font-bold">
            <span>{LEAVE_DURATION_LABEL[duration]}</span>
            <span className="text-zinc-400">·</span>
            <span>{LEAVE_TYPE_LABEL[leave.leaveType]}{leave.paid ? "" : " · unpaid"}</span>
            <span className="text-zinc-400">·</span>
            <span>
              {leave.startDate === leave.endDate
                ? dateLabel(leave.startDate)
                : `${shortDate(leave.startDate)} → ${shortDate(leave.endDate)}`}
              {window}
            </span>
          </div>
          {leave.days > 0 && <div className="mt-0.5 text-[11px] text-zinc-500">{leave.days} day{leave.days === 1 ? "" : "s"} against attendance + payroll</div>}
          {leave.reason && <div className="mt-1 whitespace-pre-wrap text-[11px] text-zinc-600 dark:text-zinc-300">Purpose: {leave.reason}</div>}
          {leave.requestedBy && <div className="mt-0.5 text-[10px] text-zinc-400">Applied by {leave.requestedBy}</div>}
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">
            {reject ? "Reason for rejection (required)" : "Note (optional)"}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus={reject}
            placeholder={reject
              ? "Tell the employee why this cannot be approved — they see this note."
              : "Anything the employee should know (optional)."}
            className={field}
          />
        </div>

        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button
            type="submit"
            disabled={busy || (reject && note.trim().length < 3)}
            className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40 ${reject ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500"}`}
          >
            {busy ? "Saving…" : reject ? "Reject request" : "Approve leave"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
