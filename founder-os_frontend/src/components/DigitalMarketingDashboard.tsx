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

interface MetricField {
  key: string;
  label: string;
  type: string;
  options?: string[];
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
  metricsSchema?: MetricField[] | null;
  metricsJson?: Record<string, any> | null;
  logId: string | null;
  status: string;
  remark: string | null;
  doneBy: string | null;
  timeSpentMin?: number | null;
  dueDate?: string | null;
  accountantId: string | null;
  accountantName: string | null;
  attachments?: FileItem[];
  missed?: string[];
  overdue: boolean;
  daysOverdue?: number | null;
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

interface FreqStat {
  frequency: string;
  total: number;
  done: number;
  pending: number;
  inprogress: number;
  overdue: number;
  completionPct: number;
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
  meta: { date: string; today: string; total: number; open: number; done: number; overdue: number; generatedAt: string; isAdmin?: boolean; self?: { id: string; name: string; role: string } | null };
  roster: RosterRow[];
  senior: TaskItem[];
  junior: TaskItem[];
  items: TaskItem[];
  overdueList?: TaskItem[];
  history?: TaskItem[];
  freqStats?: FreqStat[];
  unscheduled?: UnscheduledItem[];
  team?: TeamData | null;
  metaAdsCampaign?: { logId: string; dueDate: string; category: string | null; amountSpent: number | null; fromDate: string; toDate: string; durationDays: number | null; inquiries: number | null; leads: number | null } | null;
}

const FREQS = ["daily", "weekly", "monthly", "quarterly", "yearly"];

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

/** Minutes → "1h 20m" / "45m" for the time-taken chip. */
function fmtDur(mins: number | null | undefined): string | null {
  if (mins === null || mins === undefined) return null;
  const n = Math.floor(Number(mins));
  if (!Number.isFinite(n) || n <= 0) return null;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
}

/** "2026-09-15" → "15 Sep" for missed-day chips. */
function fmtShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

/** from/to (YYYY-MM-DD) → "5 days" run duration for the Meta Ads Run banner. */
function runDays(from: string, to: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((from || "").slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}$/.test((to || "").slice(0, 10))) return "";
  const ms = Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10));
  if (!Number.isFinite(ms) || ms < 0) return "";
  const n = Math.round(ms / 86400000) + 1;
  return `${n} day${n === 1 ? "" : "s"}`;
}

/** Match the signed-in user to a roster entry by NAME only (never email —
 *  the team shares logins, so email can't distinguish humans). Session name,
 *  then session email local-part, each accepted only on a single clear hit.
 *  Returns "" when ambiguous — the row's "Who?…" picker then decides. */
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

