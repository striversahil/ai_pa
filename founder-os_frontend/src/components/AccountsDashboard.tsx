"use client";

import React, { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";

interface TaskItem {
  templateId: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  ruleType?: string | null;
  dueLabel?: string | null;
  logId: string | null;
  status: string;
  remark: string | null;
  doneBy: string | null;
  accountantId: string | null;
  accountantName: string | null;
  overdue: boolean;
}

interface UnscheduledItem {
  templateId: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  ruleType: string | null;
  note: string | null;
  dueLabel: string | null;
}

interface RosterRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  order: number;
}

interface TemplateRow {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  active: boolean;
  order: number;
}

interface DashData {
  meta: { date: string; today: string; total: number; open: number; done: number; overdue: number; generatedAt: string };
  roster: RosterRow[];
  senior: TaskItem[];
  junior: TaskItem[];
  items: TaskItem[];
  unscheduled?: UnscheduledItem[];
}

const FREQS = ["daily", "weekly", "monthly", "quarterly", "yearly"];
const ROLES = ["senior", "junior", "either"];

function StatusChip({ status, overdue }: { status: string; overdue: boolean }) {
  const base = "inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold px-2 py-0.5 text-[11px]";
  if (status === "done")
    return <span className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>✓ Done</span>;
  if (status === "skipped")
    return <span className={`${base} bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-400/40`}>⏭ Skipped</span>;
  if (overdue || status === "overdue")
    return <span className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>⚠ Overdue</span>;
  return <span className={`${base} bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30`}>● Pending</span>;
}

function FreqChip({ f }: { f: string }) {
  const icon = f === "daily" ? "📅" : f === "weekly" ? "🗓" : f === "monthly" ? "📆" : f === "yearly" ? "🎯" : "📊";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
      {icon} {f}
    </span>
  );
}

function TaskRow({ t, roster, onLogged }: { t: TaskItem; roster: RosterRow[]; onLogged: () => void }) {
  const [remark, setRemark] = useState(t.remark ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = remark !== (t.remark ?? "");

  const save = async (status: string) => {
    if (!t.logId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/logs/${t.logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, remark: remark.trim() || null }),
      });
      if (!res.ok) throw new Error(await res.text());
      onLogged();
    } catch (e) {
      console.error(e);
      alert("Save failed — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${t.overdue && t.status !== "done" && t.status !== "skipped" ? "border-rose-500/40 bg-rose-500/[0.04]" : "border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-zinc-900 dark:text-white text-sm">{t.title}</div>
          {t.description && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t.description}</div>}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <FreqChip f={t.frequency} />
            <StatusChip status={t.status} overdue={t.overdue} />
            {t.dueLabel && (
              <span title="Expected completion from the follow-up sheet" className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">
                📌 {t.dueLabel}
              </span>
            )}
            {t.doneBy && <span className="text-[11px] text-zinc-500">by {t.doneBy}</span>}
            {t.accountantName && <span className="text-[11px] text-zinc-500">· {t.accountantName}</span>}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button disabled={busy || !t.logId} onClick={() => save("done")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 cursor-pointer border-0">✓ Done</button>
          <button disabled={busy || !t.logId} onClick={() => save("skipped")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50 cursor-pointer border-0">Skip</button>
          {t.status !== "pending" && (
            <button disabled={busy || !t.logId} onClick={() => save("pending")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 cursor-pointer border-0" title="Reopen">↩</button>
          )}
        </div>
      </div>
      <div className="flex gap-1.5 mt-2">
        <input
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Remark — e.g. paid via HDFC, ref 4821…"
          className="flex-1 min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
        />
        <button disabled={busy || !dirty || !t.logId} onClick={() => save(t.status)} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer border-0">Save</button>
      </div>
      {roster.length > 0 && (
        <div className="text-[10px] text-zinc-400 mt-1">Team: {roster.filter((r) => t.ownerRole === "either" || r.role === t.ownerRole).map((r) => r.name).join(", ") || "—"}</div>
      )}
    </div>
  );
}

function fmtToday(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const wd = WD[new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12)).getUTCDay()];
  return `${wd}, ${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}`;
}

