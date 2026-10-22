"use client";

import React, { useMemo, useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import SalarySlipEditor from "./SalarySlipEditor";
import SalaryTemplateModal from "./SalaryTemplateModal";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { type HrPayrollData, type HrSalarySlip, type PayrollStatus } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { currentMonthIST, initials, money, monthLabel, shiftMonth } from "@/hr/format";
import { downloadSalarySlipPdf } from "@/hr/salary-slip-pdf";

const STATUS_TONE: Record<PayrollStatus, string> = {
  draft: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  finalized: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  paid: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
};

type Pending = { slip: HrSalarySlip; action: "finalize" | "paid" | "reopen" };

export default function PayrollTab() {
  const [month, setMonth] = useState(currentMonthIST());
  const dash = useLiveDashboard<HrPayrollData>(async () => {
    const res = await fetch(`/api/human-resources/payroll?month=${encodeURIComponent(month)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Payroll load failed (HTTP ${res.status})`);
    return res.json();
  }, { deps: [month], pollMs: 60000 });

  const [filter, setFilter] = useState<"all" | PayrollStatus>("all");
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<HrSalarySlip | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const data = dash.data;
  const slips = useMemo(() => (data?.slips ?? []).filter((s) => filter === "all" || s.status === filter), [data?.slips, filter]);
  const missingSalary = (data?.employees ?? []).filter((e) => e.active && !e.hasSalary);

  const generate = async () => {
    setGenerating(true); setErr(null); setOk(null);
    try {
      const res = await jsonRequest("/api/human-resources/payroll/generate", "POST", { month });
      if (!res.ok) throw new Error(await readError(res));
      const out = await res.json();
      const skipped: { name: string; reason: string }[] = out.skipped ?? [];
      setOk(`Payroll generated · ${out.created ?? 0} created, ${out.updated ?? 0} updated${skipped.length ? `, ${skipped.length} skipped` : ""}.`);
      if (skipped.length) setErr(`Skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}`);
      dash.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Generate failed"); }
    finally { setGenerating(false); }
  };

  const changeStatus = async () => {
    if (!pending) return;
    setBusy(true); setErr(null); setOk(null);
    try {
      const res = await jsonRequest(`/api/human-resources/payroll/slips/${pending.slip.id}`, "PATCH", { action: pending.action });
      if (!res.ok) throw new Error(await readError(res));
      setOk(pending.action === "finalize" ? "Slip finalized." : pending.action === "paid" ? "Slip marked paid." : "Slip reopened as draft.");
      setPending(null);
      dash.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Update failed"); }
    finally { setBusy(false); }
  };

  const download = async (slip: HrSalarySlip) => {
    setBusyId(slip.id); setErr(null);
    try { await downloadSalarySlipPdf(slip); }
    catch (e) { setErr(e instanceof Error ? e.message : "PDF download failed"); }
    finally { setBusyId(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">←</button>
          <span className="min-w-28 text-center text-xs font-bold">{monthLabel(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">→</button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setTemplatesOpen(true)} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Salary templates</button>
          <button onClick={generate} disabled={generating} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-40">{generating ? "Generating…" : data?.slips.length ? "Regenerate drafts" : "Generate payroll"}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Slips</div><div className="text-lg font-extrabold">{data?.summary.slipCount ?? 0}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Draft</div><div className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{data?.summary.draftCount ?? 0}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Net payout</div><div className="text-lg font-extrabold">{money(data?.summary.totalNet ?? 0)}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase text-zinc-500">Deductions</div><div className="text-lg font-extrabold text-rose-500">{money(data?.summary.totalDeductions ?? 0)}</div></div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(["all", "draft", "finalized", "paid"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1.5 text-xs font-bold capitalize ${filter === f ? "border-transparent bg-indigo-600 text-white" : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}>{f}</button>
          ))}
        </div>
        <div className="text-[10px] text-zinc-500">Unmarked attendance counts as absent. Edit a draft to adjust lines.</div>
      </div>

      {missingSalary.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
          {missingSalary.length} active employee{missingSalary.length === 1 ? "" : "s"} missing a salary structure: {missingSalary.map((e) => e.name).join(", ")}. Assign a salary template in Employees, then regenerate.
        </div>
      )}
      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
      {ok && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">{ok}</div>}
      {dash.loading && !data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading payroll…</div>}
      {Boolean(dash.error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">Failed to load: {String(dash.error)}</div>}

      {!dash.loading && slips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">{data?.slips.length ? "No slips in this status." : `No payroll for ${monthLabel(month)} yet. Generate drafts after attendance and salary structures are ready.`}</div>
      ) : (
        <div className="space-y-2">
          {slips.map((slip) => (
            <div key={slip.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex flex-wrap items-center gap-3">
                {slip.employee?.photoUrl ? <img src={slip.employee.photoUrl} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-xs font-extrabold text-indigo-500">{initials(slip.employeeName)}</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold">{slip.employeeName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${STATUS_TONE[slip.status]}`}>{slip.status}</span>
                    {slip.employeeCode && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800">{slip.employeeCode}</span>}
                  </div>
                  <div className="text-[11px] text-zinc-500">{[slip.designation, slip.department].filter(Boolean).join(" · ") || "—"} · {slip.payableDays} payable / {slip.workingDays} days</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="font-extrabold">{money(slip.netPay)}</span>
                    <span className="text-zinc-500">net · gross {money(slip.earnedGross)} · deductions {money(slip.totalDeductions)}</span>
                    {slip.unmarkedDays > 0 && <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 font-bold text-amber-600 dark:text-amber-400">{slip.unmarkedDays} unmarked</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {slip.status === "draft" && <button onClick={() => setEditing(slip)} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Edit</button>}
                  {slip.status === "draft" && <button onClick={() => setPending({ slip, action: "finalize" })} className="rounded-lg bg-indigo-500/10 px-2 py-1.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400">Finalize</button>}
                  {slip.status === "finalized" && <button onClick={() => setPending({ slip, action: "paid" })} className="rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Mark paid</button>}
                  {slip.status !== "draft" && <button onClick={() => setPending({ slip, action: "reopen" })} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-amber-600 hover:bg-amber-500/10 dark:text-amber-400">Reopen</button>}
                  <button onClick={() => void download(slip)} disabled={busyId === slip.id} className="rounded-lg bg-zinc-900 px-2 py-1.5 text-[11px] font-bold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">{busyId === slip.id ? "PDF…" : "PDF"}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <SalarySlipEditor slip={editing} onClose={() => setEditing(null)} onSaved={() => dash.refresh()} />}
      {templatesOpen && <SalaryTemplateModal onClose={() => setTemplatesOpen(false)} />}
      <ConfirmDialog
        open={!!pending}
        title={pending?.action === "finalize" ? "Finalize salary slip?" : pending?.action === "paid" ? "Mark salary paid?" : "Reopen salary slip?"}
        message={pending?.action === "finalize"
          ? <>Finalize <b>{pending.slip.employeeName}</b> for {monthLabel(pending.slip.month)}? Lines lock after finalizing.</>
          : pending?.action === "paid"
          ? <>Mark <b>{pending?.slip.employeeName}</b> salary as paid? This records the payout date.</>
          : <>Reopen <b>{pending?.slip.employeeName}</b> as draft? You can edit and finalize it again.</>}
        confirmLabel={pending?.action === "finalize" ? "Finalize" : pending?.action === "paid" ? "Mark paid" : "Reopen"}
        busy={busy}
        onConfirm={changeStatus}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
