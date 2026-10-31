"use client";

import React, { useMemo, useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import EmployeeFormModal from "./EmployeeFormModal";
import { useLiveDashboard } from "@/hooks/useLiveData";
import type { HrEmployee } from "@/hr/types";
import { jsonRequest, readError } from "@/hr/api";
import { initials, money, shortDate } from "@/hr/format";

function EmployeeCard({ employee, onEdit, onToggle, onDelete }: {
  employee: HrEmployee;
  onEdit: (e: HrEmployee) => void;
  onToggle: (e: HrEmployee) => void;
  onDelete: (e: HrEmployee) => void;
}) {
  return (
    <div className={`rounded-xl border p-3 ${employee.active ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950" : "border-zinc-200/60 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40"}`}>
      <div className="flex items-start gap-3">
        {employee.photoUrl ? (
          <img src={employee.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl border border-zinc-200 object-cover dark:border-zinc-700" />
        ) : (
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-extrabold ${employee.active ? "bg-indigo-500/10 text-indigo-500" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800"}`}>{initials(employee.name)}</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="truncate text-sm font-bold">{employee.name}</h4>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${employee.active ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-zinc-500"}`}>{employee.active ? "Active" : "Inactive"}</span>
            {employee.employeeCode && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800">{employee.employeeCode}</span>}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            {[employee.designation, employee.department].filter(Boolean).join(" · ") || "No designation"}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
            {employee.phone && <span>{employee.phone}</span>}
            {employee.email && <span className="truncate">{employee.email}</span>}
            {employee.joiningDate && <span>Joined {shortDate(employee.joiningDate)}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-extrabold text-zinc-800 dark:text-zinc-100">{money(employee.grossSalary)} <span className="font-medium text-zinc-500">/ month</span></span>
            {employee.salaryTemplate && <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-bold text-indigo-500">{employee.salaryTemplate.name}</span>}
            {employee.salaryTemplateOutdated && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-bold text-amber-600 dark:text-amber-400">Template updated</span>}
            {employee.salaryComponents.length === 0 && <span className="text-rose-500">Salary structure missing</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={() => onEdit(employee)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Edit</button>
          <button onClick={() => onToggle(employee)} className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${employee.active ? "text-amber-600 hover:bg-amber-500/10 dark:text-amber-400" : "text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"}`}>{employee.active ? "Deactivate" : "Activate"}</button>
          <button onClick={() => onDelete(employee)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10">Remove</button>
        </div>
      </div>
    </div>
  );
}

export default function EmployeesTab() {
  const dash = useLiveDashboard<{ members: HrEmployee[] }>(async () => {
    const res = await fetch("/api/human-resources/members", { cache: "no-store" });
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { pollMs: 60000 });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"active" | "inactive" | "all">("active");
  const [form, setForm] = useState<{ open: boolean; employee: HrEmployee | null }>({ open: false, employee: null });
  const [deleting, setDeleting] = useState<HrEmployee | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const employees = dash.data?.members ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter((e) => {
      if (view === "active" && !e.active) return false;
      if (view === "inactive" && e.active) return false;
      if (!q) return true;
      return [e.name, e.employeeCode, e.designation, e.department, e.phone, e.email, e.personalPhone, e.emergencyContactName, e.emergencyContactPhone]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }, [employees, query, view]);

  const toggle = async (employee: HrEmployee) => {
    setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/members/${employee.id}`, "PATCH", { active: !employee.active });
      if (!res.ok) throw new Error(await readError(res));
      dash.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Update failed"); }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true); setErr(null);
    try {
      const res = await jsonRequest(`/api/human-resources/members/${deleting.id}`, "DELETE");
      if (!res.ok) throw new Error(await readError(res));
      setDeleting(null);
      dash.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Remove failed"); }
    finally { setBusy(false); }
  };

  const activeCount = employees.filter((e) => e.active).length;
  const inactiveCount = employees.filter((e) => !e.active).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Active</div><div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{activeCount}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Inactive</div><div className="text-lg font-extrabold text-zinc-500">{inactiveCount}</div></div>
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950"><div className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-500">Monthly gross</div><div className="text-lg font-extrabold">{money(employees.filter((e) => e.active).reduce((s, e) => s + e.grossSalary, 0))}</div></div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, code, department…" className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-950" />
          {(["active", "inactive", "all"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${view === v ? "border-transparent bg-indigo-600 text-white" : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}>{v === "active" ? `Active (${activeCount})` : v === "inactive" ? `Inactive (${inactiveCount})` : `All (${employees.length})`}</button>
          ))}
        </div>
        <button onClick={() => setForm({ open: true, employee: null })} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500">Add employee</button>
      </div>

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
      {dash.loading && !dash.data && <div className="py-12 text-center text-sm text-zinc-500 animate-pulse">Loading employees…</div>}
      {Boolean(dash.error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">Failed to load: {String(dash.error)}</div>}

      {!dash.loading && filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-3 py-10 text-center text-xs text-zinc-500 dark:border-zinc-800">
          {employees.length === 0 ? "No employees yet. Add the first active employee." : "No employees match this filter."}
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {filtered.map((employee) => (
            <EmployeeCard key={employee.id} employee={employee} onEdit={(e) => setForm({ open: true, employee: e })} onToggle={toggle} onDelete={setDeleting} />
          ))}
        </div>
      )}

      {form.open && <EmployeeFormModal employee={form.employee} onClose={() => setForm({ open: false, employee: null })} onSaved={() => dash.refresh()} />}

      <ConfirmDialog
        open={!!deleting}
        title="Remove employee?"
        message={<>Remove <b>{deleting?.name}</b> permanently? Tasks, attendance and salary history stay in the database but the employee disappears from the master.</>}
        confirmLabel="Remove"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
