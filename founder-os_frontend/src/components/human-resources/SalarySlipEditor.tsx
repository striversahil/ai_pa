"use client";

import React, { useState } from "react";
import Modal from "../Modal";
import { type HrPayrollLine, type HrSalarySlip } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { money, monthLabel } from "@/hr/format";
import { round2 } from "@/hr/salary";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500";
const label = "block text-[10px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

function LineEditor({ title, lines, onChange }: { title: string; lines: HrPayrollLine[]; onChange: (lines: HrPayrollLine[]) => void }) {
  const total = round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold">{title}</div>
        <button type="button" onClick={() => onChange([...lines, { name: "", amount: 0 }])} className="rounded-lg bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">+ Add line</button>
      </div>
      {lines.length === 0 && <div className="text-[11px] text-zinc-500">No lines.</div>}
      {lines.map((line, index) => (
        <div key={index} className="grid grid-cols-[1fr_100px_auto] gap-1.5">
          <input value={line.name} onChange={(e) => onChange(lines.map((l, i) => i === index ? { ...l, name: e.target.value } : l))} placeholder="Component" className={field} />
          <input value={String(line.amount)} onChange={(e) => onChange(lines.map((l, i) => i === index ? { ...l, amount: Number(e.target.value) || 0 } : l))} inputMode="decimal" className={field} />
          <button type="button" onClick={() => onChange(lines.filter((_, i) => i !== index))} className="rounded-lg px-2 text-sm font-bold text-rose-500 hover:bg-rose-500/10">×</button>
        </div>
      ))}
      <div className="border-t border-zinc-200 pt-1.5 text-right text-xs font-bold dark:border-zinc-800">Total {money(total)}</div>
    </div>
  );
}

export default function SalarySlipEditor({ slip, onClose, onSaved }: {
  slip: HrSalarySlip;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [earnings, setEarnings] = useState<HrPayrollLine[]>(slip.earnings.map((l) => ({ ...l })));
  const [deductions, setDeductions] = useState<HrPayrollLine[]>(slip.deductions.map((l) => ({ ...l })));
  const [notes, setNotes] = useState(slip.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const gross = round2(earnings.reduce((s, l) => s + Number(l.amount || 0), 0));
  const componentDeductions = round2(deductions.reduce((s, l) => s + Number(l.amount || 0), 0));
  const absenceDeduction = Number(slip.absenceDeduction) || 0;
  const earnedGross = round2(gross - absenceDeduction);
  const net = round2(earnedGross - componentDeductions);

  const save = async () => {
    if (earnings.length === 0) { setErr("At least one earning line is required"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/payroll/slips/${slip.id}`, "PATCH", {
        earnings, deductions, notes: notes.trim() || null,
      });
      if (!res.ok) throw new Error(await readError(res));
      onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Salary slip · ${slip.employeeName}`} subtitle={`${monthLabel(slip.month)} · draft`} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 p-3 text-[11px] dark:border-zinc-800 sm:grid-cols-4">
          <div><div className={label}>Working days</div><div className="text-sm font-bold">{slip.workingDays}</div></div>
          <div><div className={label}>Payable days</div><div className="text-sm font-bold">{slip.payableDays} / {slip.eligibleDays}</div></div>
          <div><div className={label}>Present / half</div><div className="text-sm font-bold">{slip.presentDays} / {slip.halfDays}</div></div>
          <div><div className={label}>Unmarked</div><div className={`text-sm font-bold ${slip.unmarkedDays > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>{slip.unmarkedDays}</div></div>
          <div><div className={label}>Paid leave</div><div className="text-sm font-bold">{slip.paidLeaveDays}</div></div>
          <div><div className={label}>Unpaid leave</div><div className="text-sm font-bold">{slip.unpaidLeaveDays}</div></div>
          <div><div className={label}>Absent</div><div className="text-sm font-bold text-rose-500">{slip.absentDays}</div></div>
          <div><div className={label}>Per day</div><div className="text-sm font-bold">{money(slip.perDay)}</div></div>
        </div>

        {slip.unmarkedDays > 0 && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">{slip.unmarkedDays} unmarked day{slip.unmarkedDays === 1 ? " was" : "s were"} treated as absent. Mark attendance and regenerate to correct it.</div>}

        <div className="grid gap-3 md:grid-cols-2">
          <LineEditor title="Earnings" lines={earnings} onChange={setEarnings} />
          <LineEditor title="Deductions" lines={deductions} onChange={setDeductions} />
        </div>

        <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <div><div className={label}>Gross</div><div className="font-bold">{money(gross)}</div></div>
            <div><div className={label}>Absence</div><div className="font-bold text-rose-500">-{money(absenceDeduction)}</div></div>
            <div><div className={label}>Deductions</div><div className="font-bold text-rose-500">-{money(componentDeductions)}</div></div>
            <div><div className={label}>Earned gross</div><div className="font-bold">{money(earnedGross)}</div></div>
            <div><div className={label}>Net pay</div><div className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">{money(net)}</div></div>
          </div>
        </div>

        <div><label className={label}>Notes</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={field} /></div>
        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40">{busy ? "Saving…" : "Save draft"}</button>
        </div>
      </div>
    </Modal>
  );
}
