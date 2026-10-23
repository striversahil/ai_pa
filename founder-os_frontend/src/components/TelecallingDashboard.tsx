"use client";

import React, { Fragment, useState, useCallback, useEffect, useMemo } from "react";
import { Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useLiveQuery, useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";
import { TabBar } from "@/components/ui/TabBar";
import { KNOWN_ORG_LABELS } from "./zoho/orgs";
import { REGIONS, type RegionId } from "@/telecalling/regions";

interface LeaderRow {
  id: string;
  name: string;
  assignEstimateFollowUps: boolean;
  neodoveUserName: string | null;
  conversion: { assigned: number; won: number; conversionRate: number; pipelineValue: number; acceptedValue?: number; estimatedConversion: { count: number; value: number } };
  generation: {
    callsAttempted: number;
    callsConnected: number;
    callsNotConnected: number;
    incomingCalls: number;
    outgoingCalls: number;
    talkTimeSec: number;
    leadsConverted: number;
    leadsInProgress: number;
    leadsLost: number;
    leadsGenerated: number;
    followupLeads: number;
    connectedTarget: number;
    connectedPct: number;
    connectedStatus: "green" | "amber" | "red";
    leadsTarget: number;
    leadsPct: number;
    leadsStatus: "green" | "amber" | "red";
  };
  score: number;
  risk?: { atRisk: number; zombie: number };
  /** Region model: the staff's region ('' = unmapped). */
  region?: string;
  regionName?: string;
  /** Accepted points: full slab once per accepted deal in this lead region. */
  points?: number;
  /** Closed value credited to this staff (generator + closer). */
  closedValue?: number;
  wonGenerator?: number;
  wonCloser?: number;
  tlLevel?: string;
  /** Sales-roster type: 'telecaller' | 'field_staff'. */
  type?: string;
  /** Conversion specialist (eligible to be picked as the 80% closer). */
  closerEligible?: boolean;
}

interface RiskRow {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  telecallerId: string | null;
  telecallerName: string | null;
  total: number;
  risk: "ok" | "pending" | "red" | "zombie";
  lastCommentDate: string | null;
  staleHours: number | null;
  reasoning: string | null;
  snatchReason?: string | null;
  snatchInHours?: number | null;
  /** Zoho Books org (multi-org sync; null/'' = primary). */
  organizationId?: string | null;
}

/** Region card (payload `regions[]`) — sales are owned by regions, not agents. */
interface RegionInfo {
  id: string;
  name: string;
  tl: string;
  states: string[];
  leadsGenerated: number;
  won: { count: number; value: number };
  open: { count: number; value: number };
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  talkTimeSec: number;
  points: number;
  kra: { connectedTarget: number; connectedPct: number; connectedStatus: "green" | "amber" | "red"; leadsTarget: number; leadsPct: number; leadsStatus: "green" | "amber" | "red" };
  staff: LeaderRow[];
}

/** Converted estimate awaiting the sales-head's 80% closer pick. */
interface PendingPick {
  estimateId: string;
  estimateNumber?: string | null;
  customerName?: string | null;
  total?: number | null;
  region?: string | null;
  closeDay?: string | null;
  organizationId?: string | null;
}

/** Open estimate with no region ('' — link it so region ownership works). */
interface UnmappedItem {
  estimateId: string;
  estimateNumber?: string | null;
  customerName?: string | null;
  total?: number | null;
  generatedBy?: string | null;
  organizationId?: string | null;
  lastSync?: string | null;
}

interface UnmappedAcceptedItem {
  estimateId: string;
  estimateNumber?: string | null;
  customerName?: string | null;
  total?: number | null;
  status?: string | null;
  date?: string | null;
  generatedBy?: string | null;
  hasCreator?: boolean;
}

interface DashData {
  meta: { day: string; requestedDay?: string; usingLatestAvailable?: boolean; unassignedSent: number; activeCount: number; telecallerCount: number; generatedAt: string; period?: string; periodLabel?: string; periodFrom?: string | null; periodTo?: string | null; workingDays?: number; targets?: { connectedCallsPerDay: number; leadsPerAgentPerDay: number }; conversionTarget?: { perDay: number; goldPerDay: number; workingDays: number; target: number; gold: number; value: number; pct: number; status: "below" | "hit" | "gold" }; agents?: { id: string; name: string; active: boolean }[]; selfAgentId?: string | null; canManage?: boolean; taxonomy?: { id: string; name: string; tl: string; states: string[] }[]; epoch?: string | null; viewer?: { staffId: string | null; name: string | null; region: string | null; tlLevel: string | null } | null };
  kpi: { assigned: number; won: number; conversionRate: number; pipelineValue: number; acceptedValue?: number; callsConnected: number; leadsGenerated: number; talkTimeSec: number };
  leaderboard: LeaderRow[];
  recent: any[];
  /** Per-day × per-agent MIS breakdown (only when fetched with ?daily=1). */
  daily?: DailyRow[];
  dailyError?: string | null;
  /** Team-wide earned shields (red/zombie holdings protected today). */
  shielded?: Array<{ estimateId: string; estimateNumber: string; customerName: string; holderName: string | null; status: string; reason: string; n: number; spanH: number; streak: number }> | null;
  risk?: {
    counts: { open: number; ok: number; pending: number; red: number; zombie: number };
    valueAtRisk: number;
    atRisk: RiskRow[];
  };
  /** Region cards — the heart of the sales leaderboard. */
  regions?: RegionInfo[];
  /** Roster staff with no region yet (MIS should map them). */
  unmappedStaff?: LeaderRow[];
  /** Converted estimates awaiting the sales-head's closer pick (managers only). */
  pendingPicks?: PendingPick[];
  /** Unmapped open estimates (managers only). */
  unmapped?: { count: number; value: number; items: UnmappedItem[] } | null;
  /** Accepted estimates with no lead region (managers only). */
  unmappedAccepted?: { count: number; value: number; points: number; items: UnmappedAcceptedItem[] } | null;
  /** History reset epoch — points read only from this day onward. */
  epoch?: string | null;
}

/** One day × one telecaller of MIS detail (backend `daily` block, ?daily=1). */
interface DailyRow {
  date: string;
  weekday: string;
  telecallerId: string;
  telecallerName: string;
  assigned: number;
  won: number;
  closedValue: number;
  closedEstimates: string;
  declined: number;
  declinedValue: number;
  declinedEstimates: string;
  snatches: number;
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  talkTimeMin: number;
  leadsGenerated: number;
  leadsConverted: number;
  score: number;
}

interface FollowUp {  estimateId: string;
  estimateNumber: string | null;
  customerName: string | null;
  status: string | null;
  total: number | null;
  day: string;
  assignedAt: any;
  assignmentStatus: string;
  /** Verdict from the 15-min Zoho analyzer (Classification.meaningfulUpdate). */
  satisfactory?: boolean | null;
  intentScore?: number | null;
  analysisSummary?: string | null;
  lastCommentDate?: string | null;
  staleHours?: number | null;
  /** Most recent real sales note on THIS estimate (timestamp-ordered). */
  latestComment?: { text: string; commentedBy: string; dateFormatted: string | null } | null;
  risk?: "ok" | "pending" | "red" | "zombie";
  snatchReason?: string | null;
  snatchInHours?: number | null;
  /** Informational risk reason (region model — no EOD snatch). */
  staleReason?: string | null;
  /** Estimate region (R1–R4, '' = unmapped). */
  region?: string | null;
  /** Effort-shield verdict (present only on earned red/zombie rows). */
  shield?: { status: string; reason: string; n: number; spanH: number; streak: number } | null;
  /** Lead details from the matched enquiry (null when no enquiry exists). */
  enquiryNumber?: string | null;
  sourceLead?: string | null;
  location?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  clientCompany?: string | null;
  /** Originating agent (estimate creator) — "Lead of". */
  leadOf?: string | null;
  /** True once the GH runner captured at least one detail for this estimate. */
  detailsCaptured?: boolean | null;
  /** Terminal AI give-up: 10 capture turns with <3 fields. */
  detailsFailed?: boolean | null;
  /** Agent call-disposition tag: NO_ANSWER | BUSY | CALLBACK (null = untagged). */
  callTag?: "NO_ANSWER" | "BUSY" | "CALLBACK" | null;
  /** Follow-up date for CALLBACK (YYYY-MM-DD, max +10 days). */
  callbackDate?: string | null;
  /** Telecaller id that set the tag. */
  callTagBy?: string | null;
  /** Display name of the agent that set the tag. */
  callTagByName?: string | null;
  /** ISO timestamp of when the tag was set. */
  callTagAt?: string | null;
  /** Dated customer commitment (free text, set by holder/MIS). */
  nextStep?: string | null;
  /** Date the commitment is due (YYYY-MM-DD, max +30 days). */
  nextStepDate?: string | null;
  /** True when today's NeoDove effort on this customer shields the EOD −10. */
  effortShielded?: boolean | null;
  /** Zoho Books org (multi-org sync; null/'' = primary). */
  organizationId?: string | null;
}

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
      <span title={`Last comment ${days} days ago — zombie territory (silent > 3 days = reassigned)`} className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
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

/** Attention chip (region model): red = stale/unactioned, zombie = silent 3d+.
 *  Informational only — estimates stay in the region, nothing is re-poached. */
function SnatchChip({ risk, snatchInHours, compact = false }: { risk?: string | null; snatchInHours?: number | null; compact?: boolean }) {
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (risk === "zombie")
    return (
      <span title="Silent for over 3 days — dead weight on the board" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ☠{compact ? "" : " Zombie"}
      </span>
    );
  if (risk === "red")
    return (
      <span title="Unsatisfactory remark, or last update older than 24h — needs a call" className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ⚠{compact ? "" : " Needs update"}
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
      ✓{compact ? "" : " Updated"}
    </span>
  );
}

/** Effort-shield chip — the agent's visible proof of protection. Shown on
 *  red/zombie follow-ups the holder earned (3+ calls, 2h+ spread): the
 *  estimate stays with them today despite the unsatisfactory flag. */
function ShieldChip({ shield, compact = false }: {
  shield?: { status: string; reason: string; n: number; spanH: number; streak: number } | null;
  compact?: boolean;
}) {
  if (!shield) return null;
  const base = `inline-flex items-center gap-1 shrink-0 rounded-full border font-semibold ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"}`;
  if (shield.status === "expiring")
    return (
      <span title={`${shield.reason} — call and close it today`} className={`${base} bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30`}>
        ⏳{compact ? "" : " Shield ends today"}
      </span>
    );
  return (
    <span title={`${shield.reason} — stays with you, no re-poaching`} className={`${base} bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30`}>
      🛡{compact ? "" : ` Shield day ${(shield.streak ?? 0) + 1}/2 · ${shield.n} calls`}
    </span>
  );
}

/** Lead-details chips (POC / mobile / email / location / source / enquiry
 *  number / "Lead generated by") so the agent can call without switching
 *  views. "By" is the originating agent (creator), never the current holder. */
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

/** Agent call-disposition tags for a conversion follow-up: the sales team
 *  marks each estimate Not answering / Busy / Callback (+ follow-up date,
 *  max 10 days out). Saved per estimate via PUT /api/estimates/:id/call-tag. */
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

/** Local-model patch for one estimate's call tag (optimistic echo + live-event deltas). */
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
      // Reconcile the optimistic echo with exactly what the server committed
      // (the response echoes the stored tag). This covers rapid re-tags of the
      // same estimate resolving out of order — the last response wins, and
      // responses arrive in commit order.
      onTag?.(f.estimateId, {
        callTag: ((body?.callTag ?? tag) as CallTagValue | null) ?? null,
        callbackDate: ((body?.callbackDate ?? callbackDate) as string | null) ?? null,
      });
      onSaved();
    } catch (e: any) {
      // Revert the optimistic echo — never display a state the server rejected.
      onTag?.(f.estimateId, null);
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  // Optimistic echo (Sheets-style): paint the intended tag instantly, then
  // persist. A failed save reverts via save()'s catch above.
  const tap = (tag: CallTagValue | null, callbackDate: string | null) => {
    if (tag) onTag?.(f.estimateId, { callTag: tag, callbackDate });
    else onTag?.(f.estimateId, null);
    void save(tag, callbackDate);
  };

  const chipBase = `inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold ${compact ? "text-[10px]" : "text-[11px]"}`;

  // A tag is set — show it with who/when, plus change + clear.
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
          className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-50"
        >
          change
        </button>
        <button
          disabled={busy}
          onClick={() => tap(null, null)}
          title="Clear tag"
          className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 hover:text-rose-500 disabled:opacity-50"
        >
          ✕
        </button>
        {picking && (
          <span className="inline-flex items-center gap-1">
            {(Object.keys(CALL_TAG_META) as CallTagValue[]).map((t) => (
              <button
                key={t}
                disabled={busy}
                onClick={() => (t === "CALLBACK" ? setPicking("CALLBACK") : tap(t, null))}
                title={CALL_TAG_META[t].title}
                className={`${chipBase} ${picking === t ? CALL_TAG_META[t].cls : "text-zinc-500 dark:text-zinc-400 border-zinc-400/30 bg-zinc-500/5"} hover:opacity-80 disabled:opacity-50`}
              >
                <span>{CALL_TAG_META[t].icon}</span> {CALL_TAG_META[t].label}
              </button>
            ))}
          </span>
        )}
        {picking === "CALLBACK" && (
          <span className="inline-flex items-center gap-1">
            <input
              type="date"
              value={date}
              min={minDay}
              max={maxDay}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-900 dark:text-zinc-100"
            />
            <button
              disabled={busy || !date}
              onClick={() => tap("CALLBACK", date)}
              className="rounded-md bg-sky-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? "…" : "Save"}
            </button>
          </span>
        )}
        {err && <span className="text-[10px] text-rose-500">{err}</span>}
      </div>
    );
  }

  // Untagged — three quick tag buttons; CALLBACK opens the date picker.
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      {(Object.keys(CALL_TAG_META) as CallTagValue[]).map((t) => (
        <button
          key={t}
          disabled={busy}
          onClick={() => (t === "CALLBACK" ? (setDate(localIsoDay(1)), setPicking("CALLBACK")) : tap(t, null))}
          title={t === "CALLBACK" ? "Follow up on a fixed date (max 10 days out)" : CALL_TAG_META[t].title}
          className={`${chipBase} text-zinc-500 dark:text-zinc-400 border-zinc-400/30 bg-zinc-500/5 hover:opacity-80 disabled:opacity-50`}
        >
          <span>{CALL_TAG_META[t].icon}</span> {CALL_TAG_META[t].label}
        </button>
      ))}
      {picking === "CALLBACK" && (
        <span className="inline-flex items-center gap-1">
          <input
            type="date"
            value={date}
            min={minDay}
            max={maxDay}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-900 dark:text-zinc-100"
          />
          <button
            disabled={busy || !date}
            onClick={() => tap("CALLBACK", date)}
            className="rounded-md bg-sky-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? "…" : "Save"}
          </button>
          <button disabled={busy} onClick={() => setPicking(null)} className="text-[10px] text-zinc-500 hover:text-rose-500 disabled:opacity-50">
            ✕
          </button>
        </span>
      )}
      {err && <span className="text-[10px] text-rose-500">{err}</span>}
    </div>
  );
}

