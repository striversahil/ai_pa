"use client";

// PaymentDues — the Payment dues tab: recurring bills (credit cards, mobile
// recharges, EMIs…) with per-cycle paid/unpaid state.
//
// Data rides the accounts dashboard payload (`payments` = every unresolved
// cycle, `paymentHistory` = every paid cycle). Writes go to the Worker-only
// payment endpoints (/api/accounts/payments*). Any accountant manages dues.
import React, { useMemo, useState } from "react";

export interface PaymentAttachment {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

export interface PaymentDueRow {
  templateId: string;
  title: string;
  biller: string;
  identifier: string;
  category: string;
  amount: number | null;
  frequency: string;
  ownerRole: string;
  dueDay: number | null;
  dueMonth: number | null;
  remindDays: number[];
  logId: string | null;
  dueDate: string;
  status: string;
  paidAmount: number | null;
  paidRef: string | null;
  remark: string | null;
  doneBy: string | null;
  updatedAt: string | null;
  bucket: "overdue" | "week" | "upcoming" | "paid";
  daysOverdue: number;
  daysUntil: number;
  remind: boolean;
  attachments?: PaymentAttachment[];
}

export interface PaymentSummary {
  unpaidTotal: number;
  unpaidCount: number;
  overdueCount: number;
  overdueTotal: number;
  weekCount: number;
  weekTotal: number;
  paidCount: number;
  paidTotal: number;
}

export const PAYMENT_CATEGORIES = [
  "Credit Card", "Mobile Recharge", "Utilities", "Loan / EMI", "Insurance",
  "Rent", "Software / Subscription", "Tax / Compliance", "Other",
];

// Per-category label + placeholder for the optional bill number (card number,
// mobile number, account/policy no. …). Falls back to a generic reference.
export function identifierMeta(category: string): { label: string; placeholder: string } {
  switch (category) {
    case "Credit Card": return { label: "Card number (optional)", placeholder: "e.g. ending 4521" };
    case "Mobile Recharge": return { label: "Mobile number (optional)", placeholder: "e.g. 98XXXXXXXX" };
    case "Loan / EMI": return { label: "Loan / account no. (optional)", placeholder: "e.g. loan or account no." };
    case "Insurance": return { label: "Policy no. (optional)", placeholder: "e.g. policy number" };
    case "Rent": return { label: "Property / flat (optional)", placeholder: "e.g. flat or property ref" };
    case "Utilities": return { label: "Consumer / account no. (optional)", placeholder: "e.g. consumer number" };
    case "Software / Subscription": return { label: "Account / license (optional)", placeholder: "e.g. account or license id" };
    case "Tax / Compliance": return { label: "PAN / GSTIN (optional)", placeholder: "e.g. PAN or GSTIN" };
    default: return { label: "Reference no. (optional)", placeholder: "e.g. account or ref no." };
  }
}

type MainTab = "due" | "history";
type Bucket = "all" | "overdue" | "week" | "upcoming";

const BUCKETS: { key: Bucket; label: string; icon: string }[] = [
  { key: "all", label: "All due", icon: "🧾" },
  { key: "overdue", label: "Overdue", icon: "🔴" },
  { key: "week", label: "Due in 7 days", icon: "🟡" },
  { key: "upcoming", label: "Upcoming", icon: "⚪" },
];

const inr = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;

function fmtDue(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Human schedule label per repeat choice (matches the engine: weekly reads
// dueDay as weekday 0–6 Sun=0, daily runs Mon–Sat, yearly reads dueMonth).
function schedLabel(frequency: string, dueDay: number | null, dueMonth: number | null): string {
  if (frequency === "daily") return "every working day";
  if (frequency === "weekly") {
    const wd = dueDay ?? 4;
    return `every ${WEEKDAY_SHORT[wd] ?? "Thu"}`;
  }
  if (frequency === "monthly") return dueDay ? `day ${dueDay}` : "monthly";
  if (frequency === "quarterly") return dueDay ? `day ${dueDay} of quarter-start month` : "quarterly";
  if (frequency === "yearly") {
    const m = dueMonth != null && dueMonth >= 1 && dueMonth <= 12 ? MONTH_SHORT[dueMonth - 1] : null;
    return m && dueDay ? `${m} ${dueDay}` : "yearly";
  }
  return frequency;
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

async function postJson(url: string, method: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = String(j.error);
    } catch {
      try { msg = (await res.text()).slice(0, 300) || msg; } catch { /* ignore */ }
    }
    throw new Error(msg);
  }
  return res.json().catch(() => ({}));
}

interface BillGroup {
  templateId: string;
  title: string;
  biller: string;
  identifier: string;
  category: string;
  amount: number | null;
  frequency: string;
  dueDay: number | null;
  dueMonth: number | null;
  remindDays: number[];
  sample: PaymentDueRow;
  cycles: PaymentDueRow[];
  worstOverdue: number;
  earliestDue: string;
  urgency: number; // 0 overdue · 1 week · 2 upcoming
}

function groupBills(dues: PaymentDueRow[]): BillGroup[] {
  const byId = new Map<string, PaymentDueRow[]>();
  for (const d of dues) {
    if (!byId.has(d.templateId)) byId.set(d.templateId, []);
    byId.get(d.templateId)!.push(d);
  }
  const groups: BillGroup[] = [];
  for (const [templateId, cycles] of byId) {
    const sorted = [...cycles].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const s = sorted[0];
    const worstOverdue = Math.max(0, ...sorted.map((c) => c.daysOverdue));
    const urgency = sorted.some((c) => c.bucket === "overdue") ? 0 : sorted.some((c) => c.bucket === "week") ? 1 : 2;
    groups.push({
      templateId, title: s.title, biller: s.biller, identifier: s.identifier ?? "", category: s.category,
      amount: s.amount, frequency: s.frequency, dueDay: s.dueDay ?? null, dueMonth: s.dueMonth ?? null, remindDays: s.remindDays,
      sample: s, cycles: sorted, worstOverdue,
      earliestDue: sorted[0]?.dueDate ?? "", urgency,
    });
  }
  return groups.sort((a, b) => a.urgency - b.urgency || b.worstOverdue - a.worstOverdue || a.earliestDue.localeCompare(b.earliestDue));
}

function Countdown({ r }: { r: PaymentDueRow }) {
  if (r.bucket === "paid") return null;
  if (r.bucket === "overdue") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
        ⚠ Overdue {r.daysOverdue}d
      </span>
    );
  }
  if (r.bucket === "week") {
    const label = r.daysUntil <= 0 ? "Due today" : r.daysUntil === 1 ? "Due tomorrow" : `Due in ${r.daysUntil}d`;
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
          {label}
        </span>
        {r.remind && (
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-300" title={`Reminder day (${r.remindDays.join(", ")} days before)`}>
            🔔 Reminder
          </span>
        )}
      </span>
    );
  }
  return <span className="text-[11px] font-semibold text-zinc-500">Due {fmtDue(r.dueDate)}</span>;
}