export default function AccountsDashboard() {
  const { me } = useAuth();
  const canMIS = !!me && (me.isAdmin || me.scopes.includes("mis"));
  const [tab, setTab] = useState<"all" | "senior" | "junior" | "controller">("all");

  // Today only — no date filter. The backend serves the current IST day.
  const dash = useLiveDashboard<DashData>(async () => {
    const res = await fetch("/api/automations/accounts/data");
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  });

  const data = dash.data;
  const visible = useMemo(() => {
    if (!data) return [];
    if (tab === "senior") return data.senior;
    if (tab === "junior") return data.junior;
    return data.items;
  }, [data, tab]);

  const tabs: { key: typeof tab; label: string; icon: string; mis?: boolean }[] = [
    { key: "all", label: "All tasks", icon: "📋" },
    { key: "senior", label: "Senior", icon: "👔" },
    { key: "junior", label: "Junior", icon: "🧾" },
    ...(canMIS ? [{ key: "controller" as const, label: "MIS Controller", icon: "🎛️", mis: true }] : []),
  ];

  return (
    <div className="space-y-4 text-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Accounts <span className="text-xs font-medium text-zinc-500">· daily / monthly / yearly taskbar</span></h2>
          {data && (
            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
              <span className="font-bold text-zinc-800 dark:text-zinc-100 text-xs">📅 Today · {fmtToday(data.meta.date)}</span>
              <span className="font-bold text-emerald-500">✓ {data.meta.done}</span>
              <span className="font-bold text-amber-500">● {data.meta.open} open</span>
              {data.meta.overdue > 0 && <span className="font-bold text-rose-500">⚠ {data.meta.overdue} overdue</span>}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer border-0 ${tab === t.key ? "bg-indigo-600 text-white" : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {dash.loading && <div className="py-16 text-center text-sm text-zinc-500 animate-pulse">Loading accounts taskbar…</div>}
      {Boolean((dash as any).error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">Failed to load: {String((dash as any).error)} <button onClick={() => dash.refresh()} className="ml-2 underline cursor-pointer">Retry</button></div>}

      {data && tab !== "controller" && (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((t) => <TaskRow key={t.templateId} t={t} roster={data.roster} onLogged={() => dash.refresh()} />)}
          {visible.length === 0 && <div className="col-span-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">No tasks due for this view / date. MIS can add recurring tasks from the Controller tab.</div>}
        </div>
      )}

      {data && tab !== "controller" && (data.unscheduled ?? []).filter((u) => tab === "all" || u.ownerRole === "either" || u.ownerRole === tab).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-500">📌 No fixed date — reference ({(data.unscheduled ?? []).filter((u) => tab === "all" || u.ownerRole === "either" || u.ownerRole === tab).length})</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {(data.unscheduled ?? []).filter((u) => tab === "all" || u.ownerRole === "either" || u.ownerRole === tab).map((u) => (
              <div key={u.templateId} className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-xs">
                <div className="font-semibold text-zinc-800 dark:text-zinc-200">{u.title}</div>
                {(u.note || u.dueLabel) && <div className="text-zinc-500 mt-0.5">{[u.note, u.dueLabel].filter(Boolean).join(" · ")}</div>}
                <div className="flex gap-1.5 mt-1.5">
                  <FreqChip f={u.frequency} />
                  <span className="inline-flex items-center rounded-full border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">{u.ownerRole === "either" ? "shared" : u.ownerRole}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && tab === "controller" && (canMIS ? <Controller onChanged={() => dash.refresh()} /> : <div className="rounded-xl border p-6 text-sm text-zinc-500">🔒 Controller is restricted to MIS-level users.</div>)}
    </div>
  );
}

function RosterRowEditor({ row, busy, onSave, onRemove }: {
  row: RosterRow;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [email, setEmail] = useState(row.email ?? "");
  const dirty = email !== (row.email ?? "");
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="font-semibold flex-1 truncate">{row.name}</span>
        <select value={row.role} disabled={busy} onChange={(e) => onSave({ role: e.target.value })} className={`rounded border px-1.5 py-1 text-xs font-bold ${row.role === "senior" ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400" : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950"}`}>
          <option value="junior">Junior</option>
          <option value="senior">Senior</option>
        </select>
        <button disabled={busy} onClick={onRemove} className="text-rose-500 hover:text-rose-400 cursor-pointer border-0 bg-transparent text-sm" title="Remove">✕</button>
      </div>
      <div className="flex gap-1.5">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email — maps this person" className="flex-1 min-w-0 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-indigo-500" />
        <button disabled={busy || !dirty} onClick={() => onSave({ email: email.trim() || null })} className="px-2 py-1 text-[11px] font-bold rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer border-0">Save</button>
      </div>
      {row.phone && <div className="text-[10px] text-zinc-400">{row.phone}</div>}
    </div>
  );
}

function Controller({ onChanged }: { onChanged: () => void }) {
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("junior");
  const [title, setTitle] = useState("");
  const [freq, setFreq] = useState("daily");
  const [owner, setOwner] = useState("either");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setLoadError(null);
      const [rRes, tRes] = await Promise.all([
        fetch("/api/accounts/roster?deleted=0"),
        fetch("/api/accounts/templates?all=1"),
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
  React.useEffect(() => { load(); }, []);

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
        <div className="space-y-1.5">
          {(roster ?? []).map((r) => (
            <RosterRowEditor key={r.id} row={r} busy={busy} onSave={(patch) => api(`/api/accounts/roster/${r.id}`, "PUT", patch)} onRemove={() => api(`/api/accounts/roster/${r.id}`, "DELETE")} />
          ))}
          {roster === null && !loadError && <div className="text-xs text-zinc-500 animate-pulse">Loading roster…</div>}
          {roster !== null && roster.length === 0 && !loadError && <div className="text-xs text-zinc-500">No accountants yet — add the senior and junior above.</div>}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <h3 className="font-bold text-sm">📋 Recurring tasks — daily / monthly / yearly</h3>
        <div className="grid grid-cols-2 gap-1.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title — e.g. GST working" className="col-span-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" />
          <select value={freq} onChange={(e) => setFreq(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs">
            {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button disabled={busy || !title.trim()} onClick={() => { api("/api/accounts/templates", "POST", { title: title.trim(), frequency: freq, ownerRole: owner }); setTitle(""); }} className="col-span-2 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer border-0">Add recurring task</button>
        </div>
        <div className="text-[11px] text-zinc-500">Weekly → due Monday · Monthly → due day 1 · Quarterly → quarter-start · Yearly → Jan 1. Edit due-day/month per task below. Paste your real daily / monthly / yearly lists here — placeholders ship by default.</div>
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
