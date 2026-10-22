"use client";

import React, { useEffect, useState } from "react";
import Modal from "../Modal";
import SalaryComponentsEditor from "./SalaryComponentsEditor";
import SalaryPlanEditor from "./SalaryPlanEditor";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL, type EmploymentType, type HrEmployee, type HrSalaryComponent, type HrSalaryTemplate } from "@/hr/types";
import { applySalaryPlan, jsonRequest, listSalaryTemplates, readError, reapplySalaryPlan } from "@/hr/api";
import { fileToDataUrl, uploadMediaFile } from "@/lib/imageFiles";
import { initials, todayIST } from "@/hr/format";

const field = "w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const label = "block text-[11px] font-bold uppercase tracking-wide text-zinc-500 mb-1";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
      <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

export default function EmployeeFormModal({ employee, onClose, onSaved }: {
  employee?: HrEmployee | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!employee;
  const [form, setForm] = useState({
    name: employee?.name ?? "",
    employeeCode: employee?.employeeCode ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    designation: employee?.designation ?? "",
    department: employee?.department ?? "",
    photoUrl: employee?.photoUrl ?? "",
    joiningDate: employee?.joiningDate ?? todayIST(),
    exitDate: employee?.exitDate ?? "",
    employmentType: (employee?.employmentType ?? "full_time") as EmploymentType,
    active: employee?.active ?? true,
    dateOfBirth: employee?.dateOfBirth ?? "",
    address: employee?.address ?? "",
    emergencyContactName: employee?.emergencyContactName ?? "",
    emergencyContactPhone: employee?.emergencyContactPhone ?? "",
    pan: employee?.pan ?? "",
    aadhaarLast4: employee?.aadhaarLast4 ?? "",
    bankName: employee?.bankName ?? "",
    bankAccountNumber: employee?.bankAccountNumber ?? "",
    bankIfsc: employee?.bankIfsc ?? "",
    pfNumber: employee?.pfNumber ?? "",
    esiNumber: employee?.esiNumber ?? "",
    notes: employee?.notes ?? "",
  });
  const [components, setComponents] = useState<HrSalaryComponent[]>(
    employee?.salaryComponents?.length
      ? employee.salaryComponents.map((c) => ({ ...c }))
      : [{ name: "Basic", componentType: "earning", calcType: "fixed", value: 0, isBasic: true, order: 0 }],
  );
  const initialTemplateId = employee?.salaryTemplateId ?? "";
  const initialPlanAmount = employee?.salaryInputAmount ? String(employee.salaryInputAmount) : "";
  const [templates, setTemplates] = useState<HrSalaryTemplate[]>([]);
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [planAmount, setPlanAmount] = useState(initialPlanAmount);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const planDirty = templateId !== initialTemplateId || planAmount !== initialPlanAmount;

  useEffect(() => {
    let alive = true;
    listSalaryTemplates()
      .then((rows) => { if (alive) setTemplates(rows); })
      .catch(() => { /* templates stay unavailable; legacy structure remains editable */ });
    return () => { alive = false; };
  }, []);

  const reapply = async () => {
    if (!employee) return;
    setBusy(true); setErr(null);
    try {
      const updated: any = await reapplySalaryPlan(employee.id);
      setTemplateId(updated?.salaryTemplateId ?? initialTemplateId);
      setPlanAmount(updated?.salaryInputAmount ? String(updated.salaryInputAmount) : initialPlanAmount);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Reapply failed");
    } finally { setBusy(false); }
  };

  const uploadPhoto = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("Choose an image file for the photo"); return; }
    setUploading(true); setErr(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const uploaded = await uploadMediaFile(dataUrl, file.name);
      if (!uploaded?.url) throw new Error("Photo upload failed");
      set("photoUrl", uploaded.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Photo upload failed");
    } finally { setUploading(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setErr("Employee name is required"); return; }
    setBusy(true); setErr(null);
    try {
      const body = {
        ...form,
        name: form.name.trim(),
        employeeCode: form.employeeCode.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        designation: form.designation.trim() || null,
        department: form.department.trim() || null,
        joiningDate: form.joiningDate || null,
        exitDate: form.exitDate || null,
        dateOfBirth: form.dateOfBirth || null,
        photoUrl: form.photoUrl || null,
        address: form.address.trim() || null,
        emergencyContactName: form.emergencyContactName.trim() || null,
        emergencyContactPhone: form.emergencyContactPhone.trim() || null,
        pan: form.pan.trim().toUpperCase() || null,
        aadhaarLast4: form.aadhaarLast4.trim() || null,
        bankName: form.bankName.trim() || null,
        bankAccountNumber: form.bankAccountNumber.trim() || null,
        bankIfsc: form.bankIfsc.trim().toUpperCase() || null,
        pfNumber: form.pfNumber.trim() || null,
        esiNumber: form.esiNumber.trim() || null,
        notes: form.notes.trim() || null,
      };
      const res = editing
        ? await jsonRequest(`/api/human-resources/members/${employee!.id}`, "PATCH", body)
        : await jsonRequest("/api/human-resources/members", "POST", body);
      if (!res.ok) throw new Error(await readError(res));
      const saved = await res.json();
      if (templateId) {
        if (!editing || planDirty) {
          const amount = Number(planAmount);
          if (!(amount > 0)) throw new Error("Enter the monthly salary amount for the selected template");
          await applySalaryPlan(saved.id, { templateId, inputAmount: amount });
        }
      } else if (!editing || !employee?.salaryTemplateId) {
        const compRes = await jsonRequest(`/api/human-resources/members/${saved.id}/salary-components`, "PUT", {
          salaryComponents: components.map((c, index) => ({ ...c, order: index })),
        });
        if (!compRes.ok) throw new Error(await readError(compRes));
      }
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <Modal
      title={editing ? `Edit employee · ${employee?.name}` : "Add employee"}
      subtitle="Employee master record, statutory details and salary structure"
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-center gap-3">
          {form.photoUrl ? (
            <img src={form.photoUrl} alt="" className="h-16 w-16 rounded-2xl border border-zinc-200 object-cover dark:border-zinc-700" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 text-lg font-extrabold text-indigo-500">{initials(form.name)}</div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
              {uploading ? "Uploading…" : form.photoUrl ? "Change photo" : "Add photo"}
              <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(e) => { void uploadPhoto(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </label>
            {form.photoUrl && <button type="button" onClick={() => set("photoUrl", "")} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-500 hover:bg-rose-500/10">Remove</button>}
            <span className="text-[10px] text-zinc-500">JPG/PNG · downscaled automatically</span>
          </div>
        </div>

        <Section title="Basic details">
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className={label}>Full name</label><input value={form.name} onChange={(e) => set("name", e.target.value)} className={field} autoFocus /></div>
            <div><label className={label}>Employee code</label><input value={form.employeeCode} onChange={(e) => set("employeeCode", e.target.value)} className={field} placeholder="e.g. BUI-014" /></div>
            <div><label className={label}>Designation</label><input value={form.designation} onChange={(e) => set("designation", e.target.value)} className={field} /></div>
            <div><label className={label}>Department</label><input value={form.department} onChange={(e) => set("department", e.target.value)} className={field} /></div>
            <div><label className={label}>Phone</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} className={field} /></div>
            <div><label className={label}>Email</label><input value={form.email} onChange={(e) => set("email", e.target.value)} className={field} /></div>
            <div><label className={label}>Date of birth</label><input type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} className={field} /></div>
            <div><label className={label}>Address</label><input value={form.address} onChange={(e) => set("address", e.target.value)} className={field} /></div>
          </div>
        </Section>

        <Section title="Employment">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className={label}>Joining date</label><input type="date" value={form.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} className={field} /></div>
            <div><label className={label}>Exit date</label><input type="date" value={form.exitDate} onChange={(e) => set("exitDate", e.target.value)} className={field} /></div>
            <div><label className={label}>Employment type</label><select value={form.employmentType} onChange={(e) => set("employmentType", e.target.value as EmploymentType)} className={field}>{EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</option>)}</select></div>
            <label className="flex items-end gap-2 pb-2 text-sm font-semibold"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /> Active employee</label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className={label}>Emergency contact</label><input value={form.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} className={field} /></div>
            <div><label className={label}>Emergency phone</label><input value={form.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} className={field} /></div>
          </div>
        </Section>

        <Section title="Statutory & bank">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className={label}>PAN</label><input value={form.pan} onChange={(e) => set("pan", e.target.value)} className={field} /></div>
            <div><label className={label}>Aadhaar last 4</label><input value={form.aadhaarLast4} onChange={(e) => set("aadhaarLast4", e.target.value)} maxLength={4} className={field} /></div>
            <div><label className={label}>PF number</label><input value={form.pfNumber} onChange={(e) => set("pfNumber", e.target.value)} className={field} /></div>
            <div><label className={label}>ESI number</label><input value={form.esiNumber} onChange={(e) => set("esiNumber", e.target.value)} className={field} /></div>
            <div><label className={label}>Bank name</label><input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} className={field} /></div>
            <div><label className={label}>Bank account</label><input value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} className={field} /></div>
            <div><label className={label}>IFSC</label><input value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value)} className={field} /></div>
          </div>
        </Section>

        {templates.length > 0 && (
          <SalaryPlanEditor
            employee={employee}
            templates={templates}
            templateId={templateId}
            amount={planAmount}
            onTemplateId={(id) => {
              setTemplateId(id);
              if (id && !planAmount) {
                const t = templates.find((row) => row.id === id);
                if (t?.isDefault) setPlanAmount(employee?.salaryInputAmount ? String(employee.salaryInputAmount) : "");
              }
            }}
            onAmount={setPlanAmount}
            onReapply={employee?.salaryTemplateId ? reapply : undefined}
          />
        )}
        {!templateId && (
          <SalaryComponentsEditor components={components} onChange={setComponents} />
        )}

        <Section title="Notes">
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={field} placeholder="Optional HR notes" />
        </Section>

        {err && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-500">{err}</div>}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-zinc-200 bg-[var(--bg-card)] py-2 dark:border-zinc-800">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy || uploading} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? "Saving…" : editing ? "Save employee" : "Add employee"}</button>
        </div>
      </form>
    </Modal>
  );
}
