"use client";

// Sales Leaderboard — the Telecalling dashboard, region edition.
//
// Founder decision (2026-10-22): estimates are owned by REGIONS (R1–R4),
// not individuals. This component renders the backend payload from
// founder-os_backend/src/automations/telecalling/service.ts (region cards,
// staff board, unmapped bucket, pending closer picks). The dealing/poaching/
// shield/bulk machinery of the old individual dashboard is gone. The 80/20
// close split is picked by sales-head here (closer pick panel).
//
// Mirror: backend src/automations/telecalling/service.ts · taxonomy in both
// src/telecalling/regions.ts (this side) and backend
// src/automations/telecalling/regions.ts — change together.

import React, { Fragment, useState, useCallback, useEffect, useMemo } from "react";
import { Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useLiveQuery, useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import { KNOWN_ORG_LABELS } from "./zoho/orgs";
import { REGIONS, TL_LEVELS, isValidRegion } from "@/telecalling/regions";

// ── Shon/mirrored taxonomy (backend meta.taxonomy should match REGIONS). ──────
type RegionId = "R1" | "R2" | "R3" | "R4";

const REGION_SHORT: Record<string, string> = {
  R1: "North & NCR",
  R2: "NC & Himalaya",
  R3: "West & Central",
  R4: "S/E & NE",
};

interface StaffRow {
  id: string;
  name: string;
  region: string;
  tlLevel: "TL1" | "TL2" | "";
  closerEligible: boolean;
  wonGenerator: number;
  wonCloser: number;
  won: number;
  closedValue: number;
  generatorPoints: number;
  closerPoints: number;
  points: number;
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  talkTimeSec: number;
  leadsGenerated: number;
  leadsConverted: number;
  leadsInProgress: number;
  leadsLost: number;
  score: number;
  unmapped?: boolean;
}

interface RegionRow {
  id: RegionId | "";
  name: string;
  tl: "TL1" | "TL2";
  states: string[];
  leadsGenerated: number;
  won: { count: number; value: number };
  open: { count: number; value: number };
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  talkTimeSec: number;
  points: number;
  kra: {
    connectedTarget: number;
    connectedPct: number;
    connectedStatus: "green" | "amber" | "red";
    leadsTarget: number;
    leadsPct: number;
    leadsStatus: "green" | "amber" | "red";
  };
  staff: StaffRow[];
}

interface RiskRow {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  generatorId: string | null;
  generatorName: string | null;
  region: string;
  total: number;
  risk: "ok" | "pending" | "red" | "zombie";
  lastCommentDate: string | null;
  staleHours: number | null;
  reasoning: string | null;
  staleReason?: string | null;
  nextStep: string | null;
  nextStepDate: string | null;
  organizationId?: string | null;
}

interface PendingPick {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  total: number;
  region: string;
  closeDay: string;
  organizationId: string;
}

interface UnmappedItem {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  total: number;
  generatedBy: string | null;
  organizationId: string;
  lastSync: string | null;
}

interface DashData {
  meta: {
    day: string;
    requestedDay?: string;
    usingLatestAvailable?: boolean;
    period?: string;
    periodLabel?: string;
    periodFrom?: string | null;
    periodTo?: string | null;
    workingDays?: number;
    generatedAt: string;
    taxonomy?: { id: RegionId; name: string; tl: "TL1" | "TL2"; states: string[] }[];
    canManage?: boolean;
    telecallerCount?: number;
    unmatchedSentCount?: number;
    unmappedStaffCount?: number;
    unattributedLeads?: number;
    staff?: { id: string; name: string; region: string; tlLevel: string; active: boolean }[];
    targets?: { connectedCallsPerDay: number; leadsPerAgentPerDay: number };
    conversionTarget?: { perDay: number; goldPerDay: number; workingDays: number; target: number; gold: number; value: number; pct: number; status: "below" | "hit" | "gold" };
    epoch?: string | null;
    viewer?: { staffId: string | null; name: string | null; region: string | null; tlLevel: string | null };
  };
  kpi: { won: number; closedValue: number; pipelineValue: number; leadsGenerated: number; callsAttempted: number; callsConnected: number; talkTimeSec: number };
  regions: RegionRow[];
  unmappedStaff?: StaffRow[];
  unmapped?: { count: number; value: number; items: UnmappedItem[] };
  pendingPicks?: PendingPick[];
  recent: any[];
  daily?: DailyRow[];
  dailyError?: string | null;
  risk?: {
    counts: { open: number; ok: number; pending: number; red: number; zombie: number };
    valueAtRisk: number;
    atRisk: RiskRow[];
  };
}

/** One day × one staff member of MIS detail (backend `daily` block, ?daily=1). */
interface DailyRow {
  date: string;
  weekday: string;
  telecallerId: string;
  telecallerName: string;
  region: string;
  won: number;
  closedValue: number;
  closedEstimates: string;
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  talkTimeMin: number;
  leadsGenerated: number;
  leadsConverted: number;
  score: number;
}

interface FollowUp {
  estimateId: string;
  estimateNumber: string | null;
  customerName: string | null;
  status: string | null;
  total: number | null;
  region?: string | null;
  organizationId?: string | null;
  satisfactory?: boolean | null;
  intentScore?: number | null;
  analysisSummary?: string | null;
  lastCommentDate?: string | null;
  staleHours?: number | null;
  latestComment?: { text: string; commentedBy: string; dateFormatted: string | null } | null;
  risk?: "ok" | "pending" | "red" | "zombie";
  staleReason?: string | null;
  enquiryNumber?: string | null;
  sourceLead?: string | null;
  location?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  leadOf?: string | null;
  detailsCaptured?: boolean | null;
  detailsFailed?: boolean | null;
  callTag?: "NO_ANSWER" | "BUSY" | "CALLBACK" | null;
  callbackDate?: string | null;
  callTagBy?: string | null;
  callTagByName?: string | null;
  callTagAt?: string | null;
  nextStep?: string | null;
  nextStepDate?: string | null;
}

interface AgentViewData {
  meta?: { region?: string; regionName?: string };
  agent?: { id: string; name: string; region: string; tlLevel: string; won?: number; points?: number; callsConnected?: number; leadsGenerated?: number; regionOpen?: { count: number; value: number }; followUpCount?: number };
  followUps: FollowUp[];
}

const TELECALLING_EVENTS = ["automation", "telecalling", "estimates", "baseline"];

const inr = (n: number | null | undefined): string => {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(v) >= 100_000) return `₹${(v / 100_000).toFixed(2)} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
};
const mins = (sec: number | null | undefined): string => {
  const h = Math.floor(Number(sec ?? 0) / 3600);
  return h > 0 ? `${h}h ${Math.round((Number(sec ?? 0) % 3600) / 60)}m` : `${Math.round(Number(sec ?? 0) / 60)}m`;
};

/** KRA traffic-light dot (🟢 ≥100% · 🟡 60–99% · 🔴 <60%). */
function TlPct({ pct, label }: { pct: number; label: string }) {
  const cls = pct >= 100 ? "text-emerald-500" : pct >= 60 ? "text-amber-500" : "text-rose-500";
  return (
    <span title={`${label} — target progress`} className={`text-[11px] font-semibold ${cls}`}>
      {pct}%
    </span>
  );
}

// ── Chips (shared visual language with the rest of the dashboards) ───────────

/** Satisfactory / Unsatisfactory chip from the periodic Zoho AI analysis. */
function SatChip({ value, compact = false }: { value: boolean | null | undefined; compact?: boolean }) {
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (value === true)
    return (
      <span title="Zoho analyzer found a meaningful update" className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>
        ✓{compact ? "" : " Satisfactory"}
      </span>
    );
  if (value === false)
    return (
      <span title="No meaningful update yet — needs another call" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ✕{compact ? "" : " Unsatisfactory"}
      </span>
    );
  return (
    <span title="Awaiting the next Zoho analyzer pass" className={`${base} bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-400/40`}>
      …{compact ? "" : " Pending"}
    </span>
  );
}

/** Zoho org badge (multi-org sync). Renders only when 2+ orgs are present in
 *  the loaded data — single-org views stay exactly as before. */
function OrgBadge({ orgId, orgs }: { orgId?: string | null; orgs: string[] }) {
  if (!orgId || orgs.length < 2) return null;
  const label = KNOWN_ORG_LABELS[orgId] ?? `Org •••${orgId.slice(-4)}`;
  return (
    <span title={`Zoho Books organization (${orgId})`} className="inline-flex items-center shrink-0 rounded border font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30 px-1.5 py-0.5 text-[10px] uppercase">
      {label}
    </span>
  );
}

/** Time-since-last-comment chip — the "clock is ticking" signal for agents. */
function StaleChip({ staleHours, compact = false }: { staleHours: number | null | undefined; compact?: boolean }) {
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (staleHours === null || staleHours === undefined)
    return (
      <span title="No sales comment synced from Zoho yet" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ∅{compact ? "" : " No comments"}
      </span>
    );
  const days = Math.floor(staleHours / 24);
  if (days >= 3)
    return (
      <span title={`Last comment ${days} days ago — zombie territory (silent > 3 days)`} className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ⏰{compact ? "" : ` ${days}d stale`}
      </span>
    );
  if (staleHours >= 24)
    return (
      <span title="Last comment was more than a day ago" className={`${base} bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30`}>
        ⏰{compact ? "" : " 1d+"}
      </span>
    );
  return (
    <span title="Commented within the last 24 hours" className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>
      ●{compact ? "" : " Fresh"}
    </span>
  );
}

/** Risk state chip (informational; the old EOD penalty is retired). */
function RiskChip({ risk, compact = false }: { risk?: string | null; compact?: boolean }) {
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (risk === "zombie")
    return (
      <span title="Silent for over 3 days — dead weight on the board" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ☠{compact ? "" : " Zombie"}
      </span>
    );
  if (risk === "red")
    return (
      <span title="Unsatisfactory remark, or last update older than 24h — needs a chase" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ⚠{compact ? "" : " At risk"}
      </span>
    );
  if (risk === "pending")
    return (
      <span title="Awaiting the AI verdict" className={`${base} bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30`}>
        ⏳{compact ? "" : " Analyzing"}
      </span>
    );
  return (
    <span title="Meaningful update logged" className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>
      ●{compact ? "" : " Fresh"}
    </span>
  );
}

/** Lead-details chips (POC / mobile / email / location / source / enquiry
 *  number / "Lead generated by") so the agent can call without switching
 *  views. "By" is the originating staff (creator), never a holder. */
function LeadChips({ f }: { f: FollowUp }) {
  const chips: { label: string; value: string; cls: string }[] = [];
  if (f.leadOf) chips.push({ label: "By", value: f.leadOf as string, cls: "text-rose-600 dark:text-rose-400 border-rose-500/30 bg-rose-500/5" });
  if (f.contactName) chips.push({ label: "Contact", value: f.contactName as string, cls: "text-indigo-600 dark:text-indigo-300 border-indigo-500/30 bg-indigo-500/5" });
  if (f.contactPhone) chips.push({ label: "Mobile", value: f.contactPhone as string, cls: "text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5" });
  if (f.contactEmail) chips.push({ label: "Mail", value: f.contactEmail as string, cls: "text-teal-600 dark:text-teal-300 border-teal-500/30 bg-teal-500/5" });
  if (f.location) chips.push({ label: "Loc", value: f.location as string, cls: "text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5" });
  if (f.sourceLead) chips.push({ label: "Source", value: f.sourceLead as string, cls: "text-sky-600 dark:text-sky-400 border-sky-500/30 bg-sky-500/5" });
  if (f.enquiryNumber) chips.push({ label: "Enq", value: f.enquiryNumber as string, cls: "text-violet-600 dark:text-violet-400 border-violet-500/30 bg-violet-500/5" });
  if (chips.length === 0) {
    if (f.detailsCaptured) return null; // captured, nothing to show
    // Gave up after 10 fruitless AI turns — terminal state, shown in amber.
    if (f.detailsFailed) {
      return (
        <span title="AI tried 10 times but could not extract lead details from the Zoho comments" className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
          <span className="uppercase tracking-wide opacity-70 text-[8px]">AI</span> details unavailable
        </span>
      );
    }
    // Not captured yet — the 15-min GH analyzer fills these as soon as the
    // sales agent posts the lead block in the Zoho comments.
    return (
      <span title="Lead details not captured yet — the 15-min analyzer fills these in" className="inline-flex items-center gap-1 rounded-full border border-zinc-400/30 bg-zinc-500/5 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">
        <span className="uppercase tracking-wide opacity-70 text-[8px]">AI</span> capturing…
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {chips.map((c) => (
        <span key={c.label} title={`${c.label}: ${c.value}`} className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${c.cls}`}>
          <span className="uppercase tracking-wide opacity-70 text-[8px]">{c.label}</span>
          {c.value}
        </span>
      ))}
    </div>
  );
}