/** Dated next step (customer commitment) editor. While the date is today-or-
 *  future the estimate is protected from red-risk no matter the AI verdict;
 *  a past date reads red until chased. Region staff or MIS only
 *  (server-enforced); max 30 days out. */
function NextStepControl({ f, onSaved }: { f: FollowUp; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(() => f.nextStepDate ?? localIsoDay(1));
  const [note, setNote] = useState(() => f.nextStep ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const minDay = localIsoDay(0);
  const maxDay = localIsoDay(30);
  const chipBase = "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold text-[11px]";

  const save = async (d: string | null, n: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(f.estimateId)}/next-step`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: d, note: n }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Save failed (HTTP ${res.status})`);
      setEditing(false);
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (f.nextStepDate && !editing) {
    const overdue = f.nextStepDate < minDay;
    const dueToday = f.nextStepDate === minDay;
    return (
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <span
          title={overdue ? "Commitment date passed — red until chased" : "Customer commitment — protects this estimate from red-risk through this date"}
          className={`${chipBase} ${overdue ? "text-rose-500 dark:text-rose-400 border-rose-500/40 bg-rose-500/10" : "text-indigo-500 dark:text-indigo-400 border-indigo-500/40 bg-indigo-500/10"}`}
        >
          📌 {f.nextStepDate}{dueToday ? " · today" : ""}{overdue ? " · missed" : ""}
          {f.nextStep ? ` · ${f.nextStep}` : ""}
        </span>
        <button
          disabled={busy}
          onClick={() => { setDate(f.nextStepDate ?? localIsoDay(1)); setNote(f.nextStep ?? ""); setEditing(true); }}
          className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200 disabled:opacity-50"
        >
          change
        </button>
        <button
          disabled={busy}
          onClick={() => void save(null, null)}
          title="Clear next step"
          className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 hover:text-rose-500 disabled:opacity-50"
        >
          ✕
        </button>
        {err && <span className="text-[10px] text-rose-500">{err}</span>}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <button
          disabled={busy}
          onClick={() => { setDate(localIsoDay(1)); setNote(""); setEditing(true); }}
          title="Set a dated customer commitment — protects this estimate from red-risk through that date"
          className={`${chipBase} text-zinc-500 dark:text-zinc-400 border-dashed border-zinc-400/40 bg-zinc-500/5 hover:opacity-80 disabled:opacity-50`}
        >
          📌 + Next step
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      <input
        type="date"
        value={date}
        min={minDay}
        max={maxDay}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-900 dark:text-zinc-100"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Commitment (e.g. client confirms)"
        maxLength={200}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-900 dark:text-zinc-100 w-44"
      />
      <button
        disabled={busy || !date}
        onClick={() => void save(date, note.trim() || null)}
        className="rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? "…" : "Save"}
      </button>
      <button disabled={busy} onClick={() => setEditing(false)} className="text-[10px] text-zinc-500 hover:text-rose-500 disabled:opacity-50">
        ✕
      </button>
      {err && <span className="text-[10px] text-rose-500">{err}</span>}
    </div>
  );
}

interface AgentViewData {
  meta: { analysis: string; title: string; day: string; requestedDay?: string; usingLatestAvailable?: boolean; agents?: { id: string; name: string; active: boolean }[]; generatedAt: string; error?: string; region?: string; regionName?: string };
  agent: {
    id: string; name: string; active: boolean;
    conversion?: any; generation?: any;
    score: number; followUpCount: number;
    region?: string; tlLevel?: string;
    won?: number; points?: number; callsConnected?: number; leadsGenerated?: number;
    regionOpen?: { count: number; value: number };
  };
  followUps: FollowUp[];
}

interface RosterRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  assignEstimateFollowUps: boolean;
  absentSince: string | null;
  order: number;
  neodoveUserId: string | null;
  neodoveUserName: string | null;
  totalAssigned: number;
  activeAssigned: number;
  tlLevel?: string;
  region?: string;
  type?: string;
  closerEligible?: boolean;
  linkedUser?: { id: string; email: string; name: string; isRoot: boolean } | null;
}

type View = "dashboard" | "conversion" | "generation" | "controller";

// ── Region payload → legacy UI adapter ───────────────────────────────────────
// The backend is region-owned (20% generator automatic, 80% closer picked by
// the sales head). This dashboard keeps its pre-region visual language, so the
// payload is reshaped here into the shapes the JSX below already speaks —
// adapter only, no business logic duplicated.
function kraStatus(pct: number): TrafficLight {
  return pct >= 100 ? "green" : pct >= 60 ? "amber" : "red";
}

/** Cache key for a region drill: '' → "UNMAPPED". */
function regionKey(region: string | null | undefined): string {
  return region ? String(region) : "UNMAPPED";
}
/** Query value for the drill endpoint. */
function regionQuery(key: string): string {
  return key === "UNMAPPED" ? "unmapped" : key;
}

function adaptLeaderRow(s: any, region: any, targets: any): LeaderRow {
  const open = region?.open ?? { count: 0, value: 0 };
  const won = Number(s?.won ?? 0);
  const connectedTarget = Number(targets?.connectedCallsPerDay ?? 0);
  const leadsTarget = Number(targets?.leadsPerAgentPerDay ?? 0);
  const callsConnected = Number(s?.callsConnected ?? 0);
  const leadsGenerated = Number(s?.leadsGenerated ?? 0);
  const connectedPct = connectedTarget > 0 ? Math.round((callsConnected / connectedTarget) * 100) : 0;
  const leadsPct = leadsTarget > 0 ? Math.round((leadsGenerated / leadsTarget) * 100) : 0;
  const total = won + Number(open.count ?? 0);
  return {
    id: String(s?.id ?? ""),
    name: String(s?.name ?? ""),
    assignEstimateFollowUps: !!s?.closerEligible,
    neodoveUserName: null,
    conversion: {
      assigned: Number(open.count ?? 0),
      won,
      conversionRate: total > 0 ? Math.round((won / total) * 100) : 0,
      pipelineValue: Number(open.value ?? 0),
      acceptedValue: Number(s?.closedValue ?? 0),
      estimatedConversion: { count: 0, value: 0 },
    },
    generation: {
      callsAttempted: Number(s?.callsAttempted ?? 0),
      callsConnected,
      callsNotConnected: Number(s?.callsNotConnected ?? 0),
      incomingCalls: 0,
      outgoingCalls: 0,
      talkTimeSec: Number(s?.talkTimeSec ?? 0),
      leadsConverted: Number(s?.leadsConverted ?? 0),
      leadsInProgress: Number(s?.leadsInProgress ?? 0),
      leadsLost: Number(s?.leadsLost ?? 0),
      leadsGenerated,
      followupLeads: 0,
      connectedTarget,
      connectedPct,
      connectedStatus: kraStatus(connectedPct),
      leadsTarget,
      leadsPct,
      leadsStatus: kraStatus(leadsPct),
    },
    score: Number(s?.score ?? 0),
    risk: { atRisk: 0, zombie: 0 },
    region: String(s?.region ?? region?.id ?? ""),
    regionName: String(region?.name ?? (s?.region ? s.region : "Unmapped")),
    points: Number(s?.points ?? 0),
    closedValue: Number(s?.closedValue ?? 0),
    wonGenerator: Number(s?.wonGenerator ?? 0),
    wonCloser: Number(s?.wonCloser ?? 0),
    tlLevel: String(s?.tlLevel ?? ""),
    type: String(s?.type ?? "telecaller"),
    closerEligible: !!s?.closerEligible,
  };
}

function adaptDashData(d: any): DashData {
  const regions: RegionInfo[] = Array.isArray(d?.regions) ? d.regions : [];
  const targets = d?.meta?.targets ?? {};
  const leaderboard: LeaderRow[] = [];
  for (const r of regions) {
    for (const s of (r.staff ?? [])) leaderboard.push(adaptLeaderRow(s, r, targets));
  }
  for (const s of (d?.unmappedStaff ?? [])) leaderboard.push(adaptLeaderRow(s, null, targets));
  const kpi = d?.kpi ?? {};
  const openCount = regions.reduce((n: number, r) => n + Number(r.open?.count ?? 0), 0);
  const openValue = regions.reduce((n: number, r) => n + Number(r.open?.value ?? 0), 0);
  const won = Number(kpi.won ?? 0);
  const atRisk: RiskRow[] = (d?.risk?.atRisk ?? []).map((r: any) => ({
    estimateId: String(r.estimateId),
    estimateNumber: String(r.estimateNumber ?? ""),
    customerName: String(r.customerName ?? ""),
    telecallerId: r.generatorId ?? null,
    telecallerName: r.generatorName ?? null,
    total: Number(r.total ?? 0),
    risk: r.risk,
    lastCommentDate: r.lastCommentDate ?? null,
    staleHours: r.staleHours ?? null,
    reasoning: r.reasoning ?? null,
    snatchReason: r.staleReason ?? null,
    snatchInHours: null,
    organizationId: r.organizationId ?? null,
  }));
  return {
    meta: {
      ...(d?.meta ?? {}),
      day: String(d?.meta?.day ?? ""),
      generatedAt: String(d?.meta?.generatedAt ?? ""),
      unassignedSent: Number(d?.meta?.unmappedSentCount ?? d?.unmapped?.count ?? 0),
      activeCount: leaderboard.filter((r) => r.closerEligible).length,
      telecallerCount: Number(d?.meta?.telecallerCount ?? leaderboard.length),
      agents: (d?.meta?.staff ?? []).map((s: any) => ({ id: String(s.id), name: String(s.name ?? ""), active: !!s.active })),
      selfAgentId: d?.meta?.selfAgentId ?? null,
    },
    kpi: {
      assigned: openCount,
      won,
      conversionRate: won + openCount > 0 ? Math.round((won / (won + openCount)) * 100) : 0,
      pipelineValue: Number(kpi.pipelineValue ?? openValue),
      acceptedValue: Number(kpi.closedValue ?? 0),
      callsConnected: Number(kpi.callsConnected ?? 0),
      leadsGenerated: Number(kpi.leadsGenerated ?? 0),
      talkTimeSec: Number(kpi.talkTimeSec ?? 0),
    },
    leaderboard,
    recent: d?.recent ?? [],
    daily: Array.isArray(d?.daily)
      ? d.daily.map((r: any) => ({
          date: r.date, weekday: r.weekday, telecallerId: r.telecallerId, telecallerName: r.telecallerName,
          assigned: 0, won: Number(r.won ?? 0), closedValue: Number(r.closedValue ?? 0), closedEstimates: r.closedEstimates ?? "",
          declined: 0, declinedValue: 0, declinedEstimates: "", snatches: 0,
          callsAttempted: Number(r.callsAttempted ?? 0), callsConnected: Number(r.callsConnected ?? 0), callsNotConnected: Number(r.callsNotConnected ?? 0),
          talkTimeMin: Number(r.talkTimeMin ?? 0), leadsGenerated: Number(r.leadsGenerated ?? 0), leadsConverted: Number(r.leadsConverted ?? 0), score: Number(r.score ?? 0),
        }))
      : undefined,
    dailyError: d?.dailyError ?? null,
    shielded: null,
    risk: {
      counts: d?.risk?.counts ?? { open: 0, ok: 0, pending: 0, red: 0, zombie: 0 },
      valueAtRisk: Number(d?.risk?.valueAtRisk ?? 0),
      atRisk,
    },
    regions,
    unmappedStaff: (d?.unmappedStaff ?? []).map((s: any) => adaptLeaderRow(s, null, targets)),
    pendingPicks: d?.pendingPicks ?? [],
    unmapped: d?.unmapped ?? null,
    unmappedAccepted: d?.unmappedAccepted ?? null,
    epoch: d?.meta?.epoch ?? null,
  };
}

function adaptAgentView(v: any): AgentViewData {
  const a = v?.agent ?? {};
  return {
    ...(v ?? {}),
    agent: {
      ...a,
      active: true,
      conversion: {
        assigned: Number(a?.regionOpen?.count ?? 0),
        won: Number(a?.won ?? 0),
        conversionRate: 0,
        pipelineValue: Number(a?.regionOpen?.value ?? 0),
        acceptedValue: 0,
        estimatedConversion: { count: 0, value: 0 },
      },
      generation: {
        callsAttempted: 0, callsConnected: Number(a?.callsConnected ?? 0), callsNotConnected: 0,
        incomingCalls: 0, outgoingCalls: 0, talkTimeSec: 0,
        leadsConverted: 0, leadsInProgress: 0, leadsLost: 0, leadsGenerated: Number(a?.leadsGenerated ?? 0),
        followupLeads: 0, connectedTarget: 0, connectedPct: 0, connectedStatus: "green" as TrafficLight,
        leadsTarget: 0, leadsPct: 0, leadsStatus: "green" as TrafficLight,
      },
      score: Number(a?.points ?? 0),
      followUpCount: Number(a?.followUpCount ?? (v?.followUps?.length ?? 0)),
    },
    followUps: v?.followUps ?? [],
  };
}


/** Live events that refresh telecalling views: explicit telecalling/automation
 *  broadcasts PLUS the Zoho estimate writes the risk model derives from
 *  (comments/status/classification → `estimates`, baseline freeze → `baseline`).
 *  Narrower than unfiltered (ignores chat/data-changed noise), wider than
 *  telecalling-only (which missed those upstream writes). */
const TELECALLING_EVENTS = ["automation", "telecalling", "estimates", "baseline"];

const TABS: { key: View; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "conversion", label: "Lead Conversion", icon: "📨" },
  { key: "generation", label: "Lead Generation", icon: "📞" },
  // MIS-only controller tab (filtered out of the nav without the `mis` scope).
  { key: "controller", label: "Controller", icon: "🎛️" },
];

