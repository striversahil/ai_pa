"use client";

// FieldStaffPanel — Sales → Field Staff tab.
//
// Daily field-visit surface (mobile-web first): manual check-in per location
// (city/address — automated location tracking is discontinued, no GPS is
// captured), mill rows (machine profile + requirement → auto Field-Staff
// enquiry), a GLOBAL follow-up queue and a GLOBAL day-wise expense calendar.
// Visits sort open-first, then recent → last, so the active location always
// sits on top. Deletes are sales-head/MIS only with double confirmation.

import React, { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { hasSalesManagerAccess } from "./SalesControllerPanel";
import {
  addMill, blankMillForm, checkIn, checkOut,
  deleteMill, deleteVisit, fetchFieldStaff, istToday, tomorrowIST,
  logExpenseDay, setFollowupStatus,
  setMillFlag, twoWeeksAgo, type MillForm,
} from "@/field-staff/api";
import { compareVisits, isVisitOpen, type FieldStaffData, type FieldVisit } from "@/field-staff/types";
import FieldExpenseCalendar from "./FieldExpenseCalendar";

const inputCls =
  "w-full px-2.5 py-1.5 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-lg outline-none focus:border-brand-indigo text-xs text-[var(--text-primary)]";

function StatusDot({ v }: { v: FieldVisit }) {
  if (isVisitOpen(v)) {
    return (
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0" title="Open visit — active location">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
    );
  }
  return <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-zinc-400" title="Checked out" />;
}

export default function FieldStaffPanel() {
  const { me } = useAuth();
  const canManage = hasSalesManagerAccess(me as any);
  const [staffId, setStaffId] = useState("");
  const [from, setFrom] = useState(twoWeeksAgo());
  const [to, setTo] = useState(istToday());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expenseStaffId, setExpenseStaffId] = useState("");
  const [msg, setMsg] = useState("");

  const query = useLiveDashboard(
    useCallback(() => fetchFieldStaff({ from, to, staffId: staffId || undefined }), [from, to, staffId]),
    { deps: [from, to, staffId] },
  );
  const data: FieldStaffData | null = query.data ?? null;
  const visits = useMemo(() => [...(data?.visits ?? [])].sort(compareVisits), [data]);
  const selected: FieldVisit | null = useMemo(
    () => visits.find((v) => v.id === selectedId) ?? visits[0] ?? null,
    [visits, selectedId],
  );
  const globalFollowups = useMemo(() => {
    const rows = data?.openFollowups ?? [];
    return [...rows].sort((a, b) => String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? "")));
  }, [data]);

  // Keep the expense staffer in sync with the visit filter (manual override wins).
  const staffList = data?.staff ?? [];
  const effectiveExpenseStaff = expenseStaffId || staffId || "";
  const pickStaff = (id: string) => {
    setStaffId(id);
    setExpenseStaffId(id);
    setSelectedId(null);
  };

  return (
    <div className="space-y-3">
      <CheckInBar
        staff={data?.staff ?? []}
        staffId={staffId}
        setStaffId={pickStaff}
        from={from} to={to} setFrom={setFrom} setTo={setTo}
        onDone={(m) => { setMsg(m); query.refresh(); }}
        onCheckedIn={(id) => { setSelectedId(id); query.refresh(); }}
      />
      {msg && <p className="text-[11px] text-[var(--text-secondary)]">{msg}</p>}
      {query.error ? <p className="text-xs text-red-600">Load failed: {String(query.error)} — <button className="underline" onClick={() => query.refresh()}>retry</button></p> : null}

      {/* Horizontal staffer tabs — toggle any individual field visit book. */}
      <div className="flex max-w-full items-center gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => pickStaff("")}
          className={`flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
            !staffId ? "bg-brand-indigo text-white ring-brand-indigo shadow" : "bg-[var(--bg-card)] text-[var(--text-secondary)] ring-[var(--border-card)]"
          }`}
        >
          All staff
        </button>
        {(data?.staff ?? []).map((s) => (
          <button
            key={s.id}
            onClick={() => pickStaff(s.id)}
            title={s.region ? `Region ${s.region}` : s.name}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 transition ${
              staffId === s.id
                ? "bg-brand-indigo text-white ring-brand-indigo shadow"
                : "bg-[var(--bg-card)] text-[var(--text-secondary)] ring-[var(--border-card)] hover:ring-brand-indigo/50"
            }`}
          >
            {s.name}{s.region ? ` · ${s.region}` : ""}
          </button>
        ))}
        {(data?.staff ?? []).length === 0 && !query.loading && (
          <span className="text-[11px] text-[var(--text-tertiary)]">No field staff in roster — add them in Controller → Roster (type = Field Staff).</span>
        )}
      </div>

      {data && (
        <div className="flex flex-wrap gap-2 text-[11px] font-bold text-[var(--text-secondary)]">
          <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 ring-1 ring-[var(--border-card)]">{data.totals.visits} visits</span>
          <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 ring-1 ring-[var(--border-card)]">{data.totals.mills} mills</span>
          <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 ring-1 ring-[var(--border-card)]">₹{Math.round(data.totals.expenses).toLocaleString("en-IN")} expenses</span>
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-400">{data.totals.openFollowups} open follow-ups</span>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <section className="space-y-2">
          <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Visits</h2>
          {visits.length === 0 && !query.loading && (
            <p className="rounded-xl border border-dashed border-[var(--border-card)] p-4 text-center text-[11px] text-[var(--text-tertiary)]">
              No visits in this window. Check in above to start the day.
            </p>
          )}
          <div className="space-y-2 border-l-2 border-[var(--border-card)] pl-3">
            {visits.map((v) => (
              <VisitCard
                key={v.id}
                v={v}
                active={selected?.id === v.id}
                canManage={canManage}
                onPick={() => setSelectedId(v.id)}
                onChanged={() => query.refresh()}
              />
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
            Mills{selected ? ` — ${selected.city} (${selected.day})` : ""}
          </h2>
          {!selected && <p className="text-[11px] text-[var(--text-tertiary)]">Pick a visit to see its mills.</p>}
          {selected && (
            <OpenVisitBanner visit={selected} onDone={(m) => { setMsg(m); query.refresh(); }} />
          )}
          {selected && (
            <MillList visit={selected} canManage={canManage} onDone={(m) => { if (m) setMsg(m); query.refresh(); }} />
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Follow-ups (global)</h2>
          <FollowupBox
            open={globalFollowups}
            onDone={() => query.refresh()}
          />
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Day-wise expenses</h2>
        <FieldExpenseCalendar
          expenses={data?.expenses ?? []}
          staff={staffList}
          expenseStaffId={effectiveExpenseStaff}
          onExpenseStaffChange={(id) => setExpenseStaffId(id)}
          onLog={async ({ day, staffId: sid, amount, description }) => {
            await logExpenseDay({ day, staffId: sid, amount, description });
            query.refresh();
          }}
        />
      </section>
    </div>
  );
}

function CheckInBar({ staff, staffId, setStaffId, from, to, setFrom, setTo, onDone, onCheckedIn }: {
  staff: Array<{ id: string; name: string; region: string }>;
  staffId: string; setStaffId: (v: string) => void;
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
  onDone: (m: string) => void;
  onCheckedIn: (visitId: string) => void;
}) {
  const [who, setWho] = useState(staffId);
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  // Single picker model: the visit filter and the check-in picker follow each other.
  React.useEffect(() => { if (staffId) setWho(staffId); }, [staffId]);

  const submit = async () => {
    if (!who) return onDone("Pick the field staff first.");
    if (!city.trim()) return onDone("Enter the location (city) first.");
    setBusy(true);
    try {
      const r = await checkIn({ telecallerId: who, city: city.trim(), address: address.trim() });
      const id = String((r as any)?.visit?.id ?? "");
      setCity(""); setAddress("");
      setStaffId(who);
      if (id) onCheckedIn(id);
      onDone(`Checked in at ${city.trim()} — now add the mills visited here.`);
    } catch (e: any) {
      onDone(String(e?.message ?? "check-in failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-36 flex-1 text-[11px] text-[var(--text-secondary)]">Field staff
          <select value={who} onChange={(e) => setWho(e.target.value)} className={`${inputCls} mt-1`}>
            <option value="">Select…</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.region ? ` · ${s.region}` : ""}</option>)}
          </select>
        </label>
        <label className="min-w-36 flex-1 text-[11px] text-[var(--text-secondary)]">Location (city)
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Ludhiana" className={`${inputCls} mt-1`} />
        </label>
        <label className="min-w-36 flex-1 text-[11px] text-[var(--text-secondary)]">Address (optional)
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Area / landmark" className={`${inputCls} mt-1`} />
        </label>
        <button onClick={submit} disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? "Saving…" : "Check in"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
        <label>Staff
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="ml-1 rounded-lg border border-[var(--border-card)] bg-white px-1.5 py-1 text-xs text-black">
            <option value="">All</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="ml-1 rounded-lg border border-[var(--border-card)] bg-white px-1.5 py-1 text-xs text-black" /></label>
        <label>To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="ml-1 rounded-lg border border-[var(--border-card)] bg-white px-1.5 py-1 text-xs text-black" /></label>
      </div>
    </div>
  );
}

function VisitCard({ v, active, canManage, onPick, onChanged }: {
  v: FieldVisit; active: boolean; canManage: boolean;
  onPick: () => void; onChanged: () => void;
}) {
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);

  const del = async () => {
    if (!arming) { setArming(true); return; }
    setBusy(true);
    try { await deleteVisit(v.id); onChanged(); }
    catch { setBusy(false); setArming(false); }
  };

  return (
    <div className={`w-full rounded-xl border p-2.5 text-left transition ${
      active
        ? "border-brand-indigo bg-brand-indigo/5 shadow"
        : "border-[var(--border-card)] bg-[var(--bg-card)] hover:border-brand-indigo/50"
    }`}>
      <button onClick={onPick} title={(v.mills ?? []).map((m) => m.millName).join(", ") || "No mills yet"} className="w-full text-left">
        <div className="flex items-center gap-2">
          <StatusDot v={v} />
          <span className="truncate text-xs font-extrabold text-[var(--text-primary)]">{v.city || "—"}</span>
          {!isVisitOpen(v) && <span className="rounded-full bg-zinc-500/10 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500">closed</span>}
          <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">{v.day.slice(5)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-secondary)]">
          <span className="font-bold">{v.staffName}</span>
          {v.region && <span>{v.region}</span>}
          <span>· {(v.mills ?? []).length} mills</span>
          {(v.followups ?? []).filter((f) => f.status === "open").length > 0 && (
            <span className="font-bold text-amber-600 dark:text-amber-400">
              · {(v.followups ?? []).filter((f) => f.status === "open").length} follow-up
            </span>
          )}
          {v.expenseTotal > 0 && <span>· ₹{Math.round(v.expenseTotal).toLocaleString("en-IN")}</span>}
        </div>
        {(v.mills ?? []).length > 0 && (
          <div className="mt-1 truncate text-[10px] text-[var(--text-tertiary)]">
            {(v.mills ?? []).map((m) => m.millName).filter(Boolean).join(" · ").slice(0, 90)}
          </div>
        )}
      </button>
      {canManage && (
        <div className="mt-1.5 flex justify-end">
          <button
            disabled={busy}
            onClick={del}
            className={`rounded-lg px-2 py-1 text-[10px] font-bold ring-1 disabled:opacity-50 ${
              arming ? "bg-red-600 text-white ring-red-600" : "text-red-600 ring-red-500/30 hover:bg-red-500/10"
            }`}
          >
            {busy ? "Deleting…" : arming ? "Confirm delete visit?" : "Delete"}
          </button>
          {arming && (
            <button onClick={() => setArming(false)} className="ml-1 rounded-lg px-2 py-1 text-[10px] font-bold text-[var(--text-secondary)]">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OpenVisitBanner({ visit, onDone }: { visit: FieldVisit; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (visit.checkOutAt) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
      <StatusDot v={visit} />
      <span className="text-[11px] font-bold text-[var(--text-primary)]">
        Open since {visit.checkInAt ? new Date(visit.checkInAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
      </span>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await checkOut(visit.id); onDone(`Checked out of ${visit.city}.`); }
          catch (e: any) { onDone(String(e?.message ?? "check-out failed")); }
          finally { setBusy(false); }
        }}
        className="ml-auto rounded-lg bg-[var(--bg-card)] px-2.5 py-1 text-[11px] font-extrabold ring-1 ring-[var(--border-card)] hover:bg-black/5"
      >
        Check out
      </button>
    </div>
  );
}

function MillList({ visit, canManage, onDone }: { visit: FieldVisit; canManage: boolean; onDone: (m?: string) => void }) {
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

function FollowupToggle({ m, onDone }: { m: any; onDone: () => void }) {
  const [picking, setPicking] = useState(false);
  const [due, setDue] = useState(tomorrowIST());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (m.followUpNeeded) {
    return (
      <button
        onClick={async () => { await setMillFlag(m.id, m.isNewManual, false); onDone(); }}
        className="ml-auto rounded-lg bg-amber-500/15 px-2 py-1 text-[10px] font-extrabold text-amber-600 ring-1 ring-amber-500/40"
        title="Follow-up is on — click to cancel the open follow-up"
      >
        ★ Follow-up on
      </button>
    );
  }
  if (!picking) {
    return (
      <button
        onClick={() => { setPicking(true); setDue(tomorrowIST()); }}
        className="ml-auto rounded-lg px-2 py-1 text-[10px] font-extrabold text-[var(--text-secondary)] ring-1 ring-[var(--border-card)]"
      >
        ☆ Follow-up
      </button>
    );
  }
  return (
    <div className="ml-auto flex flex-wrap items-center gap-1 rounded-lg bg-amber-500/5 p-1.5 ring-1 ring-amber-500/30">
      <input type="date" value={due} min={istToday()} onChange={(e) => setDue(e.target.value)} className="rounded-md border border-[var(--border-card)] bg-[var(--bg-input)] px-1.5 py-1 text-[10px]" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-28 rounded-md border border-[var(--border-card)] bg-[var(--bg-input)] px-1.5 py-1 text-[10px]" />
      <button
        disabled={busy}
        onClick={async () => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return setErr("Pick a date.");
          if (due < istToday()) return setErr("No past dates.");
          setBusy(true); setErr("");
          try { await setMillFlag(m.id, m.isNewManual, true, { dueDate: due, note }); onDone(); }
          catch (e: any) { setErr(String(e?.message ?? "failed")); }
          finally { setBusy(false); }
        }}
        className="rounded-md bg-amber-500 px-2 py-1 text-[10px] font-extrabold text-white disabled:opacity-50"
      >
        Set
      </button>
      <button onClick={() => setPicking(false)} className="px-1 text-[10px] font-bold text-[var(--text-tertiary)]">✕</button>
      {err && <span className="w-full text-[10px] text-red-600">{err}</span>}
    </div>
  );
}

function MillFacts({ m }: { m: any }) {
  const rows: Array<[string, string]> = [
    ["Contact", [m.keyContact, m.designation].filter(Boolean).join(" · ")],
    ["Phone", m.phone],
    ["Roller plant", m.rollerPlantNos],
    ["Atta chakki", m.attaChakkiNos],
    ["Chakki size", m.chakkiSize],
    ["Running", m.runningTime],
    ["Products", m.products],
    ["Mill age", m.millAgeYrs ? `${m.millAgeYrs} yrs` : ""],
    ["Brand", m.machineBrand],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="flex gap-1.5"><dt className="text-[var(--text-tertiary)]">{k}:</dt><dd className="font-semibold text-[var(--text-primary)]">{v}</dd></div>
      ))}
      {!m.isNew && m.matchMasterName && (
        <div className="col-span-2 flex gap-1.5"><dt className="text-[var(--text-tertiary)]">Matches:</dt><dd className="font-semibold text-[var(--text-primary)]">{m.matchMasterName}</dd></div>
      )}
    </dl>
  );
}

function FollowupBox({ open, onDone }: {
  open: Array<any>; onDone: () => void;
}) {
  const done = async (id: string) => {
    await setFollowupStatus(id, "done");
    onDone();
  };

  return (
    <div className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-3">
      <p className="text-xs font-extrabold text-[var(--text-primary)]">Follow-ups <span className="text-[var(--text-tertiary)]">({open.length} open)</span></p>
      <div className="mt-2 max-h-[380px] space-y-1.5 overflow-y-auto">
        {open.map((f) => {
          const dueLabel = String(f.dueDate ?? "").slice(0, 10);
          return (
          <div key={f.id} className="rounded-lg bg-amber-500/5 p-2 text-[11px] ring-1 ring-amber-500/20">
            <div className="flex items-center gap-2">
              <span className="truncate font-extrabold text-[var(--text-primary)]">
                {f.millName || "Follow-up"} <span className="font-bold text-amber-700 dark:text-amber-300">· {dueLabel ? `due ${dueLabel.slice(5)}` : "no date"}</span>
              </span>
            </div>
            {f.note && <p className="mt-0.5 whitespace-pre-wrap text-[var(--text-secondary)]">{f.note}</p>}
            <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">logged {f.day ? `${f.day}` : ""}</p>
            <div className="mt-1 flex gap-2">
              <button onClick={() => void done(f.id)} className="text-[10px] font-extrabold text-emerald-600">✓ Done</button>
              <button onClick={async () => { await setFollowupStatus(f.id, "cancelled"); onDone(); }} className="text-[10px] font-bold text-[var(--text-tertiary)]">Cancel</button>
            </div>
          </div>
          );
        })}
        {open.length === 0 && <p className="text-[11px] text-[var(--text-tertiary)]">Nothing pending here. Done items leave this queue.</p>}
      </div>
    </div>
  );
}
