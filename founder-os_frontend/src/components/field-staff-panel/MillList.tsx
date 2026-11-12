"use client";

// Extracted verbatim from FieldStaffPanel.tsx by scripts/refactor/split-module.mjs.
// FieldStaffPanel.tsx re-exports everything public here, so existing imports keep working.
import type { FieldVisit } from "@/field-staff/types";
import { useState } from "react";
import { blankMillForm, tomorrowIST, istToday, addMill, deleteMill, setMillFlag } from "@/field-staff/api";
import type { MillForm } from "@/field-staff/api";
import { MillFacts } from "./MillFacts";
import { FollowupToggle } from "./FollowupToggle";
import { inputCls } from "./helpers";

export function MillList({ visit, canManage, onDone }: { visit: FieldVisit; canManage: boolean; onDone: (m?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MillForm>(blankMillForm());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [armingDel, setArmingDel] = useState<Record<string, boolean>>({});

  const patch = (k: keyof MillForm, v: string | boolean) => setForm((p) => {
    if (k === "followUpNeeded" && v === true && !p.dueDate) {
      return { ...p, followUpNeeded: true, dueDate: tomorrowIST() };
    }
    return { ...p, [k]: v };
  });

  const save = async () => {
    if (!form.millName.trim()) return setErr("Mill name is required.");
    if (form.followUpNeeded) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dueDate)) return setErr("Pick the follow-up date first.");
      if (form.dueDate < istToday()) return setErr("Follow-up date cannot be in the past.");
    }
    setBusy(true); setErr("");
    try {
      const r = await addMill(visit.id, form);
      setForm(blankMillForm()); setOpen(false);
      onDone((r as any)?.rosterWarning ? `Mill saved (${String((r as any).rosterWarning)}).` : undefined);
    } catch (e: any) {
      setErr(String(e?.message ?? "save failed"));
    } finally {
      setBusy(false);
    }
  };

  const delMill = async (id: string) => {
    if (!armingDel[id]) { setArmingDel((p) => ({ ...p, [id]: true })); return; }
    try { await deleteMill(id); onDone(); }
    catch (e: any) { setErr(String((e as any)?.message ?? "delete failed")); }
    finally { setArmingDel((p) => ({ ...p, [id]: false })); }
  };

  return (
    <div className="space-y-2">
      {(visit.mills ?? []).map((m) => {
        const ex = !!expanded[m.id];
        return (
          <div key={m.id} className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-2.5">
            <button onClick={() => setExpanded((p) => ({ ...p, [m.id]: !p[m.id] }))} className="flex w-full items-center gap-2 text-left">
              <span className="truncate text-xs font-extrabold text-[var(--text-primary)]">{m.millName}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase ring-1 ${
                m.isNew ? "bg-sky-500/10 text-sky-600 ring-sky-500/30 dark:text-sky-400" : "bg-zinc-500/10 text-zinc-500 ring-zinc-500/30"
              }`} title={m.isNewManual === null ? `Auto suggestion${m.matchMasterName ? `: matches ${m.matchMasterName}` : ""}` : "Manual override"}>
                {m.isNew ? "New" : "Existing"}
              </span>
              {m.enquiryId && <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400" title="Auto-created field enquiry">· enquiry ↗</span>}
              {m.followUpNeeded && <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400">· follow-up</span>}
              <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">{ex ? "▾" : "▸"}</span>
            </button>
            {ex && (
              <div className="mt-2 space-y-1 text-[11px] text-[var(--text-secondary)]">
                <MillFacts m={m} />
                {m.requirement && <p className="whitespace-pre-wrap rounded-lg bg-amber-500/5 p-2 text-[var(--text-primary)] ring-1 ring-amber-500/20"><b>Requirement:</b> {m.requirement}</p>}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="font-bold">New mill?</span>
                  <div className="flex overflow-hidden rounded-lg ring-1 ring-[var(--border-card)]">
                    {(["auto", "yes", "no"] as const).map((opt) => {
                      const active = opt === "auto" ? m.isNewManual === null : opt === "yes" ? m.isNewManual === true : m.isNewManual === false;
                      return (
                        <button key={opt}
                          onClick={async () => { await setMillFlag(m.id, opt === "auto" ? null : opt === "yes"); onDone(); }}
                          className={`px-2 py-1 text-[10px] font-extrabold ${active ? "bg-brand-indigo text-white" : "bg-transparent text-[var(--text-secondary)]"}`}>
                          {opt === "auto" ? "Auto" : opt === "yes" ? "New" : "Existing"}
                        </button>
                      );
                    })}
                  </div>
                  <FollowupToggle m={m} onDone={onDone} />
                </div>
                {canManage && (
                  <div className="flex justify-end gap-1 pt-1">
                    <button
                      onClick={() => void delMill(m.id)}
                      className={`rounded-lg px-2 py-1 text-[10px] font-bold ring-1 ${
                        armingDel[m.id] ? "bg-red-600 text-white ring-red-600" : "text-red-600 ring-red-500/30 hover:bg-red-500/10"
                      }`}
                    >
                      {armingDel[m.id] ? "Confirm delete mill?" : "Delete"}
                    </button>
                    {armingDel[m.id] && (
                      <button onClick={() => setArmingDel((p) => ({ ...p, [m.id]: false }))} className="rounded-lg px-2 py-1 text-[10px] font-bold text-[var(--text-secondary)]">
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!open ? (
        <button onClick={() => setOpen(true)}
          className="w-full rounded-xl border border-dashed border-[var(--border-card)] p-3 text-xs font-extrabold text-brand-indigo hover:bg-brand-indigo/5">
          + Add mill visited here
        </button>
      ) : (
        <div className="space-y-2 rounded-xl border border-brand-indigo/40 bg-[var(--bg-card)] p-3">
          <div className="grid grid-cols-2 gap-2">
            <input value={form.millName} onChange={(e) => patch("millName", e.target.value)} placeholder="Mill name *" className={`${inputCls} col-span-2 font-bold`} />
            <input value={form.keyContact} onChange={(e) => patch("keyContact", e.target.value)} placeholder="Key contact" className={inputCls} />
            <input value={form.designation} onChange={(e) => patch("designation", e.target.value)} placeholder="Designation" className={inputCls} />
            <input value={form.phone} onChange={(e) => patch("phone", e.target.value)} placeholder="Phone" inputMode="tel" className={inputCls} />
            <input value={form.rollerPlantNos} onChange={(e) => patch("rollerPlantNos", e.target.value)} placeholder="Roller plant (nos.)" className={inputCls} />
            <input value={form.attaChakkiNos} onChange={(e) => patch("attaChakkiNos", e.target.value)} placeholder="Atta chakki (nos.)" className={inputCls} />
            <input value={form.chakkiSize} onChange={(e) => patch("chakkiSize", e.target.value)} placeholder="Chakki size" className={inputCls} />
            <input value={form.runningTime} onChange={(e) => patch("runningTime", e.target.value)} placeholder="Running time" className={inputCls} />
            <input value={form.products} onChange={(e) => patch("products", e.target.value)} placeholder="Products" className={`${inputCls} col-span-2`} />
            <input value={form.millAgeYrs} onChange={(e) => patch("millAgeYrs", e.target.value)} placeholder="Mill age (yrs)" className={inputCls} />
            <input value={form.machineBrand} onChange={(e) => patch("machineBrand", e.target.value)} placeholder="Machine brand" className={inputCls} />
            <textarea value={form.requirement} onChange={(e) => patch("requirement", e.target.value)} placeholder="Requirement / Enquiry (creates a field enquiry instantly)" rows={2} className={`${inputCls} col-span-2`} />
          </div>
          <label className="flex items-center gap-2 text-[11px] font-bold text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.followUpNeeded} onChange={(e) => patch("followUpNeeded", e.target.checked)} />
            Mark for follow-up
          </label>
          {form.followUpNeeded && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] font-bold text-[var(--text-secondary)]">Follow-up date *
                <input type="date" value={form.dueDate} min={istToday()} onChange={(e) => patch("dueDate", e.target.value)} className={`${inputCls} mt-1`} required />
              </label>
              <label className="text-[11px] font-bold text-[var(--text-secondary)]">Follow-up note
                <input value={form.followupNote} onChange={(e) => patch("followupNote", e.target.value)} placeholder="What to ask on revisit" className={`${inputCls} mt-1`} />
              </label>
            </div>
          )}
          {err && <p className="text-[11px] text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="rounded-lg bg-brand-indigo px-3 py-1.5 text-xs font-extrabold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save mill"}
            </button>
            <button onClick={() => { setOpen(false); setErr(""); }} className="rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)]">Cancel</button>
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)]">New/Existing is auto-suggested from the Customer Master — flip it on the card after saving. A requirement instantly becomes a Field-Staff enquiry.</p>
        </div>
      )}
    </div>
  );
}
