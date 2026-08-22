"use client";

import React, { useCallback, useEffect, useState } from "react";

type TrafficLight = "green" | "amber" | "red";

type Kra = {
 connectedTarget: number;
 connectedDailyTarget?: number;
 connected: number;
 connectedAvgPerDay?: number;
 connectedPct: number;
 connectedStatus: TrafficLight;
 leadsTarget: number;
 leadsDailyTarget?: number;
 leads: number;
 leadsAvgPerDay?: number;
 leadsPct: number;
 leadsStatus: TrafficLight;
 overall: TrafficLight;
 overallLabel: string;
 zohoEstimates: number;
 zohoPipelineValue: number;
};

type AgentRow = {
 userName: string;
 userId: string;
 managerName: string | null;
 callsAttempted: number;
 callsConnected: number;
 callsNotConnected: number;
 incomingCalls: number;
 outgoingCalls: number;
 incomingMissed: number;
 outgoingMissed: number;
 talkTimeSec: number;
 leadsConverted: number;
 leadsInProgress: number;
 leadsLost: number;
 leadsClosed: number;
 followupLeads: number;
 pendingScheduledLeads: number;
 kra?: Kra;
};

type Totals = Record<string, number>;

type DataResponse = {
 meta: {
 analysis: string;
 reportDate: string | null;
 range?: { from: string | null; to: string | null; days: number } | null;
 dates?: string[];
 fetchedAt?: string;
 generatedAt: string;
 agentCount?: number;
 error?: string;
 };
 benchmarks?: { connectedCallsPerDay: number; leadsPerAgentPerDay: number };
 agents: AgentRow[];
 totals: Totals | null;
 zohoUnmapped?: { zohoName: string; estimates: number; value: number }[];
};

const REFRESH_MS = 5 * 60 * 1000;