function fmtTalk(sec: number): string {
  if (!sec) return "—";
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtNum(n: number): string {
  return n === 0 ? "0" : n.toLocaleString();
}

// "500000" → "₹5.0L", "10000000" → "₹1.0Cr" (compact target labels).
function fmtLakh(n: number): string {
  if (!n) return "₹0";
  if (n >= 10000000) {
    const v = n / 10000000;
    return `₹${Number.isInteger(v) ? v : v.toFixed(1)}Cr`;
  }
  if (n >= 100000) {
    const v = n / 100000;
    return `₹${Number.isInteger(v) ? v : v.toFixed(1)}L`;
  }
  return `₹${Math.round(n).toLocaleString()}`;
}

// Accepted-₹ celebration tier for the Est. Conv ₹ KPI card.
// below = default · hit (≥ target) = emerald glow + pulse · gold (≥ gold) = gold gradient + shimmer.
function convTier(
  value: number,
  target?: { target: number; gold: number; status: "below" | "hit" | "gold" } | null,
): { status: "below" | "hit" | "gold"; target: number; gold: number } {
  const t = target?.target ?? 500000;
  const g = target?.gold ?? 1000000;
  const status = target?.status ?? (value >= g ? "gold" : value >= t ? "hit" : "below");
  return { status, target: t, gold: g };
}

// "2026-09-07" → "7 Sep" (short, human-friendly). Tolerates a missing/partial
// date by returning the raw string unchanged.
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, , mo, d] = m;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${MONTHS[Number(mo) - 1] ?? mo}`;
}

const LIGHT_TEXT: Record<string, string> = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-rose-400",
};
const LIGHT_BG: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};
const LIGHT_CHIP: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

type TrafficLight = "green" | "amber" | "red";

function worst(a: TrafficLight, b: TrafficLight): TrafficLight {
  if (a === "red" || b === "red") return "red";
  if (a === "amber" || b === "amber") return "amber";
  return "green";
}
const OVERALL_LABEL: Record<TrafficLight, string> = {
  green: "On Track",
  amber: "At Risk",
  red: "Behind",
};

function KraBar({ label, value, target, pct, status }: { label: string; value: number; target: number; pct: number; status: TrafficLight }) {
  const width = Math.min(100, pct);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-zinc-500 dark:text-zinc-400 font-semibold">{label}</span>
        <span className={`font-bold font-mono ${LIGHT_TEXT[status]}`}>
          {value}/{target} · {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div className={`h-full rounded-full ${LIGHT_BG[status]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function TelecallingDashboard() {
  const [view, setView] = useState<View>("dashboard");
  const { me } = useAuth();
  const [period, setPeriod] = useState<"today" | "week" | "lastweek" | "month" | "lastmonth" | "year" | "lastyear">("week");
  const PERIOD_OPTIONS: { key: typeof period; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "lastweek", label: "Last Week" },
    { key: "month", label: "This Month" },
    { key: "lastmonth", label: "Last Month" },
    { key: "year", label: "This Year" },
    { key: "lastyear", label: "Last Year" },
  ];
  // Roster is the assignment controller — visible/editable only with the
  // `mis` scope (root/admin always allowed).
  const canManageRoster = !!me && (me.isAdmin || me.scopes.includes("mis") || me.scopes.includes("sales-head"));

  const dash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch(`/api/automations/telecalling/data?period=${period}`);
      if (!res.ok) throw new Error(`Failed to load leaderboard (HTTP ${res.status})`);
      return adaptDashData(await res.json());
    },
    { events: TELECALLING_EVENTS, deps: [period], clearOnError: true },
  );

  // Lead Conversion is the default view with no period filtering — it hits the
  // plain dashboard endpoint (no ?period=) and stays independent of the
  // Dashboard's filter.
  const convDash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch("/api/automations/telecalling/data");
      if (!res.ok) throw new Error("Conversion load failed");
      return adaptDashData(await res.json());
    },
    { events: TELECALLING_EVENTS, clearOnError: true },
  );

  // Lead Generation has its OWN period filter — independent of the leaderboard
  // period, so filtering the dashboard/conversion never changes the Generation
  // view. Same endpoint, different period param.
  const [genPeriod, setGenPeriod] = useState<typeof period>("today");
  const genDash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch(`/api/automations/telecalling/data?period=${genPeriod}`);
      if (!res.ok) throw new Error("Gen load failed");
      return adaptDashData(await res.json());
    },
    { events: TELECALLING_EVENTS, deps: [genPeriod], clearOnError: true },
  );

  const roster = useLiveQuery<{ telecallers: RosterRow[] }>(
    async () => {
      if (!canManageRoster) return { telecallers: [] };
      const res = await fetch("/api/telecallers");
      if (!res.ok) throw new Error("load failed");
      return res.json();
    },
    { events: TELECALLING_EVENTS },
  );

  const [editTarget, setEditTarget] = useState<RosterRow | null>(null);
  const [rosterModalOpen, setRosterModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<"score" | "won" | "callsConnected" | "leadsGenerated">("score");
  const [regionFilter, setRegionFilter] = useState<string | null>(null);
  // Dashboard leaderboard scope: "ALL" | R1–R4 | "UNMAPPED".
  const [regionPick, setRegionPick] = useState<string>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Call-tag filters (Sheets-style): Not answering / Busy / Callback (+ due-by
  // date for callbacks). Pure client-side over the loaded follow-ups.
  const [tagFilter, setTagFilter] = useState<"ALL" | CallTagValue>("ALL");
  const [callbackDueBy, setCallbackDueBy] = useState<string>("");

  // A scoped (non-manager) sales agent is locked to their OWN region: the
  // conversion view always opens on their region and they cannot switch tabs.
  const selfAgentId = dash.data?.meta?.selfAgentId ?? convDash.data?.meta?.selfAgentId ?? null;
  const selfRegion = dash.data?.meta?.viewer?.region ?? convDash.data?.meta?.viewer?.region ?? "";
  useEffect(() => {
    if (selfAgentId) setRegionFilter(regionKey(selfRegion));
  }, [selfAgentId, selfRegion]);

  // ── MIS estimate assignment overrides (lock to one agent / never assign) ──
  const [overrideBusy, setOverrideBusy] = useState(false);

  // Prefetch EVERY region's pipeline in parallel (one round of requests),
  // refreshed on live events. Switching region tabs then reads from the local
  // map — instant, and it never shows another region's stale data while
  // loading. Region keys: R1–R4 (+ UNMAPPED for managers).
  const activeRegionKeys = (convDash.data?.regions ?? dash.data?.regions ?? [])
    .map((r) => r.id);
  if ((convDash.data?.unmapped?.items?.length ?? 0) > 0) activeRegionKeys.push("UNMAPPED");
  // A scoped (non-manager) agent only ever sees their OWN region — prefetch
  // just that key, never every region.
  const regionKeysKey = selfAgentId ? regionKey(selfRegion) : activeRegionKeys.join(",");
  const agentViews = useLiveQuery<Record<string, AgentViewData | null>>(
    async () => {
      if (!regionKeysKey) return {};
      const keys = regionKeysKey.split(",");
      const entries = await Promise.all(
        keys.map(async (key) => {
          try {
            const res = await fetch(`/api/automations/telecalling/data?region=${encodeURIComponent(regionQuery(key))}`);
            return [key, res.ok ? adaptAgentView(await res.json()) : null] as const;
          } catch {
            return [key, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    { events: TELECALLING_EVENTS, deps: [regionKeysKey], clearOnError: true },
  );
  // ── Sheets-style instant tags ──────────────────────────────────────────
  // The backend pushes the changed row INSIDE the telecalling live event
  // (delta, not a full refetch — same idea as Sheets cell ops over one
  // socket), and a tag tap applies locally on click (optimistic echo). This
  // override map is the local model patch: event deltas + own taps land here
  // in milliseconds. The debounced refetch (whose rows carry server-overlaid
  // fresh tags) reconciles and clears it — a failed save reverts + shows the
  // error instead of lying.
  const [tagOverrides, setTagOverrides] = useState<Record<string, CallTagDelta>>({});
  // NOTE: overrides are deliberately NEVER bulk-cleared on refetch. Clearing
  // them on every agentViews.data change caused the production bug where rapid
  // taps appeared to shift/vanish: overlapping single-agent refreshes resolve
  // out of order, and a stale (older-read) response arriving last overwrote
  // newer taps after the wipe removed their protection. An override can only
  // ever equal confirmed server state, because: (a) a tap writes the override
  // and the PUT commits before any refresh reads; a failed PUT removes its
  // override in save()'s catch; (b) any other tab/user's change arrives as a
  // live tag delta that overwrites the override; (c) tags are sticky
  // server-side (engines never clear them), so a persisted override cannot
  // shadow a newer server state. A stale refresh is therefore always
  // corrected by the override, never the other way round.
  useLiveEvent((e) => {
    // Tag deltas arrive as their own "telecalling-tag" type precisely so they
    // do NOT match TELECALLING_EVENTS (no ~20-request refetch storm — the
    // delta patch below is the whole update). The legacy "telecalling" match
    // covers the brief window where the backend ships ahead of this bundle.
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
  /**
   * Reconcile ONE agent's view after a tag save (1 request) instead of
   * re-fetching every agent. The optimistic override already painted the tap;
   * this confirms server state (setter name, timestamp) without the storm.
   */
  const refreshOneAgent = useCallback(async (key: string | null) => {
    if (!key) { agentViews.refresh(); return; }
    try {
      const res = await fetch(`/api/automations/telecalling/data?region=${encodeURIComponent(regionQuery(key))}`);
      if (!res.ok) return;
      const view = adaptAgentView(await res.json());
      agentViews.setData((prev) => ({ ...(prev ?? {}), [key]: view }));
    } catch { /* override patch already shows the tap; next event refetch reconciles */ }
  }, [agentViews]);
  const agentViewsMap = useMemo(() => {
    const src = agentViews.data ?? {};
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
  }, [agentViews.data, tagOverrides]);
  const getAgentView = (key: string | null): AgentViewData | null => (key ? agentViewsMap[key] ?? null : null);
  const selectedAgentView = getAgentView(regionFilter);
  // No-pickup subset of the selected agent's follow-ups (NeoDove dial outcome).
  const convFollowUps = selectedAgentView?.followUps ?? [];
  // Call-tag filter counts ( Sheets-style quick filters over the same rows).
  const tagCounts = useMemo(() => {
    const c: Record<CallTagValue, number> = { NO_ANSWER: 0, BUSY: 0, CALLBACK: 0 };
    for (const f of convFollowUps) {
      const t = (f.callTag ?? null) as CallTagValue | null;
      if (t && c[t] !== undefined) c[t] += 1;
    }
    return c;
  }, [convFollowUps]);
  const filtersActive = tagFilter !== "ALL";
  const visibleFollowUps = convFollowUps.filter((f) => {
    if (tagFilter !== "ALL") {
      if ((f.callTag ?? null) !== tagFilter) return false;
      if (tagFilter === "CALLBACK" && callbackDueBy && (f.callbackDate ?? "") > callbackDueBy) return false;
    }
    return true;
  });
  // Distinct Zoho orgs across the loaded follow-ups + at-risk rows. The org
  // badges render only when 2+ orgs are present (single-org = today's view).
  const teleOrgs = useMemo(() => {
    const set = new Set<string>();
    for (const v of Object.values(agentViews.data ?? {})) {
      for (const f of v?.followUps ?? []) {
        if (f?.organizationId) set.add(String(f.organizationId));
      }
    }
    for (const r of dash.data?.risk?.atRisk ?? []) {
      if ((r as any)?.organizationId) set.add(String((r as any).organizationId));
    }
    return [...set].sort();
  }, [agentViews.data, dash.data]);

  const refreshAll = useCallback(() => {
    dash.refresh();
    convDash.refresh();
    genDash.refresh();
    agentViews.refresh();
    roster.refresh();
  }, [dash, convDash, genDash, agentViews, roster]);

  // ── Deleted agents (MIS Controller) ──────────────────────────────────────
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedRows, setDeletedRows] = useState<RosterRow[]>([]);
  const loadDeleted = useCallback(async () => {
    if (!canManageRoster) return;
    try {
      const res = await fetch("/api/telecallers?deleted=1");
      if (res.ok) setDeletedRows((await res.json()).telecallers ?? []);
    } catch { /* ignore */ }
  }, [canManageRoster]);
  useEffect(() => {
    if (showDeleted) void loadDeleted();
  }, [showDeleted, loadDeleted]);
  const deleteTelecaller = async (id: string) => {
    setBusy(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/telecallers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Delete failed (${res.status})`);
      }
      refreshAll();
      void loadDeleted();
    } catch (e: any) {
      setRosterError(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };
  // Pretty in-house confirm (replaces window.confirm) for roster deletion.
  const [confirmDelete, setConfirmDelete] = useState<RosterRow | null>(null);
  const restoreTelecaller = async (id: string) => {
    setBusy(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/telecallers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleted: false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Restore failed (${res.status})`);
      }
      refreshAll();
      void loadDeleted();
    } catch (e: any) {
      setRosterError(e?.message ?? "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  // Add/edit agent from the modal — contact + role only, never NeoDove mapping.
  const saveRoster = async (updates: { name: string; email: string; phone: string; whatsapp: string; assignEstimateFollowUps: boolean; region: string; tlLevel: string; type: string }) => {
    if (!updates.name.trim()) return;
    setBusy(true);
    setRosterError(null);
    try {
      const payload: Record<string, unknown> = {
        name: updates.name,
        email: updates.email || null,
        phone: updates.phone || null,
        whatsapp: updates.whatsapp || null,
        assignEstimateFollowUps: updates.assignEstimateFollowUps,
        region: updates.region,
        tlLevel: updates.tlLevel,
        type: updates.type,
      };
      const res = editTarget
        ? await fetch(`/api/telecallers/${editTarget.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/telecallers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      setEditTarget(null);
      setRosterModalOpen(false);
      refreshAll();
    } catch (e: any) {
      setRosterError(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleFollowUps = async (id: string, assignEstimateFollowUps: boolean) => {
    setBusy(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/telecallers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignEstimateFollowUps: !assignEstimateFollowUps }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Update failed (${res.status})`);
      }
      refreshAll();
    } catch (e: any) {
      setRosterError(e?.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  };

  // Risk is informational in the region model (red/zombie + stale next step
  // surface as attention flags; nothing is re-poached at EOD anymore).
  const showRisk = true;

  const kpi = dash.data?.kpi;
  const board = [...(dash.data?.leaderboard ?? [])];
  const activeBoard = board;
  // Lead Conversion board — driven by ITS OWN convDash/period, not the dashboard.
  const convBoard = [...(convDash.data?.leaderboard ?? [])];
  const convActiveBoard = convBoard;
  // Lead Generation board — driven by its OWN genDash/period, not the leaderboard period.
  const genBoard = [...(genDash.data?.leaderboard ?? [])];
  const genActiveBoard = genBoard;
  // Region cards drive the Lead Conversion tabs (R1–R4 + Unmapped for managers).
  const regionBoard = convDash.data?.regions ?? dash.data?.regions ?? [];
  const unmappedBlock = convDash.data?.unmapped ?? dash.data?.unmapped ?? null;
  const pendingPicks = dash.data?.pendingPicks ?? [];
  // Est. Conv ₹ = ACCEPTED actuals in the selected period. Prefers the
  // server-side team total so it matches meta.conversionTarget.value exactly.
  const teamAccepted = kpi?.acceptedValue ?? activeBoard.reduce((s, r) => s + (r.conversion.acceptedValue ?? 0), 0);
  const conv = convTier(teamAccepted, dash.data?.meta?.conversionTarget ?? null);
  // Region performance — dashboard period, regions own the estimates. The
  // 20% generator + 80% closer credits roll up into the region totals.
  const dashRegions = dash.data?.regions ?? [];
  const regionSorted = [...dashRegions].sort((a, b) => b.points - a.points || b.won.value - a.won.value || b.open.value - a.open.value);
  const regionTopPoints = regionSorted[0]?.points ?? 0;
  const regionLeader = regionSorted[0]?.id ?? null;
  // Individual performance — optionally scoped to one region (or Unmapped).
  const scopedBoard = regionPick === "ALL" ? activeBoard : activeBoard.filter((r) => regionKey(r.region) === regionPick);
  const sorted = [...scopedBoard].sort((a, b) => {
    if (sortKey === "score") return b.score - a.score;
    if (sortKey === "won") return b.conversion.won - a.conversion.won;
    if (sortKey === "callsConnected") return b.generation.callsConnected - a.generation.callsConnected;
    return b.generation.leadsGenerated - a.generation.leadsGenerated;
  });

  const rosterRows: RosterRow[] = roster.data?.telecallers ?? [];
  const leaderScore = sorted[0]?.score ?? 0;

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete ${confirmDelete?.name ?? "telecaller"}?`}
        message="They disappear from the roster, leaderboard and assignment engine. You can restore them anytime from Deleted Agents in the Controller."
        confirmLabel="Delete agent"
        busy={busy}
        onConfirm={() => { const id = confirmDelete?.id; setConfirmDelete(null); if (id) void deleteTelecaller(id); }}
        onCancel={() => setConfirmDelete(null)}
      />
      {/* Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-zinc-50 via-white to-indigo-50/60 dark:from-zinc-900 dark:via-zinc-950 dark:to-indigo-950/40 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6">
        {/* subtle decorative glow */}
        <div className="pointer-events-none absolute -top-16 -right-16 w-56 h-56 rounded-full bg-indigo-500/10 dark:bg-indigo-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-emerald-500/5 dark:bg-emerald-500/10 blur-3xl" />

        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25 shrink-0">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                  <path d="M15 5a6 6 0 0 1 4 4" />
                  <path d="M15 9a2 2 0 0 1 2 2" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold font-heading text-zinc-900 dark:text-white tracking-tight">
                  Telecalling
                </h1>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Daily performance · Lead Conversion (estimates) + Lead Generation (enquiries, live)
                  {dash.data?.meta?.usingLatestAvailable ? (
                    <span className="ml-1 text-amber-400/90">
                      (today's NeoDove push is empty — showing latest available day)
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(dash.loading || genDash.loading) && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-500 dark:text-indigo-300 shadow-sm" role="status" aria-live="polite">
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                </svg>
                Refreshing…
              </span>
            )}
            {dash.data?.meta?.day ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 shadow-sm">
                <svg className="w-3.5 h-3.5 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                {dash.data.meta.day}
              </span>
            ) : null}
            {dash.data?.meta?.activeCount !== undefined && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                {dash.data.meta.activeCount} follow-up specialists
              </span>
            )}
            {dash.data?.meta?.telecallerCount !== undefined && dash.data.meta.telecallerCount !== dash.data.meta.activeCount && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 shadow-sm">
                {dash.data.meta.telecallerCount} total
              </span>
            )}
            {(dash.data?.meta as any)?.unattributedLeads > 0 && (
              <span title="Enquiries with no roster match — MIS should fix attribution" className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400 shadow-sm">
                {(dash.data?.meta as any).unattributedLeads} unattributed leads
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Tabs (full-width horizontal row) */}
        <aside className="w-full shrink-0">
          <TabBar
            items={TABS.filter((t) => t.key !== "controller" || canManageRoster)}
            active={view}
            onChange={setView}
          />
        </aside>

        {/* Content (seamless switch — queries stay mounted) */}
        <div className="flex-1 min-w-0">
          {view === "dashboard" && (
            <div className="space-y-6">
              {kpi && (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 relative">
                  <style>{`@keyframes fosGoldShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } } @keyframes fosGlowPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.45); } 50% { box-shadow: 0 0 18px 2px rgba(16,185,129,0.35); } } .fos-glow-pulse { animation: fosGlowPulse 2s ease-in-out infinite; } .fos-gold-text { background: linear-gradient(100deg, #b45309 20%, #fbbf24 40%, #fef3c7 50%, #fbbf24 60%, #b45309 80%); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent; animation: fosGoldShimmer 2.5s linear infinite; }`}</style>
                  {dash.loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/50 dark:bg-zinc-950/50 backdrop-blur-[1px]" aria-hidden="true">
                      <svg className="animate-spin w-6 h-6 text-indigo-500" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                      </svg>
                    </div>
                  )}
                  {[
                    { label: "Est. Won", value: fmtNum(kpi.won), accent: "text-emerald-400" },
                    { label: "Calls Connected", value: fmtNum(kpi.callsConnected), accent: "text-emerald-300" },
                    { label: "Leads Generated", value: fmtNum(kpi.leadsGenerated), accent: "text-amber-300" },
                    { label: "Talk Time", value: fmtTalk(kpi.talkTimeSec), accent: "text-indigo-300" },
                  ].map((k) => (
                    <div key={k.label} className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-600 dark:text-zinc-500 font-bold">{k.label}</div>
                      <div className={`text-2xl font-extrabold mt-1 ${k.accent}`}>{k.value}</div>
                    </div>
                  ))}
                  {/* Est. Conv ₹ — accepted actuals with target/gold celebration */}
                  <div
                    title={`Accepted estimates total in ${dash.data?.meta?.periodLabel ?? "this period"} — target ${fmtLakh(conv.target)} · gold ${fmtLakh(conv.gold)}`}
                    className={`col-span-2 md:col-span-1 rounded-xl p-4 border ${conv.status === "gold"
                      ? "bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-100 dark:from-amber-950/60 dark:via-yellow-950/40 dark:to-amber-900/40 border-amber-400/60 dark:border-amber-400/50 fos-glow-pulse"
                      : conv.status === "hit"
                        ? "bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-400/50 fos-glow-pulse"
                        : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
                      }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-zinc-600 dark:text-zinc-500 font-bold">
                      Est. Conv ₹ {conv.status === "gold" ? "👑" : conv.status === "hit" ? "🎉" : ""}
                    </div>
                    <div className={`text-2xl font-extrabold mt-1 ${conv.status === "gold" ? "fos-gold-text" : conv.status === "hit" ? "text-emerald-400 animate-pulse" : "text-indigo-300"}`}>
                      {fmtNum(teamAccepted)}
                    </div>
                    <div className="text-[11px] mt-1 font-semibold text-zinc-500 dark:text-zinc-400">
                      Target {fmtLakh(conv.target)} · Gold {fmtLakh(conv.gold)}
                    </div>
                  </div>
                </div>
              )}

              {/* Region performance — the sales board's first cut: regions own
                  the estimates, staff earn generator/closer credits inside them. */}
              <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-lg font-bold">🏅 Region performance — {dash.data?.meta?.periodLabel ?? "Today"}</h3>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      Ranked by accepted points. Each accepted deal's full slab counts once in the lead creator's region — individual 20/80 credits are separate.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">{dashRegions.length} regions</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-zinc-500 dark:text-zinc-400 text-xs uppercase">
                      <tr className="border-b border-zinc-200 dark:border-zinc-800">
                        <th className="text-left py-2 pr-3">#</th>
                        <th className="text-left py-2 pr-4 min-w-[12rem]">Region</th>
                        <th className="text-right py-2 pr-4">Staff</th>
                        <th className="text-right py-2 pr-4">Won</th>
                        <th className="text-right py-2 pr-4">Won ₹</th>
                        <th className="text-right py-2 pr-4">Open ₹</th>
                        <th className="text-right py-2 pr-4">Calls</th>
                        <th className="text-right py-2 pr-4">Leads</th>
                        <th className="text-right py-2 pr-4 whitespace-nowrap min-w-[9rem]">Points</th>
                        <th className="text-right py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {regionSorted.map((r, i) => {
                        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                        const pct = regionTopPoints > 0 ? Math.round((r.points / regionTopPoints) * 100) : 0;
                        return (
                          <tr key={r.id} className={`border-b border-zinc-100 dark:border-zinc-800/60 ${i === 0 ? "bg-amber-500/10" : ""}`}>
                            <td className="py-2 pr-3 font-bold text-lg">{medal ?? i + 1}</td>
                            <td className="py-2 pr-4">
                              <button
                                onClick={() => { setRegionFilter(r.id); setView("conversion"); }}
                                className="text-left font-semibold text-zinc-900 dark:text-white hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                                title={`Open ${r.name} follow-ups`}
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-500 dark:text-indigo-300">{r.id}</span>
                                  {r.name}
                                </span>
                                <span className="block text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{r.tl} · {r.states.slice(0, 3).join(", ")}{r.states.length > 3 ? "…" : ""}</span>
                              </button>
                            </td>
                            <td className="py-2 pr-4 text-right font-mono text-zinc-600 dark:text-zinc-400">{r.staff.length}</td>
                            <td className="py-2 pr-4 text-right font-mono text-emerald-400">{r.won.count}</td>
                            <td className="py-2 pr-4 text-right font-mono text-emerald-400 whitespace-nowrap">₹{fmtNum(r.won.value)}</td>
                            <td className="py-2 pr-4 text-right font-mono text-zinc-600 dark:text-zinc-300 whitespace-nowrap">₹{fmtNum(r.open.value)}</td>
                            <td className="py-2 pr-4 text-right font-mono" title={`${r.callsConnected}/${r.kra.connectedTarget} connected calls`}>
                              <span className={LIGHT_TEXT[r.kra.connectedStatus]}>{fmtNum(r.callsConnected)}</span>
                            </td>
                            <td className="py-2 pr-4 text-right font-mono" title={`${r.leadsGenerated}/${r.kra.leadsTarget} leads generated`}>
                              <span className={LIGHT_TEXT[r.kra.leadsStatus]}>{fmtNum(r.leadsGenerated)}</span>
                            </td>
                            <td className="py-2 pr-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-2">
                                <span title="Full accepted slab for deals whose lead creator belongs to this region" className="font-extrabold text-indigo-300 font-mono">{fmtNum(r.points)}</span>
                                {regionTopPoints > 0 && (
                                  <span className="hidden sm:inline-block w-16 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden" title={`${pct}% of the leading region`}>
                                    <span className={`block h-full rounded-full ${r.id === regionLeader ? "bg-amber-400" : "bg-indigo-400"}`} style={{ width: `${Math.max(6, pct)}%` }} />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 text-right">
                              <button
                                onClick={() => { setRegionFilter(r.id); setView("conversion"); }}
                                className="text-[11px] font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 hover:border-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                              >
                                Follow-ups →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {regionSorted.length === 0 && (
                        <tr><td colSpan={10} className="py-4 text-center text-zinc-500">No regions loaded.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {(unmappedBlock?.count ?? 0) > 0 && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      Unmapped: {unmappedBlock?.count ?? 0} open estimates · ₹{fmtNum(unmappedBlock?.value ?? 0)} outside any region
                    </span>
                    <button
                      onClick={() => {
                        if ((dash.data?.unmappedStaff?.length ?? 0) > 0) setRegionPick("UNMAPPED");
                        else { setRegionFilter("UNMAPPED"); setView("conversion"); }
                      }}
                      className="text-[11px] font-bold text-amber-700 dark:text-amber-400 underline underline-offset-2"
                    >
                      {(dash.data?.unmappedStaff?.length ?? 0) > 0 ? "Show unmapped staff" : "Open unmapped estimates →"}
                    </button>
                  </div>
                )}
              </section>

              {/* Leaderboard */}
              {Boolean(dash.error) && !dash.loading && (
                <QueryErrorBanner message={String((dash.error as any)?.message ?? dash.error)} onRetry={() => dash.refresh()} />
              )}
              <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-lg font-bold">🏆 Individual leaderboard — {dash.data?.meta?.periodLabel ?? "Today"}</h3>
                    {/* Scoring criteria — the composite score is the ranking norm. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                      <span title="Close points by estimate value: ₹0–1L → +50 · ₹1L–2.5L → +75 · ₹2.5L–5L → +100 · ₹5L and above → +200" className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-400">
                        Close <span className="font-mono">+50–200</span>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-bold text-amber-400">
                        1 lead <span className="font-mono">+15</span>
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-bold text-indigo-300">
                        1 call <span className="font-mono">+0.5</span>
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {dash.data?.meta?.periodFrom && dash.data.meta.periodTo && (
                      <div
                        className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 shadow-sm"
                        title={`${dash.data.meta.periodFrom} → ${dash.data.meta.periodTo}`}
                      >
                        <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 font-mono">
                          {fmtDate(dash.data.meta.periodFrom)} → {fmtDate(dash.data.meta.periodTo)}
                        </span>
                        {dash.data.meta.periodTo !== dash.data.meta.periodFrom && (
                          <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-500 dark:text-indigo-300">
                            {dash.data.meta.workingDays ?? "—"} days
                          </span>
                        )}
                      </div>
                    )}
                    {/* ⓘ rules — hover for the full game in simple English */}
                    <div className="relative group inline-flex">
                      <button
                        type="button"
                        aria-label="Game rules"
                        title="Game rules"
                        className="w-9 h-9 rounded-full border-2 border-indigo-400/60 bg-indigo-500/10 text-indigo-400 text-base font-bold leading-none inline-flex items-center justify-center hover:bg-indigo-500/20 hover:border-indigo-400 transition-colors"
                      >
                        i
                      </button>
                      <div className="absolute right-0 top-10 z-30 hidden group-hover:block w-80 md:w-96">
                        <div className="rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 shadow-xl p-4 text-left text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300 space-y-2">
                          <div className="text-sm font-bold text-zinc-900 dark:text-white">📖 Game Rules</div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5 text-center">
                              <div className="text-base font-extrabold text-emerald-500 dark:text-emerald-400 font-mono">+50–200</div>
                              <div className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300">🤝 Close · split 20/80</div>
                              <div className="text-[9px] text-zinc-500">generator / closer</div>
                            </div>
                            <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-2 py-1.5 text-center">
                              <div className="text-base font-extrabold text-rose-500 dark:text-rose-400 font-mono">20 / 80</div>
                              <div className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300">🎯 Generator / closer</div>
                              <div className="text-[9px] text-zinc-500">auto · sales-head pick</div>
                            </div>
                            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-center">
                              <div className="text-base font-extrabold text-amber-500 dark:text-amber-400 font-mono">+15</div>
                              <div className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300">✨ New lead</div>
                            </div>
                            <div className="rounded-lg border border-indigo-500/25 bg-indigo-500/5 px-2 py-1.5 text-center">
                              <div className="text-base font-extrabold text-indigo-500 dark:text-indigo-400 font-mono">+0.5</div>
                              <div className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300">📞 Connected call</div>
                            </div>
                          </div>
                          <div className="rounded-lg bg-zinc-500/5 border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 space-y-0.5">
                            <div>Close slabs: ₹0–1L +50 · ₹1–2.5L +75 · ₹2.5–5L +100 · ₹5L+ +200</div>
                            <div>Generator (lead owner) gets 20% automatically · closer pick gets the other 80%</div>
                            <div>Wins are region-owned · risk flags are informational (no EOD snatch)</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as any)}
                    className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none"
                  >
                    <option value="score">Rank by Composite Score</option>
                    <option value="won">Rank by Estimates Won</option>
                    <option value="callsConnected">Rank by Calls Connected</option>
                    <option value="leadsGenerated">Rank by Leads Generated</option>
                  </select>
                </div>
                </div>
                {/* Period switcher (chase window) */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {PERIOD_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setPeriod(p.key)}
                      className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                        period === p.key
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-indigo-400"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {/* Individual scope — whole team or one region at a time */}
                <div className="flex flex-wrap items-center gap-1.5 mb-3">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-zinc-500 dark:text-zinc-400 mr-1">Individuals</span>
                  <button
                    onClick={() => setRegionPick("ALL")}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                      regionPick === "ALL"
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                        : "bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-indigo-400"
                    }`}
                  >
                    All regions
                  </button>
                  {dashRegions.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRegionPick(r.id)}
                      title={r.name}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                        regionPick === r.id
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-indigo-400"
                      }`}
                    >
                      {r.id}
                    </button>
                  ))}
                  {((dash.data?.unmappedStaff?.length ?? 0) > 0 || (unmappedBlock?.count ?? 0) > 0) && (
                    <button
                      onClick={() => setRegionPick("UNMAPPED")}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
                        regionPick === "UNMAPPED"
                          ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                          : "bg-white dark:bg-zinc-950 text-amber-600 dark:text-amber-400 border-amber-500/40 hover:border-amber-400"
                      }`}
                    >
                      Unmapped
                    </button>
                  )}
                </div>
                {/* Chase podium — top 3 with gaps (composite score ranking) */}
                {sortKey === "score" && sorted.length >= 2 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                    {sorted.slice(0, 3).map((t, i) => {
                      const medals = ["🥇", "🥈", "🥉"];
                      const metric = t.score;
                      const gap = i > 0 ? sorted[i - 1].score - metric : sorted[1] ? metric - sorted[1].score : 0;
                      return (
                        <div
                          key={t.id}
                          className={`rounded-xl border p-3 flex items-center gap-3 ${
                            i === 0
                              ? "border-amber-400/40 bg-amber-400/5"
                              : i === 1
                                ? "border-zinc-300/50 dark:border-zinc-600/40 bg-zinc-400/5"
                                : "border-orange-400/30 bg-orange-400/5"
                          }`}
                        >
                          <div className="text-2xl shrink-0">{medals[i]}</div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-sm text-zinc-900 dark:text-white truncate">{t.name}</div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                              {t.conversion.won} won · {fmtNum(t.generation.leadsGenerated)} leads · {fmtNum(t.generation.callsConnected)} calls
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-extrabold font-mono text-indigo-300">{metric}</div>
                            <div className={`text-[10px] font-bold ${i === 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {i === 0 ? `+${gap} ahead` : `${gap} to #${i}`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="overflow-x-auto relative">
                  {dash.loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/40 dark:bg-zinc-950/40 backdrop-blur-[1px]" aria-hidden="true">
                      <svg className="animate-spin w-6 h-6 text-indigo-500" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                      </svg>
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead className="text-zinc-500 dark:text-zinc-400 text-xs uppercase">
                      <tr className="border-b border-zinc-200 dark:border-zinc-800">
                        <th className="text-left py-2 pr-4">#</th>
                        <th className="text-left py-2 pr-4 min-w-[11rem]">Sales staff</th>
                        <th className="text-left py-2 pr-4">Region</th>
                        <th className="text-right py-2 pr-4">Leads</th>
                        <th className="text-right py-2 pr-4">Est. Won</th>
                        <th className="text-right py-2 pr-4">Calls</th>
                        <th className="text-right py-2 pr-4">Talk</th>
                        {showRisk && <th className="text-right py-2 pr-4">Risk</th>}
                        <th className="text-right py-2 pr-4 whitespace-nowrap min-w-[8rem]">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((t, i) => {
                        const open = expandedId === t.id;
                        const rk = regionKey(t.region);
                        const view = getAgentView(rk);
                        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                        const podium = i < 3;
                        return (
                          <Fragment key={t.id}>
                            <tr className={`border-b border-zinc-100 dark:border-zinc-800/60 ${open ? "bg-indigo-50/40 dark:bg-indigo-500/5" : podium ? (i === 0 ? "bg-amber-500/10" : "bg-zinc-500/5") : ""}`}>
                              <td className={`py-2 pr-4 font-bold text-lg ${podium ? "" : "text-zinc-500 dark:text-zinc-600"}`} title={podium ? `Rank #${i + 1} — projected closed value` : `Rank #${i + 1}`}>
                                {medal ?? i + 1}
                              </td>
                              <td className="py-2 pr-4 min-w-[11rem]">
                                <button
                                  onClick={() => setExpandedId(open ? null : t.id)}
                                  className="inline-flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-white hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
                                  title={open ? "Hide region pipeline" : "Show region pipeline"}
                                >
                                  {t.name}
                                  {t.type === "field_staff" && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-500 dark:text-sky-400">Field</span>
                                  )}
                                  <span className={`text-[10px] text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
                                </button>
                              </td>
                              <td className="py-2 pr-4">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${t.region ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-500 dark:text-indigo-300" : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"}`} title={t.regionName ?? "Unmapped"}>
                                  {t.region || "Unmapped"}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-right font-mono">{fmtNum(t.generation.leadsGenerated)}</td>
                              <td className="py-2 pr-4 text-right text-emerald-400 font-mono whitespace-nowrap">
                                {t.conversion.won}
                              </td>
                              <td className="py-2 pr-4 text-right font-mono">{t.type === "field_staff" ? "—" : fmtNum(t.generation.callsConnected)}</td>
                              <td className="py-2 pr-4 text-right font-mono text-indigo-300">{t.type === "field_staff" ? "—" : fmtTalk(t.generation.talkTimeSec)}</td>
                              {showRisk && (
                              <td className="py-2 pr-4 text-right font-mono whitespace-nowrap">
                                {(t.risk?.atRisk ?? 0) + (t.risk?.zombie ?? 0) > 0 ? (
                                  <span className="text-rose-400 font-bold" title="Open estimates red (no meaningful update) or zombie (silent > 3 days) — needs attention">
                                    {t.risk?.atRisk ?? 0}⚠ / {t.risk?.zombie ?? 0}☠
                                  </span>
                                ) : (
                                  <span className="text-emerald-400" title="No estimates at risk">✓</span>
                                )}
                              </td>
                              )}
                              <td className="py-2 pr-4 text-right whitespace-nowrap min-w-[12rem]">
                                <div className="flex items-center justify-end gap-2">
                                  <span className="font-extrabold text-indigo-300 font-mono">{t.score}</span>
                                  {sortKey === "score" && leaderScore > 0 && (
                                    <>
                                      <span
                                        className="hidden sm:inline-block w-12 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden"
                                        title={`${Math.round((t.score / leaderScore) * 100)}% of the leader's score`}
                                      >
                                        <span
                                          className={`block h-full rounded-full ${i === 0 ? "bg-amber-400" : "bg-indigo-400"}`}
                                          style={{ width: `${Math.max(6, Math.round((t.score / leaderScore) * 100))}%` }}
                                        />
                                      </span>
                                      {i > 0 && (() => {
                                        const gap = sorted[i - 1].score - t.score;
                                        const closes = Math.ceil(gap / 100);
                                        const leads = Math.ceil(gap / 15);
                                        const forecast =
                                          gap <= 0
                                            ? `Overtake now`
                                            : closes <= 1
                                              ? `1 close → #${i}`
                                              : leads <= 4
                                                ? `${leads} leads → #${i}`
                                                : `${closes} closes → #${i}`;
                                        return (
                                          <span
                                            className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold whitespace-nowrap"
                                            title={`${gap} pts behind #${i} (score = 1 close ×100 · 1 lead ×15 · 1 call ×0.5). ${closes} closes or ${leads} leads would overtake them.`}
                                          >
                                            ⚡ {forecast}
                                          </span>
                                        );
                                      })()}
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {open && (
                              <tr className="border-b border-zinc-100 dark:border-zinc-800/60">
                                <td colSpan={9} className="py-2 pr-4">
                                  <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <h4 className="text-sm font-bold text-zinc-900 dark:text-white">
                                        {t.name} — {t.regionName ?? "region"} pipeline
                                        <span className="ml-2 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                                          ({view?.agent?.followUpCount ?? t.conversion.assigned})
                                        </span>
                                      </h4>
                                      {view && (
                                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                          {view.agent.regionOpen?.count ?? 0} open · {view.agent.won ?? 0} won ·{" "}
                                          {fmtNum(view.agent.regionOpen?.value ?? 0)} pipeline · {fmtNum(view.agent.points ?? 0)} pts
                                        </span>
                                      )}
                                    </div>
                                    {agentViews.loading && !view && <p className="text-xs text-zinc-500">Loading region pipeline…</p>}
                                    {!agentViews.loading && !view && Boolean(agentViews.error) && (
                                      <p className="text-xs text-rose-500">Couldn't load this agent's estimates — <button className="underline font-semibold" onClick={() => agentViews.refresh()}>retry</button>.</p>
                                    )}
                                    {!agentViews.loading && view && (view?.followUps?.length ?? 0) === 0 && (
                                      <p className="text-xs text-zinc-500">No open estimates in this region.</p>
                                    )}
                                    <div className="grid gap-1.5 sm:grid-cols-2">
                                      {(view?.followUps ?? []).map((f) => (
                                        <div key={f.estimateId} className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5">
                                          <div className="min-w-0">
                                            <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{f.customerName ?? "—"}</div>
                                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId} <OrgBadge orgId={f.organizationId} orgs={teleOrgs} /></div>
                        <LeadChips f={f} />
                        <CallTagControl f={f} onSaved={() => void refreshOneAgent(rk)} onTag={applyTagOverride} />
                        <NextStepControl f={f} onSaved={() => void refreshOneAgent(rk)} />
                        {f.latestComment ? (
                          <p
                            className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-snug line-clamp-2"
                            title={`${f.latestComment.commentedBy}${f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}\n${f.latestComment.text}`}
                          >
                            “{f.latestComment.text}”
                            <span className="text-zinc-500 dark:text-zinc-400">
                              {" "}— {f.latestComment.commentedBy}
                              {f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}
                            </span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">No sales notes yet.</p>
                        )}
                                          </div>
                                          <div className="text-right shrink-0">
                                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">{f.status ?? "—"}</div>
                                            <div className="text-[11px] font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                      {sorted.length === 0 && (
                        <tr><td colSpan={9} className="py-4 text-center text-zinc-500">{regionPick === "ALL" ? "No active telecallers yet." : regionPick === "UNMAPPED" ? "No unmapped staff." : `No staff mapped to ${regionPick}.`}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Founder pre-warning: open estimates that need a meaningful update.
                  Informational only — region-owned, nothing is re-poached. */}
              {showRisk && dash.data?.risk && (dash.data.risk.counts.red > 0 || dash.data.risk.counts.zombie > 0) && (
                <section className="bg-rose-500/5 border border-rose-500/30 rounded-xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h3 className="text-lg font-bold text-rose-500 dark:text-rose-400">
                      {selfAgentId ? "🔥 Your region — needs attention" : "🔥 At Risk — needs attention"}
                    </h3>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      <span className="font-mono font-bold text-rose-400">₹{fmtNum(dash.data.risk.valueAtRisk)}</span> at risk ·{" "}
                      <span className="font-bold text-rose-400">{dash.data.risk.counts.red} red</span> ·{" "}
                      <span className="font-bold text-rose-400">{dash.data.risk.counts.zombie} zombie</span>
                    </span>
                  </div>
                  <div className="grid gap-1.5 md:grid-cols-2">
                    {dash.data.risk.atRisk.map((r) => (
                      <div key={r.estimateId} className="rounded-md border border-rose-500/20 bg-white dark:bg-zinc-950 px-2.5 py-1.5" title={r.snatchReason ?? r.reasoning ?? undefined}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{r.customerName ?? "—"}</div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{r.estimateNumber ?? r.estimateId} · {r.telecallerName ?? "—"} <OrgBadge orgId={(r as any).organizationId} orgs={teleOrgs} /></div>
                          </div>
                          <div className="text-right shrink-0 space-y-0.5">
                            <div className="text-[11px] font-mono text-emerald-400">₹{fmtNum(Number(r.total ?? 0))}</div>
                            <div className="flex justify-end gap-1">
                              <StaleChip compact staleHours={r.staleHours} />
                              <SnatchChip compact risk={r.risk} snatchInHours={r.snatchInHours} />
                            </div>
                          </div>
                        </div>
                        {(r.snatchReason || r.reasoning) && (
                          <p className="text-[11px] text-rose-600/80 dark:text-rose-400/70 mt-1 leading-snug line-clamp-2">
                            {r.snatchReason ?? r.reasoning}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-600 mt-2">
                    Informational only — Red = latest AI verdict found no meaningful update · Zombie = no comment for over 3 days. Estimates stay region-owned; use the dated next step to protect the deal.
                  </p>
                </section>
              )}

              {/* Roster management has moved to the MIS-only Controller tab */}
            </div>
          )}

          {view === "conversion" && (
            <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <div className="mb-3">
                <h3 className="text-lg font-bold mb-1">📨 Lead Conversion</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {selfAgentId
                    ? "Your region's open estimates — call them and log a meaningful update."
                    : "Estimates are owned by regions. Switch between region tabs to see each region's pipeline."}
                </p>
              </div>

              {/* Horizontal region tabs — hidden for scoped (self-region) staff */}
              {!selfAgentId && (
                <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
                  <button
                    onClick={() => setRegionFilter(null)}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                      !regionFilter
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                        : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500"
                    }`}
                  >
                    All regions
                  </button>
                  {regionBoard.map((r) => {
                    const active = regionFilter === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => setRegionFilter(active ? null : r.id)}
                        title={`${r.name} · ${r.tl} · ${r.states.join(", ")}`}
                        className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                          active
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500"
                        }`}
                      >
                        {r.id} · {r.name}
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${active ? "bg-white/20" : "bg-zinc-100 dark:bg-zinc-700/60 text-zinc-500 dark:text-zinc-400"}`}>
                          {r.open.count}
                        </span>
                      </button>
                    );
                  })}
                  {(unmappedBlock?.count ?? 0) > 0 && (
                    <button
                      onClick={() => setRegionFilter(regionFilter === "UNMAPPED" ? null : "UNMAPPED")}
                      title="Open estimates with no region — MIS should link them"
                      className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                        regionFilter === "UNMAPPED"
                          ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                          : "bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 border-amber-500/40 hover:border-amber-400"
                      }`}
                    >
                      Unmapped
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-amber-500/15">{unmappedBlock?.count ?? 0}</span>
                    </button>
                  )}
                </div>
              )}

              {!selfAgentId && !regionFilter && (
                <div className="space-y-2 relative">
                  {convDash.loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/40 dark:bg-zinc-950/40 backdrop-blur-[1px]" aria-hidden="true">
                      <svg className="animate-spin w-6 h-6 text-indigo-500" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                      </svg>
                    </div>
                  )}
                  {Boolean(convDash.error) && !convDash.loading && (
                    <QueryErrorBanner message={String((convDash.error as any)?.message ?? convDash.error)} onRetry={() => convDash.refresh()} />
                  )}
                  {regionBoard.length === 0 && <p className="text-sm text-zinc-500">No regions loaded.</p>}
                  {regionBoard.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRegionFilter(r.id)}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors cursor-pointer group text-left"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-zinc-900 dark:text-white group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">
                          {r.id} · {r.name}
                        </span>
                        <span className="block text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                          {r.tl} · {r.states.join(", ")}
                        </span>
                      </span>
                      <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono shrink-0 text-right">
                        {r.open.count} open · {r.won.count} won · ₹{fmtNum(r.open.value)} · {r.points} pts
                      </span>
                    </button>
                  ))}
                  {(unmappedBlock?.count ?? 0) > 0 && (
                    <button
                      onClick={() => setRegionFilter("UNMAPPED")}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 hover:border-amber-400 transition-colors cursor-pointer text-left"
                    >
                      <span className="font-semibold text-amber-600 dark:text-amber-400">Unmapped estimates</span>
                      <span className="text-xs text-amber-700/80 dark:text-amber-400/80 font-mono shrink-0">
                        {unmappedBlock?.count ?? 0} open · ₹{fmtNum(unmappedBlock?.value ?? 0)} — link them in Controller
                      </span>
                    </button>
                  )}
                </div>
              )}

              {regionFilter && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-zinc-900 dark:text-white">
                      {selectedAgentView?.meta?.regionName ?? selectedAgentView?.agent?.name ?? (regionFilter === "UNMAPPED" ? "Unmapped" : regionFilter)} — follow-ups ({selectedAgentView?.agent?.followUpCount ?? 0})
                    </h4>
                    {!selfAgentId && (
                      <button onClick={() => setRegionFilter(null)} className="text-xs text-indigo-400 hover:underline">Back to all</button>
                    )}
                  </div>
                  {/* Call-tag filters (Sheets-style): Not answering / Busy /
                      Callback (+ due-by date). Pure client-side over the
                      loaded follow-ups — instant, no refetch. */}
                  {(tagCounts.NO_ANSWER + tagCounts.BUSY + tagCounts.CALLBACK > 0 || tagFilter !== "ALL") && (
                    <div className="flex flex-wrap items-center gap-2">
                      {(Object.keys(CALL_TAG_META) as CallTagValue[]).map((t) => {
                        const active = tagFilter === t;
                        return (
                          <button
                            key={t}
                            onClick={() => { setTagFilter(active ? "ALL" : t); if (t !== "CALLBACK") setCallbackDueBy(""); }}
                            title={t === "CALLBACK" ? "Show only follow-ups marked for callback" : CALL_TAG_META[t].title}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                              active
                                ? "bg-sky-600 text-white border-sky-600 shadow-sm"
                                : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-sky-400 dark:hover:border-sky-500"
                            }`}
                          >
                            <span>{CALL_TAG_META[t].icon}</span> {CALL_TAG_META[t].label} ({tagCounts[t]})
                          </button>
                        );
                      })}
                      {tagFilter === "CALLBACK" && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                          due by
                          <input
                            type="date"
                            value={callbackDueBy}
                            onChange={(e) => setCallbackDueBy(e.target.value)}
                            title="Show callbacks due on or before this date"
                            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-1.5 py-1 text-xs text-zinc-900 dark:text-zinc-100"
                          />
                          {callbackDueBy && (
                            <button onClick={() => setCallbackDueBy("")} className="text-indigo-400 hover:underline">clear</button>
                          )}
                        </span>
                      )}
                      {tagFilter !== "ALL" && (
                        <button onClick={() => { setTagFilter("ALL"); setCallbackDueBy(""); }} className="text-xs text-indigo-400 hover:underline">Show all</button>
                      )}
                    </div>
                  )}
                  {agentViews.loading && !selectedAgentView && <p className="text-sm text-zinc-500">Loading…</p>}
                  {!agentViews.loading && !selectedAgentView && Boolean(agentViews.error) && (
                    <p className="text-sm text-rose-500">Couldn't load follow-ups — <button className="underline font-semibold" onClick={() => agentViews.refresh()}>retry</button>.</p>
                  )}
                  {!agentViews.loading && selectedAgentView && (selectedAgentView?.followUps?.length ?? 0) === 0 && (
                    <p className="text-sm text-zinc-500">No follow-up estimates in this region.</p>
                  )}
                  {!agentViews.loading && (selectedAgentView?.followUps?.length ?? 0) > 0 && visibleFollowUps.length === 0 && (
                    <p className="text-sm text-zinc-500">{filtersActive ? "No follow-ups match the active filters." : "No follow-ups in this region."}</p>
                  )}
                  <div className="space-y-2">
                    {visibleFollowUps.map((f) => (
                      <div key={f.estimateId} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 space-y-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-semibold text-sm text-zinc-900 dark:text-white truncate min-w-0">{f.customerName ?? "—"}</div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <SatChip value={f.satisfactory} />
                            <StaleChip staleHours={f.staleHours} />
                            {showRisk && <SnatchChip risk={f.risk} snatchInHours={f.snatchInHours} />}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId} <OrgBadge orgId={f.organizationId} orgs={teleOrgs} /></div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-zinc-700 dark:text-zinc-300">{f.status ?? "—"}</span>
                            <span className="text-xs font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</span>
                          </div>
                        </div>
                        <LeadChips f={f} />
                        <CallTagControl f={f} onSaved={() => void refreshOneAgent(regionFilter)} onTag={applyTagOverride} />
                        <NextStepControl f={f} onSaved={() => void refreshOneAgent(regionFilter)} />
                        {f.latestComment ? (
                          <p
                            className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-snug line-clamp-2"
                            title={`${f.latestComment.commentedBy}${f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}\n${f.latestComment.text}`}
                          >
                            “{f.latestComment.text}”
                            <span className="text-zinc-500 dark:text-zinc-400">
                              {" "}— {f.latestComment.commentedBy}
                              {f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}
                            </span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">No sales notes yet.</p>
                        )}
                        {showRisk && (f.risk === "red" || f.risk === "zombie") && (f.staleReason ?? f.snatchReason) && (
                          <p className="text-[11px] text-rose-600/80 dark:text-rose-400/70 leading-snug line-clamp-2" title={(f.staleReason ?? f.snatchReason) ?? undefined}>
                            {f.staleReason ?? f.snatchReason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmapped drill: the endpoint returns no region for "unmapped",
                  so show the privileged linking queue instead of follow-ups. */}
              {regionFilter === "UNMAPPED" && (unmappedBlock?.count ?? 0) > 0 && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  {unmappedBlock?.count ?? 0} unmapped open estimates (₹{fmtNum(unmappedBlock?.value ?? 0)}). Link each one to a region in the Controller tab.
                </div>
              )}
            </section>
          )}

          {/* Controller — MIS-only: closer picks, unmapped linking, history reset, roster */}
          {view === "controller" && (
            canManageRoster ? (
              <div className="space-y-6">
                <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                  <h3 className="text-lg font-bold mb-1">🎛️ Controller</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-0">
                    MIS-level control of the region sales model — closer picks (the 80% share),
                    unmapped estimate linking, history reset and the staff roster.
                  </p>
                </section>
                <PendingPicksSection
                  pending={pendingPicks}
                  rosterRows={rosterRows}
                  busy={busy}
                  setBusy={setBusy}
                  setError={setRosterError}
                  refreshAll={refreshAll}
                />
                <UnmappedSection
                  unmapped={unmappedBlock}
                  unmappedAccepted={dash.data?.unmappedAccepted ?? convDash.data?.unmappedAccepted ?? null}
                  busy={busy}
                  setBusy={setBusy}
                  setError={setRosterError}
                  refreshAll={refreshAll}
                />
                <HistoryResetSection
                  epoch={dash.data?.epoch ?? null}
                  busy={busy}
                  setBusy={setBusy}
                  setError={setRosterError}
                  refreshAll={refreshAll}
                />
                <ExportDataSection rosterRows={rosterRows} showRisk={showRisk} />
                <RosterSection
                  rosterRows={rosterRows}
                  busy={busy}
                  rosterError={rosterError}
                  onAdd={() => { setEditTarget(null); setRosterModalOpen(true); }}
                  onEditModal={(t) => { setEditTarget(t); setRosterModalOpen(true); }}
                  onToggleFollowUps={toggleFollowUps}
                  onDelete={(t) => setConfirmDelete(t)}
                  onRestore={restoreTelecaller}
                  deletedRows={deletedRows}
                  showDeleted={showDeleted}
                  onToggleShowDeleted={(o) => {
                    setShowDeleted(o);
                    if (o) void loadDeleted();
                  }}
                />
                <RosterEditModal
                  target={editTarget}
                  open={rosterModalOpen}
                  busy={busy}
                  onSave={saveRoster}
                  onClose={() => setRosterModalOpen(false)}
                />
              </div>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-600 px-1">
                🔒 Controller is restricted to MIS-level users.
              </p>
            )
          )}

          {view === "generation" && (
            <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-lg font-bold mb-1">📞 Lead Generation</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Per-agent enquiries created (live) + NeoDove call performance — calls from the NeoDove worker database.
                  </p>
                </div>
                {/* Independent period filter for Lead Generation */}
                <div className="flex flex-wrap gap-1.5">
                  {PERIOD_OPTIONS.map((p) => (
                    <button
                      key={p.key}
                      onClick={() => setGenPeriod(p.key)}
                      className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                        genPeriod === p.key
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:border-indigo-400"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                {genDash.data?.meta?.targets ? (
                  <span>
                    Benchmarks per agent for <span className="font-bold">{genDash.data.meta.periodLabel ?? "Today"}</span>
                    {genDash.data.meta.workingDays && genDash.data.meta.workingDays > 1 ? ` (${genDash.data.meta.workingDays} working days × daily target)` : ""}:{" "}
                    <span className="text-zinc-700 dark:text-zinc-300 font-semibold">≥ {genDash.data.meta.targets.connectedCallsPerDay} connected calls</span> ·{" "}
                    <span className="text-zinc-700 dark:text-zinc-300 font-semibold">≥ {genDash.data.meta.targets.leadsPerAgentPerDay} leads</span> (enquiries created). Traffic light: 🟢 ≥100% · 🟡 60–99% · 🔴 &lt;60%
                  </span>
                ) : null}
              </p>
              {Boolean(genDash.error) && !genDash.loading && (
                <QueryErrorBanner message={String((genDash.error as any)?.message ?? genDash.error)} onRetry={() => genDash.refresh()} />
              )}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 relative">
                {genDash.loading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/40 dark:bg-zinc-950/40 backdrop-blur-[1px]" aria-hidden="true">
                    <svg className="animate-spin w-6 h-6 text-indigo-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
                    </svg>
                  </div>
                )}
                {genActiveBoard.map((t) => {
                  const g = t.generation;
                  const overall = worst(g.connectedStatus, g.leadsStatus);
                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl border p-4 space-y-3 bg-zinc-50 dark:bg-zinc-900 ${
                        overall === "green" ? "border-emerald-500/30" : overall === "amber" ? "border-amber-500/30" : "border-rose-500/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-bold text-zinc-900 dark:text-white truncate block">{t.name}</span>
                          <span className="text-[10px] text-zinc-600 dark:text-zinc-500">{t.region || "Unmapped"} · {t.tlLevel || "—"}</span>
                        </div>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-extrabold uppercase tracking-wide ${LIGHT_CHIP[overall]}`}>
                          {OVERALL_LABEL[overall]}
                        </span>
                      </div>
                      <KraBar label="Connected Calls" value={g.callsConnected} target={g.connectedTarget} pct={g.connectedPct} status={g.connectedStatus} />
                      <KraBar label="Leads Generated" value={g.leadsGenerated} target={g.leadsTarget} pct={g.leadsPct} status={g.leadsStatus} />
                      <div className="flex items-center justify-between pt-1 border-t border-zinc-200/80 dark:border-zinc-800/80 text-[10px] text-zinc-600 dark:text-zinc-500">
                        <span>Lead Conversion</span>
                        <span className="font-mono text-zinc-500 dark:text-zinc-400">
                          {t.conversion.won} won · {fmtNum(t.points ?? 0)} pts
                        </span>
                      </div>
                      {(() => {
                        const open = expandedId === t.id;
                        const rk = regionKey(t.region);
                        const view = getAgentView(rk);
                        return (
                          <div className="pt-1 border-t border-zinc-200/80 dark:border-zinc-800/80">
                            <button
                              onClick={() => setExpandedId(open ? null : t.id)}
                              className="w-full inline-flex items-center justify-between gap-2 text-xs font-semibold text-indigo-500 dark:text-indigo-400 hover:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                            >
                              <span>Region pipeline ({view?.agent?.followUpCount ?? t.conversion.assigned})</span>
                              <span className={`text-[10px] text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
                            </button>
                            {open && (
                              <div className="mt-2 space-y-1.5">
                                {agentViews.loading && !view && <p className="text-[11px] text-zinc-500">Loading…</p>}
                                {!agentViews.loading && !view && Boolean(agentViews.error) && (
                                  <p className="text-[11px] text-rose-500">Couldn't load estimates — <button className="underline font-semibold" onClick={() => agentViews.refresh()}>retry</button>.</p>
                                )}
                                {!agentViews.loading && view && (view?.followUps?.length ?? 0) === 0 && (
                                  <p className="text-[11px] text-zinc-500">No open estimates in this region.</p>
                                )}
                                {(view?.followUps ?? []).map((f) => (
                                  <div key={f.estimateId} className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1.5 bg-white dark:bg-zinc-950">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="text-[11px] font-semibold text-zinc-900 dark:text-white truncate">{f.customerName ?? "—"}</div>
                                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId}</div>
                                      </div>
                                      <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                                        <div className="flex items-center gap-1">
                                          <SatChip value={f.satisfactory} compact />
                                          <StaleChip staleHours={f.staleHours} compact />
                                        </div>
                                        {showRisk && <SnatchChip risk={f.risk} snatchInHours={f.snatchInHours} compact />}
                                        {showRisk && <ShieldChip shield={f.shield} compact />}
                                        <div className="text-[10px] text-zinc-600 dark:text-zinc-300">{f.status ?? "—"}</div>
                                        <div className="text-[10px] font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</div>
                                      </div>
                                    </div>
                                    <LeadChips f={f} />
                                    <CallTagControl f={f} compact onSaved={() => void refreshOneAgent(rk)} onTag={applyTagOverride} />
                                    <NextStepControl f={f} onSaved={() => void refreshOneAgent(rk)} />
                                    {f.latestComment ? (
                                      <p
                                        className="text-[11px] text-zinc-600 dark:text-zinc-300 leading-snug line-clamp-2"
                                        title={`${f.latestComment.commentedBy}${f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}\n${f.latestComment.text}`}
                                      >
                                        “{f.latestComment.text}”
                                        <span className="text-zinc-500 dark:text-zinc-400">
                                          {" "}— {f.latestComment.commentedBy}
                                          {f.latestComment.dateFormatted ? ` · ${f.latestComment.dateFormatted}` : ""}
                                        </span>
                                      </p>
                                    ) : (
                                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">No sales notes yet.</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                {genActiveBoard.length === 0 && (
                  <p className="text-sm text-zinc-500">No active telecallers yet — add them in the Controller roster and map each to a region.</p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Closer picks — the 80% share of every new close waits here for the sales
 *  head. The 20% generator credit is automatic (Estimate.createdBy). */
function PendingPicksSection({
  pending,
  rosterRows,
  busy,
  setBusy,
  setError,
  refreshAll,
}: {
  pending: PendingPick[];
  rosterRows: RosterRow[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  refreshAll: () => void;
}) {
  const [closerBy, setCloserBy] = useState<Record<string, string>>({});
  const pick = async (estimateId: string) => {
    const closerId = closerBy[estimateId];
    if (!closerId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/telecalling/closer-pick", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimateId, closerId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Pick failed (${res.status})`);
      setCloserBy((prev) => { const { [estimateId]: _omit, ...rest } = prev; return rest; });
      refreshAll();
    } catch (e: any) {
      setError(e?.message ?? "Closer pick failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-lg font-bold mb-1">🤝 Closer picks</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {pending.length > 0
              ? "Converted estimates awaiting the 80% closer credit. The 20% generator share is already credited automatically."
              : "No converted estimates are waiting for a closer pick."}
          </p>
        </div>
        {pending.length > 0 && (
          <span className="text-xs font-mono font-bold text-indigo-500 dark:text-indigo-300">{pending.length} pending</span>
        )}
      </div>
      {pending.length > 0 && (
        <div className="space-y-1.5">
          {pending.map((p) => {
            const region = p.region || "";
            const eligible = rosterRows.filter((t) => t.type !== "field_staff" && t.assignEstimateFollowUps && (!region || !t.region || t.region === region));
            return (
              <div key={p.estimateId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{p.customerName ?? "—"}</div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                    {p.estimateNumber ?? p.estimateId} · {region || "Unmapped"} · ₹{fmtNum(Number(p.total ?? 0))}
                    {p.closeDay ? ` · closed ${p.closeDay}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={closerBy[p.estimateId] ?? ""}
                    onChange={(e) => setCloserBy((prev) => ({ ...prev, [p.estimateId]: e.target.value }))}
                    className="px-2 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200"
                  >
                    <option value="">Pick closer…</option>
                    {eligible.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button
                    onClick={() => void pick(p.estimateId)}
                    disabled={busy || !closerBy[p.estimateId]}
                    className="text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 disabled:opacity-50"
                  >
                    Credit 80%
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Unmapped open estimates — link each to its region so region ownership,
 *  KRA and the leaderboard count it. */
function UnmappedSection({
  unmapped,
  unmappedAccepted,
  busy,
  setBusy,
  setError,
  refreshAll,
}: {
  unmapped: DashData["unmapped"];
  unmappedAccepted: DashData["unmappedAccepted"];
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  refreshAll: () => void;
}) {
  const [regionBy, setRegionBy] = useState<Record<string, RegionId | "">>({});
  const link = async (estimateId: string) => {
    const region = regionBy[estimateId];
    if (!region) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimates/${encodeURIComponent(estimateId)}/region`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Link failed (${res.status})`);
      setRegionBy((prev) => { const { [estimateId]: _omit, ...rest } = prev; return rest; });
      refreshAll();
    } catch (e: any) {
      setError(e?.message ?? "Link failed");
    } finally {
      setBusy(false);
    }
  };
  const items = unmapped?.items ?? [];
  return (
    <section className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-lg font-bold mb-1 text-amber-700 dark:text-amber-400">🧭 Unmapped estimates</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {items.length > 0
              ? "Open estimates with no region — link each one so its region owns the deal."
              : "Every open estimate has a region."}
          </p>
        </div>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{unmapped?.count ?? 0}</span> open · ₹{fmtNum(unmapped?.value ?? 0)}
        </span>
      </div>
      {items.length > 0 && (
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {items.map((it) => (
            <div key={it.estimateId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-white dark:bg-zinc-950 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{it.customerName ?? "—"}</div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                  {it.estimateNumber ?? it.estimateId} · ₹{fmtNum(Number(it.total ?? 0))}
                  {it.generatedBy ? ` · by ${it.generatedBy}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={regionBy[it.estimateId] ?? ""}
                  onChange={(e) => setRegionBy((prev) => ({ ...prev, [it.estimateId]: e.target.value as RegionId }))}
                  className="px-2 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200"
                >
                  <option value="">Region…</option>
                  {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                </select>
                <button
                  onClick={() => void link(it.estimateId)}
                  disabled={busy || !regionBy[it.estimateId]}
                  className="text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 disabled:opacity-50"
                >
                  Link
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {unmappedAccepted && unmappedAccepted.count > 0 && (
        <div className="mt-4 pt-4 border-t border-amber-500/20">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <h4 className="text-sm font-bold text-amber-700 dark:text-amber-400">Accepted, no lead region</h4>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Accepted deals outside every region — they add no points or wins until linked.
                Rows without a lead creator stay uncredited even after a region is picked.
              </p>
            </div>
            <span className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono">
              {unmappedAccepted.count} · ₹{fmtNum(unmappedAccepted.value)} · {fmtNum(unmappedAccepted.points)} pts unlinked
            </span>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {(unmappedAccepted.items ?? []).map((it) => (
              <div key={it.estimateId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-white dark:bg-zinc-950 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate flex items-center gap-1.5">
                    {it.customerName ?? "—"}
                    {!it.hasCreator && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-500 font-bold">No lead creator</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                    {it.estimateNumber ?? it.estimateId} · ₹{fmtNum(Number(it.total ?? 0))} · {it.status ?? ""}
                    {it.date ? ` · ${it.date}` : ""}
                    {it.generatedBy ? ` · by ${it.generatedBy}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={regionBy[it.estimateId] ?? ""}
                    onChange={(e) => setRegionBy((prev) => ({ ...prev, [it.estimateId]: e.target.value as RegionId }))}
                    className="px-2 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200"
                  >
                    <option value="">Region…</option>
                    {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
                  </select>
                  <button
                    onClick={() => void link(it.estimateId)}
                    disabled={busy || !regionBy[it.estimateId]}
                    className="text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 disabled:opacity-50"
                  >
                    Link
                  </button>
                </div>
              </div>
            ))}
          </div>
          {unmappedAccepted.count > (unmappedAccepted.items?.length ?? 0) && (
            <p className="text-[10px] text-zinc-500 dark:text-zinc-600 mt-1">
              Showing the first {unmappedAccepted.items?.length ?? 0} of {unmappedAccepted.count}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** History reset — purge close credits + stamp the epoch. Two-step: preview
 *  the exact row count, then confirm. */
function HistoryResetSection({
  epoch,
  busy,
  setBusy,
  setError,
  refreshAll,
}: {
  epoch: string | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  refreshAll: () => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const run = async (dry: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/telecalling/reset-history${dry ? "?dry=1" : ""}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Reset failed (${res.status})`);
      if (dry) setPreview(Number(body?.deleted?.closeRows ?? 0));
      else {
        setPreview(null);
        setDone(String(body?.epoch ?? "done"));
        setConfirming(false);
        refreshAll();
      }
    } catch (e: any) {
      setError(e?.message ?? "Reset failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold mb-1">🧨 Reset history</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xl">
            Deletes every close-credit ledger row and stamps a new epoch — points and wins
            before the epoch stop counting. Estimates, calls and rosters are untouched.
            {epoch ? ` Current epoch: ${epoch}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {preview === null ? (
            <button
              onClick={() => void run(true)}
              disabled={busy}
              className="text-sm font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-4 py-2 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-50"
            >
              Preview purge
            </button>
          ) : confirming ? (
            <>
              <span className="text-xs font-semibold text-rose-500">Delete {preview} credit row{preview === 1 ? "" : "s"}?</span>
              <button
                onClick={() => { setConfirming(false); setPreview(null); }}
                disabled={busy}
                className="text-sm font-semibold rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-4 py-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void run(false)}
                disabled={busy}
                className="text-sm font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 disabled:opacity-50"
              >
                Reset NOW
              </button>
            </>
          ) : (
            <>
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{preview} close-credit row{preview === 1 ? "" : "s"} would be purged</span>
              <button
                onClick={() => setConfirming(true)}
                className="text-sm font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-4 py-2"
              >
                Continue
              </button>
            </>
          )}
        </div>
      </div>
      {done && <p className="text-[11px] text-emerald-500 dark:text-emerald-400 mt-2 font-semibold">History reset — new epoch {done}.</p>}
    </section>
  );
}

function QueryErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5">
      <span className="text-xs font-semibold text-rose-600 dark:text-rose-300">⚠ Couldn’t load live data — {message}</span>
      <button
        onClick={onRetry}
        className="text-xs font-bold rounded-lg px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

function RosterSection({
  rosterRows,
  busy,
  rosterError,
  onAdd,
  onEditModal,
  onToggleFollowUps,
  onDelete,
  onRestore,
  deletedRows,
  showDeleted,
  onToggleShowDeleted,
}: {
  rosterRows: RosterRow[];
  busy: boolean;
  rosterError: string | null;
  onAdd: () => void;
  onEditModal: (t: RosterRow) => void;
  onToggleFollowUps: (id: string, assignEstimateFollowUps: boolean) => void;
  onDelete: (t: RosterRow) => void;
  onRestore: (id: string) => void;
  deletedRows: RosterRow[];
  showDeleted: boolean;
  onToggleShowDeleted: (open: boolean) => void;
}) {
  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold">Sales Roster</h3>
        <button onClick={onAdd} disabled={busy}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
          + Add staff
        </button>
      </div>
      {rosterError && (
        <div className="mb-3 text-xs font-semibold text-rose-500 dark:text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2">
          {rosterError}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 mb-5">
        {rosterRows.map((t) => (
          <div key={t.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-zinc-900 dark:text-white">{t.name}</div>
              <div className="flex items-center gap-1 flex-wrap justify-end">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${t.type === "field_staff" ? "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" : "border-zinc-400/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"}`}>
                  {t.type === "field_staff" ? "Field Staff" : "Telecaller"}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${t.region ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-500 dark:text-indigo-300" : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
                  {t.region || "Unmapped"}
                </span>
                {t.tlLevel && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-semibold">{t.tlLevel}</span>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${t.type === "field_staff" ? "bg-sky-500/10 text-sky-600 dark:text-sky-400" : t.assignEstimateFollowUps ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500"}`}>
                  {t.type === "field_staff" ? "Leads only" : t.assignEstimateFollowUps ? "Closer" : "Generator"}
                </span>
              </div>
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              {t.neodoveUserName ? `NeoDove: ${t.neodoveUserName}` : "NeoDove: not linked"}
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {t.email && <>Email: {t.email}</>}
              {t.phone && <> · Phone: {t.phone}</>}
              {t.whatsapp && <> · WhatsApp: {t.whatsapp}</>}
              {!t.email && !t.phone && !t.whatsapp && "No contact details"}
            </div>
            {t.linkedUser && (
              <div className="text-[11px] text-emerald-500 dark:text-emerald-400 mt-0.5">
                ✓ Signed-up platform user: {t.linkedUser.name} ({t.linkedUser.email})
              </div>
            )}
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Open in region: {t.activeAssigned} · lifetime assigned: {t.totalAssigned}</div>
            <div className="flex gap-2 mt-3 flex-wrap">
              <button onClick={() => onEditModal(t)} className="flex-1 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 py-1.5 font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700">Edit</button>
              {t.type !== "field_staff" ? (
                <button onClick={() => onToggleFollowUps(t.id, t.assignEstimateFollowUps)} className={`flex-1 text-xs rounded-lg py-1.5 font-semibold ${
                  t.assignEstimateFollowUps
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                }`} title="Conversion specialists can be picked as the 80% closer; others only earn the 20% generator share">
                  {t.assignEstimateFollowUps ? "Not a closer" : "Make closer-eligible"}
                </button>
              ) : (
                <span className="flex-1 text-center text-[11px] rounded-lg bg-sky-500/5 text-sky-600 dark:text-sky-400 py-1.5 font-semibold" title="Field staff never operate the dashboard and never close — they only generate leads">
                  Never a closer
                </span>
              )}
              <button
                onClick={() => onDelete(t)}
                disabled={busy}
                className="inline-flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 dark:text-rose-400 p-2 hover:bg-rose-500/20 disabled:opacity-40"
                title="Delete agent — hidden everywhere, restorable from Deleted Agents"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {rosterRows.length === 0 && <p className="text-sm text-zinc-500">No sales staff yet — add a telecaller or field staff below.</p>}
      </div>

      {/* Deleted agents — hidden from the roster/leaderboard, restorable */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3 mt-3">
        <button
          onClick={() => onToggleShowDeleted(!showDeleted)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 hover:border-rose-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
          title="Expand/collapse deleted agents (restorable)"
        >
          <span className={`transition-transform inline-block ${showDeleted ? "rotate-90" : ""}`}>▸</span>
          <Trash2 className="w-4 h-4" />
          Deleted agents ({deletedRows.length})
        </button>

        {showDeleted && (
          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {deletedRows.map((t) => (
              <div key={t.id} className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">{t.name}</div>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-rose-500/10 text-rose-400 font-bold">Deleted</span>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                  {t.neodoveUserName ? `NeoDove: ${t.neodoveUserName}` : "NeoDove: not linked"}
                  <br />
                  Lifetime assigned: {t.totalAssigned}
                </div>
                <button
                  onClick={() => onRestore(t.id)}
                  disabled={busy}
                  className="mt-3 w-full text-xs rounded-lg bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 py-2 font-semibold hover:bg-emerald-500/20 disabled:opacity-40"
                  title="Restore as inactive — reactivate when ready"
                >
                  ♻ Restore (inactive)
                </button>
              </div>
            ))}
            {deletedRows.length === 0 && <p className="text-xs text-zinc-500 py-2">No deleted agents.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Roster add/edit modal ────────────────────────────────────────────────────
// Opens from "Add agent" (create) or a roster card's Edit button. Edits contact
// + role fields ONLY — the NeoDove mapping is managed by the auto-sync (never
// edited here) and is shown read-only when editing an existing agent.
function RosterEditModal({
  target,
  open,
  busy,
  onSave,
  onClose,
}: {
  target: RosterRow | null; // null = creating a new agent
  open: boolean;
  busy: boolean;
  onSave: (updates: { name: string; email: string; phone: string; whatsapp: string; assignEstimateFollowUps: boolean; region: string; tlLevel: string; type: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [followUps, setFollowUps] = useState(true);
  const [region, setRegion] = useState("");
  const [tlLevel, setTlLevel] = useState("");
  const [staffType, setStaffType] = useState("telecaller");

  // Re-sync on open too: cancelling with dirty edits then re-opening the SAME
  // agent must not resurrect the abandoned values (target identity unchanged).
  useEffect(() => {
    if (!open) return;
    if (target) {
      setName(target.name);
      setEmail(target.email ?? "");
      setPhone(target.phone ?? "");
      setWhatsapp(target.whatsapp ?? "");
      setFollowUps(target.assignEstimateFollowUps);
      setRegion(target.region ?? "");
      setTlLevel(target.tlLevel ?? "");
      setStaffType(target.type === "field_staff" ? "field_staff" : "telecaller");
    } else {
      setName(""); setEmail(""); setPhone(""); setWhatsapp(""); setFollowUps(true);
      setRegion(""); setTlLevel(""); setStaffType("telecaller");
    }
  }, [target, open]);

  if (!open) return null;

  const isCreate = !target;
  const inputCls = "w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm";
  const field = (label: string, children: React.ReactNode) => (
    <label className="block space-y-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div>
          <h4 className="font-bold text-zinc-900 dark:text-white">{isCreate ? "Add sales staff" : "Edit sales staff"}</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {isCreate ? "Create a sales-roster entry — telecaller or field staff." : "Update contact details, type and role. NeoDove mapping is read-only."}
          </p>
        </div>

        <div className="space-y-3">
          {field("Type", (
            <select
              value={staffType}
              onChange={(e) => { const v = e.target.value; setStaffType(v); if (v === "field_staff") setFollowUps(false); }}
              className={inputCls}
            >
              <option value="telecaller">Telecaller — uses the dashboard</option>
              <option value="field_staff">Field Staff — leads logged by sales agents</option>
            </select>
          ))}
          {field("Name", <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Full name" />)}
          {field("Email", <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="Email" />)}
          {field("Phone", <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="Phone" />)}
          {field("WhatsApp", <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={inputCls} placeholder="WhatsApp" />)}

          <div className="grid grid-cols-2 gap-2">
            {field("Region", (
              <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}>
                <option value="">Unmapped</option>
                {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.name}</option>)}
              </select>
            ))}
            {field("Hierarchy", (
              <select value={tlLevel} onChange={(e) => setTlLevel(e.target.value)} className={inputCls}>
                <option value="">—</option>
                <option value="TL1">TL1</option>
                <option value="TL2">TL2</option>
              </select>
            ))}
          </div>

          {staffType === "field_staff" ? (
            <p className="text-[11px] rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-sky-700 dark:text-sky-400">
              Field staff never use the dashboard and never close. Sales agents log their enquiries with source <b>Field Staff</b>; the lead, region and 20% generator credit go to them. Set a region below so their estimates land in the right region.
            </p>
          ) : (
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={followUps} onChange={(e) => setFollowUps(e.target.checked)} className="accent-indigo-500" />
              Conversion specialist (closer-eligible — can be picked for the 80% share)
            </label>
          )}

          {/* NeoDove mapping — read-only, managed by the auto-sync */}
          {!isCreate && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
              <div className="font-bold uppercase tracking-wider text-[10px] mb-1">NeoDove mapping</div>
              {target.neodoveUserName ? `Linked to NeoDove user: ${target.neodoveUserName}` : "Not linked to a NeoDove user"}
              {target.neodoveUserId ? ` (id: ${target.neodoveUserId})` : ""}
              <div className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">Managed automatically — not editable here.</div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => onSave({ name, email, phone, whatsapp, assignEstimateFollowUps: staffType === "field_staff" ? false : followUps, region, tlLevel, type: staffType })}
            disabled={busy || !name.trim()}
            className="px-4 py-2 text-sm rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">
            {busy ? "Saving…" : isCreate ? "Add" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
// Exports the FULL live telecalling payload as one CSV download — performance
// (leaderboard), assignments (conversion summary) and risk (open pipeline)
// stacked as sections. Filters: period + telecaller sub-set (all / follow-up
// specialists / lead-gen only / a specific agent). Generated in the browser
// from the same endpoint the dashboards use — no new backend needed.

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Formula-injection guard: a cell starting with = + - @ (after optional
    // whitespace/quote) executes on open in Excel/Sheets — prefix with a tab.
    const safe = /^[ \t]*[=+\-@]/.test(s) ? `\t${s}` : s;
    return /[",\n\t]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const EXPORT_PERIODS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "lastweek", label: "Last Week" },
  { key: "month", label: "This Month" },
  { key: "lastmonth", label: "Last Month" },
  { key: "year", label: "This Year" },
  { key: "lastyear", label: "Last Year" },
];

function ExportDataSection({ rosterRows, showRisk }: { rosterRows: RosterRow[]; showRisk: boolean }) {
  const [period, setPeriod] = useState("week");
  const [subset, setSubset] = useState("all");
  const [days, setDays] = useState("30");
  const [loading, setLoading] = useState(false);
  const [loadingEst, setLoadingEst] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subsetRows = () => {
    if (subset === "followups") return rosterRows.filter((r) => r.assignEstimateFollowUps);
    if (subset === "leadgen") return rosterRows.filter((r) => !r.assignEstimateFollowUps);
    if (subset !== "all" && subset !== "") return rosterRows.filter((r) => r.id === subset);
    return rosterRows;
  };

  const doExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/automations/telecalling/data?period=${period}&daily=1`);
      if (!res.ok) throw new Error(`Failed to load telecalling data (HTTP ${res.status})`);
      const data: DashData = adaptDashData(await res.json());
      const wanted = subsetRows();
      const wantedIds = new Set(wanted.map((r) => r.id));

      const stamp = new Date().toISOString().slice(0, 10);
      const periodLabel = data.meta?.periodLabel ?? period;
      const base = `founder-os_all_${periodLabel.replace(/\s+/g, "_").toLowerCase()}_${stamp}.csv`;
      const rows: (string | number | null | undefined)[][] = [];

      // Section 1 — Performance (per-telecaller leaderboard)
      rows.push(["═══ PERFORMANCE (LEADERBOARD) ═══"]);
      rows.push([
        "Rank", "Sales staff", "Type", "Follow-ups", "NeoDove user",
        "Open (region)", "Won", "Conv %", "Pipeline ₹", "Closed ₹",
        "Calls Attempted", "Calls Connected", "Calls %", "Talk (min)",
        "Leads Generated", "Leads %", "Score",
        ...(showRisk ? ["At Risk", "Zombie"] : []),
      ]);
      data.leaderboard
        .filter((r) => wantedIds.has(r.id))
        .forEach((r, i) => {
          rows.push([
            i + 1,
            r.name,
            r.type === "field_staff" ? "Field Staff" : "Telecaller",
            r.type === "field_staff" ? "n/a" : r.assignEstimateFollowUps ? "yes" : "no",
            r.neodoveUserName,
            r.conversion.assigned,
            r.conversion.won,
            r.conversion.conversionRate,
            r.conversion.pipelineValue,
            r.conversion.acceptedValue ?? r.conversion.estimatedConversion?.value ?? 0,
            r.generation.callsAttempted,
            r.generation.callsConnected,
            r.generation.connectedPct,
            Math.round((r.generation.talkTimeSec ?? 0) / 60),
            r.generation.leadsGenerated,
            r.generation.leadsPct,
            r.score,
            ...(showRisk ? [r.risk?.atRisk ?? 0, r.risk?.zombie ?? 0] : []),
          ]);
        });
      rows.push([]);

      // Section 2 — Assignments (conversion summary)
      rows.push(["═══ ASSIGNMENTS (CONVERSION) ═══"]);
      rows.push(["Sales staff", "Type", "Open (region)", "Won", "Conv %", "Pipeline ₹", "Closed ₹"]);
      data.leaderboard
        .filter((r) => wantedIds.has(r.id))
        .forEach((r) => {
          rows.push([
            r.name,
            r.type === "field_staff" ? "Field Staff" : "Telecaller",
            r.conversion.assigned,
            r.conversion.won,
            r.conversion.conversionRate,
            r.conversion.pipelineValue,
            r.conversion.acceptedValue ?? r.conversion.estimatedConversion?.value ?? 0,
          ]);
        });
      rows.push([]);

      // Section 3 — Risk (open pipeline, informational only).
      if (showRisk) {
      rows.push(["═══ RISK (OPEN PIPELINE — INFORMATIONAL) ═══"]);
      rows.push([
        "Estimate", "Customer", "Lead owner", "Total ₹", "Risk",
        "Last Comment", "Stale (h)", "Reason",
      ]);
      (data.risk?.atRisk ?? [])
        .filter((r) => !wantedIds.size || (r.telecallerId && wantedIds.has(r.telecallerId)))
        .forEach((r) => {
          rows.push([
            r.estimateNumber ?? r.estimateId,
            r.customerName,
            r.telecallerName,
            r.total,
            r.risk,
            r.lastCommentDate,
            r.staleHours,
            r.snatchReason ?? r.reasoning,
          ]);
        });
      }

      // Section 4 — Daily (per-day × per-agent: every tag, call, lead)
      rows.push([]);
      rows.push(["═══ DAILY (DAY × AGENT — MIS DETAIL) ═══"]);
      rows.push(["NOTE: Won day = conversion day from the close ledger (20% generator / 80% closer)."]);
      if (data.dailyError) {
        rows.push([`Daily unavailable: ${data.dailyError}`]);
      } else {
        rows.push([
          "Date", "Day", "Telecaller", "Region",
          "Won", "Closed ₹", "Closed Estimates",
          "Calls Attempted", "Calls Connected", "Calls Not Conn.", "Talk (min)",
          "Leads Generated", "Leads Converted", "Score",
        ]);
        const daily = (data.daily ?? []).filter((d) => !wantedIds.size || wantedIds.has(d.telecallerId));
        const byDate = new Map<string, DailyRow[]>();
        for (const d of daily) {
          const arr = byDate.get(d.date) ?? [];
          arr.push(d);
          byDate.set(d.date, arr);
        }
        for (const [date, list] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const team = {
            won: 0, closedValue: 0, callsAttempted: 0, callsConnected: 0, callsNotConnected: 0,
            talkTimeMin: 0, leadsGenerated: 0, leadsConverted: 0, score: 0,
          };
          const closedTags: string[] = [];
          const regionTags = new Set<string>();
          for (const d of list) {
            team.won += d.won; team.closedValue += d.closedValue;
            team.callsAttempted += d.callsAttempted;
            team.callsConnected += d.callsConnected; team.callsNotConnected += d.callsNotConnected;
            team.talkTimeMin += d.talkTimeMin; team.leadsGenerated += d.leadsGenerated;
            team.leadsConverted += d.leadsConverted; team.score += d.score;
            if (d.closedEstimates) closedTags.push(`${d.telecallerName}: ${d.closedEstimates}`);
            rows.push([
              d.date, d.weekday, d.telecallerName,
              (d as any).region ?? "",
              d.won, d.closedValue, d.closedEstimates,
              d.callsAttempted, d.callsConnected, d.callsNotConnected, d.talkTimeMin,
              d.leadsGenerated, d.leadsConverted, d.score,
            ]);
          }
          rows.push([
            date, list[0]?.weekday ?? "", "— TEAM —", [...regionTags].join(" "),
            team.won, team.closedValue, closedTags.join(" ‖ "),
            team.callsAttempted, team.callsConnected, team.callsNotConnected, team.talkTimeMin,
            team.leadsGenerated, team.leadsConverted, team.score,
          ]);
        }
        if (daily.length === 0) rows.push(["No daily rows (empty range or single-day period)."]);
      }

      downloadCsv(base, rows);
    } catch (e: any) {
      setError(e?.message ?? "Export failed");
    } finally {
      setLoading(false);
    }
  };

  // Per-estimate MIS export — one row per estimate in the last N days (by
  // estimate/sent date), all statuses (sent/accepted/declined/confirmed), with
  // full lead detail. "Converted By" shows ONLY the lead generator's name
  // (from the +100 close ledger, which credits Estimate.createdBy) on
  // accepted/confirmed rows — blank on declined and still-open rows, by rule.
  const doExportEstimates = async () => {
    setLoadingEst(true);
    setError(null);
    try {
      const n = Math.min(365, Math.max(1, parseInt(days, 10) || 30));
      // IST day N days ago (matches the backend ledger's IST day strings).
      const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
      const since = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - n))
        .toISOString().slice(0, 10);
      const dayOf = (d: any): string => {
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
      list.sort((a, b) => dayOf(a?.date).localeCompare(dayOf(b?.date))
        || String(a?.estimateNumber ?? "").localeCompare(String(b?.estimateNumber ?? "")));

      const stamp = new Date().toISOString().slice(0, 10);
      const rows: (string | number | null | undefined)[][] = [];
      rows.push([`ESTIMATES — LAST ${n} DAYS (SINCE ${since}) — ${list.length} ROWS`]);
      rows.push([
        "Estimate", "Sent", "Enq", "Customer", "Contact", "Mobile",
        "Loc", "Source", "By", "Status", "Total ₹", "Converted By",
      ]);
      for (const e of list) {
        const status = String(e?.status ?? "").toLowerCase();
        const won = status === "accepted" || status === "confirmed";
        rows.push([
          e?.estimateNumber ?? e?.estimateId,
          dayOf(e?.date),
          e?.enquiryNumber ?? "",
          e?.customerName ?? "",
          e?.contactName ?? "",
          e?.contactPhone ?? "",
          e?.location ?? "",
          e?.sourceLead ?? "",
          e?.leadOf ?? "",
          status,
          e?.total ?? 0,
          won ? (converters[String(e?.estimateId ?? "")]?.name ?? "") : "",
        ]);
      }
      if (list.length === 0) rows.push(["No estimates in this window."]);
      downloadCsv(`founder-os_estimates_last_${n}days_${stamp}.csv`, rows);
    } catch (e: any) {
      setError(e?.message ?? "Estimates export failed");
    } finally {
      setLoadingEst(false);
    }
  };

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <h3 className="text-lg font-bold mb-1">📤 Export Data</h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
        Download the FULL telecalling payload as one CSV — performance (leaderboard), assignments (conversion),
        {showRisk ? " risk (open pipeline)," : ""} daily (day × agent: accepted/declined tags, calls, leads) sections.
        Generated client-side from the live dashboard endpoint. The estimates download below is the
        per-estimate MIS ledger for the last N days (by sent date) — contact, location, source, lead
        creator and Converted By (lead generator only; blank on declined/open rows).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none">
            {EXPORT_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Telecallers
          <select value={subset} onChange={(e) => setSubset(e.target.value)}
            className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 cursor-pointer focus:outline-none">
            <option value="all">All</option>
            <option value="followups">Follow-up specialists</option>
            <option value="leadgen">Lead-gen only</option>
            {rosterRows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button onClick={() => void doExport()} disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
          {loading ? "Exporting…" : "⬇ Download CSV"}
        </button>
        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
          Last N days (by sent date)
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" placeholder="30"
            className="w-24 px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 focus:outline-none" />
        </label>
        <button onClick={() => void doExportEstimates()} disabled={loadingEst}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
          {loadingEst ? "Exporting…" : "⬇ Download Estimates CSV"}
        </button>
        {error && <span className="text-xs text-rose-500">{error}</span>}
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-600 mt-2">
        Exports use their own period picker above (independent of the Dashboard
        leaderboard filter) plus the telecaller filter. Deleted agents and unassigned estimates
        are excluded. The daily section covers up to 93 days (year periods export the other sections only).
      </p>
    </section>
  );
}