function TaskRow({ t, roster, defaultWho, onLogged, today }: { t: TaskItem; roster: RosterRow[]; defaultWho: string; onLogged: () => void; today?: string }) {
  const [remark, setRemark] = useState(t.remark ?? "");
  // Time taken, entered as hours + minutes, stored as integer minutes.
  // Prefilled from the recorded value so it can be corrected later.
  const initHrs = t.timeSpentMin != null ? String(Math.floor(Number(t.timeSpentMin) / 60)) : "";
  const initMins = t.timeSpentMin != null ? String(Math.floor(Number(t.timeSpentMin) % 60)) : "";
  const [hrs, setHrs] = useState(initHrs);
  const [mins, setMins] = useState(initMins);
  const timeTotal = (() => {
    if (hrs.trim() === "" && mins.trim() === "") return null;
    const h = Math.max(0, Math.floor(Number(hrs) || 0));
    const m = Math.max(0, Math.floor(Number(mins) || 0));
    return h * 60 + m;
  })();
  const timeInit = t.timeSpentMin ?? null;
  // Metrics for daily numeric tasks (Meta/B2B/Whatsapp/Email). Prefilled from saved metricsJson.
  const [metrics, setMetrics] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    const src = (t as any).metricsJson as Record<string, any> | null;
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src)) init[k] = v == null ? "" : String(v);
    }
    // Ensure all schema keys have an entry
    const schema = (t as any).metricsSchema as Array<{key:string}> | null;
    if (schema) for (const f of schema) if (!(f.key in init)) init[f.key] = "";
    return init;
  });
  const metricsInit = (() => {
    const s = JSON.stringify((t as any).metricsJson ?? null);
    const cur = JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([k,v]) => [k, v.trim()===""?null : (isNaN(Number(v))? v : Number(v)) ])));
    return s;
  })();
  const metricsDirty = JSON.stringify((t as any).metricsJson ?? null) !== JSON.stringify(Object.fromEntries(Object.entries(metrics).map(([k,v]) => [k, v.trim()===""?null : (isNaN(Number(v))? v.trim() : Number(v)) ])));
  // Explicit per-row override; otherwise the log's recorded owner, otherwise
  // the signed-in user's roster match. Never goes stale: derived every render.
  const [whoOverride, setWhoOverride] = useState("");
  const whoId = whoOverride || t.accountantId || defaultWho || "";
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dirty = remark !== (t.remark ?? "") || timeTotal !== timeInit || metricsDirty;
  const lane = roster.filter((r) => t.ownerRole === "either" || r.role === t.ownerRole);
  const whoName = lane.find((r) => r.id === whoId)?.name ?? roster.find((r) => r.id === whoId)?.name ?? null;

  const save = async (status: string) => {
    if (!t.logId) return;
    setBusy(true);
    try {
      const metricsJson = (t as any).metricsSchema ? Object.fromEntries(Object.entries(metrics).map(([k,v]) => [k, v.trim()===""?null : (isNaN(Number(v))? v.trim() : Number(v)) ])) : undefined;
      const res = await fetch(`/api/digital-marketing/logs/${t.logId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          remark: remark.trim() || null,
          accountantId: whoId || null,
          doneBy: status === "done" ? whoName : undefined,
          timeSpentMin: timeTotal,
          metricsJson,
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
      const res = await fetch(`/api/digital-marketing/logs/${t.logId}/files`, { method: "POST", body: form });
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
      const res = await fetch(`/api/digital-marketing/files/${id}`, { method: "DELETE" });
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
  const isMetaRun = t.templateId === "dmm-06";
  // Whatsapp / Email marketing (dmm-08/09): Done needs the data-source field
  // filled + ≥1 proof attachment (server enforces; mirror here for guidance).
  const needsMarketingProof = t.templateId === "dmm-08" || t.templateId === "dmm-09";
  const dataSourceVal = String(
    metrics.dataSource ?? t.metricsJson?.dataSource ?? ""
  ).trim();
  const missingDataSource = needsMarketingProof && !dataSourceVal;
  const missingProofFile = needsMarketingProof && files.length === 0;
  // Status bar with mandatory reason: a transition is only clickable when a
  // remark is present (typed now or already recorded) — the server enforces it.
  const hasReason = remark.trim() !== "" || String(t.remark || "").trim() !== "";
  const needReason = !hasReason ? " — add a remark (reason) first" : "";
  const needProof = needsMarketingProof && (missingDataSource || missingProofFile)
    ? ` — write which data was used${missingProofFile ? " + attach the data as proof" : ""}`
    : "";
  const doneBlocked = !hasReason || (needsMarketingProof && (missingDataSource || missingProofFile));

  return (
    <div className={isMetaRun
      ? "rounded-2xl border-2 border-indigo-500/60 bg-gradient-to-br from-indigo-500/[0.12] via-indigo-500/[0.05] to-transparent p-3 sm:p-4 shadow-[0_0_24px_-8px_rgba(99,102,241,0.5)]"
      : `rounded-xl border p-3 sm:p-4 ${t.overdue && t.status !== "done" && t.status !== "skipped" ? "border-rose-500/40 bg-rose-500/[0.04]" : "border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-900"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isMetaRun && (
            <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
              📣 Meta Ads Run · Saturday campaign
            </div>
          )}
          <div className={`font-semibold text-sm ${isMetaRun ? "text-indigo-600 dark:text-indigo-300 text-[15px]" : "text-zinc-900 dark:text-white"}`}>{t.title}</div>
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
            {t.dueDate && t.dueDate !== today && (
              <span title={`Originally due ${t.dueDate} — still unresolved`} className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500 dark:text-rose-400">
                📅 due {fmtShort(t.dueDate)}
              </span>
            )}
            {(t.missed ?? []).length > 0 && (
              <span title={`Not completed on: ${(t.missed ?? []).join(", ")}`} className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500 dark:text-rose-400">
                ⚠ missed {(t.missed ?? []).slice(0, 3).map(fmtShort).join(", ")}{(t.missed ?? []).length > 3 ? ` +${(t.missed ?? []).length - 3} more` : ""}
              </span>
            )}
            {(t.daysOverdue ?? 0) > 0 && (
              <span title={t.dueDate ? `Originally due ${t.dueDate}` : "Days past due"} className="inline-flex items-center gap-1 rounded-full border border-rose-500/50 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-600 dark:text-rose-300">
                ⏳ {t.daysOverdue} day{t.daysOverdue === 1 ? "" : "s"} overdue
              </span>
            )}
            {t.doneBy && <span className="text-[11px] text-zinc-500">by {t.doneBy}</span>}
            {t.accountantName && t.accountantName !== t.doneBy && <span className="text-[11px] text-zinc-500">· {t.accountantName}</span>}
            {fmtDur(t.timeSpentMin) && (
              <span title="Time taken to finish this task" className="inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-teal-500 dark:text-teal-400">
                ⏱ {fmtDur(t.timeSpentMin)}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {(t.status === "pending" || t.status === "overdue") && (
            <button disabled={busy || !t.logId || !hasReason} title={`Start work${needReason}`} onClick={() => save("inprogress")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 cursor-pointer border-0">▶ In Progress</button>
          )}
          {(t.status === "pending" || t.status === "overdue" || t.status === "inprogress") && (
            <button disabled={busy || !t.logId || doneBlocked} title={`Mark done${needReason}${needProof}`} onClick={() => save("done")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 cursor-pointer border-0">✓ Done</button>
          )}
          {t.status !== "pending" && (
            <button disabled={busy || !t.logId || !hasReason} onClick={() => save("pending")} className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 cursor-pointer border-0" title={`Back to pending${needReason}`}>↩ Pending</button>
          )}
        </div>
      </div>
      {(t as any).metricsSchema && Array.isArray((t as any).metricsSchema) && (t as any).metricsSchema.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 mt-2">
          {(t as any).metricsSchema.map((f: any) => (
            <label key={f.key} className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
              <span className="font-semibold">{f.label}</span>
              {f.type === "select" && Array.isArray(f.options) ? (
                <select
                  value={metrics[f.key] ?? ""}
                  onChange={(e) => setMetrics({ ...metrics, [f.key]: e.target.value })}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500 text-zinc-900 dark:text-zinc-100"
                >
                  <option value="">Select {f.label}…</option>
                  {f.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  value={metrics[f.key] ?? ""}
                  onChange={(e) => setMetrics({ ...metrics, [f.key]: e.target.value })}
                  placeholder={f.type === 'number' ? '0' : f.type === 'date' ? 'YYYY-MM-DD' : f.label}
                  type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                  inputMode={f.type === 'number' ? 'numeric' : undefined}
                  className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
                />
              )}
            </label>
          ))}
        </div>
      )}
      {t.templateId === "dmm-06" && (metrics.fromDate || metrics.toDate) && (
        <div className="mt-1.5 text-[11px] font-semibold text-indigo-500 dark:text-indigo-300">
          📣 Meta Ads Run{metrics.category ? ` · ${metrics.category}` : ""}{metrics.amountSpent ? ` · ₹${metrics.amountSpent}` : ""}{metrics.fromDate && metrics.toDate ? ` · ${metrics.fromDate} → ${metrics.toDate} (${runDays(metrics.fromDate, metrics.toDate)})` : ""}
          {(t as any).campaignCarried && <span className="font-normal opacity-80"> · carried from campaign start — fill today's inquiries/leads below</span>}
        </div>
      )}
      {needsMarketingProof && (missingDataSource || missingProofFile) && t.status !== "done" && (
        <div className="mt-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
          ⚠ To mark Done: {missingDataSource ? "write which data was used (Data used field above)" : ""}{missingDataSource && missingProofFile ? " + " : ""}{missingProofFile ? "attach the data file as proof below" : ""}
        </div>
      )}
      <div className="flex gap-1.5 mt-2">
        <input
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Remark — e.g. leads: 5 Meta, 3 B2B…"
          className="flex-1 min-w-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
        />
        <select value={whoId} onChange={(e) => setWhoOverride(e.target.value)} title="Who did this task" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1.5 py-1.5 text-xs max-w-[130px]">
          <option value="">Who?…</option>
          {lane.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <span title="Time taken to finish (hours + minutes) — optional, saved with Done" className="inline-flex items-center gap-1 shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1.5 py-1 text-xs text-zinc-500">
          ⏱
          <input value={hrs} onChange={(e) => setHrs(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} placeholder="h" inputMode="numeric" aria-label="Hours taken" className="w-7 bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400" />
          <span className="text-zinc-400">:</span>
          <input value={mins} onChange={(e) => setMins(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} placeholder="m" inputMode="numeric" aria-label="Minutes taken" className="w-7 bg-transparent outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400" />
        </span>
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

type DigitalMarketingView = "dashboard" | "tasks" | "controller";

  // NOTE: nav tabs are built per-viewer as `visibleTabs` inside the component
  // (MIS/root additionally see the Controller tab).

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
  const [view, setView] = useState<DigitalMarketingView>("dashboard");

  // Today only — no date filter. The backend serves the current IST day.
  // pollMs safety net: a stalled request can never wedge the view forever —
  // the 30s hook timeout turns it into an error and the next poll recovers.
  // Loading renders non-destructively (spinner only before first payload).
  const dash = useLiveDashboard<DashData>(async () => {
    const res = await fetch(`/api/automations/digital-marketing/data`);
    if (!res.ok) throw new Error(`Load failed (HTTP ${res.status})`);
    return res.json();
  }, { pollMs: 60000 });

  const data = dash.data;
  const [statusFilter, setStatusFilter] = useState<"pending" | "inprogress" | "done" | "all">("pending");
  // Inner tabs for the Tasks view: today (today's taskbar) vs overdue (backlog) vs history (last-30d done)
  const [roleSub, setRoleSub] = useState<"today" | "overdue" | "history">("today");
  React.useEffect(() => { if (view === "tasks") setRoleSub("today"); }, [view]);
  const selfId = useMemo(() => matchSelfRoster(me as any, data?.roster ?? []), [me, data]);
  // No "Acting as" switcher here — a single manager works this taskbar.
  // Credit defaults to the signed-in user's roster match, overridable per row
  // via the "Who?…" picker.
  const defaultWho = selfId;
  const lane = useMemo(() => data?.items ?? [], [data]);
  const visible = useMemo(() => {
    if (statusFilter === "inprogress") return lane.filter((t) => t.status === "inprogress");
    if (statusFilter === "done") return lane.filter((t) => t.status === "done");
    if (statusFilter === "all") return lane;
    return lane.filter((t) => t.status === "pending" || t.status === "overdue");
  }, [lane, statusFilter]);
  const pendingCount = lane.filter((t) => t.status === "pending" || t.status === "overdue").length;
  const inprogCount = lane.filter((t) => t.status === "inprogress").length;
  const doneCount = lane.filter((t) => t.status === "done").length;

  // Single manager — no lane split. Controller only for MIS.
  const visibleTabs: { key: DigitalMarketingView; label: string; icon: string }[] = !data
    ? [{ key: "dashboard", label: "Dashboard", icon: "📊" }]
    : canMIS
      ? [
        { key: "dashboard", label: "Dashboard", icon: "📊" },
        { key: "tasks", label: "Tasks", icon: "📋" },
        { key: "controller", label: "Controller", icon: "🎛️" },
      ]
      : [
        { key: "dashboard", label: "Dashboard", icon: "📊" },
        { key: "tasks", label: "Tasks", icon: "📋" },
      ];
  const isTaskView = view === "tasks";
  const overdueTray = useMemo(() => data?.overdueList ?? [], [data]);
  const historyTray = useMemo(() => data?.history ?? [], [data]);
  // Reference items: single lane, always visible when in tasks view.
  const inUnscheduled = (_u: UnscheduledItem) => true;
  // If the visible tabs narrow (e.g. identity picked/cleared), drop a
  // now-unreachable view back to the dashboard.
  React.useEffect(() => {
    if (data && !visibleTabs.some((t) => t.key === view)) setView("dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, view]);

  return (
    <div className="space-y-4 text-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Digital Marketing <span className="text-xs font-medium text-zinc-500">· daily / weekly taskbar</span></h2>
          {data && (
            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
              <span className="font-bold text-zinc-800 dark:text-zinc-100 text-xs">📅 Today · {fmtToday(data.meta.date)}</span>
              <span className="font-bold text-emerald-500">✓ {data.meta.done}</span>
              <span className="font-bold text-amber-500">● {data.meta.open} open</span>
              {data.meta.overdue > 0 && <span className="font-bold text-rose-500">⚠ {data.meta.overdue} overdue</span>}
            </div>
          )}
          {data?.metaAdsCampaign && (
            <div className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11px] font-semibold text-indigo-500 dark:text-indigo-300">
              📣 Meta Ads Run{data.metaAdsCampaign.category ? ` · ${data.metaAdsCampaign.category}` : ""}{data.metaAdsCampaign.amountSpent != null ? ` · ₹${data.metaAdsCampaign.amountSpent}` : ""} · {data.metaAdsCampaign.fromDate} → {data.metaAdsCampaign.toDate}{data.metaAdsCampaign.durationDays ? ` (${data.metaAdsCampaign.durationDays} days)` : ""}
              <span className="font-normal opacity-80">· daily box stays open for inquiries/leads during the run</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Tabs (full-width horizontal row, like Telecalling). Non-MIS viewers
            only get Dashboard + Tasks — the Controller tab never renders. */}
        <aside className="w-full shrink-0">
          <nav className="flex flex-row flex-wrap gap-2">
            {visibleTabs.filter((t) => t.key !== "controller" || canMIS).map((t) => {
              const active = view === t.key;
              const count: number | null = null;
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
                  {count !== null && count > 0 && (
                    <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-extrabold ${active ? "bg-white/25 text-white" : "bg-rose-500/15 text-rose-500 dark:text-rose-400"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content (seamless switch — queries stay mounted) */}
        <div className="flex-1 min-w-0">
          {data && view === "dashboard" && <TeamBoard team={data.team ?? null} freqStats={data.freqStats ?? []} />}

      {dash.loading && !data && <div className="py-16 text-center text-sm text-zinc-500 animate-pulse">Loading digital marketing taskbar…</div>}
      {Boolean((dash as any).error) && <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-400">Failed to load: {String((dash as any).error)} <button onClick={() => dash.refresh()} className="ml-2 underline cursor-pointer">Retry</button></div>}

      {/* Tasks — single manager with inner tabs Today / Overdue / History */}
      {data && view === "tasks" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {([
              { key: "today" as const, label: `📋 Today (${lane.length})` },
              { key: "overdue" as const, label: `⚠ Overdue (${overdueTray.length})` },
              { key: "history" as const, label: `🕘 History (${historyTray.length})` },
            ]).map((t) => (
              <button key={t.key} onClick={() => setRoleSub(t.key)} className={`px-3 py-1.5 text-xs font-bold rounded-full cursor-pointer border ${roleSub === t.key ? "bg-indigo-600 text-white border-transparent" : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {roleSub === "today" && (
            <>
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
              <div className="grid gap-3 md:grid-cols-2">
                {(() => {
                  const meta = visible.find((x) => x.templateId === "dmm-06");
                  const rest = visible.filter((x) => x.templateId !== "dmm-06");
                  return (<>
                    {meta && <div className="md:col-span-2"><TaskRow key={meta.templateId} t={meta} roster={data.roster} defaultWho={defaultWho} onLogged={() => dash.refresh()} /></div>}
                    {rest.map((t) => <TaskRow key={t.templateId} t={t} roster={data.roster} defaultWho={defaultWho} onLogged={() => dash.refresh()} />)}
                  </>);
                })()}
                {visible.length === 0 && <div className="col-span-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">{statusFilter === "done" ? "Nothing marked done today — switch to History for past completions." : statusFilter === "inprogress" ? "Nothing in progress — tap ▶ In Progress on a pending task to start it." : "No tasks pending today."}</div>}
              </div>
              {(data.unscheduled ?? []).filter(inUnscheduled).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-zinc-500">📌 No fixed date — reference ({(data.unscheduled ?? []).filter(inUnscheduled).length})</h3>
                  <div className="grid gap-2 md:grid-cols-2">
                    {(data.unscheduled ?? []).filter(inUnscheduled).map((u) => (
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
            </>
          )}

          {roleSub === "overdue" && (
            <div className="space-y-2">
              {overdueTray.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {overdueTray.map((t) => <TaskRow key={t.logId ?? t.templateId} t={t} roster={data.roster} defaultWho={defaultWho} today={data.meta.date} onLogged={() => dash.refresh()} />)}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">All clear — no overdue. 🎉</div>
              )}
            </div>
          )}

          {roleSub === "history" && (
            <div className="space-y-2">
              {historyTray.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {historyTray.map((t) => <TaskRow key={t.logId ?? `${t.templateId}-${t.dueDate}`} t={t} roster={data.roster} defaultWho={defaultWho} today={data.meta.date} onLogged={() => dash.refresh()} />)}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">No completed tasks in the last 30 days.</div>
              )}
            </div>
          )}
        </div>
      )}

      {data && view === "controller" && (canMIS ? <Controller onChanged={() => dash.refresh()} /> : <div className="rounded-xl border p-6 text-sm text-zinc-500">🔒 Controller is restricted to MIS-level users.</div>)}
        </div>
      </div>
    </div>
  );
}

function TeamBoard({ team, freqStats }: { team: TeamData | null; freqStats?: FreqStat[] }) {
  if (!team) return <div className="py-12 text-center text-sm text-zinc-500">Team stats unavailable.</div>;
  const maxMonth = Math.max(1, ...team.members.map((m) => m.doneMonth));
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);
  const freqIcon: Record<string, string> = { daily: "📅", weekly: "🗓", monthly: "📆", quarterly: "📊", yearly: "🎯" };
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
      {freqStats && freqStats.length > 0 && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
          <div className="px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
            📊 Today by frequency — daily / weekly / monthly / quarterly / yearly
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y divide-zinc-100 dark:divide-zinc-800/60">
            {freqStats.map((f) => (
              <div key={f.frequency} className="p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  <span>{freqIcon[f.frequency] ?? "📌"}</span> {f.frequency}
                  <span className="ml-auto text-[10px] font-bold text-zinc-500">{f.total} total</span>
                </div>
                <div className="mt-2 flex gap-2 text-center">
                  <span className="flex-1">
                    <span className="block text-sm font-extrabold text-emerald-500">{f.done}</span>
                    <span className="block text-[9px] uppercase text-zinc-500">done</span>
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-extrabold text-rose-500">{f.overdue}</span>
                    <span className="block text-[9px] uppercase text-zinc-500">overdue</span>
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-extrabold text-amber-500">{f.pending}</span>
                    <span className="block text-[9px] uppercase text-zinc-500">pending</span>
                  </span>
                </div>
                {f.inprogress > 0 && <div className="mt-1 text-[10px] text-blue-500 font-semibold text-center">▶ {f.inprogress} in progress</div>}
                <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 mt-2 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500" style={{ width: `${f.completionPct}%` }} />
                </div>
                <div className="text-[10px] text-center text-zinc-500 mt-1">{f.completionPct}% complete</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 text-xs font-extrabold uppercase tracking-wider text-zinc-600 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
          🏆 Leaderboard · tasks done per person <span className="normal-case font-medium">(week starts Monday)</span>
        </div>
        {team.members.length === 0 && <div className="p-6 text-center text-xs text-zinc-500">No managers on the roster yet — MIS adds them from the Controller tab.</div>}
        {team.members.map((m, i) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
            <span className="w-7 text-sm font-bold shrink-0">{medal(i)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold text-sm truncate">{m.name}</span>
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
      const res = await fetch(`/api/digital-marketing/export?days=${Math.min(93, Math.max(1, days || 30))}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const rows = (data.rows ?? []) as Record<string, any>[];
      const header = ["Date", "Task", "Template", "Frequency", "Lane", "Shared", "Due", "Status", "Overdue", "Done By", "Manager", "Remark", "Time Spent", "Category", "Amount Spent", "From", "To", "Duration Days", "Inquiries", "Leads", "Data Source", "Attachments", "Updated At"];
      const lines = [header.map(csvCell).join(",")];
      for (const r of rows) {
        const files = (r.attachments ?? []).map((f: any) => `${f.name} (${f.url})`).join("; ");
        lines.push([
          r.date, r.task, r.templateId ?? "", r.frequency, r.lane, r.shared ? "yes" : "no", r.due,
          r.status, r.overdue ? "yes" : "no", r.doneBy, r.accountant, r.remark, r.timeSpent ?? "",
          r.category ?? "", r.amountSpent ?? "", r.fromDate ?? "", r.toDate ?? "", r.durationDays ?? "",
          r.inquiries ?? "", r.leads ?? "", r.dataSource ?? "", files, r.updatedAt,
        ].map(csvCell).join(","));
      }
      const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `digital-marketing-export-${data.from}-to-${data.to}.csv`;
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
  // Single manager, no lanes — every template is visible to everyone.
  const owner = "either";
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
      const res = await fetch("/api/digital-marketing/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title — e.g. Meta ads performance check" className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" />
      <select value={pattern} onChange={(e) => setPattern(e.target.value as PatternKey)} className={sel} title="Schedule pattern">
        {PATTERNS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
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
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="accent-indigo-600" /> 👥 Shared (whole team)
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
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setLoadError(null);
      const [rRes, tRes] = await Promise.all([
        fetch(`/api/digital-marketing/roster${showRemoved ? "?deleted=1" : "?deleted=0"}`),
        fetch("/api/digital-marketing/templates?all=1"),
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
        <h3 className="font-bold text-sm">👥 Managers — people who work this taskbar</h3>
        <div className="text-[11px] text-zinc-500">Each person is mapped by name + email. Done / remarks credit whoever logs them (or the name picked in a row's "Who?…" box).</div>
        <div className="grid grid-cols-2 gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. Ramesh" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email — e.g. ramesh@…" className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500" />
          <button disabled={busy || !name.trim()} onClick={() => { api("/api/digital-marketing/roster", "POST", { name: name.trim(), email: email.trim() || null }); setName(""); setEmail(""); }} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer border-0 col-span-2">Add</button>
        </div>
        {loadError && <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-400">Controller failed to load: {loadError} <button onClick={() => load()} className="ml-1 underline cursor-pointer">Retry</button></div>}
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} className="accent-indigo-600" /> Show removed (restore)
        </label>
        <div className="space-y-1.5">
          {(roster ?? []).map((r) => (
            <RosterRowEditor key={r.id} row={r} busy={busy} onSave={(patch) => api(`/api/digital-marketing/roster/${r.id}`, "PUT", patch)} onRemove={() => api(`/api/digital-marketing/roster/${r.id}`, "DELETE")} onRestore={() => api(`/api/digital-marketing/roster/${r.id}`, "PUT", { deleted: false })} />
          ))}
          {roster === null && !loadError && <div className="text-xs text-zinc-500 animate-pulse">Loading roster…</div>}
          {roster !== null && roster.length === 0 && !loadError && <div className="text-xs text-zinc-500">No managers yet — add the team above.</div>}
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
              <select value={t.frequency} disabled={busy} onChange={(e) => api(`/api/digital-marketing/templates/${t.id}`, "PUT", { frequency: e.target.value })} className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1 py-0.5 text-[11px]">
                {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <span title="Visible to the whole team" className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-1 py-0.5 text-[11px] text-zinc-500">{t.ownerRole === "either" ? "everyone" : t.ownerRole}</span>
              <button disabled={busy} onClick={() => api(`/api/digital-marketing/templates/${t.id}`, "PUT", { isShared: !t.isShared })} className={`cursor-pointer border-0 bg-transparent text-sm ${t.isShared ? "" : "opacity-30 grayscale"}`} title={t.isShared ? "Shared task (click to unmark)" : "Mark as shared task"}>👥</button>
              <button disabled={busy} onClick={() => api(`/api/digital-marketing/templates/${t.id}`, "PUT", { active: !t.active })} className="cursor-pointer border-0 bg-transparent text-sm" title={t.active ? "Pause" : "Resume"}>{t.active ? "⏸" : "▶"}</button>
              <button disabled={busy} onClick={() => api(`/api/digital-marketing/templates/${t.id}`, "DELETE")} className="text-rose-500 hover:text-rose-400 cursor-pointer border-0 bg-transparent text-sm" title="Archive">✕</button>
            </div>
          ))}
          {templates === null && <div className="text-xs text-zinc-500 animate-pulse">Loading templates…</div>}
        </div>
      </div>
    </div>
  );
}
