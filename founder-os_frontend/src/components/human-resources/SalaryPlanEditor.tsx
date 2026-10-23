"use client";

import React from "react";
import type { HrEmployee, HrSalaryPreview, HrSalaryTemplate } from "@/hr/types";
import { resolveSalary } from "@/hr/salary";
import { money } from "@/hr/format";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

export default function SalaryPlanEditor({ employee, templates, templateId, amount, onTemplateId, onAmount, onReapply }: {
  employee?: HrEmployee | null;
  templates: HrSalaryTemplate[];
  templateId: string;
  amount: string;
  onTemplateId: (id: string) => void;
  onAmount: (value: string) => void;
  onReapply?: () => void;
}) {
  const selected = templates.find((t) => t.id === templateId) ?? null;
  const rows = selected?.components ?? employee?.salaryComponents ?? [];
  const inputMode = selected?.inputMode ?? employee?.salaryInputMode ?? null;
  const inputAmount = Number(amount) || null;
  let preview: HrSalaryPreview | null = null;
  let error = "";
  if (!selected || inputAmount) try {
    const resolved = resolveSalary(rows, { inputMode, inputAmount });
    const deductionTotal = resolved.deductions.reduce((sum, line) => sum + line.amount, 0);
    preview = {
      earnings: resolved.earnings,
      deductions: resolved.deductions,
      basic: resolved.basic,
      gross: resolved.gross,
      deductionTotal,
      netPay: resolved.gross - deductionTotal,
      inputMode: resolved.inputMode ?? "gross",
      inputAmount: resolved.inputAmount ?? 0,
      targetGross: resolved.targetGross,
    };
  } catch (e) {
    error = e instanceof Error ? e.message : "Salary formula error";
  }

  return (
    <section className="space-y-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500">Salary plan</h3>
          <div className="text-[10px] text-zinc-500">Pick a salary template, then enter monthly gross or Basic. Formulas cannot be edited per employee.</div>
        </div>
        {employee?.salaryTemplateOutdated && !selected && onReapply && (
          <button type="button" onClick={onReapply} className="rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">Reapply latest template</button>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className={label}>Salary template</label>
          <select value={templateId} onChange={(e) => onTemplateId(e.target.value)} className={field}>
            {!employee?.salaryTemplateId && <option value="">Custom / legacy structure</option>}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.isDefault ? " · default" : ""}{t.employeeCount ? ` · ${t.employeeCount} employee${t.employeeCount === 1 ? "" : "s"}` : ""}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>{inputMode === "basic" ? "Monthly basic" : "Monthly gross"}</label>
          <input value={amount} onChange={(e) => onAmount(e.target.value)} inputMode="decimal" className={field} placeholder={inputMode === "basic" ? "e.g. 15000" : "e.g. 30000"} disabled={!selected} />
        </div>
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-bold text-indigo-500">{selected.inputMode === "basic" ? "Basic input" : "Gross input"}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-500 dark:bg-zinc-800">{selected.components.length} components</span>
          {employee?.salaryTemplateOutdated && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-bold text-amber-600 dark:text-amber-400">Template updated since applied</span>}
        </div>
      )}
      {selected?.description && <p className="text-[11px] text-zinc-500">{selected.description}</p>}

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{error}</div>}

      {preview && (
        <>
          <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-800 sm:grid-cols-4">
            <div><div className="text-[10px] uppercase text-zinc-500">Basic</div><div className="font-bold">{money(preview.basic)}</div></div>
            <div><div className="text-[10px] uppercase text-zinc-500">Gross</div><div className="font-bold">{money(preview.gross)}</div></div>
            <div><div className="text-[10px] uppercase text-zinc-500">Deductions</div><div className="font-bold">{money(preview.deductionTotal)}</div></div>
            <div><div className="text-[10px] uppercase text-zinc-500">Net</div><div className="font-bold text-emerald-600 dark:text-emerald-400">{money(preview.netPay)}</div></div>
          </div>
          <details className="rounded-lg bg-zinc-50 p-2 text-[11px] dark:bg-zinc-900/50">
            <summary className="cursor-pointer font-bold text-zinc-600 dark:text-zinc-300">Formula breakdown</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-[10px] font-extrabold uppercase text-emerald-500">Earnings</div>
                {preview.earnings.map((line, i) => <div key={`${line.name}-${i}`} className="flex justify-between gap-2"><span className="truncate">{line.name}</span><span className="font-semibold">{money(line.amount)}</span></div>)}
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-extrabold uppercase text-rose-500">Deductions</div>
                {preview.deductions.length === 0 && <div className="text-zinc-500">None</div>}
                {preview.deductions.map((line, i) => <div key={`${line.name}-${i}`} className="flex justify-between gap-2"><span className="truncate">{line.name}</span><span className="font-semibold">{money(line.amount)}</span></div>)}
              </div>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