export default function PaymentDues({ dues, history, summary, onRefresh }: {
  dues: PaymentDueRow[];
  history: PaymentDueRow[];
  summary?: PaymentSummary;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<MainTab>("due");
  const [bucket, setBucket] = useState<Bucket>("all");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [payRow, setPayRow] = useState<PaymentDueRow | null>(null);
  const [editRow, setEditRow] = useState<PaymentDueRow | "new" | null>(null);
  const [confirmDel, setConfirmDel] = useState<PaymentDueRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [openBills, setOpenBills] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const sum: PaymentSummary = useMemo(() => {
    if (summary) return summary;
    let unpaidTotal = 0, overdueTotal = 0, weekTotal = 0, overdueCount = 0, weekCount = 0;
    for (const d of dues) {
      unpaidTotal += d.amount ?? 0;
      if (d.bucket === "overdue") { overdueCount++; overdueTotal += d.amount ?? 0; }
      if (d.bucket === "week") { weekCount++; weekTotal += d.amount ?? 0; }
    }
    return {
      unpaidTotal, unpaidCount: dues.length, overdueCount, overdueTotal,
      weekCount, weekTotal, paidCount: history.length,
      paidTotal: history.reduce((t, h) => t + (h.paidAmount ?? h.amount ?? 0), 0),
    };
  }, [dues, history, summary]);

  const cats = useMemo(() => [...new Set([...dues, ...history].map((d) => d.category).filter(Boolean))].sort(), [dues, history]);

  const needle = q.trim().toLowerCase();
  const matches = (r: PaymentDueRow) => {
    if (cat && r.category !== cat) return false;
    if (needle && !`${r.title} ${r.biller} ${r.identifier ?? ""} ${r.paidRef ?? ""} ${r.remark ?? ""} ${r.doneBy ?? ""}`.toLowerCase().includes(needle)) return false;
    if (bucket !== "all" && tab === "due" && r.bucket !== bucket) return false;
    return true;
  };

  const billGroups = useMemo(() => {
    const filtered = dues.filter(matches);
    // Bucket filter applies at cycle level, then drop empty bills.
    const groups = groupBills(dues);
    if (bucket === "all" && !cat && !needle) return groups;
    const kept: BillGroup[] = [];
    for (const g of groups) {
      const cycles = g.cycles.filter(matches);
      if (!cycles.length) continue;
      kept.push({ ...g, cycles });
    }
    return kept;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dues, bucket, cat, needle]);

  const filteredHistory = useMemo(() => {
    return history.filter(matches).sort((a, b) =>
      String(b.updatedAt ?? b.dueDate).localeCompare(String(a.updatedAt ?? a.dueDate)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, cat, needle]);

  const bucketCounts = useMemo(() => {
    const c: Record<Bucket, number> = { all: dues.length, overdue: 0, week: 0, upcoming: 0 };
    for (const d of dues) { if (d.bucket === "overdue") c.overdue++; else if (d.bucket === "week") c.week++; else c.upcoming++; }
    return c;
  }, [dues]);

  async function uploadReceipt(logId: string, file: File) {
    setUploading(logId); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/accounts/logs/${logId}/files`, { method: "POST", body: fd });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* ignore */ }
        throw new Error(msg);
      }
      setOkMsg("Receipt attached.");
      onRefresh();
    } catch (e: any) { setErr(e?.message || "Upload failed"); }
    finally { setUploading(null); }
  }

  async function reopen(logId: string) {
    setBusy(true); setErr(null); setOkMsg(null);
    try {
      await postJson(`/api/accounts/logs/${logId}`, "PATCH", { status: "pending", remark: "Reopened — marked unpaid" });
      setOkMsg("Moved back to dues.");
      onRefresh();
    } catch (e: any) { setErr(e?.message || "Reopen failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {/* Reminder header: the at-a-glance strip */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Unpaid now</p>
          <p className="mt-0.5 font-mono text-xl font-bold text-zinc-900 dark:text-white">{inr(sum.unpaidTotal)}</p>
          <p className="text-[11px] text-zinc-500">{sum.unpaidCount} open cycle{sum.unpaidCount === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 px-4 py-3 shadow-sm dark:bg-rose-500/10">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">🔴 Overdue</p>
          <p className="mt-0.5 font-mono text-xl font-bold text-rose-700 dark:text-rose-300">{sum.overdueCount} · {inr(sum.overdueTotal)}</p>
          <p className="text-[11px] text-rose-500">{sum.overdueCount ? "needs payment now" : "nothing overdue"}</p>
        </div>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 shadow-sm dark:bg-amber-500/10">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">🟡 Due in 7 days</p>
          <p className="mt-0.5 font-mono text-xl font-bold text-amber-800 dark:text-amber-200">{sum.weekCount} · {inr(sum.weekTotal)}</p>
          <p className="text-[11px] text-amber-600 dark:text-amber-400">includes today + 🔔 reminder days</p>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 shadow-sm dark:bg-emerald-500/10">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">🟢 Paid (all time)</p>
          <p className="mt-0.5 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-300">{sum.paidCount} · {inr(sum.paidTotal)}</p>
          <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80">full history below</p>
        </div>
      </div>

      {/* Main tabs + add */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTab("due")} className={`rounded-full border px-3 py-1.5 text-xs font-bold cursor-pointer ${tab === "due" ? "border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}>
          💳 Dues ({dues.length})
        </button>
        <button onClick={() => setTab("history")} className={`rounded-full border px-3 py-1.5 text-xs font-bold cursor-pointer ${tab === "history" ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}>
          🧾 Paid history ({history.length})
        </button>
        <div className="flex-1" />
        <button onClick={() => { setErr(null); setOkMsg(null); setEditRow("new"); }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 cursor-pointer">
          + Add due
        </button>
      </div>

      {/* Bucket tabs (dues) + filters */}
      {tab === "due" && (
        <div className="flex flex-wrap items-center gap-2">
          {BUCKETS.map((b) => (
            <button key={b.key} onClick={() => setBucket(b.key)} className={`rounded-full border px-3 py-1.5 text-xs font-bold cursor-pointer ${bucket === b.key ? "border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"}`}>
              {b.icon} {b.label} ({bucketCounts[b.key]})
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-2 rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40 sm:grid-cols-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, biller, number, UTR ref, person…" className={inputCls} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={inputCls}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {okMsg && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">{okMsg}</p>}
      {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">⚠ {err}</p>}

      {tab === "due" && (
        <>
          {billGroups.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
              {dues.length === 0 ? "No payment dues yet — add the first bill (credit card, recharge, EMI…) with + Add due." : "Nothing matches these filters."}
            </div>
          )}
          {billGroups.map((g) => {
            const open = openBills[g.templateId] ?? true;
            const overdueCycles = g.cycles.filter((c) => c.bucket === "overdue");
            return (
              <div key={g.templateId} className={`rounded-xl border bg-white shadow-sm dark:bg-zinc-900/40 ${overdueCycles.length ? "border-rose-500/40" : g.cycles.some((c) => c.remind) ? "border-indigo-500/40" : "border-zinc-200/80 dark:border-zinc-800"}`}>
                <button onClick={() => setOpenBills((m) => ({ ...m, [g.templateId]: !open }))} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left cursor-pointer">
                  <span className="text-base">{overdueCycles.length ? "🔴" : g.cycles.some((c) => c.bucket === "week") ? "🟡" : "⚪"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-zinc-900 dark:text-white">
                      {g.title}
                      {g.biller && g.biller !== g.title && <span className="ml-2 font-semibold text-zinc-500">· {g.biller}</span>}
                      {g.identifier && <span className="ml-2 rounded bg-indigo-500/10 px-1.5 py-px font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-300">· {g.identifier}</span>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                      <span className="rounded bg-zinc-100 px-1.5 py-px font-semibold dark:bg-zinc-800">{g.category}</span>
                      <span className="capitalize">{schedLabel(g.frequency, g.dueDay, g.dueMonth)}</span>
                      <span>{g.cycles.length} open cycle{g.cycles.length === 1 ? "" : "s"}</span>
                      {overdueCycles.length > 0 && <span className="font-bold text-rose-600 dark:text-rose-400">· {overdueCycles.length} overdue</span>}
                      {g.remindDays.length > 0 && <span title="Reminder schedule">· 🔔 {g.remindDays.join("/")}</span>}
                    </span>
                  </span>
                  <span className="font-mono text-sm font-bold text-zinc-900 dark:text-white">{inr(g.amount)}</span>
                  <span className="text-xs text-zinc-400">{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="space-y-1.5 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                    {g.cycles.map((r) => (
                      <div key={`${r.templateId}-${r.dueDate}-${r.logId ?? "proj"}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                            <span className="font-bold text-zinc-800 dark:text-zinc-100">Due {fmtDue(r.dueDate)}</span>
                            {!r.logId && <span className="rounded border border-dashed border-zinc-400 px-1.5 py-px text-[10px] font-semibold text-zinc-500" title="No instance yet — paying creates the cycle">projected</span>}
                            <Countdown r={r} />
                          </p>
                          {r.attachments && r.attachments.length > 0 && (
                            <p className="mt-0.5 text-[11px] text-zinc-500">
                              📎 {r.attachments.map((a) => <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mr-2 underline">{a.fileName}</a>)}
                            </p>
                          )}
                        </div>
                        <span className="font-mono text-sm font-bold text-zinc-900 dark:text-white">{inr(r.amount)}</span>
                        <button onClick={() => { setErr(null); setOkMsg(null); setPayRow(r); }} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 cursor-pointer">
                          Mark paid
                        </button>
                        <button onClick={() => { setErr(null); setOkMsg(null); setEditRow(r); }} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">
                          Edit bill
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {tab === "history" && (
        <>
          {filteredHistory.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
              {history.length === 0 ? "No payments recorded yet — mark a due paid and it lands here with amount + reference." : "Nothing matches these filters."}
            </div>
          )}
          <div className="space-y-1.5">
            {filteredHistory.map((r) => (
              <div key={`${r.templateId}-${r.dueDate}-${r.logId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-zinc-200/80 bg-white px-3 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-zinc-900 dark:text-white">
                    <span className="mr-1.5 text-emerald-500">✓</span>{r.title}
                    {r.biller && r.biller !== r.title && <span className="ml-2 font-semibold text-zinc-500">· {r.biller}</span>}
                    {r.identifier && <span className="ml-2 rounded bg-indigo-500/10 px-1.5 py-px font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-300">· {r.identifier}</span>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    Due {fmtDue(r.dueDate)} · Paid {inr(r.paidAmount)}{r.paidRef ? ` · ${r.paidRef}` : ""}{r.doneBy ? ` · by ${r.doneBy}` : ""}{r.updatedAt ? ` · ${fmtDateTime(r.updatedAt)}` : ""}
                  </p>
                  {r.attachments && r.attachments.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      📎 {r.attachments.map((a) => <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mr-2 underline">{a.fileName}</a>)}
                    </p>
                  )}
                </div>
                <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-300">{inr(r.paidAmount ?? r.amount)}</span>
                <div className="flex items-center gap-1.5">
                  {r.logId && (
                    <>
                      <label className="cursor-pointer rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        {uploading === r.logId ? "Uploading…" : "Attach receipt"}
                        <input type="file" className="hidden" disabled={uploading === r.logId} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReceipt(r.logId!, f); e.target.value = ""; }} />
                      </label>
                      <button onClick={() => void reopen(r.logId!)} disabled={busy} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-600 hover:border-amber-400 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer disabled:opacity-50">
                        Reopen
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {payRow && (
        <PayDialog
          row={payRow}
          busy={busy}
          onClose={() => setPayRow(null)}
          onPay={async (paidAmount, paidRef) => {
            setBusy(true); setErr(null); setOkMsg(null);
            try {
              await postJson("/api/accounts/payments/pay", "POST", {
                templateId: payRow.templateId, dueDate: payRow.dueDate, paidAmount, paidRef,
              });
              setPayRow(null);
              setOkMsg(`Paid ${payRow.title} (${fmtDue(payRow.dueDate)}) — recorded with ${paidRef}.`);
              // Optimistic: flip to history tab so the new record is visible.
              setTab("history");
              onRefresh();
            } catch (e: any) { setErr(e?.message || "Mark paid failed — not saved. Retry."); }
            finally { setBusy(false); }
          }}
        />
      )}

      {editRow && (
        <DueFormDialog
          row={editRow === "new" ? null : editRow}
          busy={busy}
          onClose={() => setEditRow(null)}
          onSave={async (body, id) => {
            setBusy(true); setErr(null); setOkMsg(null);
            try {
              await postJson(id ? `/api/accounts/payments/${id}` : "/api/accounts/payments", id ? "PUT" : "POST", body);
              setEditRow(null);
              setOkMsg(id ? "Bill updated." : "Bill added — its cycles are now tracked.");
              onRefresh();
            } catch (e: any) { setErr(e?.message || "Save failed"); }
            finally { setBusy(false); }
          }}
          onDelete={async (id) => {
            setBusy(true); setErr(null);
            try {
              await postJson(`/api/accounts/payments/${id}`, "DELETE", {});
              setEditRow(null); setConfirmDel(null);
              setOkMsg("Bill removed.");
              onRefresh();
            } catch (e: any) { setErr(e?.message || "Delete failed"); }
            finally { setBusy(false); }
          }}
          confirmDel={confirmDel}
          setConfirmDel={setConfirmDel}
        />
      )}
    </div>
  );
}

function PayDialog({ row, busy, onClose, onPay }: {
  row: PaymentDueRow;
  busy: boolean;
  onClose: () => void;
  onPay: (amount: number, ref: string) => void;
}) {
  const [amount, setAmount] = useState(row.paidAmount ?? row.amount ?? "" as number | "");
  const [ref, setRef] = useState(row.paidRef ?? "");
  const [localErr, setLocalErr] = useState<string | null>(null);
  return (
    <Modal title={`Mark paid — ${row.title}`} onClose={onClose}>
      <p className="text-xs text-zinc-500">Due {fmtDue(row.dueDate)}{(row as any).identifier ? ` · ${(row as any).identifier}` : ""}{row.logId ? "" : " · projected cycle (paying creates it)"} · expected {inr(row.amount)}</p>
      <label className="mt-3 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        Amount paid (₹)
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "") as any)} inputMode="decimal" className={`${inputCls} mt-1`} placeholder="e.g. 12500" />
      </label>
      <label className="mt-2 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        UTR / transaction reference (required)
        <input value={ref} onChange={(e) => setRef(e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. UTR / UPI ref no." maxLength={200} />
      </label>
      {localErr && <p className="mt-2 text-xs text-rose-500">{localErr}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">Cancel</button>
        <button
          disabled={busy}
          onClick={() => {
            const n = Number(amount);
            if (!Number.isFinite(n) || n <= 0) { setLocalErr("Enter the amount paid"); return; }
            if (!ref.trim()) { setLocalErr("Enter the UTR / transaction reference"); return; }
            onPay(Math.round(n * 100) / 100, ref.trim());
          }}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
        >
          {busy ? "Saving…" : "Mark paid"}
        </button>
      </div>
    </Modal>
  );
}

function DueFormDialog({ row, busy, onClose, onSave, onDelete, confirmDel, setConfirmDel }: {
  row: PaymentDueRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>, id: string | null) => void;
  onDelete: (id: string) => void;
  confirmDel: PaymentDueRow | null;
  setConfirmDel: (r: PaymentDueRow | null) => void;
}) {
  const [title, setTitle] = useState(row?.title ?? "");
  const [biller, setBiller] = useState(row?.biller ?? "");
  const [identifier, setIdentifier] = useState(row?.identifier ?? "");
  const [category, setCategory] = useState(row?.category ?? "Credit Card");
  const idMeta = identifierMeta(category);
  const [amount, setAmount] = useState(row?.amount ?? "" as number | "");
  const [frequency, setFrequency] = useState(row?.frequency ?? "monthly");
  // Schedule inputs adapt to the repeat choice (daily needs nothing, weekly
  // takes a weekday, monthly/quarterly a day-of-month, yearly a month + day).
  const initDay = row?.frequency === "weekly" ? "" : (row?.dueDay ?? "");
  const [schedDay, setSchedDay] = useState(initDay as number | "");
  const [schedMonth, setSchedMonth] = useState(row?.dueMonth ?? "" as number | "");
  const [schedWeekday, setSchedWeekday] = useState(
    row?.frequency === "weekly" && row?.dueDay !== null && row?.dueDay !== undefined ? String(row.dueDay) : "4",
  );
  const [remindDays, setRemindDays] = useState((row?.remindDays ?? [7, 3, 1]).join(","));
  const [localErr, setLocalErr] = useState<string | null>(null);
  return (
    <Modal title={row ? `Edit bill — ${row.title}` : "Add payment due"} onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 sm:col-span-2">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. HDFC Credit Card bill" maxLength={200} />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Biller
          <input value={biller} onChange={(e) => setBiller(e.target.value)} className={`${inputCls} mt-1`} placeholder="e.g. HDFC Bank" maxLength={200} />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          {idMeta.label}
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} className={`${inputCls} mt-1`} placeholder={idMeta.placeholder} maxLength={100} />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} mt-1`}>
            {PAYMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Amount (₹, expected)
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "") as any)} inputMode="decimal" className={`${inputCls} mt-1`} placeholder="Leave blank if it varies" />
        </label>
        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Repeats
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={`${inputCls} mt-1`}>
            {["daily", "weekly", "monthly", "quarterly", "yearly"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        {frequency === "daily" && (
          <p className="self-end rounded-lg bg-zinc-100 px-3 py-2 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            Runs every working day (Mon–Sat) — no date needed.
          </p>
        )}
        {frequency === "weekly" && (
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Due weekday
            <select value={schedWeekday} onChange={(e) => setSchedWeekday(e.target.value)} className={`${inputCls} mt-1`}>
              {[["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"], ["6", "Saturday"], ["0", "Sunday"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
        {(frequency === "monthly" || frequency === "quarterly") && (
          <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            Due day of month{frequency === "quarterly" ? " (in the quarter-start month)" : ""}
            <input value={schedDay} onChange={(e) => setSchedDay(e.target.value.replace(/[^0-9]/g, "").slice(0, 2) as any)} inputMode="numeric" className={`${inputCls} mt-1`} placeholder="e.g. 5" />
          </label>
        )}
        {frequency === "yearly" && (
          <>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Due month
              <select value={schedMonth} onChange={(e) => setSchedMonth(e.target.value as any)} className={`${inputCls} mt-1`}>
                <option value="">Select…</option>
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
              Due day of month
              <input value={schedDay} onChange={(e) => setSchedDay(e.target.value.replace(/[^0-9]/g, "").slice(0, 2) as any)} inputMode="numeric" className={`${inputCls} mt-1`} placeholder="e.g. 5" />
            </label>
          </>
        )}
      </div>
      <label className="mt-2 block text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        Reminder days before due (comma-separated)
        <input value={remindDays} onChange={(e) => setRemindDays(e.target.value.replace(/[^0-9,]/g, ""))} className={`${inputCls} mt-1`} placeholder="7,3,1" />
      </label>
      {localErr && <p className="mt-2 text-xs text-rose-500">{localErr}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div>
          {row && (confirmDel ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">Remove this bill (all cycles)?</span>
              <button onClick={() => onDelete(row.templateId)} disabled={busy} className="rounded-lg bg-rose-600 px-2.5 py-1.5 font-bold text-white disabled:opacity-50 cursor-pointer">Yes, remove</button>
              <button onClick={() => setConfirmDel(null)} className="rounded-lg border border-zinc-300 px-2.5 py-1.5 font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">Keep</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDel(row)} className="rounded-lg border border-rose-500/40 px-2.5 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer">Remove</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400 cursor-pointer">Cancel</button>
          <button
            disabled={busy}
            onClick={() => {
              if (!title.trim()) { setLocalErr("Title is required"); return; }
              let day: number | null = null;
              let month: number | null = null;
              if (frequency === "weekly") {
                day = Number(schedWeekday);
              } else if (frequency === "monthly" || frequency === "quarterly") {
                if (schedDay === "") { setLocalErr("Enter the due day of month"); return; }
                day = Number(schedDay);
                if (!Number.isInteger(day) || day < 1 || day > 31) { setLocalErr("Due day must be 1–31"); return; }
              } else if (frequency === "yearly") {
                if (schedMonth === "") { setLocalErr("Pick the due month"); return; }
                month = Number(schedMonth);
                if (schedDay === "") { setLocalErr("Enter the due day of month"); return; }
                day = Number(schedDay);
                if (!Number.isInteger(day) || day < 1 || day > 31) { setLocalErr("Due day must be 1–31"); return; }
              }
              const body: Record<string, unknown> = {
                title: title.trim(), biller: biller.trim() || null, identifier: identifier.trim() || null, category,
                amount: amount === "" ? null : Number(amount),
                frequency, dueDay: day, dueMonth: month,
                ownerRole: "either", remindDays: remindDays || "7,3,1",
              };
              onSave(body, row?.templateId ?? null);
            }}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Saving…" : row ? "Save changes" : "Add due"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-start justify-between gap-3">
          <h4 className="font-bold text-zinc-900 dark:text-white">{title}</h4>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-lg leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
