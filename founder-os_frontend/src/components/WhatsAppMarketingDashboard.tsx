"use client";

import React, { useState, useEffect, useCallback } from "react";

type LeadStats = {
 total: number;
 sent: number;
 delivered: number;
 read: number;
 failed: number;
 pending: number;
};

type Campaign = {
 id: string;
 name: string;
 description: string | null;
 type: string;
 provider: string;
 status: string;
 scheduleType: string;
 scheduledAt: string | null;
 cron: string | null;
 timezone: string;
 templateName: string | null;
 messageBody: string | null;
 mediaUrl: string | null;
 enabled: boolean;
 lastRunAt: string | null;
 runCount: number;
 stats: LeadStats;
 recentRuns: { id: string; status: string; total: number; sent: number; failed: number; startedAt: string }[];
};

type DashboardData = {
 kpis: {
 campaigns: number;
 active: number;
 draft: number;
 paused: number;
 completed: number;
 totalLeads: number;
 providers: { waba: { configured: boolean }; aisensy: { configured: boolean } };
 };
 campaigns: Campaign[];
 recentRuns: { id: string; status: string; total: number; sent: number; failed: number; startedAt: string }[];
};

const statusColor: Record<string, string> = {
 active: "text-emerald-600 dark:text-emerald-emerald300 bg-emerald-500/10 border-emerald-500/30",
 draft: "text-[var(--text-secondary)] bg-zinc-500/10 border-zinc-500/30",
 paused: "text-amber-600 dark:text-amber-amber300 bg-amber-500/10 border-amber-500/30",
 completed: "text-sky-600 dark:text-sky-sky300 bg-sky-500/10 border-sky-500/30",
 archived: "text-[var(--text-tertiary)] bg-zinc-500/5 border-zinc-500/20",
};

const leadStatusColor: Record<string, string> = {
 pending: "text-[var(--text-tertiary)]",
 sent: "text-sky-600 dark:text-sky-sky300",
 delivered: "text-emerald-600 dark:text-emerald-emerald300",
 read: "text-emerald-600 dark:text-emerald-emerald400",
 failed: "text-rose-600 dark:text-rose-rose400",
};

