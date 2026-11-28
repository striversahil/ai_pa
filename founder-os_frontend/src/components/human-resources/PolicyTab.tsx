"use client";

// Policy — the company rules HR defines once and payroll applies every month:
// late arrivals, paid leave allowances and short leaves. Kept separate from
// the calendar so the editor stays a form, not a list of exceptions.
import React, { useEffect, useState } from "react";
import { getHrPolicy, saveHrPolicy } from "@/hr/api";
import { excessShortLeaves, latePenaltyDays } from "@/hr/policy";
import {
  EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL, LEAVE_TYPES, LEAVE_TYPE_LABEL,
  POLICY_APPLY_TO, POLICY_LATE_ACTIONS, POLICY_LEAVE_EXCESS, POLICY_SHORT_EXCESS,
  type EmploymentType, type HrPolicy, type HrPolicyLateRule, type HrPolicyLeaveAllowance,
  type HrPolicyShortLeave, type PolicyApplyTo, type PolicyLateAction,
  type PolicyLeaveExcess, type PolicyShortExcess,
} from "@/hr/types";

const field = "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500";
const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
const hint = "mt-1 text-[11px] text-zinc-500";

const LATE_ACTION_LABEL: Record<PolicyLateAction, string> = {
  half_day: "Deduct half a day",
  full_day: "Deduct a full day",
  warn: "Warn only (no deduction)",
};
const APPLY_LABEL: Record<PolicyApplyTo, string> = {
  once: "Once in that month",
  each: "For every late after the limit",
};
const LEAVE_EXCESS_LABEL: Record<PolicyLeaveExcess, string> = {
  unpaid: "Extra days are unpaid",
  block: "Block approvals once used up",
};
const SHORT_EXCESS_LABEL: Record<PolicyShortExcess, string> = {
  unpaid_half_day: "Each extra short leave costs half a day",
  warn: "Warn only (no deduction)",
};

function ScopeSelect({ value, onChange }: { value: EmploymentType | null; onChange: (value: EmploymentType | null) => void }) {
  return (
    <select className={field} value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as EmploymentType | null)}>
      <option value="">Everyone (company default)</option>
      {EMPLOYMENT_TYPES.map((type) => <option key={type} value={type}>{EMPLOYMENT_TYPE_LABEL[type]}</option>)}
    </select>
  );
}

function NumberField({ value, onChange, min = 0, max = 31 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <input type="number" min={min} max={max} step={1} className={field + " w-24"} value={value}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0))))} />
  );
}

