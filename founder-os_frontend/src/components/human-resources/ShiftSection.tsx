"use client";

import React, { useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { deleteShift, listShifts, saveShift } from "@/hr/api";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL, type EmploymentType, type HrShift } from "@/hr/types";
import Modal from "../Modal";
import ConfirmDialog from "../ui/ConfirmDialog";

const field = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950";
const label = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500";

function appliesTo(shift: HrShift): string {
  return shift.employmentType ? EMPLOYMENT_TYPE_LABEL[shift.employmentType] : "All types";
}

function ShiftFormModal({ shift, onClose, onSaved }: {
  shift: HrShift | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!shift;
  const [name, setName] = useState(shift?.name ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">(shift?.employmentType ?? "");
  const [startTime, setStartTime] = useState(shift?.startTime ?? "09:30");
  const [endTime, setEndTime] = useState(shift?.endTime ?? "18:30");
  const [graceMinutes, setGraceMinutes] = useState(String(shift?.graceMinutes ?? 10));
  const [active, setActive] = useState(shift?.active !== false);
  const [order, setOrder] = useState(String(shift?.order ?? 0));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Enter a shift name."); return; }
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: name.trim(),
        employmentType: employmentType || null,
        startTime,
        endTime,
        graceMinutes: Number(graceMinutes) || 0,
        active,
        order: Number(order) || 0,
      };
      await saveShift(body, editing ? shift!.id : undefined);
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? "Edit shift" : "Add shift"}
      subtitle="The expected check-in window. A later check-in is marked late automatically."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} placeholder="e.g. General shift" className={field} />
        </div>
        <div>
          <label className={label}>Applies to</label>
          <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType | "")} className={field}>
            <option value="">All employment types (company default)</option>
            {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>Start time</label><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={field} /></div>
          <div><label className={label}>End time</label><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={field} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>Grace (minutes)</label><input type="number" min={0} max={240} value={graceMinutes} onChange={(e) => setGraceMinutes(e.target.value)} className={field} /></div>
          <div><label className={label}>Order</label><input type="number" min={0} max={9999} value={order} onChange={(e) => setOrder(e.target.value)} className={field} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (available when assigning an employee)
        </label>
        <p className="text-[11px] text-zinc-500">An end time at or before the start is an overnight shift; attendance still derives late from the start + grace.</p>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? "Saving…" : editing ? "Save shift" : "Add shift"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Controller → Shifts: the check-in / check-out windows attendance derives
 *  "late" from. HR assigns one per employee (Employee form → Shift). */
export default function ShiftSection() {
  const dash = useLiveDashboard(async () => ({ shifts: await listShifts() }), { events: ["human-resources"], pollMs: 60000 });
  const [modal, setModal] = useState<{ shift: HrShift | null } | null>(null);
  const [pending, setPending] = useState<HrShift | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shifts = dash.data?.shifts ?? [];

  const remove = async () => {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteShift(pending.id);
      setPending(null);
      dash.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-extrabold">Shifts</h3>
          <p className="text-[11px] text-zinc-500">The expected check-in / check-out window per employment type. Assign a shift on the employee form; a check-in past the start + grace is marked late automatically.</p>
        </div>
        <button onClick={() => { setErr(null); setModal({ shift: null }); }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">Add shift</button>
      </div>
      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-500">{err}</div>}
      {shifts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">No shifts yet. Add one so attendance can mark late arrivals.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead className="bg-zinc-50 text-left text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr><th className="px-3 py-2">Shift</th><th className="px-3 py-2">Window</th><th className="px-3 py-2">Applies to</th><th className="px-3 py-2">Grace</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id} className="border-t border-zinc-100 dark:border-zinc-800/80">
                  <td className="px-3 py-2 font-semibold">{shift.name}{shift.active ? "" : <span className="ml-1 rounded-full bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500">Inactive</span>}</td>
                  <td className="px-3 py-2">{shift.startTime}–{shift.endTime}</td>
                  <td className="px-3 py-2 text-zinc-500">{appliesTo(shift)}</td>
                  <td className="px-3 py-2 text-zinc-500">{shift.graceMinutes}m</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => { setErr(null); setModal({ shift }); }} className="rounded-md px-2 py-1 text-[11px] font-bold text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-400">Edit</button>
                    <button onClick={() => { setErr(null); setPending(shift); }} className="rounded-md px-2 py-1 text-[11px] font-bold text-rose-500 hover:bg-rose-500/10">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ShiftFormModal shift={modal.shift} onClose={() => setModal(null)} onSaved={() => dash.refresh()} />
      )}

      <ConfirmDialog
        open={!!pending}
        title="Delete shift?"
        message={<>Delete <b>{pending?.name}</b>? Employees on it must be moved to another shift first.</>}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
