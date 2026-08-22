"use client";

import React, { useState, useEffect, useCallback } from "react";

type Kpi = {
 label: string;
 value: string | number;
 sub?: string;
 accent?: "indigo" | "emerald" | "rose" | "amber" | "violet";
};

type Warning = {
 sNo: string;
 company: string;
 field: string;
 issue: string;
 severity: "critical" | "warning";
};

type Table = {
 title: string;
 columns: string[];
 rows: (string | number)[][];
};

type Insight = {
 name: string;
 role: string;
 badge: string;
 desc: string;
};

type SheetData = {
 meta: {
 analysis: string;
 title: string;
 spreadsheetUrl: string;
 range: string;
 rowsRead: number;
 configured: boolean;
 generatedAt: string;
 error?: string;
 };
 kpis?: Kpi[];
 warnings?: Warning[];
 insights?: { good: Insight[]; inconsistent: Insight[] };
 tables?: Table[];
};

const ACCENT_CLASS: Record<string, { text: string; glow: string }> = {
 indigo: { text: "text-indigo-600 dark:text-indigo-400", glow: "bg-indigo-500/10" },
 emerald: { text: "text-emerald-600 dark:text-emerald-emerald400", glow: "bg-emerald-500/10" },
 rose: { text: "text-rose-600 dark:text-rose-rose400", glow: "bg-rose-500/10" },
 amber: { text: "text-amber-600 dark:text-amber-amber400", glow: "bg-amber-500/10" },
 violet: { text: "text-violet-600 dark:text-violet-violet400", glow: "bg-violet-500/10" },
};