export default function PolicyTab() {
  const [draft, setDraft] = useState<HrPolicy | null>(null);
  const [updated, setUpdated] = useState<{ at: string | null; by: string | null }>({ at: null, by: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getHrPolicy()
      .then((body) => { if (alive) { setDraft(body.policy); setUpdated({ at: body.updatedAt, by: body.updatedBy }); } })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Policy load failed"); });
    return () => { alive = false; };
  }, []);

  const patchLate = (patch: Partial<HrPolicyLateRule>) =>
    setDraft((d) => (d ? { ...d, lateRule: { ...d.lateRule, ...patch } } : d));
  const patchShort = (patch: Partial<HrPolicyShortLeave>) =>
    setDraft((d) => (d ? { ...d, shortLeave: { ...d.shortLeave, ...patch } } : d));
  const patchAllowance = (index: number, patch: Partial<HrPolicyLeaveAllowance>) =>
    setDraft((d) => d ? { ...d, leaveAllowances: d.leaveAllowances.map((row, i) => (i === index ? { ...row, ...patch } : row)) } : d);
  const addAllowance = () => setDraft((d) => d ? {
    ...d,
    leaveAllowances: [...d.leaveAllowances, {
      leaveType: "casual", paidDaysPerMonth: 1, maxDaysPerMonth: 0, excess: "unpaid", employmentType: null,
    }],
  } : d);
  const removeAllowance = (index: number) => setDraft((d) => d ? {
    ...d, leaveAllowances: d.leaveAllowances.filter((_, i) => i !== index),
  } : d);

  const save = async () => {
    if (!draft) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      const body = await saveHrPolicy(draft);
      setDraft(body.policy);
      setUpdated({ at: body.updatedAt, by: body.updatedBy });
      setNote("Policy saved — payroll uses it the next time slips are generated.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  };

  if (!draft) {
    return (
      <div className={card}>
        {err ? <p className="text-sm text-rose-500">{err}</p> : <p className="text-sm text-zinc-500 animate-pulse">Loading policy…</p>}
      </div>
    );
  }

  const lateExample = latePenaltyDays(draft.lateRule, draft.lateRule.allowedLates + 2);
  const shortExample = excessShortLeaves(draft.shortLeave, draft.shortLeave.maxPerMonth + 2);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
        <div>
          <h3 className="text-sm font-extrabold">Company policy</h3>
          <p className="mt-1 max-w-2xl text-[11px] text-zinc-500">
            One policy for the whole company, with optional rules per employment type. Defaults deduct nothing;
            every rule you add is applied by payroll to draft slips. A decided leave keeps the paid days it was decided with.
          </p>
          {updated.at && <p className="mt-1 text-[10px] text-zinc-400">Last saved {updated.at.slice(0, 16).replace("T", " ")}{updated.by ? " by " + updated.by : ""}</p>}
        </div>
        <button onClick={save} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
          {busy ? "Saving…" : "Save policy"}
        </button>
      </div>
      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-500">{err}</div>}
      {note && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">{note}</div>}

      <section className={card}>
        <h4 className="text-sm font-bold">Late arrivals</h4>
        <p className={hint}>A check-in after the shift start + grace is already marked Late. This decides what happens after the monthly allowance.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-[11px] font-semibold text-zinc-500">Late check-ins allowed / month
            <div className="mt-1"><NumberField value={draft.lateRule.allowedLates} onChange={(n) => patchLate({ allowedLates: n })} /></div>
          </label>
          <label className="text-[11px] font-semibold text-zinc-500">After the limit
            <select className={field + " mt-1 w-full"} value={draft.lateRule.action} onChange={(e) => patchLate({ action: e.target.value as PolicyLateAction })}>
              {POLICY_LATE_ACTIONS.map((a) => <option key={a} value={a}>{LATE_ACTION_LABEL[a]}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-zinc-500">Apply
            <select className={field + " mt-1 w-full"} value={draft.lateRule.applyTo} onChange={(e) => patchLate({ applyTo: e.target.value as PolicyApplyTo })}>
              {POLICY_APPLY_TO.map((a) => <option key={a} value={a}>{APPLY_LABEL[a]}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-zinc-500">Applies to
            <div className="mt-1"><ScopeSelect value={draft.lateRule.employmentType} onChange={(v) => patchLate({ employmentType: v })} /></div>
          </label>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">Example: {draft.lateRule.allowedLates + 2} late days in a month → {lateExample === 0 ? "no deduction" : lateExample + " day(s) deducted"}.</p>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold">Paid leave each month</h4>
            <p className={hint}>Allowance per leave type. No row means the leave&apos;s own paid/unpaid setting decides (today&apos;s behaviour).</p>
          </div>
          <button onClick={addAllowance} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">+ Add allowance</button>
        </div>
        {draft.leaveAllowances.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-[11px] text-zinc-500 dark:border-zinc-700">No allowances yet — every approved leave stays paid exactly like today.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {draft.leaveAllowances.map((row, index) => (
              <div key={index} className="grid gap-2 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800 sm:grid-cols-2 lg:grid-cols-6">
                <label className="text-[10px] font-bold uppercase text-zinc-400">Leave type
                  <select className={field + " mt-1 w-full"} value={row.leaveType} onChange={(e) => patchAllowance(index, { leaveType: e.target.value as HrPolicyLeaveAllowance["leaveType"] })}>
                    {LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>)}
                  </select>
                </label>
                <label className="text-[10px] font-bold uppercase text-zinc-400">Paid days / month
                  <div className="mt-1"><NumberField value={row.paidDaysPerMonth} onChange={(n) => patchAllowance(index, { paidDaysPerMonth: n })} /></div>
                </label>
                <label className="text-[10px] font-bold uppercase text-zinc-400">Total cap (0 = none)
                  <div className="mt-1"><NumberField value={row.maxDaysPerMonth} max={62} onChange={(n) => patchAllowance(index, { maxDaysPerMonth: n })} /></div>
                </label>
                <label className="text-[10px] font-bold uppercase text-zinc-400">If exceeded
                  <select className={field + " mt-1 w-full"} value={row.excess} onChange={(e) => patchAllowance(index, { excess: e.target.value as PolicyLeaveExcess })}>
                    {POLICY_LEAVE_EXCESS.map((v) => <option key={v} value={v}>{LEAVE_EXCESS_LABEL[v]}</option>)}
                  </select>
                </label>
                <label className="text-[10px] font-bold uppercase text-zinc-400">Applies to
                  <div className="mt-1"><ScopeSelect value={row.employmentType} onChange={(v) => patchAllowance(index, { employmentType: v })} /></div>
                </label>
                <div className="flex items-end">
                  <button onClick={() => removeAllowance(index)} className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-[11px] font-bold text-rose-500 hover:bg-rose-500/20">Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={card}>
        <h4 className="text-sm font-bold">Short leaves</h4>
        <p className={hint}>A short leave is a couple of hours away from work; it is never a full absent day unless it exceeds the allowance.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-[11px] font-semibold text-zinc-500">Short leaves allowed / month
            <div className="mt-1"><NumberField value={draft.shortLeave.maxPerMonth} onChange={(n) => patchShort({ maxPerMonth: n })} /></div>
          </label>
          <label className="text-[11px] font-semibold text-zinc-500">If exceeded
            <select className={field + " mt-1 w-full"} value={draft.shortLeave.excess} onChange={(e) => patchShort({ excess: e.target.value as PolicyShortExcess })}>
              {POLICY_SHORT_EXCESS.map((v) => <option key={v} value={v}>{SHORT_EXCESS_LABEL[v]}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-zinc-500">Applies to
            <div className="mt-1"><ScopeSelect value={draft.shortLeave.employmentType} onChange={(v) => patchShort({ employmentType: v })} /></div>
          </label>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">Example: {draft.shortLeave.maxPerMonth + 2} short leaves in a month → {shortExample === 0 ? "no deduction" : shortExample + " half day(s) unpaid"}.</p>
      </section>
    </div>
  );
}
