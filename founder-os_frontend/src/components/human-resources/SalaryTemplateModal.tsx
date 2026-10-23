"use client";

import React, { useEffect, useState } from "react";
import Modal from "../Modal";
import ConfirmDialog from "../ui/ConfirmDialog";
import SalaryComponentsEditor from "./SalaryComponentsEditor";
import {
  deleteSalaryTemplate, listSalaryTemplates, saveSalaryTemplate, setDefaultSalaryTemplate,
} from "@/hr/api";
import type { HrSalaryComponent, HrSalaryTemplate, SalaryInputMode } from "@/hr/types";
import { resolveSalary } from "@/hr/salary";
import { money } from "@/hr/format";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

type Draft = {
  id?: string;
  name: string;
  description: string;
  inputMode: SalaryInputMode;
  isDefault: boolean;
  components: HrSalaryComponent[];
};

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  inputMode: "gross",
  isDefault: false,
  components: [
    { name: "Basic", componentType: "earning", calcType: "percent_gross", value: 50, isBasic: true, order: 0 },
    { name: "Special Allowance", componentType: "earning", calcType: "balance", value: 0, isBasic: false, order: 9 },
    { name: "Provident Fund", componentType: "deduction", calcType: "formula", value: 0, formula: "min(basic, 15000) * 0.12", code: "pf", isBasic: false, order: 10 },
  ],
});

function presetRow(key: string, mode: SalaryInputMode): HrSalaryComponent | null {
  if (key === "basic") return mode === "basic"
    ? { name: "Basic", componentType: "earning", calcType: "formula", value: 0, formula: "input", code: "basic", isBasic: true, order: 0 }
    : { name: "Basic", componentType: "earning", calcType: "percent_gross", value: 50, code: "basic", isBasic: true, order: 0 };
  if (key === "hra") return { name: "House Rent Allowance", componentType: "earning", calcType: "percent_basic", value: 50, code: "hra", isBasic: false, order: 1 };
  if (key === "special") return mode === "gross"
    ? { name: "Special Allowance", componentType: "earning", calcType: "balance", value: 0, code: "special", isBasic: false, order: 9 }
    : null;
  if (key === "pf") return { name: "Provident Fund", componentType: "deduction", calcType: "formula", value: 0, formula: "min(basic, 15000) * 0.12", code: "pf", isBasic: false, order: 10 };
  if (key === "esi") return { name: "Employee State Insurance", componentType: "deduction", calcType: "formula", value: 0, formula: "if(gross <= 21000, gross * 0.0075, 0)", code: "esi", isBasic: false, order: 11 };
  if (key === "pt") return { name: "Professional Tax", componentType: "deduction", calcType: "fixed", value: 0, code: "pt", isBasic: false, order: 12 };
  return null;
}

const PRESETS: { key: string; label: string }[] = [
  { key: "basic", label: "+ Basic" },
  { key: "hra", label: "+ HRA 50%" },
  { key: "special", label: "+ Balance allowance" },
  { key: "pf", label: "+ PF" },
  { key: "esi", label: "+ ESI" },
  { key: "pt", label: "+ PT" },
];

