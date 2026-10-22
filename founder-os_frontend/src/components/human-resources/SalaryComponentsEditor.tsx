"use client";

import React from "react";
import { COMPONENT_CALC_TYPES, COMPONENT_TYPES, type ComponentCalcType, type ComponentType, type HrSalaryComponent, type SalaryInputMode } from "@/hr/types";
import { resolveSalary } from "@/hr/salary";
import { money } from "@/hr/format";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500";
const label = "block text-[10px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

const CALC_LABEL: Record<ComponentCalcType, string> = {
  fixed: "Fixed",
  percent_basic: "% of Basic",
  percent_gross: "% of Gross",
  formula: "Formula",
  balance: "Balance",
};

export default function SalaryComponentsEditor({ components, onChange, mode = null, inputAmount = null }: {
  components: HrSalaryComponent[];
  onChange: (rows: HrSalaryComponent[]) => void;
  mode?: SalaryInputMode | null;
  inputAmount?: number | null;
}) {
  let resolved: ReturnType<typeof resolveSalary> | null = null;
  let resolveError = "";
  try { resolved = resolveSalary(components, { inputMode: mode, inputAmount }); }
  catch (e) { resolveError = e instanceof Error ? e.message : "Salary formula error"; }
  const update = (index: number, patch: Partial<HrSalaryComponent>) => {
    onChange(components.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const add = (type: ComponentType) => {
    onChange([...components, {
      name: type === "earning" ? "Allowance" : "Deduction",
      componentType: type,
      calcType: "fixed",
      value: 0,
      isBasic: false,
      order: components.length,
    }]);
  };
  const remove = (index: number) => onChange(components.filter((_, i) => i !== index));

  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-zinc-800 dark:text-zinc-100">Salary structure</div>
          <div className="text-[10px] text-zinc-500">Fixed or % of Basic/Gross. Mark one earning line as Basic.</div>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => add("earning")} className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">+ Earning</button>
          <button type="button" onClick={() => add("deduction")} className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-bold text-rose-500">+ Deduction</button>
        </div>
      </div>

      {components.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 px-3 py-5 text-center text-xs text-zinc-500">
          Add Basic and other salary components.
        </div>
      )}

      <div className="space-y-2">
        {components.map((row, index) => (
          <div key={`${row.componentType}-${index}`} className="grid gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 sm:grid-cols-[1.3fr_0.9fr_0.9fr_0.7fr_auto]">
            <div>
              <label className={label}>Name</label>
              <input value={row.name} onChange={(e) => update(index, { name: e.target.value })} className={field} />
            </div>
            <div>
              <label className={label}>Type</label>
              <select value={row.componentType} onChange={(e) => update(index, { componentType: e.target.value as ComponentType, isBasic: e.target.value === "deduction" ? false : row.isBasic, calcType: e.target.value === "earning" && row.calcType === "percent_gross" ? "fixed" : row.calcType })} className={field}>
                {COMPONENT_TYPES.map((t) => <option key={t} value={t}>{t === "earning" ? "Earning" : "Deduction"}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Calculation</label>
              <select value={row.calcType} onChange={(e) => update(index, { calcType: e.target.value as ComponentCalcType, value: e.target.value === "formula" || e.target.value === "balance" ? 0 : row.value })} className={field}>
                {COMPONENT_CALC_TYPES.filter((c) => {
                  if (c === "balance") return row.componentType === "earning" && mode !== "basic";
                  if (c === "percent_gross") return row.componentType === "earning" && mode !== "basic";
                  return true;
                }).map((c) => <option key={c} value={c}>{CALC_LABEL[c]}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>{row.calcType === "formula" || row.calcType === "balance" ? "Formula" : row.calcType === "fixed" ? "Amount" : "Percent"}</label>
              <input value={row.calcType === "formula" ? String(row.formula ?? "") : String(row.value)} onChange={(e) => row.calcType === "formula" ? update(index, { formula: e.target.value }) : update(index, { value: Number(e.target.value) || 0 })} inputMode={row.calcType === "formula" ? undefined : "decimal"} className={field} placeholder={row.calcType === "formula" ? "e.g. min(basic, 15000) * 0.12" : ""} disabled={row.calcType === "balance"} />
            </div>
            <div className="flex items-end gap-1.5 pb-0.5">
              {row.componentType === "earning" && (
                <label className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold text-zinc-500">
                  <input type="checkbox" checked={row.isBasic} onChange={(e) => onChange(components.map((r, i) => ({ ...r, isBasic: i === index ? e.target.checked : e.target.checked ? false : r.isBasic })))} />
                  Basic
                </label>
              )}
              <button type="button" onClick={() => remove(index)} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-rose-500 hover:bg-rose-500/10">×</button>
            </div>
            {(row.calcType === "formula" || row.calcType === "percent_basic" || row.calcType === "percent_gross") && (
              <div className="col-span-full grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <div><label className={label}>Code</label><input value={String(row.code ?? "")} onChange={(e) => update(index, { code: e.target.value })} className={field} placeholder="e.g. pf" /></div>
                <div><label className={label}>Floor</label><input value={row.floor === null || row.floor === undefined ? "" : String(row.floor)} onChange={(e) => update(index, { floor: e.target.value === "" ? null : Number(e.target.value) || 0 })} inputMode="decimal" className={field} placeholder="none" /></div>
                <div><label className={label}>Cap</label><input value={row.cap === null || row.cap === undefined ? "" : String(row.cap)} onChange={(e) => update(index, { cap: e.target.value === "" ? null : Number(e.target.value) || 0 })} inputMode="decimal" className={field} placeholder="none" /></div>
                <div className="flex items-end pb-1 text-[9px] text-zinc-500">vars: input, basic, gross</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {resolveError && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">{resolveError}</div>}
      <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-2 text-xs sm:grid-cols-4">
        <div><div className="text-[10px] uppercase text-zinc-500">Basic</div><div className="font-bold">{money(resolved?.basic ?? 0)}</div></div>
        <div><div className="text-[10px] uppercase text-zinc-500">Gross</div><div className="font-bold">{money(resolved?.gross ?? 0)}</div></div>
        <div><div className="text-[10px] uppercase text-zinc-500">Deductions</div><div className="font-bold">{money(resolved?.deductions.reduce((s, x) => s + x.amount, 0) ?? 0)}</div></div>
        <div><div className="text-[10px] uppercase text-zinc-500">Net</div><div className="font-bold text-emerald-600 dark:text-emerald-400">{money((resolved?.gross ?? 0) - (resolved?.deductions.reduce((s, x) => s + x.amount, 0) ?? 0))}</div></div>
      </div>
    </div>
  );
}