type PresetKey =
 | "today" | "yesterday" | "this_week" | "last_week"
 | "this_month" | "last_month" | "last_7_days" | "last_30_days"
 | "all_time" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
 { key: "today", label: "Today (live)" },
 { key: "yesterday", label: "Yesterday" },
 { key: "this_week", label: "This Week" },
 { key: "last_week", label: "Last Week" },
 { key: "this_month", label: "This Month" },
 { key: "last_month", label: "Last Month" },
 { key: "last_7_days", label: "Last 7 Days" },
 { key: "last_30_days", label: "Last 30 Days" },
 { key: "all_time", label: "All Time" },
 { key: "custom", label: "Custom Range…" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function istToday(): string {
 return new Intl.DateTimeFormat("en-CA", {
 timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
 }).format(new Date()).slice(0, 10);
}

function addDays(dateStr: string, delta: number): string {
 const [y, m, d] = dateStr.split("-").map(Number);
 return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function computeRange(preset: PresetKey, customFrom: string, customTo: string): { from?: string; to?: string } {
 const today = istToday();
 switch (preset) {
 case "today": return { from: today, to: today };
 case "yesterday": { const y = addDays(today, -1); return { from: y, to: y }; }
 case "this_week": {
 const [y, m, d] = today.split("-").map(Number);
 const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
 return { from: addDays(today, -((dow + 6) % 7)), to: today }; // Mon → today
 }
 case "last_week": {
 const [y, m, d] = today.split("-").map(Number);
 const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
 const mon = addDays(today, -((dow + 6) % 7));
 return { from: addDays(mon, -7), to: addDays(mon, -1) };
 }
 case "this_month": return { from: `${today.slice(0, 8)}01`, to: today };
 case "last_month": {
 const firstOfThisMonth = `${today.slice(0, 8)}01`;
 const lastOfPrev = addDays(firstOfThisMonth, -1);
 return { from: `${lastOfPrev.slice(0, 8)}01`, to: lastOfPrev };
 }
 case "last_7_days": return { from: addDays(today, -6), to: today };
 case "last_30_days": return { from: addDays(today, -29), to: today };
 case "all_time": return { from: "2020-01-01", to: today };
 case "custom":
 if (DATE_RE.test(customFrom) && DATE_RE.test(customTo)) {
 return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
 }
 return {};
 }
}

function fmtRangeLabel(from?: string | null, to?: string | null): string {
 if (!from && !to) return "";
 if (from === to) return from!;
 return `${from} – ${to}`;
}

const LIGHT_TEXT: Record<TrafficLight, string> = {
 green: "text-emerald-600 dark:text-emerald-emerald400",
 amber: "text-amber-600 dark:text-amber-amber400",
 red: "text-rose-600 dark:text-rose-rose400",
};
const LIGHT_BG: Record<TrafficLight, string> = {
 green: "bg-emerald-500",
 amber: "bg-amber-500",
 red: "bg-rose-500",
};
const LIGHT_CHIP: Record<TrafficLight, string> = {
 green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-emerald400 border-emerald-500/20",
 amber: "bg-amber-500/10 text-amber-600 dark:text-amber-amber400 border-amber-500/20",
 red: "bg-rose-500/10 text-rose-600 dark:text-rose-rose400 border-rose-500/20",
};

function fmtTalkTime(sec: number): string {
 if (!sec) return "—";
 const h = Math.floor(sec / 3600);
 const m = Math.round((sec % 3600) / 60);
 return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtNum(n: number | undefined): string {
 return n === undefined || n === null ? "—" : String(n);
}

function KraBar({ label, value, target, pct, status }: { label: string; value: number; target: number; pct: number; status: TrafficLight }) {
 const width = Math.min(100, pct);
 return (
 <div>
 <div className="flex items-center justify-between text-[11px] mb-1">
 <span className="text-[var(--text-tertiary)] font-semibold">{label}</span>
 <span className={`font-bold font-mono ${LIGHT_TEXT[status]}`}>
 {value}/{target} · {pct}%
 </span>
 </div>
 <div className="h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
 <div className={`h-full rounded-full transition-all duration-500 ${LIGHT_BG[status]}`} style={{ width: `${width}%` }} />
 </div>
 </div>
 );
}

export default function NeodoveTelecallerDashboard() {
 const [data, setData] = useState<DataResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
 const [preset, setPreset] = useState<PresetKey>("today");
 const [customFrom, setCustomFrom] = useState("");
 const [customTo, setCustomTo] = useState("");

 // Recompute the active range whenever the preset / custom dates change.
 const range = React.useMemo(
 () => computeRange(preset, customFrom, customTo),
 [preset, customFrom, customTo],
 );
 const rangeRef = React.useRef(range);
 rangeRef.current = range;

 const load = useCallback(async (showSpinner = false) => {
 if (showSpinner) setRefreshing(true);
 try {
 const { from, to } = rangeRef.current;
 const qs = from && to ? `?from=${from}&to=${to}` : "";
 const res = await fetch(`/api/automations/neodove-telecaller-report/data${qs}`, { cache: "no-store" });
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const json: DataResponse = await res.json();
 setData(json);
 setError(json.meta.error ?? null);
 setLastLoaded(new Date());
 } catch (e: any) {
 setError(e.message ?? "failed to load");
 } finally {
 setLoading(false);
 setRefreshing(false);
 }
 }, []);

 useEffect(() => {
 load(true);
 }, [load, range]);

 useEffect(() => {
 const t = setInterval(() => load(), REFRESH_MS);
 return () => clearInterval(t);
 }, [load]);

 const agents = data?.agents ?? [];
 const totals = data?.totals;
 const benchmarks = data?.benchmarks ?? { connectedCallsPerDay: 120, leadsPerAgentPerDay: 5 };
 const zohoUnmapped = data?.zohoUnmapped ?? [];
 const withKra = agents.filter((a) => a.kra);
 const days = data?.meta.range?.days ?? 1;
 const multiDay = days > 1;
 const rangeLabel =
 data?.meta.range && data.meta.range.days > 0
 ? fmtRangeLabel(data.meta.range.from, data.meta.range.to)
 : data?.meta.reportDate ?? "";

 return (
 <div className="space-y-4 text-[var(--text-primary)]">
 {/* Header */}
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-5">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <h2 className="text-xl font-bold">📞 Telecaller Performance — Individual KRA/KPI</h2>
 <p className="text-xs text-[var(--text-tertiary)] mt-1">
 {rangeLabel ? (
 <>
 <span className="text-indigo-600 dark:text-indigo-indigo300 font-semibold">{rangeLabel}</span>
 {multiDay && <> · <span className="text-[var(--text-secondary)] font-semibold">{days} active days</span> · totals summed, benchmarks judged on avg/day</>}
 {!multiDay && <> · live vs daily benchmarks</>}
 {" "}· auto-refreshes every 5 min
 </>
 ) : (
 "Waiting for first report…"
 )}
 </p>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <select
 value={preset}
 onChange={(e) => setPreset(e.target.value as PresetKey)}
 className="px-3 py-1.5 text-xs bg-black/5 dark:bg-white/10 border border-black/15 dark:border-white/15 rounded-lg text-[var(--text-primary)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
 aria-label="Report date range"
 >
 {PRESETS.map((p) => (
 <option key={p.key} value={p.key}>{p.label}</option>
 ))}
 </select>
 {preset === "custom" && (
 <>
 <input
 type="date" value={customFrom} max={istToday()}
 onChange={(e) => setCustomFrom(e.target.value)}
 className="px-2 py-1.5 text-xs bg-black/5 dark:bg-white/10 border border-black/15 dark:border-white/15 rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:[color-scheme:dark]"
 aria-label="From date"
 />
 <span className="text-xs text-[var(--text-tertiary)]">→</span>
 <input
 type="date" value={customTo} max={istToday()}
 onChange={(e) => setCustomTo(e.target.value)}
 className="px-2 py-1.5 text-xs bg-black/5 dark:bg-white/10 border border-black/15 dark:border-white/15 rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:[color-scheme:dark]"
 aria-label="To date"
 />
 </>
 )}
 {lastLoaded && (
 <span className="text-[11px] text-[var(--text-tertiary)]">updated {lastLoaded.toLocaleTimeString()}</span>
 )}
 <button
 onClick={() => load(true)}
 disabled={refreshing}
 className="text-white px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-all duration-200 cursor-pointer border-0 disabled:opacity-50"
 >
 {refreshing ? "Refreshing…" : "↻ Refresh now"}
 </button>
 </div>
 </div>
 <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
 Benchmarks per agent/day: <span className="text-[var(--text-secondary)] font-semibold">≥ {benchmarks.connectedCallsPerDay} connected calls</span> ·{" "}
 <span className="text-[var(--text-secondary)] font-semibold">≥ {benchmarks.leadsPerAgentPerDay} leads</span> (in-progress + converted)
 {multiDay && <> — scaled to <span className="text-indigo-600 dark:text-indigo-indigo300 font-semibold">{benchmarks.connectedCallsPerDay * days} calls / {benchmarks.leadsPerAgentPerDay * days} leads for {days} active days</span></>}
 . Traffic light: 🟢 ≥100% · 🟡 60–99% · 🔴 &lt;60%
 </p>
 {error && (
 <p className="mt-3 text-xs text-amber-600 dark:text-amber-amber300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{error}</p>
 )}
 </div>

 {/* Individual Agent KRA/KPI cards */}
 {!loading && withKra.length > 0 && (
 <div className="space-y-3">
 <h3 className="text-xs font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-indigo300">
 🎯 Individual Agent KRA — {multiDay ? "Range Total vs Scaled Benchmark" : "Today vs Benchmark"}
 </h3>
 <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
 {withKra.map((a) => {
 const k = a.kra!;
 return (
 <div key={a.userId || a.userName} className={`rounded-xl border p-4 space-y-3 bg-[var(--bg-card)] ${
 k.overall === "green" ? "border-emerald-500/30" : k.overall === "amber" ? "border-amber-500/30" : "border-rose-500/30"
 }`}>
 <div className="flex items-start justify-between gap-2">
 <div className="min-w-0">
 <span className="font-bold text-[var(--text-primary)] truncate block">{a.userName}</span>
 <span className="text-[10px] text-[var(--text-tertiary)]">{a.managerName ?? "—"}</span>
 </div>
 <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-extrabold uppercase tracking-wide ${LIGHT_CHIP[k.overall]}`}>
 {k.overallLabel}
 </span>
 </div>
 <KraBar label="Connected Calls" value={k.connected} target={k.connectedTarget} pct={k.connectedPct} status={k.connectedStatus} />
 <KraBar label="Leads Generated" value={k.leads} target={k.leadsTarget} pct={k.leadsPct} status={k.leadsStatus} />
 {multiDay && (
 <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
 <span>Range avg/day</span>
 <span className="font-mono text-[var(--text-tertiary)]">{k.connectedAvgPerDay ?? "—"}/{k.connectedDailyTarget ?? benchmarks.connectedCallsPerDay} calls · {k.leadsAvgPerDay ?? "—"}/{k.leadsDailyTarget ?? benchmarks.leadsPerAgentPerDay} leads</span>
 </div>
 )}
 <div className="flex items-center justify-between pt-1 border-t border-[var(--border-card)] text-[10px] text-[var(--text-tertiary)]">
 <span>Zoho pipeline</span>
 {k.zohoEstimates > 0 ? (
 <span className="font-semibold text-indigo-600 dark:text-indigo-indigo300">
 {k.zohoEstimates} sent est. · ₹{k.zohoPipelineValue.toLocaleString()}
 </span>
 ) : (
 <span className="italic">not mapped</span>
 )}
 </div>
 </div>
 );
 })}
 </div>
 {zohoUnmapped.length > 0 && (
 <p className="text-[10px] text-[var(--text-tertiary)]">
 Zoho commenters not mapped to any agent: {zohoUnmapped.map((z) => `${z.zohoName} (${z.estimates})`).join(", ")}. Set the D1 setting
 {" "}
 <code className="text-[var(--text-tertiary)]">kra:zoho_name_map</code> to map them.
 </p>
 )}
 </div>
 )}

 {/* Team KPI strip */}
 {totals && (
 <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
 {[
 { label: "Calls Attempted", value: fmtNum(totals.callsAttempted), accent: "text-[var(--text-primary)]" },
 { label: "Connected", value: fmtNum(totals.callsConnected), accent: "text-emerald-600 dark:text-emerald-emerald400" },
 { label: "Missed (in+out)", value: fmtNum((totals.incomingMissed ?? 0) + (totals.outgoingMissed ?? 0)), accent: "text-rose-600 dark:text-rose-rose400" },
 { label: "Team Talk Time", value: fmtTalkTime(totals.talkTimeSec), accent: "text-indigo-600 dark:text-indigo-indigo300" },
 { label: "Converted", value: fmtNum(totals.leadsConverted), accent: "text-emerald-600 dark:text-emerald-emerald300" },
 { label: "Follow-ups Due", value: fmtNum(totals.followupLeads), accent: "text-amber-600 dark:text-amber-amber300" },
 ].map((k) => (
 <div key={k.label} className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-4">
 <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-bold">{k.label}</div>
 <div className={`text-2xl font-extrabold mt-1 ${k.accent}`}>{k.value}</div>
 </div>
 ))}
 </div>
 )}

 {/* Agent table */}
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl overflow-hidden">
 {loading ? (
 <div className="py-16 text-center text-[var(--text-tertiary)] animate-pulse">Loading telecaller data…</div>
 ) : agents.length === 0 ? (
 <div className="py-16 text-center text-[var(--text-tertiary)]">No agent activity stored for this day yet.</div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-card)]">
 <th className="px-4 py-3">#</th>
 <th className="px-4 py-3">Agent</th>
 <th className="px-4 py-3">Manager</th>
 <th className="px-4 py-3 text-right">Attempted</th>
 <th className="px-4 py-3 text-right">Connected</th>
 <th className="px-4 py-3 text-right">% of Target</th>
 <th className="px-4 py-3 text-right">Leads (IP+Cv)</th>
 <th className="px-4 py-3 text-right">Not Conn.</th>
 <th className="px-4 py-3 text-right">Incoming</th>
 <th className="px-4 py-3 text-right">Outgoing</th>
 <th className="px-4 py-3 text-right">Missed</th>
 <th className="px-4 py-3 text-right">Talk Time</th>
 <th className="px-4 py-3 text-right">Converted</th>
 <th className="px-4 py-3 text-right">In Prog.</th>
 <th className="px-4 py-3 text-right">Lost</th>
 <th className="px-4 py-3 text-right">Follow-ups</th>
 <th className="px-4 py-3 text-right">Pending Sched.</th>
 </tr>
 </thead>
 <tbody>
 {agents.map((a, i) => (
 <tr key={a.userId || a.userName} className="border-b border-[var(--border-card)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
 <td className="px-4 py-2.5 text-[var(--text-tertiary)]">{i + 1}</td>
 <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">{a.userName}</td>
 <td className="px-4 py-2.5 text-[var(--text-tertiary)] whitespace-nowrap">{a.managerName ?? "—"}</td>
 <td className="px-4 py-2.5 text-right font-bold text-[var(--text-primary)]">{a.callsAttempted}</td>
 <td className="px-4 py-2.5 text-right text-emerald-600 dark:text-emerald-emerald400">{a.callsConnected}</td>
 <td className={`px-4 py-2.5 text-right font-mono font-bold ${a.kra ? LIGHT_TEXT[a.kra.connectedStatus] : "text-[var(--text-tertiary)]"}`}>
 {a.kra ? `${a.kra.connectedPct}%` : "—"}
 </td>
 <td className={`px-4 py-2.5 text-right font-mono font-bold ${a.kra ? LIGHT_TEXT[a.kra.leadsStatus] : "text-[var(--text-tertiary)]"}`}>
 {a.kra ? `${a.kra.leads}/${a.kra.leadsTarget}` : "—"}
 </td>
 <td className="px-4 py-2.5 text-right text-[var(--text-tertiary)]">{a.callsNotConnected}</td>
 <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{a.incomingCalls}</td>
 <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{a.outgoingCalls}</td>
 <td className="px-4 py-2.5 text-right text-rose-600 dark:text-rose-rose400">{a.incomingMissed + a.outgoingMissed}</td>
 <td className="px-4 py-2.5 text-right text-indigo-600 dark:text-indigo-indigo300 font-medium">{fmtTalkTime(a.talkTimeSec)}</td>
 <td className="px-4 py-2.5 text-right text-emerald-600 dark:text-emerald-emerald300 font-semibold">{a.leadsConverted}</td>
 <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{a.leadsInProgress}</td>
 <td className="px-4 py-2.5 text-right text-[var(--text-tertiary)]">{a.leadsLost}</td>
 <td className="px-4 py-2.5 text-right text-amber-600 dark:text-amber-amber300">{a.followupLeads}</td>
 <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{a.pendingScheduledLeads}</td>
 </tr>
 ))}
 </tbody>
 {totals && (
 <tfoot>
 <tr className="bg-black/5 dark:bg-white/10 text-[13px] font-bold border-t border-black/15 dark:border-white/15">
 <td colSpan={3} className="px-4 py-3 text-[var(--text-secondary)] uppercase tracking-wide text-[10px]">Team Total</td>
 <td className="px-4 py-3 text-right text-[var(--text-primary)]">{fmtNum(totals.callsAttempted)}</td>
 <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-emerald400">{fmtNum(totals.callsConnected)}</td>
 <td className="px-4 py-3 text-right text-[var(--text-tertiary)]">—</td>
 <td className="px-4 py-3 text-right text-[var(--text-tertiary)]">—</td>
 <td className="px-4 py-3 text-right text-[var(--text-tertiary)]">{fmtNum(totals.callsNotConnected)}</td>
 <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{fmtNum(totals.incomingCalls)}</td>
 <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{fmtNum(totals.outgoingCalls)}</td>
 <td className="px-4 py-3 text-right text-rose-600 dark:text-rose-rose400">{(totals.incomingMissed ?? 0) + (totals.outgoingMissed ?? 0)}</td>
 <td className="px-4 py-3 text-right text-indigo-600 dark:text-indigo-indigo300">{fmtTalkTime(totals.talkTimeSec)}</td>
 <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-emerald300">{fmtNum(totals.leadsConverted)}</td>
 <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{fmtNum(totals.leadsInProgress)}</td>
 <td className="px-4 py-3 text-right text-[var(--text-tertiary)]">{fmtNum(totals.leadsLost)}</td>
 <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-amber300">{fmtNum(totals.followupLeads)}</td>
 <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{fmtNum(totals.pendingScheduledLeads)}</td>
 </tr>
 </tfoot>
 )}
 </table>
 </div>
 )}
 </div>
 </div>
 );
}