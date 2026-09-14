"use client";

import React, { useMemo, useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";

interface FileItem {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

interface TaskItem {
  templateId: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  ruleType?: string | null;
  dueLabel?: string | null;
  isShared?: boolean;
  employeeRaw?: string | null;
  logId: string | null;
  status: string;
  remark: string | null;
  doneBy: string | null;
  accountantId: string | null;
  accountantName: string | null;
  attachments?: FileItem[];
  missed?: string[];
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
  isShared?: boolean;
  employeeRaw?: string | null;
}

interface RosterRow {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role: string;
  order: number;
  deleted?: boolean;
}

interface TemplateRow {
  id: string;
  title: string;
  description: string | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  isShared?: boolean;
  employeeRaw?: string | null;
  department?: string | null;
  sheetStatus?: string | null;
  active: boolean;
  order: number;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  doneToday: number;
  doneWeek: number;
  doneMonth: number;
  openLaneToday: number;
}

interface TeamData {
  date: string;
  weekStart: string;
  monthStart: string;
  doneToday: number;
  openToday: number;
  inProgressToday?: number;
  overdueToday: number;
  completionPct: number;
  weekDone: number;
  monthDone: number;
  members: TeamMember[];
}

interface DashData {
  meta: { date: string; today: string; total: number; open: number; done: number; overdue: number; generatedAt: string };
  roster: RosterRow[];
  senior: TaskItem[];
  junior: TaskItem[];
  items: TaskItem[];
  unscheduled?: UnscheduledItem[];
  team?: TeamData | null;
}

const FREQS = ["daily", "weekly", "monthly", "quarterly", "yearly"];
const ROLES = ["senior", "junior", "either"];

function StatusChip({ status, overdue }: { status: string; overdue: boolean }) {
  const base = "inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold px-2 py-0.5 text-[11px]";
  if (status === "done")
    return <span className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>✓ Done</span>;
  if (status === "inprogress")
    return <span className={`${base} bg-blue-500/10 text-blue-500 dark:text-blue-400 border-blue-500/30`}>▶ In Progress</span>;
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

function fmtSize(n: number): string {
  if (!n) return "";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

/** "2026-09-15" → "15 Sep" for missed-day chips. */
function fmtShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

/** Match the signed-in user to a roster entry by NAME only (never email —
 *  the team shares logins, so email can't distinguish humans). Session name,
 *  then session email local-part, each accepted only on a single clear hit.
 *  Returns "" when ambiguous — the "Acting as" picker then decides. */
export function matchSelfRoster(me: { user: { email: string; name: string } } | null, roster: RosterRow[]): string {
  if (!me) return "";
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates = [norm(me.user.name || ""), norm((me.user.email || "").split("@")[0])].filter((s) => s.length >= 3);
  for (const n of candidates) {
    const hits = roster.filter((r) => {
      const rn = norm(r.name);
      return rn && (rn === n || rn.startsWith(n) || n.startsWith(rn));
    });
    if (hits.length === 1) return hits[0].id;
  }
  return "";
}

const ACTOR_KEY = "accounts_actor_id";

function TaskRow({ t, roster, defaultWho, onLogged }: { t: TaskItem; roster: RosterRow[]; defaultWho: string; onLogged: () => void }) {
  const [remark, setRemark] = useState(t.remark ?? "");
  // Explicit per-row override; otherwise the log's recorded owner, otherwise
  // the device's "Acting as" identity. Never goes stale: derived every render.
  const [whoOverride, setWhoOverride] = useState("");
  const whoId = whoOverride || t.accountantId || defaultWho || "";
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dirty = remark !== (t.remark ?? "");
  const lane = roster.filter((r) => t.ownerRole === "either" || r.role === t.ownerRole);
  const whoName = lane.find((r) => r.id === whoId)?.name ?? roster.find((r) => r.id === whoId)?.name ?? null;

  const save = async (status: string) => {
    if (!t.logId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/logs/${t.logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          remark: remark.trim() || null,
          accountantId: whoId || null,
          doneBy: status === "done" ? whoName : undefined,
        }),
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

  const upload = async (file: File | undefined) => {
    if (!file || !t.logId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/accounts/logs/${t.logId}/files`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      onLogged();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/files/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      onLogged();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const files = t.attachments ?? [];
  // Status bar with mandatory reason: a transition is only clickable when a
  // remark is present (typed now or already recorded) — the server enforces it.
  const hasReason = remark.trim() !== "" || String(t.remark || "").trim() !== "";
  const needReason = !hasReason ? " — add a remark (reason) first" : "";

  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${t.overdue && t.status !== "done" && t.status !== "skipped" ? "border-rose-500/40 bg-rose-500/[0.04]" : "border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-zinc-900 dark:text-white text-sm">{t.title}</div>
          {t.description && <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t.description}</div>}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <FreqChip f={t.frequency} />
            <StatusChip status={t.status} overdue={t.overdue} />
            {t.isShared ? (
              <span title={`Shared task${t.employeeRaw ? ` · sheet: ${t.employeeRaw}` : ""}`} className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">
                👥 shared
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">{t.ownerRole}</span>
            )}
            {t.dueLabel && (
              <span title="Expected completion from the follow-up sheet" className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400">
                📌 {t.dueLabel}
              </span>
            )}
            {(t.missed ?? []).length > 0 && (
              <span title={`Not completed on: ${(t.missed ?? []).join(", ")}`} className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500 dark:text-rose-400">
                ⚠ missed {(t.missed ?? []).slice(0, 3).map(fmtShort).join(", ")}{(t.missed ?? []).length > 3 ? ` +${(t.missed ?? []).length - 3} more` : ""}
              </span>
            )}
            {t.doneBy && <span className="text-[11px] text-zinc-500">by {t.doneBy}</span>}
            {t.accountantName && t.accountantName !== t.doneBy && <span className="text-[11px] text-zinc-500">· {t.accountantName}</span>}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {(t.status === "pending" || t.status === "overdue") && (
            <button disabled={busy || !t.logId || !hasReason} title={`Start work${needReason}`} onClick={() => save("inprogress")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 cursor-pointer border-0">▶ In Progress</button>
          )}
          {(t.status === "pending" || t.status === "overdue" || t.status === "inprogress") && (
            <button disabled={busy || !t.logId || !hasReason} title={`Mark done${needReason}`} onClick={() => save("done")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 cursor-pointer border-0">✓ Done</button>
          )}
          {t.status !== "pending" && (
            <button disabled={busy || !t.logId || !hasReason} onClick={() => save("pending")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 cursor-pointer border-0" title={`Back to pending${needReason}`}>↩ Pending</button>
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
        <select value={whoId} onChange={(e) => setWhoOverride(e.target.value)} title="Who did this task" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1.5 py-1.5 text-xs max-w-[130px]">
          <option value="">Who?…</option>
          {lane.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button disabled={busy || !dirty || !t.logId} onClick={() => save(t.status)} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer border-0">Save</button>
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {files.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1 rounded-full border border-zinc-300 dark:border-zinc-700 pl-1.5 pr-1 py-0.5 text-[11px]">
              <a href={f.url} target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline max-w-[180px] truncate" title={`${f.fileName}${f.uploadedBy ? ` · by ${f.uploadedBy}` : ""}`}>
                📎 {f.fileName} <span className="text-zinc-500">{fmtSize(f.size)}</span>
              </a>
              <button disabled={busy} onClick={() => removeFile(f.id)} className="text-rose-500 hover:text-rose-400 cursor-pointer border-0 bg-transparent text-xs px-0.5" title="Remove file">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2">
        <label className={`inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer ${uploading ? "opacity-50" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}>
          📎 {uploading ? "Uploading…" : "Attach proof (PDF / image / sheet / ZIP, ≤20MB)"}
          <input type="file" className="hidden" disabled={uploading || !t.logId} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>
      {lane.length > 0 && (
        <div className="text-[10px] text-zinc-400 mt-1">Team: {lane.map((r) => r.name).join(", ")}</div>
      )}
    </div>
  );
}

type AccountsView = "dashboard" | "tasks" | "senior" | "junior" | "controller";

const TABS: { key: AccountsView; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "tasks", label: "All Tasks", icon: "📋" },
  { key: "senior", label: "Senior", icon: "👔" },
  { key: "junior", label: "Junior", icon: "🧾" },
  // MIS-only controller tab (filtered out of the nav without the `mis` scope).
  { key: "controller", label: "Controller", icon: "🎛️" },
];

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
  const [view, setView] = useState<AccountsView>("dashboard");

  // Today only — no date filter. The backend serves the current IST day.
  // pollMs safety net: a stalled request can never wedge the view forever —
  // the 30s hook timeout turns it into an error and the next poll recovers.
  // Loading renders non-destructively (spinner only before first payload).
  const dash = useLiveDashboard<DashData>(async () => {
    const res = await fetch("/api/automations/accounts/data");
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { pollMs: 60000 });

  const data = dash.data;
  const [statusFilter, setStatusFilter] = useState<"pending" | "inprogress" | "done" | "all">("pending");
  const selfId = useMemo(() => matchSelfRoster(me as any, data?.roster ?? []), [me, data]);
  // Shared logins can't be told apart by auth — each device declares its human
  // once ("Acting as"), remembered in localStorage. Every Done/remark/file is
  // credited to this identity unless a row overrides it.
  const [actorPick, setActorPick] = useState(() => {
    try { return localStorage.getItem(ACTOR_KEY) || ""; } catch { return ""; }
  });
  const pickActor = (id: string) => {
    setActorPick(id);
    try {
      if (id) localStorage.setItem(ACTOR_KEY, id);
      else localStorage.removeItem(ACTOR_KEY);
    } catch { /* private mode */ }
  };
  const defaultWho = actorPick || selfId;
  // A remembered identity can go stale (person removed from the roster):
  // drop it so "Acting as" never credits a deleted accountant.
  React.useEffect(() => {
    if (actorPick && data && !data.roster.some((r) => r.id === actorPick)) pickActor("");
  }, [actorPick, data]);
  const lane = useMemo(() => {
    if (!data) return [];
    if (view === "senior") return data.senior;
    if (view === "junior") return data.junior;
    return data.items;
  }, [data, view]);
  const visible = useMemo(() => {
    if (statusFilter === "inprogress") return lane.filter((t) => t.status === "inprogress");
    if (statusFilter === "done") return lane.filter((t) => t.status === "done");
    if (statusFilter === "all") return lane;
    return lane.filter((t) => t.status === "pending" || t.status === "overdue");
  }, [lane, statusFilter]);
  const pendingCount = lane.filter((t) => t.status === "pending" || t.status === "overdue").length;
  const inprogCount = lane.filter((t) => t.status === "inprogress").length;
  const doneCount = lane.filter((t) => t.status === "done").length;

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
        {data && data.roster.length > 0 && (
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 shrink-0" title="Shared login? Pick who is using this device — credits go to this person">
            Acting as:
            <select value={actorPick} onChange={(e) => pickActor(e.target.value)} className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2 py-1.5 text-xs font-bold text-indigo-300 outline-none">
              <option value="">Auto{selfId && data.roster.find((r) => r.id === selfId) ? ` (${data.roster.find((r) => r.id === selfId)!.name})` : ""}</option>
              {data.roster.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.role}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-col gap-6">
        {/* Tabs (full-width horizontal row, like Telecalling) */}
        <aside className="w-full shrink-0">
          <nav className="flex flex-row flex-wrap gap-2">
            {TABS.filter((t) => t.key !== "controller" || canMIS).map((t) => {
              const active = view === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setView(t.key)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors text-left ${
                    active
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span className="text-base leading-none">{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content (seamless switch — queries stay mounted) */}
        <div className="flex-1 min-w-0">
          {data && view === "dashboard" && <TeamBoard team={data.team ?? null} />}

      {dash.loading && !data && <div className="py-16 text-center text-sm text-zinc-500 animate-pulse">Loading accounts taskbar…</div>}
      {Boolean((dash as any).error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">Failed to load: {String((dash as any).error)} <button onClick={() => dash.refresh()} className="ml-2 underline cursor-pointer">Retry</button></div>}

      {data && (view === "tasks" || view === "senior" || view === "junior") && (
        <div className="flex flex-wrap gap-1.5">
          {([
            { key: "pending", label: `● Pending (${pendingCount})` },
            { key: "inprogress", label: `▶ In Progress (${inprogCount})` },
            { key: "done", label: `✓ Done (${doneCount})` },
            { key: "all", label: `All (${lane.length})` },
          ] as const).map((s) => (
            <button key={s.key} onClick={() => setStatusFilter(s.key)} className={`px-3 py-1 text-[11px] font-bold rounded-full cursor-pointer border ${statusFilter === s.key ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent" : "border-zinc-300 dark:border-zinc-700 text-zinc-500"}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {data && (view === "tasks" || view === "senior" || view === "junior") && (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((t) => <TaskRow key={t.templateId} t={t} roster={data.roster} defaultWho={defaultWho} onLogged={() => dash.refresh()} />)}
          {visible.length === 0 && <div className="col-span-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">{statusFilter === "done" ? "Nothing marked done in this view yet — today's completions will appear here." : statusFilter === "inprogress" ? "Nothing in progress — tap ▶ In Progress on a pending task to start it." : "No pending tasks in this view."}</div>}
        </div>
      )}

      {data && (view === "tasks" || view === "senior" || view === "junior") && (data.unscheduled ?? []).filter((u) => view === "tasks" || u.ownerRole === "either" || u.ownerRole === view).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-500">📌 No fixed date — reference ({(data.unscheduled ?? []).filter((u) => view === "tasks" || u.ownerRole === "either" || u.ownerRole === view).length})</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {(data.unscheduled ?? []).filter((u) => view === "tasks" || u.ownerRole === "either" || u.ownerRole === view).map((u) => (
              <div key={u.templateId} className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-xs">
                <div className="font-semibold text-zinc-800 dark:text-zinc-200">{u.title}</div>
                {(u.note || u.dueLabel) && <div className="text-zinc-500 mt-0.5">{[u.note, u.dueLabel].filter(Boolean).join(" · ")}</div>}
                <div className="flex gap-1.5 mt-1.5">
                  <FreqChip f={u.frequency} />
                  <span title={u.employeeRaw ? `Sheet: ${u.employeeRaw}` : undefined} className="inline-flex items-center rounded-full border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">{u.isShared ? "👥 shared" : u.ownerRole}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && view === "controller" && (canMIS ? <Controller onChanged={() => dash.refresh()} /> : <div className="rounded-xl border p-6 text-sm text-zinc-500">🔒 Controller is restricted to MIS-level users.</div>)}
        </div>
      </div>
    </div>
  );
}

function TeamBoard({ team }: { team: TeamData | null }) {
  if (!team) return <div className="py-12 text-center text-sm text-zinc-500">Team stats unavailable.</div>;
  const maxMonth = Math.max(1, ...team.members.map((m) => m.doneMonth));
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Done today", value: team.doneToday, accent: "text-emerald-400" },
          { label: "In progress", value: team.inProgressToday ?? 0, accent: "text-blue-400" },
          { label: "Open today", value: team.openToday, accent: "text-amber-300" },
          { label: "Overdue", value: team.overdueToday, accent: "text-rose-400" },
          { label: "Completion", value: `${team.completionPct}%`, accent: "text-indigo-300" },
          { label: "Done this week", value: team.weekDone, accent: "text-zinc-900 dark:text-zinc-100" },
          { label: "Done this month", value: team.monthDone, accent: "text-zinc-900 dark:text-zinc-100" },
        ].map((k) => (
          <div key={k.label} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600 dark:text-zinc-500 font-bold">{k.label}</div>
            <div className={`text-2xl font-extrabold mt-1 ${k.accent}`}>{k.value}</div>
          </div>
        ))}
      </div>
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
          🏆 Leaderboard · tasks done per person <span className="normal-case font-medium">(week starts Monday)</span>
        </div>
        {team.members.length === 0 && <div className="p-6 text-center text-xs text-zinc-500">No accountants on the roster yet — MIS adds them from the Controller tab.</div>}
        {team.members.map((m, i) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
            <span className="w-7 text-sm font-bold shrink-0">{medal(i)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold text-sm truncate">{m.name}</span>
                <span className={`text-[10px] font-bold uppercase ${m.role === "senior" ? "text-indigo-400" : "text-zinc-500"}`}>{m.role}</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 mt-1 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" style={{ width: `${Math.round((m.doneMonth / maxMonth) * 100)}%` }} />
              </div>
            </div>
            <div className="flex gap-3 text-center shrink-0">
              <span title="Done today"><span className="block text-sm font-extrabold font-mono text-emerald-500">{m.doneToday}</span><span className="block text-[9px] uppercase text-zinc-500">today</span></span>
              <span title="Done this week"><span className="block text-sm font-extrabold font-mono">{m.doneWeek}</span><span className="block text-[9px] uppercase text-zinc-500">week</span></span>
              <span title="Done this month"><span className="block text-sm font-extrabold font-mono">{m.doneMonth}</span><span className="block text-[9px] uppercase text-zinc-500">month</span></span>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-zinc-500">Tip: pick your name in the “Who?…” box when marking a task Done to climb the board. Shared tasks credit whoever logs them.</div>
    </div>
  );
}

/** CSV cell guard: quotes wrap, and a leading tab neuters Excel formula injection. */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? "\t" + s : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function ExportCard() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setInfo(null);
    try {
      const res = await fetch(`/api/accounts/export?days=${Math.min(93, Math.max(1, days || 30))}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const rows = (data.rows ?? []) as Record<string, any>[];
      const header = ["Date", "Task", "Frequency", "Lane", "Shared", "Due", "Status", "Overdue", "Done By", "Accountant", "Remark", "Attachments", "Updated At"];
      const lines = [header.map(csvCell).join(",")];
      for (const r of rows) {
        const files = (r.attachments ?? []).map((f: any) => `${f.name} (${f.url})`).join("; ");
        lines.push([
          r.date, r.task, r.frequency, r.lane, r.shared ? "yes" : "no", r.due,
          r.status, r.overdue ? "yes" : "no", r.doneBy, r.accountant, r.remark, files, r.updatedAt,
        ].map(csvCell).join(","));
      }
      const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `accounts-export-${data.from}-to-${data.to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setInfo(`Exported ${rows.length} rows (${data.from} → ${data.to}).`);
    } catch (e) {
      console.error(e);
      setInfo(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 lg:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-sm">📤 MIS export — full task history</h3>
          <div className="text-[11px] text-zinc-500 mt-0.5">Every due task per day with lane, pending / in-progress / done status, who did it, remarks and attachment links. Opens in Excel.</div>
        </div>
        <label className="text-[11px] text-zinc-500 flex items-center gap-1.5">
          Past
          <input type="number" min={1} max={93} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-16 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" />
          days
        </label>
        <button disabled={busy} onClick={run} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 cursor-pointer border-0">
          {busy ? "Exporting…" : "⬇ Export CSV"}
        </button>
      </div>
      {info && <div className="text-[11px] text-zinc-500 mt-2">{info}</div>}
    </div>
  );
}
function RosterRowEditor({ row, busy, onSave, onRemove, onRestore }: {
  row: RosterRow;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
  onRestore?: () => void;
}) {
  const [email, setEmail] = useState(row.email ?? "");
  const dirty = email !== (row.email ?? "");
  if (row.deleted) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs opacity-70">
        <span className="font-semibold flex-1 truncate">{row.name} <span className="font-normal text-zinc-500">(removed)</span></span>
        {onRestore && <button disabled={busy} onClick={onRestore} className="px-2 py-1 text-[11px] font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 cursor-pointer border-0">Restore</button>}
      </div>
    );
  }
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

const PATTERN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PATTERN_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_NUM: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const PATTERNS = [
  { key: "daily", label: "Daily (working days)" },
  { key: "weekly", label: "Weekly on a weekday" },
  { key: "monthly_fixed", label: "Monthly · one fixed day" },
  { key: "monthly_multiple", label: "Monthly · several days" },
  { key: "monthly_range", label: "Monthly · day range" },
  { key: "yearly_fixed", label: "Yearly · one fixed date" },
  { key: "yearly_range", label: "Yearly · date range" },
  { key: "week_of_month", label: "Yearly · Nth week of month" },
  { key: "multi", label: "Several fixed dates (quarterly…)" },
  { key: "tbd", label: "No fixed date (reference)" },
] as const;

type PatternKey = (typeof PATTERNS)[number]["key"];

function ord(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function parseDayList(text: string): number[] | null {
  const days = [...new Set(
    text.split(/[,;\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31),
  )].sort((a, b) => a - b);
  return days.length ? days : null;
}

/** Pattern form → template POST body (ruleType/ruleJson/rawText + legacy fills). */
function buildTemplateBody(p: {
  title: string; ownerRole: string; shared: boolean; pattern: PatternKey;
  day: string; daysText: string; startDay: string; endDay: string; weekday: string;
  month: string; yDay: string; sMonth: string; sDay: string; eMonth: string; eDay: string;
  weekNum: string; occs: { month: string; day: string }[];
}): { body?: Record<string, unknown>; error?: string } {
  const title = p.title.trim();
  if (!title) return { error: "Title required" };
  const base = { title, ownerRole: p.ownerRole, isShared: p.shared };
  const day = parseInt(p.day, 10);
  const sDay = parseInt(p.startDay, 10);
  const eDay = parseInt(p.endDay, 10);
  const yDay = parseInt(p.yDay, 10);
  switch (p.pattern) {
    case "daily":
      return { body: { ...base, frequency: "daily", ruleType: "not_applicable", ruleJson: { type: "not_applicable" }, rawText: "Every working day", dueDay: null, dueMonth: null } };
    case "weekly": {
      const wn = WEEKDAY_NUM[p.weekday] ?? 4;
      return { body: { ...base, frequency: "weekly", ruleType: "weekday", ruleJson: { type: "weekday", weekday: p.weekday, occurrence: "every" }, rawText: `Every ${p.weekday}`, dueDay: wn, dueMonth: null } };
    }
    case "monthly_fixed":
      if (!Number.isInteger(day) || day < 1 || day > 31) return { error: "Day must be 1–31" };
      return { body: { ...base, frequency: "monthly", ruleType: "fixed_day", ruleJson: { type: "fixed_day", day, month: null }, rawText: `${ord(day)} of every month`, dueDay: day, dueMonth: null } };
    case "monthly_multiple": {
      const days = parseDayList(p.daysText);
      if (!days) return { error: "Enter days like 8, 11, 13" };
      const fmt = days.map(ord).join(", ").replace(/, ([^,]*)$/, " & $1");
      return { body: { ...base, frequency: "monthly", ruleType: "multiple_days", ruleJson: { type: "multiple_days", days, month: null }, rawText: `${fmt} of every month`, dueDay: days[0], dueMonth: null } };
    }
    case "monthly_range":
      if (!Number.isInteger(sDay) || !Number.isInteger(eDay) || sDay < 1 || eDay > 31 || sDay > eDay) return { error: "Range needs start ≤ end within 1–31" };
      return { body: { ...base, frequency: "monthly", ruleType: "day_range", ruleJson: { type: "day_range", start_day: sDay, end_day: eDay, month: null }, rawText: `${ord(sDay)} - ${ord(eDay)} of every month`, dueDay: sDay, dueMonth: null } };
    case "yearly_fixed":
      if (!Number.isInteger(yDay) || yDay < 1 || yDay > 31) return { error: "Day must be 1–31" };
      return { body: { ...base, frequency: "yearly", ruleType: "fixed_day", ruleJson: { type: "fixed_day", day: yDay, month: p.month }, rawText: `${ord(yDay)} ${p.month}`, dueDay: yDay, dueMonth: PATTERN_MONTHS.indexOf(p.month) + 1 } };
    case "yearly_range": {
      const sd = parseInt(p.sDay, 10);
      const ed = parseInt(p.eDay, 10);
      if (!Number.isInteger(sd) || !Number.isInteger(ed) || sd < 1 || sd > 31 || ed < 1 || ed > 31) return { error: "Both range days must be 1–31" };
      return { body: { ...base, frequency: "yearly", ruleType: "month_day_range", ruleJson: { type: "month_day_range", start: { day: sd, month: p.sMonth }, end: { day: ed, month: p.eMonth } }, rawText: `${ord(sd)} ${p.sMonth} - ${ord(ed)} ${p.eMonth}`, dueDay: sd, dueMonth: PATTERN_MONTHS.indexOf(p.sMonth) + 1 } };
    }
    case "week_of_month": {
      const w = parseInt(p.weekNum, 10);
      if (![1, 2, 3, 4, 5].includes(w)) return { error: "Week must be 1–5" };
      return { body: { ...base, frequency: "yearly", ruleType: "week_of_month", ruleJson: { type: "week_of_month", week_number: w, month: p.month }, rawText: `${ord(w)} week of ${p.month}`, dueDay: null, dueMonth: PATTERN_MONTHS.indexOf(p.month) + 1 } };
    }
    case "multi": {
      const occs = p.occs.map((o) => ({ month: o.month, day: parseInt(o.day, 10) })).filter((o) => Number.isInteger(o.day) && o.day >= 1 && o.day <= 31);
      if (!occs.length) return { error: "Add at least one valid date" };
      const distinctMonths = new Set(occs.map((o) => o.month)).size;
      const raw = occs.map((o) => `${ord(o.day)} ${o.month.slice(0, 3)}`).join(", ");
      return { body: { ...base, frequency: occs.length > 2 ? "quarterly" : "yearly", ruleType: "multi_occurrence", ruleJson: { type: "multi_occurrence", occurrences: occs.map((o) => ({ type: "fixed_day", day: o.day, month: o.month })) }, rawText: raw, dueDay: null, dueMonth: null, _months: distinctMonths } };
    }
    case "tbd":
      return { body: { ...base, frequency: "monthly", ruleType: "to_be_decided", ruleJson: { type: "to_be_decided" }, rawText: null, dueDay: null, dueMonth: null } };
  }
}

function TemplateCreator({ onChanged }: { onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("either");
  const [shared, setShared] = useState(false);
  const [pattern, setPattern] = useState<PatternKey>("monthly_fixed");
  const [day, setDay] = useState("15");
  const [daysText, setDaysText] = useState("8, 11, 13");
  const [startDay, setStartDay] = useState("15");
  const [endDay, setEndDay] = useState("18");
  const [weekday, setWeekday] = useState("Thursday");
  const [month, setMonth] = useState("January");
  const [yDay, setYDay] = useState("15");
  const [sMonth, setSMonth] = useState("September");
  const [sDay, setSDay] = useState("30");
  const [eMonth, setEMonth] = useState("October");
  const [eDay, setEDay] = useState("31");
  const [weekNum, setWeekNum] = useState("1");
  const [occs, setOccs] = useState<{ month: string; day: string }[]>([{ month: "June", day: "15" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preview = (() => {
    const r = buildTemplateBody({ title: title || "…", ownerRole: owner, shared, pattern, day, daysText, startDay, endDay, weekday, month, yDay, sMonth, sDay, eMonth, eDay, weekNum, occs });
    if (r.error) return r.error;
    const b = r.body!;
    return `Shows ${String(b.rawText ?? "as reference (no fixed date)")} · ${b.frequency} · ${shared ? "shared" : owner}`;
  })();

  const submit = async () => {
    const r = buildTemplateBody({ title, ownerRole: owner, shared, pattern, day, daysText, startDay, endDay, weekday, month, yDay, sMonth, sDay, eMonth, eDay, weekNum, occs });
    if (r.error || !r.body) { setErr(r.error ?? "Invalid"); return; }
    setErr(null);
    setBusy(true);
    try {
      const { _months, ...body } = r.body as Record<string, unknown>;
      void _months;
      const res = await fetch("/api/accounts/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await res.text());
      setTitle("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const num = "w-16 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500";
  const sel = "rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs";

  return (
    <div className="space-y-1.5">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title — e.g. Professional tax payment" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" />
      <div className="grid grid-cols-2 gap-1.5">
        <select value={pattern} onChange={(e) => setPattern(e.target.value as PatternKey)} className={sel} title="Schedule pattern">
          {PATTERNS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)} className={sel} title="Owner lane">
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      {pattern === "monthly_fixed" && (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">Day of month <input value={day} onChange={(e) => setDay(e.target.value)} className={num} inputMode="numeric" /></label>
      )}
      {pattern === "monthly_multiple" && (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">Days <input value={daysText} onChange={(e) => setDaysText(e.target.value)} placeholder="8, 11, 13" className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500" /></label>
      )}
      {pattern === "monthly_range" && (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">From <input value={startDay} onChange={(e) => setStartDay(e.target.value)} className={num} inputMode="numeric" /> to <input value={endDay} onChange={(e) => setEndDay(e.target.value)} className={num} inputMode="numeric" /></label>
      )}
      {pattern === "weekly" && (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">Every <select value={weekday} onChange={(e) => setWeekday(e.target.value)} className={sel}>{PATTERN_WEEKDAYS.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
      )}
      {(pattern === "yearly_fixed" || pattern === "week_of_month") && (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          {pattern === "week_of_month" ? (
            <>Week <input value={weekNum} onChange={(e) => setWeekNum(e.target.value)} className={num} inputMode="numeric" /> of</>
          ) : (
            <>Day <input value={yDay} onChange={(e) => setYDay(e.target.value)} className={num} inputMode="numeric" /> of</>
          )}
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={sel}>{PATTERN_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </div>
      )}
      {pattern === "yearly_range" && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          <input value={sDay} onChange={(e) => setSDay(e.target.value)} className={num} inputMode="numeric" />
          <select value={sMonth} onChange={(e) => setSMonth(e.target.value)} className={sel}>{PATTERN_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <span>→</span>
          <input value={eDay} onChange={(e) => setEDay(e.target.value)} className={num} inputMode="numeric" />
          <select value={eMonth} onChange={(e) => setEMonth(e.target.value)} className={sel}>{PATTERN_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </div>
      )}
      {pattern === "multi" && (
        <div className="space-y-1">
          {occs.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span>#{i + 1}</span>
              <select value={o.month} onChange={(e) => setOccs(occs.map((x, j) => (j === i ? { ...x, month: e.target.value } : x)))} className={sel}>{PATTERN_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              <input value={o.day} onChange={(e) => setOccs(occs.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} className={num} inputMode="numeric" />
              <button onClick={() => setOccs(occs.filter((_, j) => j !== i))} className="text-rose-500 hover:text-rose-400 cursor-pointer border-0 bg-transparent" title="Remove date">✕</button>
            </div>
          ))}
          <button onClick={() => setOccs([...occs, { month: "January", day: "15" }])} className="text-[11px] text-indigo-400 hover:underline cursor-pointer border-0 bg-transparent">+ Add date</button>
        </div>
      )}
      <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="accent-indigo-600" /> 👥 Shared (both senior + junior)
      </label>
      <div className="text-[11px] text-zinc-500 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1">→ {preview}</div>
      {err && <div className="text-[11px] text-rose-500">{err}</div>}
      <button disabled={busy || !title.trim()} onClick={submit} className="w-full px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer border-0">{busy ? "Adding…" : "Add recurring task"}</button>
    </div>
  );
}

function Controller({ onChanged }: { onChanged: () => void }) {
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
        fetch(`/api/accounts/roster${showRemoved ? "?deleted=1" : "?deleted=0"}`),
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