// ── Agent call-disposition tags (kept verbatim mechanics) ────────────────────
type CallTagValue = "NO_ANSWER" | "BUSY" | "CALLBACK";
const CALL_TAG_META: Record<CallTagValue, { label: string; icon: string; cls: string; title: string }> = {
  NO_ANSWER: { label: "Not answering", icon: "📵", cls: "text-orange-600 dark:text-orange-400 border-orange-500/30 bg-orange-500/5", title: "Client is not picking up the phone" },
  BUSY: { label: "Busy", icon: "⏳", cls: "text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5", title: "Client is busy — call back later" },
  CALLBACK: { label: "Callback", icon: "📞", cls: "text-sky-600 dark:text-sky-400 border-sky-500/30 bg-sky-500/5", title: "Follow up on a fixed date (max 10 days out)" },
};

/** Local YYYY-MM-DD of today + offset days (bounds the callback date input). */
function localIsoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local-model patch for one estimate's call tag (optimistic echo + live deltas). */
export interface CallTagDelta {
  callTag: CallTagValue | null;
  callbackDate: string | null;
  callTagBy?: string | null;
  callTagByName?: string | null;
  callTagAt?: string | null;
}

function CallTagControl({ f, onSaved, onTag, compact = false }: { f: FollowUp; onSaved: () => void; onTag?: (estimateId: string, delta: CallTagDelta | null) => void; compact?: boolean }) {
  const [picking, setPicking] = useState<CallTagValue | null>(null);
  const [date, setDate] = useState(() => f.callbackDate ?? localIsoDay(1));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const minDay = localIsoDay(0);
  const maxDay = localIsoDay(10);

  const save = async (tag: CallTagValue | null, callbackDate: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(f.estimateId)}/call-tag`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, callbackDate }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Save failed (HTTP ${res.status})`);
      setPicking(null);
      onTag?.(f.estimateId, {
        callTag: ((body?.callTag ?? tag) as CallTagValue | null) ?? null,
        callbackDate: ((body?.callbackDate ?? callbackDate) as string | null) ?? null,
      });
      onSaved();
    } catch (e: any) {
      onTag?.(f.estimateId, null);
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const tap = (tag: CallTagValue | null, callbackDate: string | null) => {
    if (tag) onTag?.(f.estimateId, { callTag: tag, callbackDate });
    else onTag?.(f.estimateId, null);
    void save(tag, callbackDate);
  };

  const chipBase = `inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold ${compact ? "text-[10px]" : "text-[11px]"}`;

  if (f.callTag && CALL_TAG_META[f.callTag as CallTagValue]) {
    const meta = CALL_TAG_META[f.callTag as CallTagValue];
    const dueNote =
      f.callTag === "CALLBACK" && f.callbackDate
        ? f.callbackDate < minDay
          ? " — overdue, call today"
          : f.callbackDate === minDay
            ? " — due today"
            : ` — due ${f.callbackDate}`
        : "";
    return (
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <span title={`${meta.title}${dueNote}${f.callTagByName ? ` · set by ${f.callTagByName}` : ""}`} className={`${chipBase} ${meta.cls}`}>
          <span>{meta.icon}</span> {meta.label}
          {f.callTag === "CALLBACK" && f.callbackDate ? ` · ${f.callbackDate}` : ""}
        </span>
        <button
          disabled={busy}
          onClick={() => { setDate(f.callbackDate ?? localIsoDay(1)); setPicking(f.callTag as CallTagValue); }}
          title="Change tag"
          className="rounded border border-zinc-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 hover:border-amber-500/50 hover:text-amber-500"
        >
          change
        </button>
        <button
          disabled={busy}
          onClick={() => tap(null, null)}
          title="Clear tag"
          className="rounded border border-zinc-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 hover:border-rose-500/50 hover:text-rose-500"
        >
          clear
        </button>
        {picking && (
          <span className="inline-flex items-center gap-1">
            {picking === "CALLBACK" && (
              <input
                type="date"
                value={date}
                min={minDay}
                max={maxDay}
                onChange={(ev) => setDate(ev.target.value)}
                className="rounded border border-zinc-400/40 bg-transparent px-1 py-0.5 text-[10px]"
              />
            )}
            <button
              disabled={busy}
              onClick={() => tap(picking, picking === "CALLBACK" ? date : null)}
              className="rounded bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500"
            >
              {busy ? "…" : "save"}
            </button>
            <button onClick={() => setPicking(null)} className="text-[10px] text-zinc-500 px-1">✕</button>
          </span>
        )}
        {err && <span className="text-[10px] text-rose-500">{err}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      {(Object.keys(CALL_TAG_META) as CallTagValue[]).map((t) => (
        <button
          key={t}
          disabled={busy}
          onClick={() => { setDate(localIsoDay(1)); tap(t, null); }}
          title={CALL_TAG_META[t].title}
          className={`${chipBase} ${CALL_TAG_META[t].cls} opacity-70 hover:opacity-100`}
        >
          <span>{CALL_TAG_META[t].icon}</span>
          {compact ? "" : ` ${CALL_TAG_META[t].label}`}
        </button>
      ))}
      {err && <span className="text-[10px] text-rose-500">{err}</span>}
    </div>
  );
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return '"' + s.replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
};
function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Modals ────────────────────────────────────────────────────────────────────

const modalCls = "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4";
const cardCls = "mx-auto mt-10 w-full max-w-3xl rounded-lg border border-zinc-300/40 bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 shadow-xl";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "w-full rounded border border-zinc-400/40 bg-white dark:bg-zinc-800 px-2 py-1.5 text-sm";

interface RosterRow extends StaffRow {
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  order: number;
  deleted: boolean;
  totalAssigned?: number;
  activeAssigned?: number;
  linkedUser?: { id: string; email: string; name: string; isRoot: boolean } | null;
}

function RosterModal({ open, onClose, row, onSaved }: { open: boolean; onClose: () => void; row: RosterRow | null; onSaved: () => void }) {
  const isNew = !row;
  const [form, setForm] = useState<RosterRow | null>(row);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setForm(row ?? { id: "", name: "", region: "", tlLevel: "", closerEligible: true, email: null, phone: null, whatsapp: null, order: 0, deleted: false, won: 0, wonGenerator: 0, wonCloser: 0, closedValue: 0, generatorPoints: 0, closerPoints: 0, points: 0, callsAttempted: 0, callsConnected: 0, callsNotConnected: 0, talkTimeSec: 0, leadsGenerated: 0, leadsConverted: 0, leadsInProgress: 0, leadsLost: 0, score: 0 }); setErr(null); }, [row, open]);
  if (!open) return null;
  const f = form as RosterRow;
  const set = (patch: Partial<RosterRow>) => setForm((p) => ({ ...(p as RosterRow), ...patch }));
  const save = async () => {
    if (!String(f.name ?? "").trim()) { setErr("Name required"); return; }
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: String(f.name).trim(),
        email: f.email || null,
        phone: f.phone || null,
        whatsapp: f.whatsapp || null,
        tlLevel: f.tlLevel || "",
        region: f.region || "",
        assignEstimateFollowUps: !!f.closerEligible,
        order: Number(f.order ?? 0),
      };
      const res = isNew
        ? await fetch("/api/telecallers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/telecallers/${encodeURIComponent(f.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={modalCls} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cardCls + " max-w-xl"}>
        <div className="flex items-center justify-between border-b border-zinc-300/40 dark:border-zinc-700 px-4 py-3">
          <h3 className="text-sm font-bold">{isNew ? "Add staff" : `Edit staff — ${row?.name}`}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-rose-500 text-lg leading-none">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4">
          <Field label="Name"><input className={inputCls} value={f.name ?? ""} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Email"><input className={inputCls} value={f.email ?? ""} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Hierarchy level">
            <select className={inputCls} value={f.tlLevel ?? ""} onChange={(e) => set({ tlLevel: e.target.value })}>
              <option value="">— unset —</option>
              {TL_LEVELS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Region">
            <select className={inputCls} value={f.region ?? ""} onChange={(e) => set({ region: e.target.value })}>
              <option value="">— unmapped —</option>
              {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.name}</option>)}
            </select>
          </Field>
          <Field label="Phone"><input className={inputCls} value={f.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="WhatsApp"><input className={inputCls} value={f.whatsapp ?? ""} onChange={(e) => set({ whatsapp: e.target.value })} /></Field>
          <Field label="Roster order"><input type="number" className={inputCls} value={f.order ?? 0} onChange={(e) => set({ order: Number(e.target.value || 0) })} /></Field>
          <label className="flex items-end gap-2 pb-1.5">
            <input
              type="checkbox"
              checked={!!f.closerEligible}
              onChange={(e) => set({ closerEligible: e.target.checked })}
            />
            <span className="text-xs font-semibold">Conversion specialist (can be picked as closer)</span>
          </label>
          <p className="col-span-2 text-[11px] leading-relaxed text-zinc-500">
            Once the region is set, the new enquiry-created estimates get stamped with the region and the estimate finally lands up at the right place. Unmapped regions are highlighted on the board, which is exactly what the region creator should not operate on (unmapped staff are excluded from using region links directly). But they receive every call KPI.
          </p>
        </div>
        {err && <p className="px-4 pb-1 text-xs text-rose-500">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-zinc-300/40 dark:border-zinc-700 px-4 py-3">
          <button onClick={onClose} className="rounded border border-zinc-400/40 px-3 py-1.5 text-xs font-semibold">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-900 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

/** Closer-pick modal: 80% of a close is pending until sales-head picks who
 *  banked it. Same-region conversion specialists only (validated backend-side). */
function CloserPickModal({ open, onClose, picks, staffByRegion, onSaved }: {
  open: boolean; onClose: () => void; picks: PendingPick[]; staffByRegion: Map<string, StaffRow[]>; onSaved: () => void;
}) {
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [closerId, setCloserId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return null;
  const pick = (p: PendingPick) => { setPickFor(p.estimateId); setCloserId(""); setErr(null); };
  const confirm = async () => {
    if (!pickFor || !closerId) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/telecalling/closer-pick", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estimateId: pickFor, closerId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Pick failed (HTTP ${res.status})`);
      setPickFor(null);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Pick failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={modalCls} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cardCls}>
        <div className="flex items-center justify-between border-b border-zinc-300/40 dark:border-zinc-700 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold">Closes waiting for a pick</h3>
            <p className="text-[11px] text-zinc-500">{picks.length} converted estimate{picks.length === 1 ? "" : "s"} — generator's 20% is banked, the 80% closer share is pending.</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-rose-500 text-lg leading-none">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-3">
          {picks.length === 0 && <p className="p-3 text-xs text-zinc-500">Nothing pending — every noted close has a closer credited.</p>}
          <ul className="space-y-2">
            {picks.map((p) => {
              const regionStaff = staffByRegion.get(p.region) ?? [];
              return (
                <li key={p.estimateId} className="rounded border border-zinc-300/40 dark:border-zinc-700 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold">{p.estimateNumber}</span>
                    <span className="text-xs text-zinc-500">{p.customerName}</span>
                    <span className="text-xs font-semibold text-emerald-500">{inr(p.total)}</span>
                    {p.region ? <span className="rounded-full bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 text-[10px] font-bold text-sky-500">{p.region} · {REGION_SHORT[p.region]}</span> : <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">unmapped</span>}
                    <span className="text-[10px] text-zinc-400">closed {p.closeDay}</span>
                    {pickFor !== p.estimateId && (
                      <button onClick={() => pick(p)} className="ml-auto rounded bg-amber-500 px-2 py-1 text-[11px] font-bold text-zinc-900">Pick closer</button>
                    )}
                  </div>
                  {pickFor === p.estimateId && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-300/30 dark:border-zinc-700 pt-2">
                      <select value={closerId} onChange={(e) => setCloserId(e.target.value)} className={inputCls + " max-w-xs"}>
                        <option value="">— pick a closer ({p.region ? `${regionStaff.length} in ${p.region}` : "any staff"} ) —</option>
                        {(p.region ? regionStaff : [...staffByRegion.get("") ?? [], ...Object.values(staffByRegion).flat()])
                          .filter((s) => s.closerEligible)
                          .map((s) => (
                            <option key={s.id} value={s.id}>{s.name} ({wonLabel(s)}</option>
                          ))}
                      </select>
                      <button onClick={confirm} disabled={busy || !closerId} className="rounded bg-emerald-500 px-2 py-1 text-[11px] font-bold text-zinc-900 disabled:opacity-50">{busy ? "…" : "Credit 80%"}</button>
                      <button onClick={() => setPickFor(null)} className="text-[11px] text-zinc-500">cancel</button>
                      {err && <span className="text-[11px] text-rose-500">{err}</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
function wonLabel(s: StaffRow): string {
  const parts: string[] = [];
  if (s.wonGenerator > 0) parts.push(`${s.wonGenerator} gen`);
  if (s.wonCloser > 0) parts.push(`${s.wonCloser} closed`);
  if (s.won > 0) parts.push(`${s.won} won`);
  return parts.join(", ") || "no wins yet";
}

/** Unmapped linker: aim a regionless estimate at a region (R1–R4). */
function UnmappedModal({ open, onClose, bucket, onSaved }: { open: boolean; onClose: () => void; bucket?: { count: number; value: number; items: UnmappedItem[] }; onSaved: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return null;
  const link = async (id: string, region: string) => {
    setBusyId(id);
    setErr(null);
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(id)}/region`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ region }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Link failed (HTTP ${res.status})`);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Link failed");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div className={modalCls} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cardCls}>
        <div className="flex items-center justify-between border-b border-zinc-300/40 dark:border-zinc-700 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold">Unmapped estimates</h3>
            <p className="text-[11px] text-zinc-500">{bucket?.count ?? 0} open · {inr(bucket?.value ?? 0)} — link each to its region (enquiries stamp new ones automatically).</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-rose-500 text-lg leading-none">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-3">
          {!bucket || bucket.items.length === 0 ? (
            <p className="p-3 text-xs text-zinc-500">Bucket empty — every open estimate sits in a region.</p>
          ) : (
            <ul className="space-y-2">
              {bucket.items.map((it) => (
                <li key={it.estimateId} className="flex flex-wrap items-center gap-2 rounded border border-zinc-300/40 dark:border-zinc-700 p-2.5">
                  <span className="text-sm font-bold">{it.estimateNumber}</span>
                  <span className="text-xs text-zinc-500">{it.customerName}</span>
                  <span className="text-xs font-semibold text-emerald-500">{inr(it.total)}</span>
                  <OrgBadge orgId={it.organizationId} orgs={["676267428", "744573214"]} />
                  {it.generatedBy ? <span className="text-[10px] text-rose-500">By {it.generatedBy}</span> : <span className="text-[10px] text-zinc-400">no creator</span>}
                  <span className="ml-auto flex gap-1">
                    {REGIONS.map((r) => (
                      <button
                        key={r.id}
                        disabled={busyId === it.estimateId}
                        onClick={() => link(it.estimateId, r.id)}
                        title={`Link to ${r.name}`}
                        className="rounded border border-sky-500/30 bg-sky-500/5 px-1.5 py-0.5 text-[10px] font-bold text-sky-600 dark:text-sky-400 disabled:opacity-50"
                      >
                        {r.id}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {err && <p className="p-3 text-xs text-rose-500">{err}</p>}
        </div>
      </div>
    </div>
  );
}