export default function WhatsAppMarketingDashboard() {
 const [data, setData] = useState<DashboardData | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [showNewCampaign, setShowNewCampaign] = useState(false);
 const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
 const [leads, setLeads] = useState<any[]>([]);
 const [leadsLoading, setLeadsLoading] = useState(false);
 const [toast, setToast] = useState<string | null>(null);
 const [runningId, setRunningId] = useState<string | null>(null);

 // New campaign form state
 const [form, setForm] = useState({
 name: "",
 type: "promotional",
 provider: "waba",
 scheduleType: "one_shot",
 scheduledAt: "",
 cron: "0 9 * * MON",
 templateName: "",
 templateParams: "",
 messageBody: "",
 mediaUrl: "",
 aisensyCampaignName: "",
 status: "draft",
 });

 const showToast = (msg: string) => {
 setToast(msg);
 setTimeout(() => setToast(null), 3000);
 };

 const fetchDashboard = useCallback(async () => {
 try {
 const res = await fetch("/api/automations/whatsapp-marketing/data");
 if (res.ok) setData(await res.json());
 } catch (e) {
 setError("Failed to load dashboard");
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 fetchDashboard();
 const id = setInterval(fetchDashboard, 60000);
 return () => clearInterval(id);
 }, [fetchDashboard]);

 const loadLeads = async (campaignId: string) => {
 setLeadsLoading(true);
 try {
 const res = await fetch(`/api/whatsapp-marketing/leads/${campaignId}?limit=100`);
 if (res.ok) {
 const json = await res.json();
 setLeads(json.leads);
 }
 } catch {
 setLeads([]);
 } finally {
 setLeadsLoading(false);
 }
 };

 const openCampaign = async (c: Campaign) => {
 setSelectedCampaign(c);
 await loadLeads(c.id);
 };

 const handleCreate = async () => {
 const body: any = {
 name: form.name,
 type: form.type,
 provider: form.provider,
 scheduleType: form.scheduleType,
 status: form.status,
 };
 if (form.scheduleType === "one_shot" && form.scheduledAt) {
 body.scheduledAt = form.scheduledAt;
 } else if (form.scheduleType === "recurring") {
 body.cron = form.cron || "0 9 * * MON";
 }
 if (form.provider === "waba") {
 if (form.templateName) {
 body.templateName = form.templateName;
 body.templateParams = form.templateParams
 ? form.templateParams.split("|").map((p: string) => p.trim())
 : [];
 } else if (form.messageBody) {
 body.messageBody = form.messageBody;
 }
 if (form.mediaUrl) body.mediaUrl = form.mediaUrl;
 } else {
 body.aisensyCampaignName = form.aisensyCampaignName;
 }
 if (!body.name) { showToast("Campaign name is required"); return; }
 try {
 const res = await fetch("/api/whatsapp-marketing/campaigns", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(body),
 });
 if (res.ok) {
 showToast("Campaign created");
 setShowNewCampaign(false);
 setForm({ ...form, name: "" });
 fetchDashboard();
 } else {
 const j = await res.json().catch(() => ({}));
 showToast(j.error || "Failed to create campaign");
 }
 } catch {
 showToast("Failed to create campaign");
 }
 };

 const handleRun = async (id: string) => {
 setRunningId(id);
 try {
 const res = await fetch(`/api/whatsapp-marketing/campaigns/${id}/run`, {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ leadLimit: 100 }),
 });
 const j = await res.json().catch(() => ({}));
 showToast(res.ok ? `Run finished (sent ${j.result?.sent ?? 0})` : j.error || "Run failed");
 fetchDashboard();
 } catch {
 showToast("Run failed");
 } finally {
 setRunningId(null);
 }
 };

 const handleToggleStatus = async (c: Campaign) => {
 const next = c.status === "active" ? "paused" : "active";
 try {
 await fetch(`/api/whatsapp-marketing/campaigns/${c.id}`, {
 method: "PATCH",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ status: next }),
 });
 fetchDashboard();
 } catch {
 showToast("Failed to update status");
 }
 };

 const handleDelete = async (c: Campaign) => {
 if (!window.confirm(`Delete campaign "${c.name}" and all its leads?`)) return;
 try {
 await fetch(`/api/whatsapp-marketing/campaigns/${c.id}`, { method: "DELETE" });
 showToast("Campaign deleted");
 setSelectedCampaign(null);
 fetchDashboard();
 } catch {
 showToast("Failed to delete campaign");
 }
 };

 const [csvText, setCsvText] = useState("");
 const handleUploadLeads = async () => {
 if (!selectedCampaign) return;
 try {
 const res = await fetch(`/api/whatsapp-marketing/campaigns/${selectedCampaign.id}/leads`, {
 method: "POST",
 headers: { "Content-Type": "text/plain" },
 body: csvText,
 });
 const j = await res.json().catch(() => ({}));
 showToast(res.ok ? `Imported ${j.created} leads` : j.error || "Import failed");
 setCsvText("");
 loadLeads(selectedCampaign.id);
 fetchDashboard();
 } catch {
 showToast("Import failed");
 }
 };

 if (loading) return <div className="p-8 text-[var(--text-tertiary)]">Loading marketing dashboard…</div>;
 if (error && !data) return <div className="p-8 text-rose-600 dark:text-rose-rose400">{error}</div>;

 const k = data?.kpis;

 const inputCls = "w-full rounded-lg border border-black/15 dark:border-white/15 bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-sky-500";
 const labelCls = "block text-xs font-medium text-[var(--text-tertiary)] mb-1";

 return (
 <div className="p-6 space-y-6">
 {toast && (
 <div className="fixed top-4 right-4 z-50 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-emerald300">
 {toast}
 </div>
 )}

 <div className="flex items-center justify-between">
 <div>
 <h1 className="text-xl font-semibold text-[var(--text-primary)]">WhatsApp Marketing</h1>
 <p className="text-sm text-[var(--text-tertiary)]">
 {data?.kpis.providers.waba.configured ? "WABA connected" : "WABA not configured"}
 {" · "}
 {data?.kpis.providers.aisensy.configured ? "AiSensy connected" : "AiSensy not configured"}
 </p>
 </div>
 <button
 onClick={() => setShowNewCampaign(!showNewCampaign)}
 className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500"
 >
 {showNewCampaign ? "Cancel" : "+ New Campaign"}
 </button>
 </div>

 {/* KPI cards */}
 {k && (
 <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
 <Kpi label="Campaigns" value={k.campaigns} />
 <Kpi label="Active" value={k.active} accent="text-emerald-600 dark:text-emerald-emerald300" />
 <Kpi label="Draft" value={k.draft} accent="text-[var(--text-secondary)]" />
 <Kpi label="Paused" value={k.paused} accent="text-amber-600 dark:text-amber-amber300" />
 <Kpi label="Completed" value={k.completed} accent="text-sky-600 dark:text-sky-sky300" />
 <Kpi label="Total Leads" value={k.totalLeads} accent="text-violet-600 dark:text-violet-violet300" />
 </div>
 )}

 {/* New campaign form */}
 {showNewCampaign && (
 <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-5 space-y-4">
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 <div>
 <label className={labelCls}>Name *</label>
 <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Summer Promo 2026" />
 </div>
 <div>
 <label className={labelCls}>Type</label>
 <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
 <option value="promotional">Promotional</option>
 <option value="reengagement">Re-engagement</option>
 <option value="invoice">Invoice</option>
 <option value="seasonal">Seasonal</option>
 <option value="custom">Custom</option>
 </select>
 </div>
 <div>
 <label className={labelCls}>Provider</label>
 <select className={inputCls} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
 <option value="waba">WABA (Meta Cloud API)</option>
 <option value="aisensy">AiSensy</option>
 </select>
 </div>
 <div>
 <label className={labelCls}>Schedule</label>
 <select className={inputCls} value={form.scheduleType} onChange={(e) => setForm({ ...form, scheduleType: e.target.value })}>
 <option value="one_shot">One-shot</option>
 <option value="recurring">Recurring (cron)</option>
 </select>
 </div>
 {form.scheduleType === "one_shot" ? (
 <div>
 <label className={labelCls}>Send at (IST)</label>
 <input type="datetime-local" className={inputCls} value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
 </div>
 ) : (
 <div>
 <label className={labelCls}>Cron (Asia/Kolkata)</label>
 <input className={inputCls} value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} placeholder="0 9 * * MON" />
 </div>
 )}
 <div>
 <label className={labelCls}>Status</label>
 <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
 <option value="draft">Draft</option>
 <option value="active">Active</option>
 </select>
 </div>

 {form.provider === "waba" ? (
 <>
 <div>
 <label className={labelCls}>Template name (or leave empty for text)</label>
 <input className={inputCls} value={form.templateName} onChange={(e) => setForm({ ...form, templateName: e.target.value })} placeholder="summer_promo_2026" />
 </div>
 <div>
 <label className={labelCls}>Template params (pipe | separated, supports {'{{lead.name}}'})</label>
 <input className={inputCls} value={form.templateParams} onChange={(e) => setForm({ ...form, templateParams: e.target.value })} placeholder="John | {{lead.name}}" />
 </div>
 <div>
 <label className={labelCls}>Free-text body (if no template)</label>
 <input className={inputCls} value={form.messageBody} onChange={(e) => setForm({ ...form, messageBody: e.target.value })} placeholder="Hi {{lead.name}}, your estimate is ready…" />
 </div>
 <div>
 <label className={labelCls}>Media URL (optional)</label>
 <input className={inputCls} value={form.mediaUrl} onChange={(e) => setForm({ ...form, mediaUrl: e.target.value })} placeholder="https://…/invoice.pdf" />
 </div>
 </>
 ) : (
 <div>
 <label className={labelCls}>AiSensy campaign name</label>
 <input className={inputCls} value={form.aisensyCampaignName} onChange={(e) => setForm({ ...form, aisensyCampaignName: e.target.value })} placeholder="Live campaign name in AiSensy" />
 </div>
 )}
 </div>
 <button onClick={handleCreate} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium hover:bg-sky-500">
 Create Campaign
 </button>
 </div>
 )}

 {/* Campaign list */}
 <div className="space-y-3">
 {data?.campaigns.length === 0 && (
 <div className="rounded-xl border border-dashed border-[var(--border-card)] p-8 text-center text-sm text-[var(--text-tertiary)]">
 No campaigns yet. Create one to start marketing.
 </div>
 )}
 {data?.campaigns.map((c) => (
 <div key={c.id} className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
 <div className="flex items-start justify-between gap-4">
 <button className="text-left" onClick={() => openCampaign(c)}>
 <div className="flex items-center gap-2">
 <span className="font-medium text-[var(--text-primary)]">{c.name}</span>
 <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusColor[c.status] || statusColor.draft}`}>{c.status}</span>
 {!c.enabled && <span className="rounded-full border border-zinc-300 dark:border-zinc-600 px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">disabled</span>}
 </div>
 <div className="mt-1 text-xs text-[var(--text-tertiary)]">
 {c.type} · {c.provider} ·{" "}
 {c.scheduleType === "recurring"
 ? `cron ${c.cron}`
 : `one-shot ${c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : "—"}`}
 {" · "}last run {c.lastRunAt ? new Date(c.lastRunAt).toLocaleString() : "never"}
 {c.templateName && ` · tmpl ${c.templateName}`}
 </div>
 </button>
 <div className="flex items-center gap-2 shrink-0">
 <button onClick={() => handleRun(c.id)} disabled={runningId === c.id} className="rounded-lg border border-black/15 dark:border-white/15 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-sky300 disabled:opacity-50">
 {runningId === c.id ? "Running…" : "Run Now"}
 </button>
 <button onClick={() => handleToggleStatus(c)} className="rounded-lg border border-black/15 dark:border-white/15 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-amber300">
 {c.status === "active" ? "Pause" : "Activate"}
 </button>
 <button onClick={() => handleDelete(c)} className="rounded-lg border border-black/15 dark:border-white/15 px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:border-rose-500 hover:text-rose-600 dark:hover:text-rose-rose300">
 Delete
 </button>
 </div>
 </div>
 <div className="mt-3 grid grid-cols-6 gap-2 text-center">
 <MiniStat label="Total" value={c.stats.total} />
 <MiniStat label="Sent" value={c.stats.sent} cls="text-sky-600 dark:text-sky-sky300" />
 <MiniStat label="Delivered" value={c.stats.delivered} cls="text-emerald-600 dark:text-emerald-emerald300" />
 <MiniStat label="Read" value={c.stats.read} cls="text-emerald-600 dark:text-emerald-emerald400" />
 <MiniStat label="Failed" value={c.stats.failed} cls="text-rose-600 dark:text-rose-rose400" />
 <MiniStat label="Pending" value={c.stats.pending} cls="text-[var(--text-tertiary)]" />
 </div>
 </div>
 ))}
 </div>

 {/* Selected campaign detail */}
 {selectedCampaign && (
 <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-5 space-y-4">
 <div className="flex items-center justify-between">
 <h2 className="text-lg font-medium text-[var(--text-primary)]">{selectedCampaign.name} — Leads</h2>
 <button onClick={() => setSelectedCampaign(null)} className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Close</button>
 </div>

 <div className="space-y-2">
 <label className={labelCls}>Paste leads (CSV: phone,name,attrs… or JSON array)</label>
 <textarea
 className="w-full rounded-lg border border-black/15 dark:border-white/15 bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-sky-500"
 rows={5}
 value={csvText}
 onChange={(e) => setCsvText(e.target.value)}
 placeholder={"phone,name\n919876543210,John Doe\n919111222333,Jane Smith"}
 />
 <button onClick={handleUploadLeads} className="text-white rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500">
 Upload Leads
 </button>
 </div>

 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="text-left text-xs text-[var(--text-tertiary)]">
 <th className="pb-2">Phone</th>
 <th className="pb-2">Name</th>
 <th className="pb-2">Status</th>
 <th className="pb-2">Error</th>
 <th className="pb-2">Sent</th>
 </tr>
 </thead>
 <tbody>
 {leadsLoading && (
 <tr><td colSpan={5} className="py-3 text-[var(--text-tertiary)]">Loading leads…</td></tr>
 )}
 {!leadsLoading && leads.length === 0 && (
 <tr><td colSpan={5} className="py-3 text-[var(--text-tertiary)]">No leads yet.</td></tr>
 )}
 {leads.map((l) => (
 <tr key={l.id} className="border-t border-[var(--border-card)]">
 <td className="py-2 font-mono text-[var(--text-secondary)]">{l.phoneNumber}</td>
 <td className="py-2 text-[var(--text-secondary)]">{l.name || "—"}</td>
 <td className={`py-2 ${leadStatusColor[l.status] || "text-[var(--text-tertiary)]"}`}>{l.status}</td>
 <td className="py-2 max-w-[200px] truncate text-[var(--text-tertiary)]">{l.error || "—"}</td>
 <td className="py-2 text-[var(--text-tertiary)]">{l.sentAt ? new Date(l.sentAt).toLocaleString() : "—"}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {/* Recent runs */}
 {data?.recentRuns && data.recentRuns.length > 0 && (
 <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-5">
 <h2 className="mb-3 text-lg font-medium text-[var(--text-primary)]">Recent Runs</h2>
 <table className="w-full text-sm">
 <thead>
 <tr className="text-left text-xs text-[var(--text-tertiary)]">
 <th className="pb-2">Started</th>
 <th className="pb-2">Status</th>
 <th className="pb-2">Total</th>
 <th className="pb-2">Sent</th>
 <th className="pb-2">Failed</th>
 </tr>
 </thead>
 <tbody>
 {data.recentRuns.map((r) => (
 <tr key={r.id} className="border-t border-[var(--border-card)]">
 <td className="py-2 text-[var(--text-tertiary)]">{new Date(r.startedAt).toLocaleString()}</td>
 <td className={`py-2 ${r.status === "failed" ? "text-rose-600 dark:text-rose-rose400" : r.status === "completed" ? "text-emerald-600 dark:text-emerald-emerald300" : "text-[var(--text-secondary)]"}`}>{r.status}</td>
 <td className="py-2 text-[var(--text-tertiary)]">{r.total}</td>
 <td className="py-2 text-sky-600 dark:text-sky-sky300">{r.sent}</td>
 <td className="py-2 text-rose-600 dark:text-rose-rose400">{r.failed}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 );
}

function Kpi({ label, value, accent = "text-[var(--text-primary)]" }: { label: string; value: number; accent?: string }) {
 return (
 <div className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-card)] p-4">
 <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
 <div className="mt-1 text-xs text-[var(--text-tertiary)]">{label}</div>
 </div>
 );
}

function MiniStat({ label, value, cls = "text-[var(--text-secondary)]" }: { label: string; value: number; cls?: string }) {
 return (
 <div className="rounded-lg bg-[var(--bg-card)] px-2 py-1.5">
 <div className={`text-sm font-medium ${cls}`}>{value}</div>
 <div className="text-[10px] text-[var(--text-tertiary)]">{label}</div>
 </div>
 );
}
