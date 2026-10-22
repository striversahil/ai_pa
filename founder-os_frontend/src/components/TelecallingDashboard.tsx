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
            <select className={inputCls} value={f.tlLevel ?? ""} onChange={(e) => set({ tlLevel: e.target.value as RosterRow["tlLevel"] })}>
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
            The region maps this staff member to the sales leaderboard: every estimate they generate is stamped with this region, and they can work any estimate in it. Closer eligibility controls who can receive the 80% close share. Unmapped staff still show every call KPI — but no region data.
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
                            <option key={s.id} value={s.id}>{s.name} ({wonLabel(s)})</option>
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

// ── Main dashboard ───────────────────────────────────────────────────────────

type View = "regions" | "staff" | "atrisk" | "manage";
type PeriodKey = "today" | "week" | "lastweek" | "month" | "lastmonth" | "year" | "lastyear";

export default function TelecallingDashboard() {
  const { me } = useAuth();
  const [view, setView] = useState<View>("regions");
  const [period, setPeriod] = useState<PeriodKey>("week");
  const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "lastweek", label: "Last Week" },
    { key: "month", label: "This Month" },
    { key: "lastmonth", label: "Last Month" },
    { key: "year", label: "This Year" },
    { key: "lastyear", label: "Last Year" },
  ];
  // Managers: root/admin, MIS holders, and the sales-head scope. Staff (sales
  // agents) only see their own region drill.
  const [canManage, setCanManage] = useState(false);

  const dashQ = useLiveQuery<DashData>(
    async () => {
      const res = await fetch(`/api/automations/telecalling/data?period=${period}`);
      if (!res.ok) throw new Error(`Failed to load leaderboard (HTTP ${res.status})`);
      return res.json();
    },
    { events: TELECALLING_EVENTS, deps: [period], clearOnError: true },
  );
  const dash = dashQ.data;

  useEffect(() => {
    setCanManage(dash?.meta?.canManage ?? (!!me && (me.isAdmin || me.scopes.includes("mis") || me.scopes.includes("sales-head"))));
  }, [dash, me]);

  // Roster (managers only).
  const rosterQ = useLiveQuery<{ telecallers: RosterRow[] }>(
    async () => {
      if (!canManage) return { telecallers: [] };
      const res = await fetch("/api/telecallers");
      if (!res.ok) throw new Error("load failed");
      return res.json();
    },
    { events: TELECALLING_EVENTS },
  );

  // Region drill-down: every staff member's ?agent= view (their REGION
  // pipeline). Managers prefetch all; staff only their own.
  const selfRegionStaff = dash?.meta?.viewer?.staffId ?? null;
  const drillIds = useMemo(() => {
    if (selfRegionStaff) return [selfRegionStaff];
    return canManage ? (dash?.meta?.staff ?? []).map((s) => s.id) : [];
  }, [dash, selfRegionStaff, canManage]);
  const drillKey = useMemo(() => drillIds.join(","), [drillIds]);
  const agentViewsQ = useLiveQuery<Record<string, AgentViewData | null>>(
    async () => {
      if (!drillKey) return {};
      const ids = drillKey.split(",");
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/automations/telecalling/data?agent=${encodeURIComponent(id)}`);
            return [id, res.ok ? ((await res.json()) as AgentViewData) : null] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    { events: TELECALLING_EVENTS, deps: [drillKey], clearOnError: true },
  );

  // Call-tag optimistic echo + live deltas (same mechanics as enquiry drill).
  const [tagOverrides, setTagOverrides] = useState<Record<string, CallTagDelta>>({});
  useLiveEvent((e) => {
    if (e.type !== "telecalling-tag" && e.type !== "telecalling") return;
    const d = (e as unknown as { callTag?: { estimateId?: unknown } }).callTag;
    if (d && typeof d.estimateId === "string") {
      const dd = d as unknown as CallTagDelta & { estimateId: string };
      setTagOverrides((prev) => ({
        ...prev,
        [String(dd.estimateId)]: {
          callTag: dd.callTag ?? null,
          callbackDate: dd.callbackDate ?? null,
          callTagBy: dd.callTagBy ?? null,
          callTagByName: dd.callTagByName ?? null,
          callTagAt: dd.callTagAt ?? null,
        },
      }));
    }
  });
  const applyTagOverride = useCallback((estimateId: string, delta: CallTagDelta | null) => {
    setTagOverrides((prev) => {
      if (!delta) {
        const { [estimateId]: _omit, ...rest } = prev;
        return rest;
      }
      return { ...prev, [estimateId]: delta };
    });
  }, []);
  const agentViewsMap = useMemo(() => {
    const src = agentViewsQ.data ?? {};
    if (Object.keys(tagOverrides).length === 0) return src;
    const out: Record<string, AgentViewData | null> = {};
    for (const [id, v] of Object.entries(src)) {
      if (!v || !Array.isArray(v.followUps)) { out[id] = v; continue; }
      out[id] = {
        ...v,
        followUps: v.followUps.map((f) => (tagOverrides[f.estimateId] ? { ...f, ...tagOverrides[f.estimateId] } : f)),
      };
    }
    return out;
  }, [agentViewsQ.data, tagOverrides]);
  const getAgentView = useCallback((id: string | null): AgentViewData | null => (id ? agentViewsMap[id] ?? null : null), [agentViewsMap]);

  const refreshAll = useCallback(() => {
    dashQ.refresh();
    rosterQ.refresh();
    agentViewsQ.refresh();
  }, [dashQ, rosterQ, agentViewsQ]);

  // ── Mgmt state ───────────────────────────────────────────────────────────
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RosterRow | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [pickModalOpen, setPickModalOpen] = useState(false);
  const [unmappedModalOpen, setUnmappedModalOpen] = useState(false);
  const [resetCounts, setResetCounts] = useState<number | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RosterRow | null>(null);
  const [busy, setBusy] = useState(false);

  const staffByRegion = useMemo(() => {
    const m = new Map<string, StaffRow[]>();
    for (const r of dash?.regions ?? []) m.set(r.id, r.staff ?? []);
    m.set("", [...(dash?.unmappedStaff ?? [])]);
    return m;
  }, [dash]);

  const pendingPicks = dash?.pendingPicks ?? [];
  const unmapped = dash?.unmapped;
  const atRisk = dash?.risk?.atRisk ?? [];

  // Distinct Zoho orgs across loaded rows (badges render with 2+ orgs).
  const orgs = useMemo(() => {
    const set = new Set<string>();
    for (const v of Object.values(agentViewsMap)) {
      for (const f of v?.followUps ?? []) if (f?.organizationId) set.add(String(f.organizationId));
    }
    for (const r of atRisk) if ((r as any)?.organizationId) set.add(String((r as any).organizationId));
    return [...set].sort();
  }, [agentViewsMap, atRisk]);

  const deleteRoster = async (row: RosterRow) => {
    setBusy(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/telecallers/${encodeURIComponent(row.id)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Delete failed (${res.status})`);
      }
      setDeleteTarget(null);
      refreshAll();
    } catch (e: any) {
      setRosterError(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  // ── History reset (dry preview → confirm) ────────────────────────────────
  const dryReset = async () => {
    setResetBusy(true);
    setResetCounts(null);
    try {
      const res = await fetch("/api/telecalling/reset-history?dry=1", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Preview failed (HTTP ${res.status})`);
      setResetCounts(typeof data?.deleted?.closeRows === "number" ? data.deleted.closeRows : null);
    } catch {
      setResetCounts(null);
    }
    setResetBusy(false);
  };
  const runReset = async () => {
    setResetBusy(true);
    try {
      await fetch("/api/telecalling/reset-history", { method: "POST" });
      setResetCounts(null);
      refreshAll();
    } catch {
      /* silent — next refetch shows the fresh board */
    }
    setResetBusy(false);
  };

  // ── Exports ──────────────────────────────────────────────────────────────
  const [loadingDaily, setLoadingDaily] = useState(false);
  const doExportDaily = async () => {
    setLoadingDaily(true);
    try {
      const res = await fetch(`/api/automations/telecalling/data?period=${period}&daily=1`);
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const payload = (await res.json()) as DashData;
      if (payload.dailyError) throw new Error(payload.dailyError);
      const rows: (string | number | null | undefined)[][] = [];
      const label = payload?.meta?.periodLabel ?? "Period";
      rows.push([`SALES LEADERBOARD — ${label} (${payload?.meta?.periodFrom ?? ""} → ${payload?.meta?.periodTo ?? payload?.meta?.day ?? ""})`]);
      rows.push(["Date", "Weekday", "Staff", "Region", "Won", "Value ₹", "Closed Estimates", "Calls", "Connected", "Not connected", "Talk min", "Leads", "Score"]);
      for (const d of payload?.daily ?? []) {
        rows.push([d.date, d.weekday, d.telecallerName, d.region, d.won, d.closedValue, d.closedEstimates, d.callsAttempted, d.callsConnected, d.callsNotConnected, d.talkTimeMin, d.leadsGenerated, d.score]);
      }
      downloadCsv(`sales-leaderboard-${period}.csv`, rows);
    } catch (e: any) {
      setRosterError(e?.message ?? "Export failed");
    } finally {
      setLoadingDaily(false);
    }
  };

  const [loadingEst, setLoadingEst] = useState(false);
  const doExportEstimates = async () => {
    setLoadingEst(true);
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const dayOf = (d: unknown): string => {
        const s = String(d ?? "");
        const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        const t = Date.parse(s);
        return Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
      };
      const [estRes, convRes] = await Promise.all([
        fetch("/api/estimates"),
        fetch(`/api/automations/telecalling/data?converters=1&since=${since}`),
      ]);
      if (!estRes.ok) throw new Error(`Failed to load estimates (HTTP ${estRes.status})`);
      if (!convRes.ok) throw new Error(`Failed to load converters (HTTP ${convRes.status})`);
      const estPayload = await estRes.json();
      const convPayload = await convRes.json();
      const converters: Record<string, { name: string; day: string }> = convPayload?.converters ?? {};
      const wanted = new Set(["sent", "accepted", "declined", "confirmed"]);
      const list: any[] = (estPayload?.estimates ?? []).filter(
        (e: any) => wanted.has(String(e?.status ?? "").toLowerCase()) && dayOf(e?.date) >= since
      );
      list.sort((a, b) =>
        dayOf(a?.date).localeCompare(dayOf(b?.date)) ||
        String(a?.estimateNumber ?? "").localeCompare(String(b?.estimateNumber ?? ""))
      );
      const rows: (string | number | null | undefined)[][] = [];
      rows.push([`ESTIMATES — LAST 30 DAYS (SINCE ${since}) — ${list.length} ROWS`]);
      rows.push(["Estimate", "Sent", "Customer", "Status", "Region", "Total ₹", "Generated By", "Converted By (pick)"]);
      for (const e of list) {
        const conv = converters[String(e?.estimateId ?? "")];
        rows.push([
          e?.estimateNumber ?? e?.estimateId,
          dayOf(e?.date),
          e?.customerName ?? "",
          String(e?.status ?? "").toLowerCase(),
          String(e?.region ?? "") || "unmapped",
          Number(e?.total ?? 0) || 0,
          e?.leadOfName ?? "",
          conv ? `${conv.name} (gets at ${conv.day})` : "",
        ]);
      }
      downloadCsv(`estimates-region-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    } catch (e: any) {
      setRosterError(e?.message ?? "Export failed");
    } finally {
      setLoadingEst(false);
    }
  };

  // ── Drill-down state ─────────────────────────────────────────────────────
  const [drillFor, setDrillForModal] = useState<string | null>(null);
  const [tagFilter, setTagFilterState] = useState<"ALL" | CallTagValue>("ALL");
  const [callbackDueBy, setCallbackDueBy] = useState<string>("");
  const drillView = getAgentView(drillFor);
  const drillFollowUps = useMemo(
    () => (drillView?.followUps ?? []).filter((f) => {
      if (tagFilter === "ALL") return true;
      if ((f.callTag ?? null) !== tagFilter) return false;
      if (tagFilter === "CALLBACK" && callbackDueBy && (f.callbackDate ?? "") > callbackDueBy) return false;
      return true;
    }),
    [drillView, tagFilter, callbackDueBy],
  );

  if (dashQ.error) {
    return (
      <div className="p-6 text-sm text-rose-500">
        {String(dashQ.error)}
        <button onClick={() => dashQ.refresh()} className="ml-3 rounded border border-zinc-400/40 px-2 py-1 text-xs">Retry</button>
      </div>
    );
  }
  if (!dash) {
    return <div className="p-6 text-sm text-zinc-500">Loading sales leaderboard…</div>;
  }

  const kpi = dash.kpi;
  const target = dash.meta?.conversionTarget;
  const viewer = dash.meta?.viewer;
  const epoch = dash.meta?.epoch ?? null;
  const staffAll = (dash.regions ?? []).flatMap((r) => (r.staff ?? []).map((s) => ({ ...s, regionLabel: r.id })));

  return (
    <div className="p-3 sm:p-6 space-y-4">
      {/* Header row: title + period + epoch badge */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Sales Leaderboard</h2>
        <span className="text-[11px] text-zinc-500">
          {dash.meta?.periodLabel ?? "Today"}
          {dash.meta?.usingLatestAvailable ? " · latest available NeoDove day" : ""}
          {viewer?.staffId ? ` · your region: ${viewer.region ? `${viewer.region} ${REGION_SHORT[viewer.region as RegionId] ?? ""}` : "unmapped"}` : ""}
        </span>
        {epoch && (
          <span
            className="rounded-full bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 text-[10px] font-bold text-violet-500"
            title={`Live reset stamped ${epoch} — points count only from that day on`}
          >
            ⏱ from {epoch}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} className="rounded border border-zinc-400/40 bg-transparent px-2 py-1 text-xs">
            {PERIOD_OPTIONS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <button onClick={() => dashQ.refresh()} title="Refresh" className="rounded border border-zinc-400/40 px-2 py-1 text-xs font-semibold hover:border-amber-500/50 hover:text-amber-500">↻</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded border border-zinc-300/40 dark:border-zinc-700 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Won</p>
          <p className="text-xl font-extrabold text-emerald-500">{kpi?.won ?? 0}</p>
          <p className="text-[11px] text-zinc-500">{inr(kpi?.closedValue ?? 0)}</p>
          {target && target.workingDays ? (
            <div className="mt-0.5 flex items-center gap-1">
              <div className="h-1 w-16 overflow-hidden rounded bg-zinc-400/30">
                <div className={`h-1 ${target.status === "gold" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, target.pct)}%` }} />
              </div>
              <span className={`text-[10px] font-semibold ${target.status === "gold" ? "text-amber-500" : target.status === "hit" ? "text-emerald-500" : "text-zinc-500"}`}>
                {target.pct}% of ₹{(target.target / 100000).toFixed(0)}L
              </span>
            </div>
          ) : null}
        </div>
        <div className="rounded border border-zinc-300/40 dark:border-zinc-700 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Open pipeline</p>
          <p className="text-xl font-extrabold">{(dash.regions ?? []).reduce((s, r) => s + r.open.count, 0)}</p>
          <p className="text-[11px] text-zinc-500">{inr(kpi?.pipelineValue ?? 0)}</p>
          {canManage && unmapped && unmapped.count > 0 && (
            <button onClick={() => setUnmappedModalOpen(true)} className="mt-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">
              {unmapped.count} unmapped — link them
            </button>
          )}
        </div>
        <div className="rounded border border-zinc-300/40 dark:border-zinc-700 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Leads generated</p>
          <p className="text-xl font-extrabold text-sky-500">{kpi?.leadsGenerated ?? 0}</p>
          {(dash.meta?.unattributedLeads ?? 0) > 0 && (
            <p className="text-[10px] text-amber-500">{dash.meta?.unattributedLeads} unattributed (no roster match)</p>
          )}
        </div>
        <div className="rounded border border-zinc-300/40 dark:border-zinc-700 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Calls connected</p>
          <p className="text-xl font-extrabold">{kpi?.callsConnected ?? 0}</p>
          <p className="text-[11px] text-zinc-500">of {kpi?.callsAttempted ?? 0} attempted</p>
        </div>
        <div className="rounded border border-zinc-300/40 dark:border-zinc-700 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Talk time</p>
          <p className="text-xl font-extrabold">{mins(kpi?.talkTimeSec ?? 0)}</p>
        </div>
        <div className="rounded border border-zinc-300/40 dark:border-zinc-700 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Awaiting pick</p>
          <p className="text-xl font-extrabold text-amber-500">{pendingPicks.length}</p>
          {canManage && pendingPicks.length > 0 && (
            <button onClick={() => setPickModalOpen(true)} className="mt-0.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-900">Pick closers</button>
          )}
        </div>
      </div>

      {/* View tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-zinc-300/40 dark:border-zinc-700 pb-2">
        {([
          ["regions", "Regions"],
          ["staff", "Staff board"],
          ["atrisk", `At risk (${dash.risk?.counts?.red ?? 0} red · ${dash.risk?.counts?.zombie ?? 0} zombie)`],
          ...(canManage ? [["manage", "Manage"] as [View, string]] : []),
        ] as Array<[View, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`rounded-full px-3 py-1 text-xs font-bold ${view === key ? "bg-amber-500 text-zinc-900" : "border border-zinc-400/40 text-zinc-500 hover:border-amber-500/50 hover:text-amber-500"}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto flex gap-1.5">
          <button onClick={doExportDaily} disabled={loadingDaily} className="rounded border border-zinc-400/40 px-2 py-1 text-[11px] font-semibold disabled:opacity-50">{loadingDaily ? "…" : "⬇ Daily CSV"}</button>
          <button onClick={doExportEstimates} disabled={loadingEst} className="rounded border border-zinc-400/40 px-2 py-1 text-[11px] font-semibold disabled:opacity-50">{loadingEst ? "…" : "⬇ Estimates CSV"}</button>
        </span>
      </div>

      {rosterError && <p className="rounded bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-500">{rosterError}</p>}

      {/* ── Regions view ──────────────────────────────────────────────────── */}
      {view === "regions" && (
        <div className="grid gap-3 lg:grid-cols-2">
          {(dash.regions ?? []).map((r) => (
            <div key={r.id || "unmapped"} className="rounded-lg border border-zinc-300/40 dark:border-zinc-700 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 text-[11px] font-extrabold text-sky-600 dark:text-sky-400">{r.id}</span>
                <h3 className="text-sm font-bold">{r.name}</h3>
                <span className="rounded-full border border-zinc-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500">{r.tl} team</span>
                <div className="ml-auto flex items-center gap-2 text-[10px]">
                  <TlPct pct={r.kra.connectedPct} label="Calls vs NeoDove daily benchmark" />
                  <TlPct pct={r.kra.leadsPct} label="Enquiry leads vs daily benchmark" />
                </div>
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-500">{r.states.join(" · ")}</p>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                <div className="rounded bg-emerald-500/5 border border-emerald-500/20 p-1.5">
                  <p className="text-[9px] font-bold uppercase text-zinc-500">Won</p>
                  <p className="text-base font-extrabold text-emerald-500">{r.won.count}</p>
                  <p className="text-[9px] text-zinc-500">{inr(r.won.value)}</p>
                </div>
                <div className="rounded bg-amber-500/5 border border-amber-500/20 p-1.5">
                  <p className="text-[9px] font-bold uppercase text-zinc-500">Open</p>
                  <p className="text-base font-extrabold text-amber-500">{r.open.count}</p>
                  <p className="text-[9px] text-zinc-500">{inr(r.open.value)}</p>
                </div>
                <div className="rounded bg-sky-500/5 border border-sky-500/20 p-1.5">
                  <p className="text-[9px] font-bold uppercase text-zinc-500">Points</p>
                  <p className="text-base font-extrabold text-sky-500">{r.points}</p>
                  <p className="text-[9px] text-zinc-500">{r.leadsGenerated} leads</p>
                </div>
                <div className="rounded bg-violet-500/5 border border-violet-500/20 p-1.5">
                  <p className="text-[9px] font-bold uppercase text-zinc-500">Talk</p>
                  <p className="text-base font-extrabold text-violet-500">{mins(r.talkTimeSec)}</p>
                  <p className="text-[9px] text-zinc-500">{r.callsConnected} conn.</p>
                </div>
              </div>
              {/* Region staff board */}
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-zinc-500">
                    <tr>
                      <th className="py-1 pr-2 font-semibold">Staff</th>
                      <th className="py-1 pr-2 font-semibold">Points</th>
                      <th className="py-1 pr-2 font-semibold">Won (gen/closed)</th>
                      <th className="py-1 pr-2 font-semibold">Value</th>
                      <th className="py-1 pr-2 font-semibold">Leads</th>
                      <th className="py-1 pr-2 font-semibold">Calls</th>
                      <th className="py-1 pr-2 font-semibold" />
                    </tr>
                  </thead>
                  <tbody>
                    {(r.staff ?? []).map((s) => (
                      <tr key={s.id} className="border-t border-zinc-300/20 dark:border-zinc-700/40">
                        <td className="py-1 pr-2 font-semibold">
                          {s.name}
                          {s.tlLevel ? <span className="ml-1 text-[9px] text-zinc-400">{s.tlLevel}</span> : null}
                          {!s.closerEligible && <span className="ml-1 text-[9px] text-zinc-400">gen-only</span>}
                        </td>
                        <td className="py-1 pr-2 font-extrabold">{s.points}</td>
                        <td className="py-1 pr-2">{s.wonGenerator}<span className="text-zinc-400">/</span>{s.wonCloser}</td>
                        <td className="py-1 pr-2">{inr(s.closedValue)}</td>
                        <td className="py-1 pr-2">{s.leadsGenerated}</td>
                        <td className="py-1 pr-2">{s.callsConnected}</td>
                        <td className="py-1 pr-2">
                          <button onClick={() => setDrillForModal(s.id)} className="text-[10px] font-bold text-sky-500 hover:underline">pipeline →</button>
                        </td>
                      </tr>
                    ))}
                    {(r.staff ?? []).length === 0 && (
                      <tr><td colSpan={7} className="py-1 text-zinc-400">No staff mapped to this region yet — Manage → roster.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Unmapped staff banner */}
          {(dash.unmappedStaff ?? []).length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 lg:col-span-2">
              <h3 className="text-sm font-bold text-amber-500">Staff without a region ({(dash.unmappedStaff ?? []).length})</h3>
              <p className="text-[11px] text-zinc-500">They still bank call KPIs and lead credits — but no region data. Map them in Manage → roster.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(dash.unmappedStaff ?? []).map((s) => (
                  <span key={s.id} className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-500">
                    {s.name} · {s.points} pts
                  </span>
                ))}
                {canManage && (
                  <button onClick={() => setView("manage")} className="rounded border border-amber-500/40 px-2 py-0.5 text-[11px] font-bold text-amber-500">Open roster →</button>
                )}
              </div>
            </div>
          )}

          {/* Unmapped estimates card (privileged) */}
          {canManage && unmapped && unmapped.count > 0 && (
            <button
              onClick={() => setUnmappedModalOpen(true)}
              className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-left hover:bg-amber-500/10 lg:col-span-2"
            >
              <h3 className="text-sm font-bold text-amber-500">Unmapped estimates — {unmapped.count} open · {inr(unmapped.value)}</h3>
              <p className="text-[11px] text-zinc-500">
                Estimates whose creator had no region when they synced. Link each to where the customer actually is. Example: {unmapped.items.slice(0, 3).map((i) => i.estimateNumber).join(", ")}…
              </p>
            </button>
          )}
        </div>
      )}

      {/* ── Staff board (all regions, rank-ordered) ───────────────────────── */}
      {view === "staff" && (
        <div className="overflow-x-auto rounded-lg border border-zinc-300/40 dark:border-zinc-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-500/5 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">Staff</th>
                <th className="px-3 py-2 font-semibold">Region</th>
                <th className="px-3 py-2 font-semibold">Points</th>
                <th className="px-3 py-2 font-semibold">Generator</th>
                <th className="px-3 py-2 font-semibold">Closer</th>
                <th className="px-3 py-2 font-semibold">Won ₹</th>
                <th className="px-3 py-2 font-semibold">Leads</th>
                <th className="px-3 py-2 font-semibold">Calls</th>
                <th className="px-3 py-2 font-semibold">Talk</th>
                <th className="px-3 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {staffAll.sort((a, b) => b.points - a.points || b.closedValue - a.closedValue).map((s, i) => (
                <tr key={s.id} className="border-t border-zinc-300/20 dark:border-zinc-700/40">
                  <td className="px-3 py-1.5 text-zinc-400">{i + 1}</td>
                  <td className="px-3 py-1.5 font-semibold">{s.name}{s.tlLevel ? <span className="ml-1 text-[9px] text-zinc-400">{s.tlLevel}</span> : null}{!s.closerEligible && <span className="ml-1 text-[9px] text-zinc-400">gen-only</span>}</td>
                  <td className="px-3 py-1.5"><span className="rounded bg-sky-500/10 border border-sky-500/30 px-1 py-0.5 text-[10px] font-bold text-sky-500">{s.regionLabel}</span></td>
                  <td className="px-3 py-1.5 font-extrabold">{s.points}</td>
                  <td className="px-3 py-1.5">{s.wonGenerator} <span className="text-[9px] text-zinc-400">(+{s.generatorPoints})</span></td>
                  <td className="px-3 py-1.5">{s.wonCloser} <span className="text-[9px] text-zinc-400">(+{s.closerPoints})</span></td>
                  <td className="px-3 py-1.5 text-emerald-500">{inr(s.closedValue)}</td>
                  <td className="px-3 py-1.5">{s.leadsGenerated}</td>
                  <td className="px-3 py-1.5">{s.callsConnected}{s.callsAttempted > 0 ? <span className="text-[9px] text-zinc-400">/{s.callsAttempted}</span> : null}</td>
                  <td className="px-3 py-1.5">{mins(s.talkTimeSec)}</td>
                  <td className="px-3 py-1.5"><button onClick={() => setDrillForModal(s.id)} className="text-[10px] font-bold text-sky-500 hover:underline">pipeline →</button></td>
                </tr>
              ))}
              {(dash.unmappedStaff ?? []).map((s) => (
                <tr key={s.id} className="border-t border-amber-500/20 bg-amber-500/5">
                  <td className="px-3 py-1.5 text-zinc-400">•</td>
                  <td className="px-3 py-1.5 font-semibold text-amber-500">{s.name} <span className="text-[9px]">(unmapped)</span></td>
                  <td className="px-3 py-1.5">—</td>
                  <td className="px-3 py-1.5 font-extrabold">{s.points}</td>
                  <td className="px-3 py-1.5">{s.wonGenerator} <span className="text-[9px] text-zinc-400">(+{s.generatorPoints})</span></td>
                  <td className="px-3 py-1.5">{s.wonCloser} <span className="text-[9px] text-zinc-400">(+{s.closerPoints})</span></td>
                  <td className="px-3 py-1.5 text-emerald-500">{inr(s.closedValue)}</td>
                  <td className="px-3 py-1.5">{s.leadsGenerated}</td>
                  <td className="px-3 py-1.5">{s.callsConnected}{s.callsAttempted > 0 ? <span className="text-[9px] text-zinc-400">/{s.callsAttempted}</span> : null}</td>
                  <td className="px-3 py-1.5">{mins(s.talkTimeSec)}</td>
                  <td className="px-3 py-1.5"><button onClick={() => setDrillForModal(s.id)} className="text-[10px] font-bold text-sky-500 hover:underline">pipeline →</button></td>
                </tr>
              ))}
              {staffAll.length === 0 && (dash.unmappedStaff ?? []).length === 0 && (
                <tr><td colSpan={11} className="px-3 py-3 text-zinc-400">No staff on the board yet — Management → roster to add them.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── At-risk (informational) ───────────────────────────────────────── */}
      {view === "atrisk" && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-500">
            Live pre-warning over the open {inr(dash.risk?.valueAtRisk ?? 0)} pipeline: red = unsatisfactory/stale, zombie = silent &gt; 3 days. Informational — nothing moves until a close or a region link changes it.
          </p>
          <div className="overflow-x-auto rounded-lg border border-zinc-300/40 dark:border-zinc-700">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-500/5 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Estimate</th>
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Region</th>
                  <th className="px-3 py-2 font-semibold">Total</th>
                  <th className="px-3 py-2 font-semibold">Generated by</th>
                  <th className="px-3 py-2 font-semibold">State</th>
                  <th className="px-3 py-2 font-semibold">Next step</th>
                  <th className="px-3 py-2 font-semibold">Last comment</th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map((r) => (
                  <tr key={r.estimateId} className="border-t border-zinc-300/20 dark:border-zinc-700/40">
                    <td className="px-3 py-1.5 font-bold">{r.estimateNumber}</td>
                    <td className="px-3 py-1.5">{r.customerName}</td>
                    <td className="px-3 py-1.5">
                      {r.region
                        ? <span className="rounded bg-sky-500/10 border border-sky-500/30 px-1 py-0.5 text-[10px] font-bold text-sky-500">{r.region}</span>
                        : <span className="text-[10px] font-bold text-amber-500">unmapped</span>}
                    </td>
                    <td className="px-3 py-1.5">{inr(r.total)}</td>
                    <td className="px-3 py-1.5">{r.generatorName ?? <span className="text-zinc-400">—</span>}</td>
                    <td className="px-3 py-1.5"><RiskChip risk={r.risk} /></td>
                    <td className="px-3 py-1.5 text-[11px]">{r.nextStep ? `${r.nextStepDate ?? ""} — ${r.nextStep}` : <span className="text-zinc-400">—</span>}</td>
                    <td className="px-3 py-1.5 text-[11px]">{r.lastCommentDate ?? <span className="text-zinc-400">none</span>}</td>
                  </tr>
                ))}
                {atRisk.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-3 text-zinc-400">Nothing at risk — every open estimate has a fresh comment or an on-record commitment.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Manage (canManage only) ───────────────────────────────────────── */}
      {view === "manage" && canManage && (
        <div className="space-y-4">
          {/* Closer pickup */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <h3 className="text-sm font-bold text-amber-500">Closes awaiting a pick ({pendingPicks.length})</h3>
            <p className="text-[11px] text-zinc-500">The generator's 20% is automatic; pick who banks the other 80%. Same-region conversion specialists only.</p>
            <button onClick={() => setPickModalOpen(true)} className="mt-2 rounded bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-900">Open pick panel</button>
          </div>

          {/* Unmapped */}
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
            <h3 className="text-sm font-bold text-sky-500">Unmapped estimates ({unmapped?.count ?? 0})</h3>
            <p className="text-[11px] text-zinc-500">Enquiries stamp regions automatically now — these synced before their creator had a region.</p>
            <button onClick={() => setUnmappedModalOpen(true)} disabled={!unmapped || unmapped.count === 0} className="mt-2 rounded bg-sky-500 px-3 py-1.5 text-xs font-bold text-zinc-900 disabled:opacity-40">Open link panel</button>
          </div>

          {/* Roster */}
          <div className="rounded-lg border border-zinc-300/40 dark:border-zinc-700 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold">Roster — staff × hierarchy × region</h3>
              <button
                onClick={() => { setEditTarget(null); setRosterModalOpen(true); }}
                className="ml-auto rounded bg-emerald-500 px-3 py-1.5 text-xs font-bold text-zinc-900"
              >
                + Add staff
              </button>
            </div>
            {rosterError && <p className="mt-2 text-xs text-rose-500">{rosterError}</p>}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1.5 pr-3 font-semibold">Staff</th>
                    <th className="py-1.5 pr-3 font-semibold">TL</th>
                    <th className="py-1.5 pr-3 font-semibold">Region</th>
                    <th className="py-1.5 pr-3 font-semibold">Closer</th>
                    <th className="py-1.5 pr-3 font-semibold">Platform user</th>
                    <th className="py-1.5 pr-3 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {(rosterQ.data?.telecallers ?? []).map((t) => (
                    <tr key={t.id} className="border-t border-zinc-300/20 dark:border-zinc-700/40">
                      <td className="py-1.5 pr-3 font-semibold">{t.name}</td>
                      <td className="py-1.5 pr-3">{t.tlLevel || <span className="text-zinc-400">—</span>}</td>
                      <td className="py-1.5 pr-3">
                        {t.region
                          ? <span className="rounded bg-sky-500/10 border border-sky-500/30 px-1 py-0.5 text-[10px] font-bold text-sky-500">{t.region}</span>
                          : <span className="text-[10px] font-bold text-amber-500">unmapped</span>}
                      </td>
                      <td className="py-1.5 pr-3">{t.closerEligible ? <span className="text-emerald-500">✓</span> : <span className="text-zinc-400">—</span>}</td>
                      <td className="py-1.5 pr-3">{t.linkedUser ? <span className="text-emerald-500">✓ {(t.linkedUser as any)?.name ?? "linked"}</span> : <span className="text-zinc-400">—</span>}</td>
                      <td className="py-1.5 pr-3 text-right">
                        <button onClick={() => { setEditTarget(t); setRosterModalOpen(true); }} className="mr-2 text-[11px] font-bold text-sky-500 hover:underline">edit</button>
                        <button onClick={() => setDeleteTarget(t)} title="Soft delete" className="text-rose-500 hover:text-rose-400"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* History reset */}
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
            <h3 className="text-sm font-bold text-rose-500">History reset (founder-approved)</h3>
            <p className="text-[11px] text-zinc-500">
              Deletes every close-credit ledger row (both the 20% and the 80%, plus legacy swipe-close rows) and stamps an epoch — the board reads points only from that day on. Non-close history (call KPIs, comments, risk) is untouched.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={dryReset} disabled={resetBusy} className="rounded border border-rose-500/40 px-3 py-1.5 text-xs font-bold text-rose-500 disabled:opacity-50">{resetBusy ? "…" : "Preview count"}</button>
              {resetCounts !== null && <span className="text-xs font-semibold">{resetCounts} close rows would be purged.</span>}
              {resetCounts !== null && (
                <button onClick={runReset} disabled={resetBusy} className="rounded bg-rose-500 px-3 py-1.5 text-xs font-bold text-zinc-900 disabled:opacity-50">Reset NOW</button>
              )}
              {resetCounts !== null && <span className="text-[10px] text-zinc-400">One-time founder decision — irreversible.</span>}
            </div>
          </div>

          {/* Exports */}
          <div className="rounded-lg border border-zinc-300/40 dark:border-zinc-700 p-3">
            <h3 className="text-sm font-bold">Exports</h3>
            <p className="text-[11px] text-zinc-500">Daily breakdown uses the selected period filter; estimates CSV covers the last 30 days.</p>
            <div className="mt-2 flex gap-2">
              <button onClick={doExportDaily} disabled={loadingDaily} className="rounded border border-zinc-400/40 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{loadingDaily ? "…" : "⬇ Daily CSV"}</button>
              <button onClick={doExportEstimates} disabled={loadingEst} className="rounded border border-zinc-400/40 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{loadingEst ? "…" : "⬇ Estimates CSV"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Region pipeline drill-down modal ──────────────────────────────── */}
      {drillFor && (
        <div className={modalCls} onClick={(e) => { if (e.target === e.currentTarget) { setDrillForModal(null); setTagFilterState("ALL"); setCallbackDueBy(""); } }}>
          <div className={cardCls + " max-w-5xl"}>
            {(() => {
              const v = drillView;
              const a = v?.agent ?? null;
              return (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-zinc-300/40 dark:border-zinc-700 px-4 py-3">
                    <h3 className="text-sm font-bold">{a?.name ? `${a.name} — region pipeline` : "Region pipeline"}</h3>
                    {a?.region ? (
                      <span className="rounded bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 text-[10px] font-bold text-sky-500">{a.region} · {REGION_SHORT[a.region as RegionId] ?? ""}</span>
                    ) : (
                      <span className="rounded bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-500">no region yet</span>
                    )}
                    {a && (
                      <span className="text-[11px] text-zinc-500">
                        {a.points ?? 0} pts · {a.won ?? 0} won · {a.callsConnected ?? 0} calls · {a.leadsGenerated ?? 0} leads
                        {a?.regionOpen ? ` · region open: ${a.regionOpen.count} (${inr(a.regionOpen.value)})` : ""}
                      </span>
                    )}
                    <button onClick={() => { setDrillForModal(null); setTagFilterState("ALL"); }} className="ml-auto text-zinc-500 hover:text-rose-500 text-lg leading-none">✕</button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-300/30 dark:border-zinc-700/50 px-4 py-2">
                    <button
                      onClick={() => setTagFilterState("ALL")}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tagFilter === "ALL" ? "bg-amber-500 text-zinc-900" : "border border-zinc-400/40 text-zinc-500"}`}
                    >
                      All
                    </button>
                    {(["NO_ANSWER", "BUSY", "CALLBACK"] as CallTagValue[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTagFilterState(t)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tagFilter === t ? "bg-amber-500 text-zinc-900" : "border border-zinc-400/40 text-zinc-500"}`}
                      >
                        {CALL_TAG_META[t].label}
                      </button>
                    ))}
                    {tagFilter === "CALLBACK" && (
                      <input type="date" value={callbackDueBy} onChange={(ev) => setCallbackDueBy(ev.target.value)} placeholder="due by" className="rounded border border-zinc-400/40 bg-transparent px-1 py-0.5 text-[10px]" />
                    )}
                  </div>
                  <div className="max-h-[65vh] space-y-2 overflow-y-auto p-3">
                    {drillFollowUps.length === 0 && (
                      <p className="p-4 text-center text-xs text-zinc-500">
                        No open estimates in this region{tagFilter !== "ALL" ? " matching the filter" : ""}. New enquiries stamp their region automatically.
                      </p>
                    )}
                    {drillFollowUps.map((f) => (
                      <div key={f.estimateId} className="rounded border border-zinc-300/40 dark:border-zinc-700 p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold">{f.estimateNumber}</span>
                          <span className="text-xs text-zinc-500">{f.customerName}</span>
                          <span className="text-xs font-semibold text-emerald-500">{inr(f.total ?? 0)}</span>
                          <OrgBadge orgId={f.organizationId ?? null} orgs={orgs} />
                          <RiskChip risk={f.risk} compact />
                          <StaleChip staleHours={f.staleHours} compact />
                          <SatChip value={f.satisfactory} compact />
                          <span className="ml-auto text-[10px] text-zinc-400">total sort desc — biggest deals first</span>
                        </div>
                        {f.latestComment && (
                          <p
                            className="mt-1 line-clamp-2 text-[11px] text-zinc-500"
                            title={`${f.latestComment.commentedBy}: ${f.latestComment.text}`}
                          >
                            “{f.latestComment.text}”
                          </p>
                        )}
                        {f.staleReason && <p className="text-[10px] text-zinc-400">{f.staleReason}</p>}
                        <LeadChips f={f} />
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <CallTagControl f={f} onSaved={() => refreshAll()} onTag={applyTagOverride} compact />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modals */}
      <RosterModal open={rosterModalOpen} onClose={() => setRosterModalOpen(false)} row={editTarget} onSaved={refreshAll} />
      <CloserPickModal open={pickModalOpen} onClose={() => setPickModalOpen(false)} picks={pendingPicks} staffByRegion={staffByRegion} onSaved={refreshAll} />
      <UnmappedModal open={unmappedModalOpen} onClose={() => setUnmappedModalOpen(false)} bucket={unmapped} onSaved={refreshAll} />
      <ConfirmDialog
        open={!!deleteTarget}
        title={`Soft delete ${deleteTarget?.name ?? "staff"}?`}
        message="Hidden from the roster and leaderboard, restorable later. Their lead history stays."
        confirmLabel="Delete"
        onConfirm={() => deleteTarget && deleteRoster(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
