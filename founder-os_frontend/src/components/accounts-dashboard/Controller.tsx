"use client";

// Extracted verbatim from AccountsDashboard.tsx by scripts/refactor/split-module.mjs.
// AccountsDashboard.tsx re-exports everything public here, so existing imports keep working.
import React, { useState } from "react";
import type { RosterRow, TemplateRow } from "./types";
import { ExportCard } from "./ExportCard";
import { RosterRowEditor } from "./RosterRowEditor";
import { TemplateCreator } from "./TemplateCreator";
import { FREQS, ROLES } from "./helpers";

export function Controller({ onChanged }: { onChanged: () => void }) {
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("junior");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setLoadError(null);
      const [rRes, tRes] = await Promise.all([
        fetch(`/api/accounts/roster${showRemoved ? "?deleted=1" : "?deleted=0"}`, { cache: "no-store" }),
        fetch("/api/accounts/templates?all=1", { cache: "no-store" }),
      ]);
      if (!rRes.ok) throw new Error(`roster HTTP ${rRes.status}`);
      if (!tRes.ok) throw new Error(`templates HTTP ${tRes.status}`);
      const [r, t] = await Promise.all([rRes.json(), tRes.json()]);
      setRoster(r.accountants ?? []);
      setTemplates(t.templates ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };
  React.useEffect(() => { load(); }, [showRemoved]);

  const api = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error(await res.text());
      await load();
      onChanged();
    } catch (e) {
      console.error(e);
      alert("Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ExportCard />
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <h3 className="font-bold text-sm">👥 Accountants — map person → Senior / Junior</h3>
        <div className="text-[11px] text-zinc-500">Same idea as the telecalling roster: each person is mapped by name + email, then flagged Senior or Junior. The taskbar splits on this flag.</div>
        <div className="grid grid-cols-2 gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. Ramesh" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email — e.g. ramesh@…" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs">
            <option value="junior">Junior</option>
            <option value="senior">Senior</option>
          </select>
          <button disabled={busy || !name.trim()} onClick={() => { api("/api/accounts/roster", "POST", { name: name.trim(), email: email.trim() || null, role }); setName(""); setEmail(""); }} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer border-0">Add</button>
        </div>
        {loadError && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-400">Controller failed to load: {loadError} <button onClick={() => load()} className="ml-1 underline cursor-pointer">Retry</button></div>}
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} className="accent-indigo-600" /> Show removed (restore)
        </label>
        <div className="space-y-1.5">
          {(roster ?? []).map((r) => (
            <RosterRowEditor key={r.id} row={r} busy={busy} onSave={(patch) => api(`/api/accounts/roster/${r.id}`, "PUT", patch)} onRemove={() => api(`/api/accounts/roster/${r.id}`, "DELETE")} onRestore={() => api(`/api/accounts/roster/${r.id}`, "PUT", { deleted: false })} />
          ))}
          {roster === null && !loadError && <div className="text-xs text-zinc-500 animate-pulse">Loading roster…</div>}
          {roster !== null && roster.length === 0 && !loadError && <div className="text-xs text-zinc-500">No accountants yet — add the senior and junior above.</div>}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <h3 className="font-bold text-sm">📋 Recurring tasks — daily / monthly / yearly</h3>
        <TemplateCreator onChanged={() => { load(); onChanged(); }} />
        <div className="text-[11px] text-zinc-500">Pick any schedule fashion — fixed day, several days, ranges, weekday, yearly dates, quarterly lists, or reference-only. Existing rows below can be edited, paused, or archived.</div>
        <div className="space-y-1.5 max-h-[420px] overflow-auto">
          {(templates ?? []).map((t) => (
            <div key={t.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${t.active ? "border-zinc-200 dark:border-zinc-800" : "border-dashed opacity-60"}`}>
              <span className="font-semibold flex-1 min-w-[120px] truncate">{t.title}</span>
              <select value={t.frequency} disabled={busy} onChange={(e) => api(`/api/accounts/templates/${t.id}`, "PUT", { frequency: e.target.value })} className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1 py-0.5 text-[11px]">
                {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select value={t.ownerRole} disabled={busy} onChange={(e) => api(`/api/accounts/templates/${t.id}`, "PUT", { ownerRole: e.target.value })} className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1 py-0.5 text-[11px]">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button disabled={busy} onClick={() => api(`/api/accounts/templates/${t.id}`, "PUT", { isShared: !t.isShared })} className={`cursor-pointer border-0 bg-transparent text-sm ${t.isShared ? "" : "opacity-30 grayscale"}`} title={t.isShared ? "Shared task (click to unmark)" : "Mark as shared task"}>👥</button>
              <button disabled={busy} onClick={() => api(`/api/accounts/templates/${t.id}`, "PUT", { active: !t.active })} className="cursor-pointer border-0 bg-transparent text-sm" title={t.active ? "Pause" : "Resume"}>{t.active ? "⏸" : "▶"}</button>
              <button disabled={busy} onClick={() => api(`/api/accounts/templates/${t.id}`, "DELETE")} className="text-rose-500 hover:text-rose-400 cursor-pointer border-0 bg-transparent text-sm" title="Archive">✕</button>
            </div>
          ))}
          {templates === null && <div className="text-xs text-zinc-500 animate-pulse">Loading templates…</div>}
        </div>
      </div>
    </div>
  );
}
