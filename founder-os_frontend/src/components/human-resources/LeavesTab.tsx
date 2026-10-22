"use client";

import React, { useMemo, useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import LeaveFormModal from "./LeaveFormModal";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { LEAVE_TYPE_LABEL, type HrEmployee, type HrHoliday, type HrLeave } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { currentMonthIST, dateLabel, monthLabel, shiftMonth, shortDate } from "@/hr/format";

const field = "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500";

export default function LeavesTab() {
  const [month, setMonth] = useState(currentMonthIST());
  const dash = useLiveDashboard<{ leaves: HrLeave[]; holidays: HrHoliday[]; employees: HrEmployee[] }>(async () => {
    const year = month.slice(0, 4);
    const [leaveRes, holRes, empRes] = await Promise.all([
      fetch(`/api/human-resources/leaves?month=${encodeURIComponent(month)}`, { cache: "no-store" }),
      fetch(`/api/human-resources/holidays?year=${encodeURIComponent(year)}`, { cache: "no-store" }),
      fetch("/api/human-resources/members", { cache: "no-store" }),
    ]);
    if (!leaveRes.ok) throw new Error(`Leaves load failed (HTTP ${leaveRes.status})`);
    if (!holRes.ok) throw new Error(`Holidays load failed (HTTP ${holRes.status})`);
    if (!empRes.ok) throw new Error(`Employees load failed (HTTP ${empRes.status})`);
    const leavesBody = await leaveRes.json();
    const holBody = await holRes.json();
    const empBody = await empRes.json();
    return { leaves: leavesBody.leaves ?? [], holidays: holBody.holidays ?? [], employees: empBody.members ?? [] };
  }, { deps: [month], pollMs: 60000 });

  const [leaveForm, setLeaveForm] = useState<{ open: boolean; leave: HrLeave | null }>({ open: false, leave: null });
  const [deleting, setDeleting] = useState<HrLeave | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [holidayForm, setHolidayForm] = useState({ id: "", date: `${month}-01`, name: "" });
  const [holidayBusy, setHolidayBusy] = useState(false);

  const leaves = dash.data?.leaves ?? [];
  const holidays = useMemo(() => (dash.data?.holidays ?? []).slice().sort((a, b) => a.date.localeCompare(b.date)), [dash.data?.holidays]);
  const year = month.slice(0, 4);
  const paidDays = leaves.filter((l) => l.paid).reduce((s, l) => s + l.days, 0);
  const unpaidDays = leaves.filter((l) => !l.paid).reduce((s, l) => s + l.days, 0);

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
    if (!holidayForm.date || !holidayForm.name.trim()) { setErr("Holiday date and name are required"); return; }
    setHolidayBusy(true); setErr(null);
    try {
      const res = holidayForm.id
        ? await jsonRequest(`/api/human-resources/holidays/${holidayForm.id}`, "PATCH", { date: holidayForm.date, name: holidayForm.name.trim() })
        : await jsonRequest("/api/human-resources/holidays", "POST", { date: holidayForm.date, name: holidayForm.name.trim() });
      if (!res.ok) throw new Error(await readError(res));
      setHolidayForm({ id: "", date: `${month}-01`, name: "" });
      dash.refresh();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Holiday save failed"); }
    finally { setHolidayBusy(false); }
  };

  const removeHoliday = async (holiday: HrHoliday) => {
    setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/holidays/${holiday.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      if (holidayForm.id === holiday.id) setHolidayForm({ id: "", date: `${month}-01`, name: "" });
      dash.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Holiday delete failed"); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">←</button>
          <span className="min-w-28 text-center text-xs font-bold">{monthLabel(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">→</button>
        </div>
        <button onClick={() => setLeaveForm({ open: true, leave: null })} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">Record leave</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Leave records</div><div className="text-lg font-extrabold">{leaves.length}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Paid days</div><div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{paidDays}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Unpaid days</div><div className="text-lg font-extrabold text-rose-500">{unpaidDays}</div></div>
      </div>

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
      {Boolean(dash.error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">Failed to load: {String(dash.error)}</div>}

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
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{shortDate(leave.startDate)} → {shortDate(leave.endDate)} · {leave.days} working day{leave.days === 1 ? "" : "s"}</div>
                  {leave.reason && <div className="mt-1 text-[11px] text-zinc-500">{leave.reason}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
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
            <div className="grid grid-cols-[1fr_1.4fr] gap-2">
              <input type="date" value={holidayForm.date} onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))} className={field} />
              <input value={holidayForm.name} onChange={(e) => setHolidayForm((f) => ({ ...f, name: e.target.value }))} placeholder="Holiday name" className={field} />
            </div>
            <div className="flex justify-end gap-1.5">
              {holidayForm.id && <button type="button" onClick={() => setHolidayForm({ id: "", date: `${month}-01`, name: "" })} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Cancel</button>}
              <button type="submit" disabled={holidayBusy} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">{holidayBusy ? "Saving…" : holidayForm.id ? "Update" : "Add holiday"}</button>
            </div>
          </form>
          {holidays.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">No holidays added for {year}.</div>
          ) : holidays.map((holiday) => (
            <div key={holiday.id} className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950`}>
              <div>
                <div className="text-xs font-bold">{holiday.name}</div>
                <div className="text-[10px] text-zinc-500">{dateLabel(holiday.date)}, {holiday.date.slice(0, 4)}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setHolidayForm({ id: holiday.id, date: holiday.date, name: holiday.name })} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Edit</button>
                <button onClick={() => void removeHoliday(holiday)} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-500 hover:bg-rose-500/10">Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {leaveForm.open && <LeaveFormModal leave={leaveForm.leave} employees={dash.data?.employees ?? []} onClose={() => setLeaveForm({ open: false, leave: null })} onSaved={() => dash.refresh()} />}
      <ConfirmDialog open={!!deleting} title="Delete leave record?" message={<>Delete <b>{deleting?.memberName || "this"}</b> leave? Attendance and payroll will recalculate.</>} confirmLabel="Delete" busy={busy} onConfirm={removeLeave} onCancel={() => setDeleting(null)} />
    </div>
  );
}
