"use client";

// ─────────────────────────────────────────────────────────────────────────────
// LeaveApplicationView — the employee-facing Leave page (/leave, sidebar).
//
// Every approved login can apply here (full day / half day / short leave) for
// their own roster member; HR reviews the request in HR → Leaves & holidays and
// approves or rejects it with a note. Nothing is hard-coded about the member:
// GET /api/leave/mine is scoped server-side, so one employee never sees another
// person's leave.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { cancelLeaveRequest, fetchMyLeave } from "@/hr/api";
import { dateLabel, shortDate, timeLabel, todayIST } from "@/hr/format";
import {
  LEAVE_DURATION_LABEL, LEAVE_TYPE_LABEL, type HrLeave, type LeaveStatus,
} from "@/hr/types";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import LeaveApplyModal from "./LeaveApplyModal";

const STATUS_TONE: Record<LeaveStatus, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rejected: "border-rose-500/30 bg-rose-500/10 text-rose-500",
};

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-[10px] font-extrabold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-extrabold ${tone}`}>{value}</div>
    </div>
  );
}

function LeaveCard({ leave, onWithdraw }: { leave: HrLeave; onWithdraw?: (leave: HrLeave) => void }) {
  const status = (leave.status ?? "approved") as LeaveStatus;
  const duration = leave.durationType ?? "full_day";
  const sameDay = leave.startDate === leave.endDate;
  const window = leave.fromTime && leave.toTime ? `${timeLabel(leave.fromTime)} – ${timeLabel(leave.toTime)}` : null;
  const daysLabel = duration === "short" ? "recorded only" : `${leave.days} day${leave.days === 1 ? "" : "s"}`;
  return (
    <div className={`rounded-xl border p-3 ${status === "rejected" ? "border-rose-500/30" : status === "pending" ? "border-amber-500/30" : "border-zinc-200 dark:border-zinc-800"} bg-white dark:bg-zinc-950`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold">{LEAVE_DURATION_LABEL[duration]}</span>
            <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-500 dark:text-indigo-400">
              {LEAVE_TYPE_LABEL[leave.leaveType]}{leave.paid ? "" : " · unpaid"}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[status]}`}>
              {status === "pending" ? "Pending HR approval" : status === "approved" ? "Approved" : "Rejected"}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">
            {sameDay ? dateLabel(leave.startDate) : `${shortDate(leave.startDate)} → ${shortDate(leave.endDate)}`}
            {window ? ` · ${window}` : ""} · {daysLabel}
          </div>
          {leave.reason && <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">{leave.reason}</div>}
          {status === "rejected" && leave.decisionNote && (
            <div className="mt-1.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 text-[11px] text-rose-500">
              HR: {leave.decisionNote}
            </div>
          )}
          {status === "approved" && leave.decidedBy && (
            <div className="mt-1 text-[10px] text-zinc-400">Approved by {leave.decidedBy}</div>
          )}
        </div>
        {status === "pending" && onWithdraw && (
          <button
            onClick={() => onWithdraw(leave)}
            className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10"
          >
            Withdraw
          </button>
        )}
      </div>
    </div>
  );
}

export default function LeaveApplicationView() {
  const dash = useLiveDashboard(fetchMyLeave, { events: ["human-resources"], pollMs: 60000 });
  const [applyOpen, setApplyOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState<HrLeave | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const data = dash.data;
  const today = todayIST();
  const requests = data?.requests ?? [];

  const { pending, approved, rejected } = useMemo(() => {
    const p: HrLeave[] = [];
    const a: HrLeave[] = [];
    const r: HrLeave[] = [];
    for (const leave of requests) {
      const status = (leave.status ?? "approved") as LeaveStatus;
      if (status === "pending") p.push(leave);
      else if (status === "rejected") r.push(leave);
      else a.push(leave);
    }
    return { pending: p, approved: a, rejected: r };
  }, [requests]);

  const upcoming = approved.filter((l) => l.endDate >= today);
  const past = approved.filter((l) => l.endDate < today);

  const withdraw = async () => {
    if (!withdrawing) return;
    setBusy(true); setErr(null);
    try {
      await cancelLeaveRequest(withdrawing.id);
      setWithdrawing(null);
      dash.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not withdraw the request");
    } finally {
      setBusy(false);
    }
  };

  if (dash.loading && !data) {
    return <div className="p-6 text-sm text-zinc-500">Loading your leave…</div>;
  }
  if (dash.error && !data) {
    return (
      <div className="space-y-2 p-6">
        <h2 className="text-lg font-bold">Leave unavailable</h2>
        <p className="text-sm text-zinc-500">{(dash.error as Error)?.message ?? "Request failed"}</p>
        <button onClick={dash.refresh} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-extrabold tracking-tight">Leave</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            Apply for a full day, half day or short leave — HR decides and you see their note here.
            {data?.self ? ` Applying as ${data.self.name}${data.self.designation ? ` · ${data.self.designation}` : ""}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={dash.refresh} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">Refresh</button>
          <button
            onClick={() => setApplyOpen(true)}
            disabled={!data?.linked}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Apply for leave
          </button>
        </div>
      </div>

      {data && !data.linked && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="text-sm font-extrabold text-amber-700 dark:text-amber-400">Your login is not linked yet</h3>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400/80">
            Ask HR to link this email to your employee record (HR → Delegation → Logins), then you can apply here.
          </p>
        </div>
      )}

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Awaiting HR" value={pending.length} tone="text-amber-600 dark:text-amber-400" />
        <Stat label="Approved" value={approved.length} tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Rejected" value={rejected.length} tone="text-rose-500" />
      </div>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Waiting for HR</h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {pending.map((leave) => <LeaveCard key={leave.id} leave={leave} onWithdraw={setWithdrawing} />)}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">Approved · upcoming</h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {upcoming.map((leave) => <LeaveCard key={leave.id} leave={leave} />)}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">History</h2>
        {past.length + rejected.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">
            No leave history yet — your applications appear here with HR&apos;s decision.
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {[...past, ...rejected]
              .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)))
              .map((leave) => <LeaveCard key={leave.id} leave={leave} />)}
          </div>
        )}
      </section>

      {applyOpen && data?.self && (
        <LeaveApplyModal selfName={data.self.name} onClose={() => setApplyOpen(false)} onSaved={dash.refresh} />
      )}

      <ConfirmDialog
        open={!!withdrawing}
        title="Withdraw leave request?"
        message={<>Withdraw the <b>{withdrawing ? LEAVE_DURATION_LABEL[withdrawing.durationType ?? "full_day"] : ""}</b> request for <b>{withdrawing ? dateLabel(withdrawing.startDate) : ""}</b>? HR will no longer see it.</>}
        confirmLabel="Withdraw"
        busy={busy}
        onConfirm={withdraw}
        onCancel={() => setWithdrawing(null)}
      />
    </div>
  );
}