const formatIso = (d: Date) =>
 `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function SheetAnalysisDashboard({ slug }: { slug: string }) {
 const [data, setData] = useState<SheetData | null>(null);
 const [loading, setLoading] = useState<boolean>(true);
 const [error, setError] = useState<string | null>(null);
 const [startDate, setStartDate] = useState("");
 const [endDate, setEndDate] = useState("");

 const fetchData = useCallback(async () => {
 setLoading(true);
 setError(null);
 try {
 const params = new URLSearchParams();
 if (startDate) params.set("start", startDate);
 if (endDate) params.set("end", endDate);
 const qs = params.toString();
 const res = await fetch(`/api/automations/${slug}/data${qs ? `?${qs}` : ""}`);
 if (!res.ok) {
 setError(`Dashboard not available (HTTP ${res.status}).`);
 setData(null);
 return;
 }
 setData(await res.json());
 } catch (e: unknown) {
 setError(e instanceof Error ? e.message : String(e));
 } finally {
 setLoading(false);
 }
 }, [slug, startDate, endDate]);

 useEffect(() => {
 let cancelled = false;
 const load = async () => {
 setLoading(true);
 setError(null);
 try {
 const params = new URLSearchParams();
 if (startDate) params.set("start", startDate);
 if (endDate) params.set("end", endDate);
 const qs = params.toString();
 const res = await fetch(`/api/automations/${slug}/data${qs ? `?${qs}` : ""}`);
 if (!res.ok) {
 if (!cancelled) {
 setError(`Dashboard not available (HTTP ${res.status}).`);
 setData(null);
 }
 return;
 }
 if (!cancelled) setData(await res.json());
 } catch (e: unknown) {
 if (!cancelled) setError(e instanceof Error ? e.message : String(e));
 } finally {
 if (!cancelled) setLoading(false);
 }
 };
 load();
 const timer = setInterval(load, 120_000);
 return () => {
 cancelled = true;
 clearInterval(timer);
 };
 }, [slug, startDate, endDate]);

 const applyPreset = (preset: string) => {
 const base = new Date();
 switch (preset) {
 case "today":
 setStartDate(formatIso(base));
 setEndDate(formatIso(base));
 break;
 case "yesterday": {
 const prev = new Date(base);
 prev.setDate(base.getDate() - 1);
 setStartDate(formatIso(prev));
 setEndDate(formatIso(prev));
 break;
 }
 case "last7": {
 const past = new Date(base);
 past.setDate(base.getDate() - 7);
 setStartDate(formatIso(past));
 setEndDate(formatIso(base));
 break;
 }
 case "last30": {
 const past = new Date(base);
 past.setDate(base.getDate() - 30);
 setStartDate(formatIso(past));
 setEndDate(formatIso(base));
 break;
 }
 case "all":
 setStartDate("");
 setEndDate("");
 break;
 }
 };

 if (!loading && !error && data && data.meta?.analysis !== "sheet") {
 return (
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-10 text-center text-sm text-[var(--text-tertiary)]">
 No dashboard wired for <code className="text-[var(--text-secondary)]">{slug}</code> yet.
 </div>
 );
 }

 return (
 <div className="space-y-6 text-[var(--text-primary)] pb-12">
 {/* Header */}
 <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b border-[var(--border-card)] pb-5">
 <div>
 <h1 className="text-2xl font-bold font-heading tracking-tight flex items-center gap-2">
 <span>📊</span> {data?.meta?.title ?? "Sheet Analysis"}
 </h1>
 <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
 {data?.meta?.rowsRead ?? "—"} rows · range {data?.meta?.range ?? "—"}
 {data?.meta?.generatedAt && ` · updated ${new Date(data.meta.generatedAt).toLocaleTimeString()}`}
 </p>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <div className="flex items-center gap-1.5 bg-[var(--bg-card)] border border-[var(--border-card)] rounded-lg p-1.5 text-xs">
 <span className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-wider pl-1">Range:</span>
 <select
 onChange={(e) => applyPreset(e.target.value)}
 defaultValue="all"
 className="bg-[var(--bg-input)] border border-[var(--border-card)] text-[var(--text-secondary)] text-xs rounded-md px-2 py-1 focus:outline-none focus:border-indigo-500 cursor-pointer"
 >
 <option value="all">All Available</option>
 <option value="today">Today</option>
 <option value="yesterday">Yesterday</option>
 <option value="last7">Last 7 Days</option>
 <option value="last30">Last 30 Days</option>
 </select>
 <input
 type="date"
 value={startDate}
 onChange={(e) => setStartDate(e.target.value)}
 className="bg-[var(--bg-input)] border border-[var(--border-card)] text-[var(--text-primary)] text-xs rounded-md px-2 py-1 focus:outline-none focus:border-indigo-500"
 />
 <span className="text-[var(--text-tertiary)] font-bold">➔</span>
 <input
 type="date"
 value={endDate}
 onChange={(e) => setEndDate(e.target.value)}
 className="bg-[var(--bg-input)] border border-[var(--border-card)] text-[var(--text-primary)] text-xs rounded-md px-2 py-1 focus:outline-none focus:border-indigo-500"
 />
 </div>
 <button
 onClick={fetchData}
 className="text-white flex items-center gap-2 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-medium text-xs transition-all duration-200 cursor-pointer border-0"
 >
 <span>🔄</span> Refresh
 </button>
 </div>
 </div>

 {/* Not-configured / error banners */}
 {!loading && !error && data && !data.meta.configured && (
 <div className="bg-amber-950/10 border border-amber-900/30 rounded-xl p-4 text-xs text-amber-200/90 leading-relaxed">
 ⚠️ Google Sheets is not configured. Add <code className="bg-[var(--bg-input)] px-1 py-0.5 rounded font-mono text-rose-600 dark:text-rose-rose300">google-service-account.json</code> or set <code className="bg-[var(--bg-input)] px-1 py-0.5 rounded font-mono text-rose-600 dark:text-rose-rose300">GOOGLE_SERVICE_ACCOUNT_JSON</code> to connect a live sheet.
 </div>
 )}
 {!loading && error && (
 <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-5 text-sm text-rose-600 dark:text-rose-rose300">
 {error}
 </div>
 )}
 {!loading && !error && data && data.meta.error && data.meta.configured && (
 <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-xs text-rose-600 dark:text-rose-rose300">
 ⚠️ {data.meta.error}
 </div>
 )}

 {loading && (
 <div className="flex items-center justify-center py-20 text-[var(--text-tertiary)]">
 <span className="animate-pulse">Loading sheet analysis...</span>
 </div>
 )}

 {!loading && !error && data && data.meta.analysis === "sheet" && (
 <>
 {/* KPI cards */}
 {data.kpis && data.kpis.length > 0 && (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
 {data.kpis.map((kpi) => {
 const accent = ACCENT_CLASS[kpi.accent ?? "indigo"] ?? ACCENT_CLASS.indigo;
 return (
 <div key={kpi.label} className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-4 flex flex-col justify-between shadow-md relative overflow-hidden">
 <div className={`absolute top-0 right-0 p-2 text-5xl font-bold font-mono ${accent.glow}`}>•</div>
 <span className="text-[var(--text-tertiary)] text-[10px] font-semibold uppercase tracking-wider">{kpi.label}</span>
 <span className={`text-2xl font-extrabold mt-1 z-10 font-mono ${accent.text}`}>{kpi.value}</span>
 {kpi.sub && <span className="text-[9px] text-[var(--text-tertiary)] mt-0.5 font-medium">{kpi.sub}</span>}
 </div>
 );
 })}
 </div>
 )}

 {/* Data quality warnings */}
 {data.warnings !== undefined && (
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-5 shadow-md space-y-3">
 <h3 className="text-[var(--text-primary)] font-bold text-base flex items-center gap-2">
 <span>🔍</span> Data Quality & Integrity Audit ({data.warnings.length} Warnings)
 </h3>
 {data.warnings.length === 0 ? (
 <p className="text-xs text-emerald-600 dark:text-emerald-emerald400 font-bold">✓ Data is clean! Zero warnings or missing fields found in sheet range.</p>
 ) : (
 <div className="overflow-x-auto border border-[var(--border-card)] rounded-lg">
 <table className="w-full text-left text-xs border-collapse">
 <thead>
 <tr className="bg-[var(--bg-input)] border-b border-[var(--border-card)] text-[var(--text-tertiary)] font-bold text-[10px] uppercase">
 <th className="p-3 text-center w-12">Row</th>
 <th className="p-3 w-48">Company Name</th>
 <th className="p-3 w-40">Field Target</th>
 <th className="p-3">Identified Issue / Correction Needed</th>
 <th className="p-3 text-center w-28">Severity</th>
 </tr>
 </thead>
 <tbody>
 {data.warnings.slice(0, 20).map((warning, idx) => (
 <tr key={idx} className="border-b border-[var(--border-card)] hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-secondary)]">
 <td className="p-3 text-center font-mono font-bold text-[var(--text-tertiary)]">{warning.sNo}</td>
 <td className="p-3 font-bold text-[var(--text-primary)]">{warning.company}</td>
 <td className="p-3 text-[var(--text-tertiary)] font-mono text-[10px]">{warning.field}</td>
 <td className="p-3 font-medium">{warning.issue}</td>
 <td className="p-3 text-center">
 <span className={`px-2 py-0.5 text-[9px] font-extrabold uppercase rounded ${
 warning.severity === "critical"
 ? "bg-rose-500/10 text-rose-600 dark:text-rose-rose400 border border-rose-500/20"
 : "bg-amber-500/10 text-amber-600 dark:text-amber-amber400 border border-amber-500/20"
 }`}>{warning.severity}</span>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}

 {/* Performance insights */}
 {data.insights && (
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-5 shadow-md space-y-4">
 <h3 className="text-[var(--text-primary)] font-bold text-base flex items-center gap-2">
 <span>🧠</span> AI-Driven Performance & Consistency Insights
 </h3>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
 <div className="bg-emerald-950/10 border border-emerald-900/20 rounded-xl p-4 space-y-3">
 <h4 className="text-emerald-600 dark:text-emerald-emerald400 font-bold text-xs flex items-center gap-2">
 <span>🔥</span> Top & Consistent Performers
 </h4>
 {data.insights.good.length === 0 ? (
 <p className="text-xs text-[var(--text-tertiary)]">No agents meet the top performer threshold in this range.</p>
 ) : (
 <div className="space-y-2.5">
 {data.insights.good.map((item) => (
 <div key={item.name} className="bg-black/5 dark:bg-black/25 p-2.5 rounded-lg border border-emerald-950/30 flex justify-between items-center gap-3">
 <div>
 <div className="flex items-center gap-2">
 <span className="text-[var(--text-primary)] font-bold text-xs">{item.name}</span>
 <span className="text-[8px] px-1 bg-black/5 dark:bg-white/10 text-[var(--text-tertiary)] rounded font-mono">{item.role}</span>
 </div>
 <span className="text-[10px] text-[var(--text-tertiary)]">{item.desc}</span>
 </div>
 <span className="text-[9px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-emerald400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">{item.badge}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 <div className="bg-rose-950/10 border border-rose-900/20 rounded-xl p-4 space-y-3">
 <h4 className="text-rose-600 dark:text-rose-rose400 font-bold text-xs flex items-center gap-2">
 <span>⚠️</span> Inconsistent / Needs Training Focus
 </h4>
 {data.insights.inconsistent.length === 0 ? (
 <p className="text-xs text-[var(--text-tertiary)]">No agents flagged for consistency issues in this range.</p>
 ) : (
 <div className="space-y-2.5">
 {data.insights.inconsistent.map((item) => (
 <div key={item.name} className="bg-black/5 dark:bg-black/25 p-2.5 rounded-lg border border-rose-950/30 flex justify-between items-center gap-3">
 <div>
 <div className="flex items-center gap-2">
 <span className="text-[var(--text-primary)] font-bold text-xs">{item.name}</span>
 <span className="text-[8px] px-1 bg-black/5 dark:bg-white/10 text-[var(--text-tertiary)] rounded font-mono">{item.role}</span>
 </div>
 <span className="text-[10px] text-[var(--text-tertiary)]">{item.desc}</span>
 </div>
 <span className="text-[9px] bg-rose-500/10 text-rose-600 dark:text-rose-rose400 border border-rose-500/20 px-2 py-0.5 rounded-full font-bold">{item.badge}</span>
 </div>
 ))}
 </div>
 )}
 </div>
 </div>
 </div>
 )}

 {/* Tables */}
 {data.tables && data.tables.map((table) => (
 <div key={table.title} className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl p-6 shadow-md">
 <h3 className="text-[var(--text-primary)] font-bold text-base mb-4">{table.title}</h3>
 <div className="overflow-x-auto border border-[var(--border-card)] rounded-lg">
 <table className="w-full text-left text-xs border-collapse">
 <thead>
 <tr className="bg-[var(--bg-input)] border-b border-[var(--border-card)] text-[var(--text-tertiary)] font-bold">
 {table.columns.map((col) => (
 <th key={col} className="p-3.5 whitespace-nowrap">{col}</th>
 ))}
 </tr>
 </thead>
 <tbody>
 {table.rows.length === 0 ? (
 <tr>
 <td colSpan={table.columns.length} className="p-8 text-center text-[var(--text-tertiary)]">
 No records found in this range.
 </td>
 </tr>
 ) : (
 table.rows.slice(0, 100).map((row, idx) => (
 <tr key={idx} className="border-b border-[var(--border-card)] hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-secondary)]">
 {row.map((cell, cIdx) => (
 <td key={cIdx} className={`p-3.5 whitespace-nowrap ${cIdx === 0 ? "font-mono font-bold text-[var(--text-tertiary)] text-center" : ""}`}>
 {cell}
 </td>
 ))}
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </div>
 ))}
 </>
 )}
 </div>
 );
}
