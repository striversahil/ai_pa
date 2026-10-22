"use client";

import React, { useEffect, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LABEL, LEAVE_TYPE_LABEL, type AttendanceStatus, type HrAttendanceDay, type HrAttendanceSummaryRow } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { dateLabel, hoursLabel, initials, isSunday, shiftDate, todayIST } from "@/hr/format";

interface Draft { status: AttendanceStatus | ""; inTime: string; outTime: string; notes: string }

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-indigo-500";

function buildDrafts(day: HrAttendanceDay): Record<string, Draft> {
  const next: Record<string, Draft> = {};
  for (const row of day.rows) {
    next[row.member.id] = {
      status: (row.attendance?.status ?? "") as AttendanceStatus | "",
      inTime: row.attendance?.inTime ?? "",
      outTime: row.attendance?.outTime ?? "",
      notes: row.attendance?.notes ?? "",
    };
  }
  return next;
}

function statusTone(status: AttendanceStatus | "") {
  if (status === "present") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (status === "half_day") return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  if (status === "absent") return "bg-rose-500/10 text-rose-500";
  if (status === "holiday") return "bg-indigo-500/10 text-indigo-500";
  return "bg-zinc-500/10 text-zinc-500";
}

export default function AttendanceTab() {
  const [date, setDate] = useState(todayIST());
  const dash = useLiveDashboard<{ day: HrAttendanceDay; summary: HrAttendanceSummaryRow[] }>(async () => {
    const [dayRes, sumRes] = await Promise.all([
      fetch(`/api/human-resources/attendance?date=${encodeURIComponent(date)}`, { cache: "no-store" }),
      fetch(`/api/human-resources/attendance/summary?month=${encodeURIComponent(date.slice(0, 7))}`, { cache: "no-store" }),
    ]);
    if (!dayRes.ok) throw new Error(`Attendance load failed (HTTP ${dayRes.status})`);
    if (!sumRes.ok) throw new Error(`Summary load failed (HTTP ${sumRes.status})`);
    const day = await dayRes.json();
    const summaryBody = await sumRes.json();
    return { day, summary: summaryBody.rows ?? [] };
  }, { deps: [date], pollMs: 60000 });

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  useEffect(() => {
    if (dash.data?.day?.date) setDrafts(buildDrafts(dash.data.day));
  }, [dash.data?.day?.date]);

  const dayData = dash.data?.day;
  const rows = dayData?.rows ?? [];
  const changedCount = rows.filter((r) => {
    const d = drafts[r.member.id];
    if (!d) return false;
    const a = r.attendance;
    return d.status !== (a?.status ?? "") || d.inTime !== (a?.inTime ?? "") || d.outTime !== (a?.outTime ?? "") || d.notes !== (a?.notes ?? "");
  }).length;

  const changeDate = (next: string) => {
    setDate(next);
    setDrafts({});
    setOk(null);
    setErr(null);
  };
  const update = (memberId: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [memberId]: { ...prev[memberId], ...patch } }));
    setOk(null);
  };
  const markAllPresent = () => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        if (row.leave) continue;
        next[row.member.id] = { ...next[row.member.id], status: "present" };
      }
      return next;
    });
    setOk(null);
  };

  const save = async () => {
    if (!dayData) return;
    const payload = rows
      .map((row) => {
        const d = drafts[row.member.id];
        if (!d || d.status === "" || row.leave) return null;
        return {
          memberId: row.member.id,
          date,
          inTime: d.inTime || null,
          outTime: d.outTime || null,
          status: d.status,
          notes: d.notes.trim() || null,
        };
      })
      .filter(Boolean);
    if (!payload.length) { setErr("Mark at least one employee before saving."); return; }
    setBusy(true); setErr(null); setOk(null);
    try {
      const res = await jsonRequest("/api/human-resources/attendance", "PUT", { rows: payload });
      if (!res.ok) throw new Error(await readError(res));
      const out = await res.json();
      setOk(`Saved ${out.saved ?? payload.length} attendance record${(out.saved ?? payload.length) === 1 ? "" : "s"}.`);
      dash.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const summary = dash.data?.summary ?? [];
  const monthMarked = summary.reduce((s, r) => s + r.marked, 0);
  const monthHours = summary.reduce((s, r) => s + r.hours, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => changeDate(shiftDate(date, -1))} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">←</button>
          <input type="date" value={date} onChange={(e) => changeDate(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
          <button onClick={() => changeDate(shiftDate(date, 1))} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">→</button>
          <button onClick={() => changeDate(todayIST())} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">Today</button>
          <span className="ml-1 text-xs font-semibold text-zinc-500">{dateLabel(date)}{isSunday(date) ? " · Sunday off" : ""}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={markAllPresent} className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400">All present</button>
          <button onClick={save} disabled={busy || !changedCount} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-40">{busy ? "Saving…" : changedCount ? `Save ${changedCount} change${changedCount === 1 ? "" : "s"}` : "Saved"}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Team</div><div className="text-lg font-extrabold">{dayData?.summary.total ?? 0}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Marked</div><div className="text-lg font-extrabold text-indigo-500">{dayData?.summary.marked ?? 0}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Present</div><div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{dayData?.summary.present ?? 0}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Absent</div><div className="text-lg font-extrabold text-rose-500">{dayData?.summary.absent ?? 0}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">On leave</div><div className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{dayData?.summary.leave ?? 0}</div></div>
      </div>

      {dayData?.holiday && <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-3 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400">Company holiday · {dayData.holiday.name}</div>}
      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
      {ok && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">{ok}</div>}

      {dash.loading && !dash.data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading attendance…</div>}
      {Boolean(dash.error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">Failed to load: {String(dash.error)}</div>}

      {!dash.loading && rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">No active employees. Add employees to mark attendance.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[760px] border-collapse text-xs">
            <thead className="bg-zinc-50 text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">In time</th><th className="px-3 py-2">Out time</th><th className="px-3 py-2">Note</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const d = drafts[row.member.id] ?? { status: "", inTime: "", outTime: "", notes: "" };
                return (
                  <tr key={row.member.id} className="border-t border-zinc-100 dark:border-zinc-800/80">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {row.member.photoUrl ? <img src={row.member.photoUrl} alt="" className="h-7 w-7 rounded-lg object-cover" /> : <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 text-[10px] font-extrabold text-indigo-500">{initials(row.member.name)}</div>}
                        <div>
                          <div className="font-bold">{row.member.name}</div>
                          <div className="text-[10px] text-zinc-500">{row.member.designation || row.member.employeeCode || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {row.leave ? (
                        <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">Leave · {LEAVE_TYPE_LABEL[row.leave.leaveType]}{row.leave.paid ? "" : " (unpaid)"}</span>
                      ) : (
                        <select value={d.status} onChange={(e) => update(row.member.id, { status: e.target.value as AttendanceStatus | "" })} className={`${field} font-semibold ${statusTone(d.status)}`}>
                          <option value="">Not marked</option>
                          {ATTENDANCE_STATUSES.map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABEL[s]}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2"><input type="time" value={d.inTime} disabled={!!row.leave} onChange={(e) => update(row.member.id, { inTime: e.target.value, status: d.status || "present" })} className={field} /></td>
                    <td className="px-3 py-2"><input type="time" value={d.outTime} disabled={!!row.leave} onChange={(e) => update(row.member.id, { outTime: e.target.value, status: d.status || "present" })} className={field} /></td>
                    <td className="px-3 py-2"><input value={d.notes} disabled={!!row.leave} onChange={(e) => update(row.member.id, { notes: e.target.value })} placeholder="Optional" className={field} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
        <button onClick={() => setShowSummary((v) => !v)} className="flex w-full items-center justify-between px-3 py-2.5 text-left">
          <span className="text-xs font-bold">Monthly summary · {date.slice(0, 7)}</span>
          <span className="text-[11px] text-zinc-500">{monthMarked} marked · {hoursLabel(monthHours)} {showSummary ? "▲" : "▼"}</span>
        </button>
        {showSummary && (
          <div className="overflow-x-auto border-t border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[620px] border-collapse text-xs">
              <thead className="bg-zinc-50 text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                <tr><th className="px-3 py-2">Employee</th><th className="px-2 py-2">Present</th><th className="px-2 py-2">Half</th><th className="px-2 py-2">Absent</th><th className="px-2 py-2">Holiday</th><th className="px-2 py-2">Leave</th><th className="px-2 py-2">Hours</th></tr>
              </thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.member.id} className="border-t border-zinc-100 dark:border-zinc-800/80">
                    <td className="px-3 py-2 font-semibold">{r.member.name}</td>
                    <td className="px-2 py-2 font-bold text-emerald-600 dark:text-emerald-400">{r.present}</td>
                    <td className="px-2 py-2 text-amber-600 dark:text-amber-400">{r.halfDay}</td>
                    <td className="px-2 py-2 text-rose-500">{r.absent}</td>
                    <td className="px-2 py-2 text-indigo-500">{r.holiday}</td>
                    <td className="px-2 py-2 text-zinc-500">{r.leaveDays}</td>
                    <td className="px-2 py-2 text-zinc-500">{hoursLabel(r.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
