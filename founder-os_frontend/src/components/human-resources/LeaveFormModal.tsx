"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import { LEAVE_TYPES, LEAVE_TYPE_LABEL, type HrEmployee, type HrLeave, type LeaveType } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { todayIST } from "@/hr/format";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

export default function LeaveFormModal({ leave, employees, onClose, onSaved }: {
  leave?: HrLeave | null;
  employees: HrEmployee[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    memberId: leave?.memberId ?? employees.find((e) => e.active)?.id ?? "",
    leaveType: (leave?.leaveType ?? "casual") as LeaveType,
    paid: leave?.paid ?? true,
    startDate: leave?.startDate ?? todayIST(),
    endDate: leave?.endDate ?? todayIST(),
    reason: leave?.reason ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.memberId) { setErr("Select an employee"); return; }
    if (form.endDate < form.startDate) { setErr("End date cannot be before start date"); return; }
    setBusy(true); setErr(null);
    try {
      const body = { ...form, reason: form.reason.trim() || null };
      const res = leave
        ? await jsonRequest(`/api/human-resources/leaves/${leave.id}`, "PATCH", body)
        : await jsonRequest("/api/human-resources/leaves", "POST", body);
      if (!res.ok) throw new Error(await readError(res));
      onSaved(); onClose();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={leave ? "Edit leave" : "Record leave"} subtitle="Leave days exclude Sundays and company holidays" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Employee</label>
          <select value={form.memberId} onChange={(e) => set("memberId", e.target.value)} className={field}>
            <option value="">Select employee</option>
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}{emp.employeeCode ? ` · ${emp.employeeCode}` : ""}{emp.active ? "" : " (inactive)"}</option>)}
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className={label}>Leave type</label>
            <select value={form.leaveType} onChange={(e) => { const t = e.target.value as LeaveType; set("leaveType", t); set("paid", t !== "unpaid"); }} className={field}>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm font-semibold"><input type="checkbox" checked={form.paid} onChange={(e) => set("paid", e.target.checked)} /> Paid leave</label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><label className={label}>Start date</label><input type="date" value={form.startDate} onChange={(e) => { set("startDate", e.target.value); if (form.endDate < e.target.value) set("endDate", e.target.value); }} className={field} /></div>
          <div><label className={label}>End date</label><input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} className={field} /></div>
        </div>
        <div><label className={label}>Reason</label><textarea value={form.reason} onChange={(e) => set("reason", e.target.value)} rows={2} className={field} /></div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40">{busy ? "Saving…" : "Save leave"}</button>
        </div>
      </form>
    </Modal>
  );
}
