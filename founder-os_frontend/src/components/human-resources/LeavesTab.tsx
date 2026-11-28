"use client";

// Leaves & Policy — HR side.
//
//   Requests   employee applications waiting for a decision (tab badge = count,
//              the same rose count pill the Accounts payment-reminder tabs use)
//   Approved / Rejected   decided applications with the HR note
//   Calendar & holidays   HR-recorded leaves for the month + the holiday list
//
// One live payload feeds every tab (single fetch, single `human-resources` live
// event). Applications themselves are read-only here: they live on the same
// HumanResourcesLeave table as HR records, so attendance + payroll already see
// approved rows only.
import React, { useMemo, useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import LeaveFormModal from "./LeaveFormModal";
import LeaveDecisionModal from "./LeaveDecisionModal";
import PolicyTab from "./PolicyTab";
import { TabBar, type TabBarItem } from "../ui/TabBar";
import { useLiveDashboard } from "@/hooks/useLiveData";
import {
  LEAVE_DURATION_LABEL, LEAVE_TYPE_LABEL,
  type HrEmployee, type HrHoliday, type HrHolidayKind, type HrLeave, type LeaveStatus,
} from "@/hr/types";
import { jsonRequest, readError, fetchLeaveRequests } from "@/hr/api";
import { currentMonthIST, monthLabel, shiftMonth, shortDate, timeLabel } from "@/hr/format";

const field = "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500";

type LeaveTab = "requests" | "approved" | "rejected" | "calendar" | "policy";

// mirror: founder-os_backend/src/automations/human-resources/holidays-parse.ts
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type HolidayDraft = {
  id: string;
  kind: HrHolidayKind;
  date: string;
  startDate: string;
  endDate: string;
  weekday: number;
  name: string;
};

function blankHoliday(month: string): HolidayDraft {
  const first = `${month}-01`;
  return { id: "", kind: "single", date: first, startDate: first, endDate: first, weekday: 0, name: "" };
}

const STATUS_TONE: Record<LeaveStatus, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rejected: "border-rose-500/30 bg-rose-500/10 text-rose-500",
};

function durationLine(leave: HrLeave): string {
  const duration = leave.durationType ?? "full_day";
  const sameDay = leave.startDate === leave.endDate;
  const span = sameDay ? shortDate(leave.startDate) : `${shortDate(leave.startDate)} → ${shortDate(leave.endDate)}`;
  const window = leave.fromTime && leave.toTime ? ` · ${timeLabel(leave.fromTime)} – ${timeLabel(leave.toTime)}` : "";
  const days = duration === "short" ? "recorded only" : `${leave.days} working day${leave.days === 1 ? "" : "s"}`;
  return `${LEAVE_DURATION_LABEL[duration]} · ${span}${window} · ${days}`;
}