export default function SalaryTemplateModal({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<HrSalaryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sample, setSample] = useState("30000");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<HrSalaryTemplate | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    try { setTemplates(await listSalaryTemplates()); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load templates"); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let alive = true;
    listSalaryTemplates()
      .then((rows) => { if (alive) setTemplates(rows); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : "Could not load templates"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const edit = (template: HrSalaryTemplate) => {
    setDraft({
      id: template.id,
      name: template.name,
      description: template.description ?? "",
      inputMode: template.inputMode,
      isDefault: template.isDefault,
      components: template.components.map((row) => ({ ...row })),
    });
    setSample(template.inputMode === "basic" ? "15000" : "30000");
    setErr(null);
  };

  const create = () => { setDraft(emptyDraft()); setSample("30000"); setErr(null); };

  const switchMode = (mode: SalaryInputMode) => {
    setSample(mode === "basic" ? "15000" : "30000");
    setDraft((prev) => prev ? {
      ...prev,
      inputMode: mode,
      components: prev.components.filter((row) => mode === "gross" || (row.calcType !== "balance" && row.calcType !== "percent_gross")),
    } : prev);
  };

  const addPreset = (key: string) => {
    if (!draft) return;
    const row = presetRow(key, draft.inputMode);
    if (!row) return;
    if (row.code && draft.components.some((c) => c.code === row.code)) return;
    setDraft({ ...draft, components: [...draft.components.filter((c) => !(row.isBasic && c.isBasic)), { ...row, order: draft.components.length }] });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setErr("Template name is required"); return; }
    setBusy(true); setErr(null);
    try {
      await saveSalaryTemplate({
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        inputMode: draft.inputMode,
        isDefault: draft.isDefault,
        components: draft.components.map((row, index) => ({
          name: row.name, componentType: row.componentType, calcType: row.calcType,
          value: Number(row.value) || 0, formula: row.formula ?? null, code: row.code ?? null,
          cap: row.cap ?? null, floor: row.floor ?? null, isBasic: !!row.isBasic, order: index,
        })),
      }, draft.id);
      setDraft(null);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const makeDefault = async (template: HrSalaryTemplate) => {
    setBusy(true); setErr(null);
    try { await setDefaultSalaryTemplate(template.id); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not set default"); }
    finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true); setErr(null);
    try { await deleteSalaryTemplate(deleting.id); setDeleting(null); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Delete failed"); }
    finally { setBusy(false); }
  };

  const sampleAmount = Number(sample) || 0;
  let previewError = "";
  let preview: ReturnType<typeof resolveSalary> | null = null;
  if (draft) {
    try { preview = resolveSalary(draft.components, { inputMode: draft.inputMode, inputAmount: sampleAmount }); }
    catch (e) { previewError = e instanceof Error ? e.message : "Formula error"; }
  }

  return (
    <Modal title="Salary templates" subtitle="Reusable formula-driven structures assigned to employees" onClose={onClose} wide>
      {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}

      {draft ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
            <div><label className={label}>Template name</label><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} placeholder="e.g. Standard gross structure" /></div>
            <div><label className={label}>Employee enters</label><select value={draft.inputMode} onChange={(e) => switchMode(e.target.value as SalaryInputMode)} className={field}><option value="gross">Monthly gross</option><option value="basic">Monthly Basic</option></select></div>
            <label className="flex items-end gap-2 pb-2 text-xs font-semibold"><input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} /> Default</label>
            <div className="sm:col-span-3"><label className={label}>Description</label><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={field} placeholder="Optional note for HR" /></div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => <button key={p.key} type="button" onClick={() => addPreset(p.key)} className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">{p.label}</button>)}
          </div>

          <SalaryComponentsEditor
            components={draft.components}
            onChange={(rows) => setDraft({ ...draft, components: rows })}
            mode={draft.inputMode}
            inputAmount={sampleAmount}
          />

          <div className="grid gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800 sm:grid-cols-[160px_1fr]">
            <div><label className={label}>Preview {draft.inputMode}</label><input value={sample} onChange={(e) => setSample(e.target.value)} inputMode="decimal" className={field} /></div>
            <div className="flex items-end pb-1 text-xs">
              {previewError ? <span className="font-semibold text-rose-500">{previewError}</span> : preview ? (
                <span className="text-zinc-500">Basic <b className="text-zinc-800 dark:text-zinc-100">{money(preview.basic)}</b> · Gross <b className="text-zinc-800 dark:text-zinc-100">{money(preview.gross)}</b> · Net <b className="text-emerald-600 dark:text-emerald-400">{money(preview.gross - preview.deductions.reduce((sum, line) => sum + line.amount, 0))}</b></span>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <button type="button" onClick={() => { setDraft(null); setErr(null); }} disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300">Back</button>
            <button type="button" onClick={save} disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40">{busy ? "Saving…" : draft.id ? "Save template" : "Create template"}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-zinc-500">Template edits do not change employees who already applied it. Their salary plan shows “outdated” until reapplied.</div>
            <button type="button" onClick={create} className="flex-shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">+ New template</button>
          </div>

          {loading && <div className="py-10 text-center text-sm text-zinc-500 animate-pulse">Loading templates…</div>}
          {!loading && templates.length === 0 && <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">No salary templates yet.</div>}

          <div className="space-y-2">
            {templates.map((template) => (
              <div key={template.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold">{template.name}</span>
                      <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-500">{template.inputMode === "basic" ? "Basic input" : "Gross input"}</span>
                      {template.isDefault && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Default</span>}
                      {template.employeeCount > 0 && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800">{template.employeeCount} assigned</span>}
                    </div>
                    {template.description && <div className="mt-0.5 text-[11px] text-zinc-500">{template.description}</div>}
                    <div className="mt-1 text-[11px] text-zinc-500">{template.components.length} components · {template.components.map((c) => c.name).join(", ")}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => edit(template)} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Edit</button>
                    {!template.isDefault && <button type="button" onClick={() => void makeDefault(template)} disabled={busy} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-indigo-600 hover:bg-indigo-500/10 disabled:opacity-40 dark:text-indigo-400">Default</button>}
                    <button type="button" onClick={() => setDeleting(template)} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-rose-500 hover:bg-rose-500/10">Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete salary template?"
        message={<>Delete <b>{deleting?.name}</b>? Templates assigned to employees cannot be deleted; reassign those employees first.</>}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </Modal>
  );
}
