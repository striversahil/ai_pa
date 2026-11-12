"use client";

// Extracted verbatim from FieldStaffPanel.tsx by scripts/refactor/split-module.mjs.
// FieldStaffPanel.tsx re-exports everything public here, so existing imports keep working.
import React, { useState } from "react";
import { checkIn } from "@/field-staff/api";
import { inputCls } from "./helpers";

export function CheckInBar({ staff, staffId, setStaffId, from, to, setFrom, setTo, onDone, onCheckedIn }: {
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