function RequestCard({ leave, onDecide }: {
  leave: HrLeave;
  onDecide: (leave: HrLeave, mode: "approve" | "reject") => void;
}) {
  const status = (leave.status ?? "approved") as LeaveStatus;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold">{leave.memberName || "Employee"}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[status]}`}>
              {status === "pending" ? "Pending" : status === "approved" ? "Approved" : "Rejected"}
            </span>
            <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-500 dark:text-indigo-400">
              {LEAVE_TYPE_LABEL[leave.leaveType]}{leave.paid ? "" : " · unpaid"}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">{durationLine(leave)}</div>
          {leave.reason && <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">Purpose: {leave.reason}</div>}
          {leave.requestedBy && <div className="mt-0.5 text-[10px] text-zinc-400">Applied by {leave.requestedBy}</div>}
          {leave.decisionNote && (
            <div className={`mt-1.5 rounded-lg border px-2 py-1.5 text-[11px] ${status === "rejected" ? "border-rose-500/30 bg-rose-500/5 text-rose-500" : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"}`}>
              HR note: {leave.decisionNote}{leave.decidedBy ? ` — ${leave.decidedBy}` : ""}
            </div>
          )}
        </div>
        {status === "pending" && (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => onDecide(leave, "approve")} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500">Approve</button>
            <button onClick={() => onDecide(leave, "reject")} className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold text-rose-500 hover:bg-rose-500/20">Reject</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LeavesTab() {
  const [month, setMonth] = useState(currentMonthIST());
  const [tab, setTab] = useState<LeaveTab>("requests");
  const dash = useLiveDashboard<{
    leaves: HrLeave[]; holidays: HrHoliday[]; employees: HrEmployee[]; requests: HrLeave[];
  }>(async () => {
    const year = month.slice(0, 4);
    const [leaveRes, holRes, empRes, requests] = await Promise.all([
      fetch(`/api/human-resources/leaves?month=${encodeURIComponent(month)}`, { cache: "no-store" }),
      fetch(`/api/human-resources/holidays?year=${encodeURIComponent(year)}`, { cache: "no-store" }),
      fetch("/api/human-resources/members", { cache: "no-store" }),
      fetchLeaveRequests("all"),
    ]);
    if (!leaveRes.ok) throw new Error(`Leaves load failed (HTTP ${leaveRes.status})`);
    if (!holRes.ok) throw new Error(`Holidays load failed (HTTP ${holRes.status})`);
    if (!empRes.ok) throw new Error(`Employees load failed (HTTP ${empRes.status})`);
    const [leavesBody, holBody, empBody] = await Promise.all([
      leaveRes.json(), holRes.json(), empRes.json(),
    ]);
    return {
      leaves: leavesBody.leaves ?? [],
      holidays: holBody.holidays ?? [],
      employees: empBody.members ?? [],
      requests,
    };
  }, { events: ["human-resources"], deps: [month], pollMs: 60000 });

  const [leaveForm, setLeaveForm] = useState<{ open: boolean; leave: HrLeave | null }>({ open: false, leave: null });
  const [decision, setDecision] = useState<{ leave: HrLeave; mode: "approve" | "reject" } | null>(null);
  const [deleting, setDeleting] = useState<HrLeave | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [holidayForm, setHolidayForm] = useState<HolidayDraft>(() => blankHoliday(month));
  const [holidayBusy, setHolidayBusy] = useState(false);

  const leaves = dash.data?.leaves ?? [];
  const requests = dash.data?.requests ?? [];
  const holidays = useMemo(() => (dash.data?.holidays ?? []).slice().sort((a, b) => a.startDate.localeCompare(b.startDate)), [dash.data?.holidays]);
  const year = month.slice(0, 4);
  const paidDays = leaves.reduce((s, l) => s + (l.paidDays ?? (l.paid ? l.days : 0)), 0);
  const unpaidDays = leaves.reduce((s, l) => s + Math.max(0, l.days - (l.paidDays ?? (l.paid ? l.days : 0))), 0);

  const pending = requests.filter((r) => (r.status ?? "approved") === "pending");
  const decided = requests.filter((r) => (r.status ?? "approved") !== "pending");
  const approvedRequests = decided.filter((r) => r.status === "approved");
  const rejectedRequests = decided.filter((r) => r.status === "rejected");

  const filters: TabBarItem<LeaveTab>[] = [
    { key: "requests", label: "Requests", count: pending.length, tone: "danger" },
    { key: "approved", label: "Approved", count: approvedRequests.length },
    { key: "rejected", label: "Rejected", count: rejectedRequests.length },
    { key: "calendar", label: "Calendar & holidays", count: leaves.length },
    { key: "policy", label: "Policy" },
  ];

  const removeLeave = async () => {
    if (!deleting) return;
    setBusy(true); setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/leaves/${deleting.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      setDeleting(null); dash.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Delete failed"); }
    finally { setBusy(false); }
  };

  const saveHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = holidayForm.name.trim();
    if (!name) { setErr("Holiday name is required"); return; }
    let payload: Record<string, unknown>;
    if (holidayForm.kind === "single") {
      if (!holidayForm.date) { setErr("Pick the holiday date"); return; }
      payload = { kind: "single", date: holidayForm.date, name };
    } else if (holidayForm.kind === "range") {
      if (!holidayForm.startDate || !holidayForm.endDate) { setErr("Pick the first and last day of the holiday"); return; }
      if (holidayForm.endDate < holidayForm.startDate) { setErr("The last day cannot be before the first day"); return; }
      payload = { kind: "range", startDate: holidayForm.startDate, endDate: holidayForm.endDate, name };
    } else {
      if (!holidayForm.startDate || !holidayForm.endDate) { setErr("Pick the window this weekday applies to"); return; }
      if (holidayForm.endDate < holidayForm.startDate) { setErr("The window end cannot be before its start"); return; }
      payload = { kind: "weekday", weekday: holidayForm.weekday, startDate: holidayForm.startDate, endDate: holidayForm.endDate, name };
    }
    setHolidayBusy(true); setErr(null);
    try {
      const res = holidayForm.id
        ? await jsonRequest(`/api/human-resources/holidays/${holidayForm.id}`, "PATCH", payload)
        : await jsonRequest("/api/human-resources/holidays", "POST", payload);
      if (!res.ok) throw new Error(await readError(res));
      setHolidayForm(blankHoliday(month));
      dash.refresh();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Holiday save failed"); }
    finally { setHolidayBusy(false); }
  };

  const removeHoliday = async (holiday: HrHoliday) => {
    setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/holidays/${holiday.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      if (holidayForm.id === holiday.id) setHolidayForm(blankHoliday(month));
      dash.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Holiday delete failed"); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabBar items={filters} active={tab} onChange={setTab} ariaLabel="Leave views" />
        <div className="flex items-center gap-1.5">
          {tab === "calendar" && (
            <>
              <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">←</button>
              <span className="min-w-28 text-center text-xs font-bold">{monthLabel(month)}</span>
              <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">→</button>
            </>
          )}
          <button onClick={() => setLeaveForm({ open: true, leave: null })} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">Record leave</button>
        </div>
      </div>

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
      {Boolean(dash.error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">Failed to load: {String(dash.error)}</div>}

      {tab === "requests" && (
        <div className="space-y-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">
            Waiting for a decision · {pending.length}
          </h3>
          {pending.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">
              No leave requests waiting. Employees apply from the Leave page in their sidebar.
            </div>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {pending.map((leave) => (
                <RequestCard key={leave.id} leave={leave} onDecide={(l, mode) => setDecision({ leave: l, mode })} />
              ))}
            </div>
          )}
        </div>
      )}

      {(tab === "approved" || tab === "rejected") && (
        <div className="space-y-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">
            {tab === "approved" ? "Approved leave" : "Rejected requests"} · {(tab === "approved" ? approvedRequests : rejectedRequests).length}
          </h3>
          {(tab === "approved" ? approvedRequests : rejectedRequests).length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">
              Nothing {tab === "approved" ? "approved" : "rejected"} yet.
            </div>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {(tab === "approved" ? approvedRequests : rejectedRequests).map((leave) => (
                <RequestCard key={leave.id} leave={leave} onDecide={(l, mode) => setDecision({ leave: l, mode })} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "calendar" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Leave records</div><div className="text-lg font-extrabold">{leaves.length}</div></div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Paid days</div><div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{paidDays}</div></div>
            <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Unpaid days</div><div className="text-lg font-extrabold text-rose-500">{unpaidDays}</div></div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">Leaves in {monthLabel(month)}</h3>
              {leaves.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">No leave records this month.</div>
              ) : leaves.map((leave) => (
                <div key={leave.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-bold">{leave.memberName || "Employee"}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${leave.paid ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-500"}`}>{LEAVE_TYPE_LABEL[leave.leaveType]}{leave.paid ? "" : " · unpaid"}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_TONE[(leave.status ?? "approved") as LeaveStatus]}`}>
                          {(leave.status ?? "approved") === "pending" ? "Pending" : (leave.status ?? "approved") === "approved" ? "Approved" : "Rejected"}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">{durationLine(leave)}</div>
                      {leave.reason && <div className="mt-1 text-[11px] text-zinc-500">{leave.reason}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {(leave.status ?? "approved") === "pending" && (
                        <>
                          <button onClick={() => setDecision({ leave, mode: "approve" })} className="rounded-lg px-2 py-1 text-[11px] font-bold text-emerald-600 hover:bg-emerald-500/10">Approve</button>
                          <button onClick={() => setDecision({ leave, mode: "reject" })} className="rounded-lg px-2 py-1 text-[11px] font-bold text-rose-500 hover:bg-rose-500/10">Reject</button>
                        </>
                      )}
                      <button onClick={() => setLeaveForm({ open: true, leave })} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Edit</button>
                      <button onClick={() => setDeleting(leave)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10">Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">Company holidays · {year}</h3>
              <form onSubmit={saveHoliday} className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex flex-wrap gap-1">
                  {(["single", "range", "weekday"] as HrHolidayKind[]).map((kind) => (
                    <button key={kind} type="button" onClick={() => setHolidayForm((f) => ({ ...f, kind }))} className={`rounded-lg px-2.5 py-1 text-[11px] font-bold capitalize ${holidayForm.kind === kind ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                      {kind === "single" ? "One day" : kind === "range" ? "Timespan" : "Day of week"}
                    </button>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {holidayForm.kind === "single" ? (
                    <input type="date" value={holidayForm.date} onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))} className={field} />
                  ) : holidayForm.kind === "range" ? (
                    <>
                      <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">First day<input type="date" value={holidayForm.startDate} onChange={(e) => setHolidayForm((f) => ({ ...f, startDate: e.target.value }))} className={field + " mt-1 block w-full"} /></label>
                      <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Last day<input type="date" value={holidayForm.endDate} onChange={(e) => setHolidayForm((f) => ({ ...f, endDate: e.target.value }))} className={field + " mt-1 block w-full"} /></label>
                    </>
                  ) : (
                    <>
                      <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Every<select value={holidayForm.weekday} onChange={(e) => setHolidayForm((f) => ({ ...f, weekday: Number(e.target.value) }))} className={field + " mt-1 block w-full"}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">From<input type="date" value={holidayForm.startDate} onChange={(e) => setHolidayForm((f) => ({ ...f, startDate: e.target.value }))} className={field + " mt-1 block w-full"} /></label>
                        <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">To<input type="date" value={holidayForm.endDate} onChange={(e) => setHolidayForm((f) => ({ ...f, endDate: e.target.value }))} className={field + " mt-1 block w-full"} /></label>
                      </div>
                    </>
                  )}
                  <input value={holidayForm.name} onChange={(e) => setHolidayForm((f) => ({ ...f, name: e.target.value }))} placeholder="Holiday name" className={field + " sm:col-span-2"} />
                </div>
                <p className="text-[10px] text-zinc-500">Every date in a rule is paid like a working day by payroll; leaves skip it. A weekday rule repeats between “From” and “To”.</p>
                <div className="flex justify-end gap-1.5">
                  {holidayForm.id && <button type="button" onClick={() => setHolidayForm(blankHoliday(month))} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>}
                  <button type="submit" disabled={holidayBusy} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">{holidayBusy ? "Saving…" : holidayForm.id ? "Update" : "Add holiday"}</button>
                </div>
              </form>
              {holidays.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">No holidays added for {year}.</div>
              ) : holidays.map((holiday) => (
                <div key={holiday.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-950">
                  <div>
                    <div className="text-xs font-bold">{holiday.name}</div>
                    <div className="text-[10px] text-zinc-500">{holiday.label || holiday.startDate}{holiday.kind === "range" ? " (timespan)" : holiday.kind === "weekday" ? " (day of week)" : ""}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setHolidayForm({ id: holiday.id, kind: holiday.kind, date: holiday.date ?? holiday.startDate, startDate: holiday.startDate, endDate: holiday.endDate, weekday: holiday.weekday ?? 0, name: holiday.name })} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Edit</button>
                    <button onClick={() => void removeHoliday(holiday)} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-500 hover:bg-rose-500/10">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "policy" && <PolicyTab />}

      {leaveForm.open && <LeaveFormModal leave={leaveForm.leave} employees={dash.data?.employees ?? []} onClose={() => setLeaveForm({ open: false, leave: null })} onSaved={() => dash.refresh()} />}
      {decision && (
        <LeaveDecisionModal
          leave={decision.leave}
          mode={decision.mode}
          onClose={() => setDecision(null)}
          onSaved={() => dash.refresh()}
        />
      )}
      <ConfirmDialog open={!!deleting} title="Delete leave record?" message={<>Delete <b>{deleting?.memberName || "this"}</b> leave? Attendance and payroll will recalculate.</>} confirmLabel="Delete" busy={busy} onConfirm={removeLeave} onCancel={() => setDeleting(null)} />
    </div>
  );
}
