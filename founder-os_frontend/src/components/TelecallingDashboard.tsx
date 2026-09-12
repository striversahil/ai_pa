"use client";

import React, { Fragment, useState, useCallback, useEffect, useMemo } from "react";
import { Trash2 } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useLiveQuery, useLiveEvent } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";

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
}

interface DashData {
  meta: { day: string; requestedDay?: string; usingLatestAvailable?: boolean; unassignedSent: number; activeCount: number; telecallerCount: number; generatedAt: string; period?: string; periodLabel?: string; periodFrom?: string | null; periodTo?: string | null; workingDays?: number; targets?: { connectedCallsPerDay: number; leadsPerAgentPerDay: number }; conversionTarget?: { perDay: number; goldPerDay: number; workingDays: number; target: number; gold: number; value: number; pct: number; status: "below" | "hit" | "gold" }; agents?: { id: string; name: string; active: boolean }[]; selfAgentId?: string | null };
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

/** EOD remark-penalty countdown chip — the "get a meaningful update before 9 PM" signal. */
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
      <span title={`Unsatisfactory remark, or last update older than 24h — costs −10 at EOD${snatchInHours != null ? ` in ~${snatchInHours}h` : ""}`} className={`${base} bg-rose-500/10 text-rose-500 dark:text-rose-400 border-rose-500/30`}>
        ⚠{compact ? "" : ` −10 in ${snatchInHours != null ? `~${snatchInHours}h` : "EOD"}`}
      </span>
    );
  if (risk === "pending")
    return (
      <span title="Awaiting the AI verdict" className={`${base} bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/30`}>
        ⏳{compact ? "" : " Analyzing"}
      </span>
    );
  return (
    <span title="Meaningful update logged — no EOD deduction" className={`${base} bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border-emerald-500/30`}>
      🛡{compact ? "" : " Safe"}
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

interface AgentViewData {
  meta: { analysis: string; title: string; day: string; requestedDay?: string; usingLatestAvailable?: boolean; agents?: { id: string; name: string; active: boolean }[]; generatedAt: string; error?: string };
  agent: { id: string; name: string; active: boolean; conversion: any; generation: any; score: number; followUpCount: number };
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
  linkedUser?: { id: string; email: string; name: string; isRoot: boolean } | null;
}

type View = "dashboard" | "conversion" | "generation" | "controller";

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
  const canManageRoster = !!me && (me.isAdmin || me.scopes.includes("mis"));

  const dash = useLiveQuery<DashData>(
    async () => {
      const res = await fetch(`/api/automations/telecalling/data?period=${period}`);
      if (!res.ok) throw new Error(`Failed to load leaderboard (HTTP ${res.status})`);
      return res.json();
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
      return res.json();
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
      return res.json();
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
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Call-tag filters (Sheets-style): Not answering / Busy / Callback (+ due-by
  // date for callbacks). Pure client-side over the loaded follow-ups.
  const [tagFilter, setTagFilter] = useState<"ALL" | CallTagValue>("ALL");
  const [callbackDueBy, setCallbackDueBy] = useState<string>("");

  // A scoped (non-admin) sales agent is locked to their OWN lead conversion:
  // force the conversion view onto their agent id and never let them switch.
  const selfAgentId = dash.data?.meta?.selfAgentId ?? convDash.data?.meta?.selfAgentId ?? null;
  useEffect(() => {
    if (selfAgentId) setAgentFilter(selfAgentId);
  }, [selfAgentId]);

  // ── MIS estimate assignment overrides (lock to one agent / never assign) ──
  const [overrideBusy, setOverrideBusy] = useState(false);

  // Prefetch EVERY active agent's data in parallel (one round of requests),
  // refreshed on live events. Switching agents then reads from the local map —
  // instant, and it never shows another agent's stale data while loading.
  // Keyed off the CONVERSION data (default view) so agent follow-ups always
  // load regardless of what Dashboard period filter is active.
  const activeAgentIds = (convDash.data?.leaderboard ?? dash.data?.leaderboard ?? [])
    .map((r) => r.id);
  // A scoped (non-admin) agent only ever sees their OWN follow-ups — prefetch
  // just their id, never every agent.
  const agentIdsKey = selfAgentId ? selfAgentId : activeAgentIds.join(",");
  const agentViews = useLiveQuery<Record<string, AgentViewData | null>>(
    async () => {
      if (!agentIdsKey) return {};
      const ids = agentIdsKey.split(",");
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
    { events: TELECALLING_EVENTS, deps: [agentIdsKey], clearOnError: true },
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
  const refreshOneAgent = useCallback(async (agentId: string | null) => {
    if (!agentId) { agentViews.refresh(); return; }
    try {
      const res = await fetch(`/api/automations/telecalling/data?agent=${encodeURIComponent(agentId)}`);
      if (!res.ok) return;
      const view = (await res.json()) as AgentViewData;
      agentViews.setData((prev) => ({ ...(prev ?? {}), [agentId]: view }));
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
  const getAgentView = (id: string | null): AgentViewData | null => (id ? agentViewsMap[id] ?? null : null);
  const selectedAgentView = getAgentView(agentFilter);
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
  const saveRoster = async (updates: { name: string; email: string; phone: string; whatsapp: string; assignEstimateFollowUps: boolean }) => {
    if (!updates.name.trim()) return;
    setBusy(true);
    setRosterError(null);
    try {
      const payload = {
        name: updates.name,
        email: updates.email || null,
        phone: updates.phone || null,
        whatsapp: updates.whatsapp || null,
        assignEstimateFollowUps: updates.assignEstimateFollowUps,
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

  // ── "Active Penalty" runtime toggle (MIS Controller) ───────────────────────
  const [penaltyMode, setPenaltyMode] = useState<boolean | null>(null);
  const loadPenaltyMode = useCallback(async () => {
    if (!canManageRoster) return;
    try {
      const res = await fetch("/api/telecallers/penalty-mode");
      if (res.ok) setPenaltyMode((await res.json()).enabled ?? false);
    } catch { /* keep last known state */ }
  }, [canManageRoster]);
  useEffect(() => {
    void loadPenaltyMode();
  }, [loadPenaltyMode]);
  const togglePenaltyMode = async () => {
    setBusy(true);
    setRosterError(null);
    try {
      const next = !(penaltyMode ?? false);
      const res = await fetch("/api/telecallers/penalty-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      // Never flip the switch optimistically: a failed PUT (401/403/5xx) must
      // NOT display the new state — that exact lie caused the 2026-09-08
      // "penalty not working" report (UI said ON, server disagreed).
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Penalty toggle failed (${res.status})`);
      }
      const body = await res.json().catch(() => ({}));
      if (body && body.ok === false) throw new Error(body?.error || "Penalty toggle failed");
      setPenaltyMode(body?.enabled ?? next);
      refreshAll();
    } catch (e: any) {
      setRosterError(e?.message ?? "Penalty toggle failed");
    } finally {
      setBusy(false);
    }
  };

  // ── "EOD Reassignment" master switch (MIS Controller) ─────────────────────
  const [eodReassign, setEodReassign] = useState<boolean | null>(null);
  const loadEodReassign = useCallback(async () => {
    if (!canManageRoster) return;
    try {
      const res = await fetch("/api/telecallers/eod-reassign");
      if (res.ok) setEodReassign((await res.json()).enabled ?? true);
    } catch { /* keep last known state */ }
  }, [canManageRoster]);
  useEffect(() => {
    void loadEodReassign();
  }, [loadEodReassign]);
  const toggleEodReassign = async () => {
    setBusy(true);
    setRosterError(null);
    try {
      const next = !(eodReassign ?? true);
      const res = await fetch("/api/telecallers/eod-reassign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      // Same no-optimistic-flip rule as the penalty toggle: a failed PUT must
      // NOT display the new state.
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Reassignment toggle failed (${res.status})`);
      }
      const body = await res.json().catch(() => ({}));
      if (body && body.ok === false) throw new Error(body?.error || "Reassignment toggle failed");
      setEodReassign(body?.enabled ?? next);
      refreshAll();
    } catch (e: any) {
      setRosterError(e?.message ?? "Reassignment toggle failed");
    } finally {
      setBusy(false);
    }
  };
  // At-risk displays (leaderboard risk column, 🔥 At Risk section, snatch /
  // shield chips, export risk parts) are hidden while EOD Reassignment is OFF
  // — nothing can be snatched, so the labels are noise. Defaults to visible
  // (switch defaults ON; non-MIS viewers never load the switch state).
  const showRisk = eodReassign ?? true;

  // ── Absentee cover (MIS Controller): absent → equal redistribution ─────────
  const toggleAbsent = async (id: string, isAbsent: boolean) => {
    setBusy(true);
    setRosterError(null);
    try {
      const res = await fetch(`/api/telecallers/${id}/absent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absent: !isAbsent }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const body = await res.json().catch(() => ({}));
      if (body && body.ok === false) throw new Error(body?.error || "Request failed");
      refreshAll();
    } catch (e: any) {
      setRosterError(e?.message ?? "Mark absent/present failed");
    } finally {
      setBusy(false);
    }
  };

  const kpi = dash.data?.kpi;
  const board = [...(dash.data?.leaderboard ?? [])];
  const activeBoard = board;
  // Lead Conversion board — driven by ITS OWN convDash/period, not the dashboard.
  const convBoard = [...(convDash.data?.leaderboard ?? [])];
  const convActiveBoard = convBoard;
  // Lead Generation board — driven by its OWN genDash/period, not the leaderboard period.
  const genBoard = [...(genDash.data?.leaderboard ?? [])];
  const genActiveBoard = genBoard;
  // Est. Conv ₹ = ACCEPTED actuals in the selected period. Prefers the
  // server-side team total so it matches meta.conversionTarget.value exactly.
  const teamAccepted = kpi?.acceptedValue ?? activeBoard.reduce((s, r) => s + (r.conversion.acceptedValue ?? 0), 0);
  const conv = convTier(teamAccepted, dash.data?.meta?.conversionTarget ?? null);
  const sorted = [...activeBoard].sort((a, b) => {
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
                  Daily performance · Lead Conversion (estimates) + Lead Generation (NeoDove, live)
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
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* Tabs (full-width horizontal row) */}
        <aside className="w-full shrink-0">
          <nav className="flex flex-row flex-wrap gap-2">
            {TABS.filter((t) => t.key !== "controller" || canManageRoster).map((t) => {
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

              {/* Leaderboard */}
              {Boolean(dash.error) && !dash.loading && (
                <QueryErrorBanner message={String((dash.error as any)?.message ?? dash.error)} onRetry={() => dash.refresh()} />
              )}
              <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-lg font-bold">🏆 Leaderboard — {dash.data?.meta?.periodLabel ?? "Today"}</h3>
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
                          <ul className="space-y-1.5 list-none">
                            <li><span className="font-bold text-emerald-500 dark:text-emerald-400">+50 – +200</span> — you <span className="font-semibold">convert</span> an estimate (customer accepts / confirms), scored by its value. Credited to whoever generated the lead.
                              <span className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-2 py-1.5 font-semibold">
                                <span>₹0 – ₹1L <span className="float-right font-mono font-bold text-emerald-500 dark:text-emerald-400">+50</span></span>
                                <span>₹1L – ₹2.5L <span className="float-right font-mono font-bold text-emerald-500 dark:text-emerald-400">+75</span></span>
                                <span>₹2.5L – ₹5L <span className="float-right font-mono font-bold text-emerald-500 dark:text-emerald-400">+100</span></span>
                                <span>₹5L &amp; above <span className="float-right font-mono font-bold text-emerald-500 dark:text-emerald-400">+200</span></span>
                              </span>
                            </li>
                            <li><span className="font-bold text-amber-500 dark:text-amber-400">+15</span> — each <span className="font-semibold">new lead</span> you generate.</li>
                            <li><span className="font-bold text-indigo-500 dark:text-indigo-400">+0.5</span> — each <span className="font-semibold">connected call</span>.</li>
                            <li><span className="font-bold text-rose-500 dark:text-rose-400">−10</span> — each <span className="font-semibold">red (unsatisfactory) estimate</span> you still hold at the 9 PM EOD run (once per estimate per day; working days only — zero NeoDove calls that day means zero deduction for everyone).</li>
                            <li className="pt-1 border-t border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-500">🏆 The leaderboard ranks by <span className="font-semibold text-zinc-700 dark:text-zinc-200">composite score</span> = close +50–200 (by value) · lead +15 · call +0.5 · <span className="text-rose-500">red-hold −10</span>{penaltyMode ? <span> (Active Penalty ON — penalties apply)</span> : <span> (Active Penalty OFF — penalties paused)</span>}. Risk-based re-poaching follows the Controller's 🔁 EOD Reassignment switch (currently OFF — holders keep everything). The table restarts at zero every week so everyone gets a fair shot.<br />Retired rules (−15 snatch, −20 decline, 🛡 shields): no new rows — old rows still count in past totals while ON.</li>
                          </ul>
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
                        <th className="text-left py-2 pr-4 min-w-[11rem]">Telecaller</th>
                        <th className="text-right py-2 pr-4">Leads</th>
                        <th className="text-right py-2 pr-4">Est. Won</th>
                        <th className="text-right py-2 pr-4">Calls</th>
                        <th className="text-right py-2 pr-4">Talk</th>
                        {showRisk && <th className="text-right py-2 pr-4">Risk</th>}
                        <th className="text-right py-2 pr-4 whitespace-nowrap min-w-[12rem]">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((t, i) => {
                        const open = expandedId === t.id;
                        const view = getAgentView(t.id);
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
                                  title={open ? "Hide assigned estimates" : "Show assigned estimates"}
                                >
                                  {t.name}
                                  <span className={`text-[10px] text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
                                </button>
                              </td>
                              <td className="py-2 pr-4 text-right font-mono">{fmtNum(t.generation.leadsGenerated)}</td>
                              <td className="py-2 pr-4 text-right text-emerald-400 font-mono whitespace-nowrap">
                                {t.conversion.won}
                              </td>
                              <td className="py-2 pr-4 text-right font-mono">{fmtNum(t.generation.callsConnected)}</td>
                              <td className="py-2 pr-4 text-right font-mono text-indigo-300">{fmtTalk(t.generation.talkTimeSec)}</td>
                              {showRisk && (
                              <td className="py-2 pr-4 text-right font-mono whitespace-nowrap">
                                {(t.risk?.atRisk ?? 0) + (t.risk?.zombie ?? 0) > 0 ? (
                                  <span className="text-rose-400 font-bold" title="Open estimates red (no meaningful update) or zombie (silent > 3 days) — lost at EOD">
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
                                <td colSpan={8} className="py-2 pr-4">
                                  <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <h4 className="text-sm font-bold text-zinc-900 dark:text-white">
                                        {t.name} — assigned estimates
                                        <span className="ml-2 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                                          ({view?.agent?.followUpCount ?? t.conversion.assigned})
                                        </span>
                                      </h4>
                                      {view && (
                                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                          {view.agent.conversion?.assigned ?? 0} assigned · {view.agent.conversion?.won ?? 0} won ·{" "}
                                          {view.agent.conversion?.conversionRate ?? 0}% conv · Est. Conv ₹{" "}
                                          {fmtNum(view.agent.conversion?.acceptedValue ?? view.agent.conversion?.estimatedConversion?.value ?? 0)}
                                        </span>
                                      )}
                                    </div>
                                    {agentViews.loading && !view && <p className="text-xs text-zinc-500">Loading assigned estimates…</p>}
                                    {!agentViews.loading && !view && Boolean(agentViews.error) && (
                                      <p className="text-xs text-rose-500">Couldn't load this agent's estimates — <button className="underline font-semibold" onClick={() => agentViews.refresh()}>retry</button>.</p>
                                    )}
                                    {!agentViews.loading && view && (view?.followUps?.length ?? 0) === 0 && (
                                      <p className="text-xs text-zinc-500">No assigned estimates for this agent.</p>
                                    )}
                                    <div className="grid gap-1.5 sm:grid-cols-2">
                                      {(view?.followUps ?? []).map((f) => (
                                        <div key={f.estimateId} className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5">
                                          <div className="min-w-0">
                                            <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{f.customerName ?? "—"}</div>
                                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId}</div>
                        <LeadChips f={f} />
                        <CallTagControl f={f} onSaved={() => void refreshOneAgent(t.id)} onTag={applyTagOverride} />
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
                        <tr><td colSpan={8} className="py-4 text-center text-zinc-500">No active telecallers yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Founder pre-warning: open estimates about to be snatched at EOD.
                  Hidden while EOD Reassignment is OFF (nothing can be snatched). */}
              {showRisk && dash.data?.risk && (dash.data.risk.counts.red > 0 || dash.data.risk.counts.zombie > 0) && (
                <section className="bg-rose-500/5 border border-rose-500/30 rounded-xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h3 className="text-lg font-bold text-rose-500 dark:text-rose-400">
                      {selfAgentId ? "🔥 Your At Risk — will be snatched at EOD (9 PM IST)" : "🔥 At Risk — about to be snatched at EOD (9 PM IST)"}
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
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{r.estimateNumber ?? r.estimateId} · {r.telecallerName ?? "—"}</div>
                          </div>
                          <div className="text-right shrink-0 space-y-0.5">
                            <div className="text-[11px] font-mono text-emerald-400">₹{fmtNum(Number(r.total ?? 0))}</div>
                            <div className="flex justify-end gap-1">
                              <StaleChip compact staleHours={r.staleHours} />
                              <SnatchChip compact risk={r.risk} snatchInHours={r.snatchInHours} />
                              <ShieldChip
                                compact
                                shield={(() => {
                                  const s = (dash.data?.shielded ?? []).find((x) => x.estimateId === r.estimateId);
                                  return s ? { status: s.status, reason: s.reason, n: s.n, spanH: s.spanH, streak: s.streak } : null;
                                })()}
                              />
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
                    Red = latest AI verdict found no meaningful update · Zombie = no comment for over 3 days. Both are re-poached to a higher-converting agent at tonight's sweep.
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
                    ? "Your assigned estimates — call them and log a meaningful update before the end-of-day sweep."
                    : "Sent estimates are distributed across telecallers. Switch between agent tabs to see each one's assigned estimates."}
                </p>
              </div>

              {/* Team-wide effort shields — earned red/zombie holdings the engine
                  will NOT snatch today (3+ spread calls). Shown as a 🛡 chip on
                  the estimate rows below (joined from the payload's shielded
                  list), next to the other chips. */}

              {/* Horizontal agent tabs — hidden for scoped (self-only) agents */}
              {!selfAgentId && (
                <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
                  <button
                    onClick={() => setAgentFilter(null)}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                      !agentFilter
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                        : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500"
                    }`}
                  >
                    All
                  </button>
                  {(convDash.data?.meta?.agents ?? convActiveBoard).map((t) => {
                    const board = convActiveBoard.find((b) => b.id === t.id);
                    const count = board?.conversion.assigned ?? 0;
                    const active = agentFilter === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setAgentFilter(active ? null : t.id)}
                        className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                          active
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                            : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500"
                        }`}
                      >
                        {t.name}
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${active ? "bg-white/20" : "bg-zinc-100 dark:bg-zinc-700/60 text-zinc-500 dark:text-zinc-400"}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {!selfAgentId && !agentFilter && (
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
                  {convActiveBoard.length === 0 && <p className="text-sm text-zinc-500">No active telecallers.</p>}
                      {convActiveBoard.map((t) => (
                      <button
                      key={t.id}
                      onClick={() => setAgentFilter(t.id)}
                      className="w-full flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors cursor-pointer group"
                    >
                      <span className="font-semibold text-zinc-900 dark:text-white group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors">
                        {t.name}
                      </span>
                      <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono">
                        {t.conversion.assigned} assigned · {t.conversion.won} won · {t.conversion.conversionRate}% · ₹{fmtNum(t.conversion.pipelineValue)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {agentFilter && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-zinc-900 dark:text-white">
                      {selfAgentId ? "Your follow-ups" : `${selectedAgentView?.agent?.name ?? "…"} — follow-ups`} ({selectedAgentView?.agent?.followUpCount ?? 0})
                    </h4>
                    {!selfAgentId && (
                      <button onClick={() => setAgentFilter(null)} className="text-xs text-indigo-400 hover:underline">Back to all</button>
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
                    <p className="text-sm text-zinc-500">No follow-up estimates assigned to this agent.</p>
                  )}
                  {!agentViews.loading && (selectedAgentView?.followUps?.length ?? 0) > 0 && visibleFollowUps.length === 0 && (
                    <p className="text-sm text-zinc-500">{filtersActive ? "No follow-ups match the active filters." : "No follow-ups for this agent."}</p>
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
                            {showRisk && <ShieldChip shield={f.shield} />}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">{f.estimateNumber ?? f.estimateId}</div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-zinc-700 dark:text-zinc-300">{f.status ?? "—"}</span>
                            <span className="text-xs font-mono text-emerald-400">₹{fmtNum(Number(f.total ?? 0))}</span>
                          </div>
                        </div>
                        <LeadChips f={f} />
                        <CallTagControl f={f} onSaved={() => void refreshOneAgent(agentFilter)} onTag={applyTagOverride} />
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
                        {showRisk && (f.risk === "red" || f.risk === "zombie") && f.snatchReason && (
                          <p className="text-[11px] text-rose-600/80 dark:text-rose-400/70 leading-snug line-clamp-2" title={f.snatchReason}>
                            {f.snatchReason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Controller — MIS-only: roster + all telecalling control actions */}
          {view === "controller" && (
            canManageRoster ? (
              <div className="space-y-6">
                <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                  <h3 className="text-lg font-bold mb-1">🎛️ Controller</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                    MIS-level control of telecalling — the roster below drives the automatic
                    estimate assignment and end-of-day reassignment engine. Changes apply from
                    the next rotation.
                  </p>
                </section>
                {/* Active Penalty master toggle (MIS) */}
                <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold mb-1">⚖️ Active Penalty</h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xl">
                        Master switch for all penalties, ON by default: the −10
                        EOD remark deduction applies. OFF pauses every penalty
                        (no −10 charged, penalties ignored in scores). Temp
                        absent-cover holds are always penalty-free.
                      </p>
                    </div>
                    <button
                      onClick={togglePenaltyMode}
                      disabled={busy || penaltyMode === null}
                      className={`shrink-0 text-sm font-bold rounded-lg px-5 py-2.5 transition-colors disabled:opacity-60 ${
                        penaltyMode
                          ? "bg-rose-600 hover:bg-rose-500 text-white"
                          : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700"
                      }`}
                      title="Toggles whether penalties (−10 EOD remark deduction) apply to agents"
                    >
                      {penaltyMode === null ? "…" : penaltyMode ? "Active Penalty: ON" : "Active Penalty: OFF"}
                    </button>
                  </div>
                </section>
                {/* EOD Reassignment master switch (MIS) */}
                <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold mb-1">🔁 EOD Reassignment</h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-xl">
                        Master switch for risk-based reassignment. ON (default):
                        red/zombie estimates are re-poached to a better converter
                        at the engine runs. OFF: no risk re-poaching — only
                        unassigned estimates get dealt, MIS locks enforced, and
                        lead-gen-held estimates corrected back to converters.
                      </p>
                    </div>
                    <button
                      onClick={toggleEodReassign}
                      disabled={busy || eodReassign === null}
                      className={`shrink-0 text-sm font-bold rounded-lg px-5 py-2.5 transition-colors disabled:opacity-60 ${
                        eodReassign ?? true
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                          : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700"
                      }`}
                      title="Toggles whether at-risk estimates are re-poached at the engine runs"
                    >
                      {eodReassign === null ? "…" : eodReassign ? "EOD Reassignment: ON" : "EOD Reassignment: OFF"}
                    </button>
                  </div>
                </section>
                <EstimateOverridesSection
                  rosterRows={rosterRows}
                  busy={overrideBusy}
                  setBusy={setOverrideBusy}
                />
                <BulkModifySection
                  rosterRows={rosterRows}
                  refreshAll={refreshAll}
                  setRosterError={setRosterError}
                />
                <ExportDataSection rosterRows={rosterRows} showRisk={showRisk} />
                <RosterSection
                  rosterRows={rosterRows}
                  busy={busy}
                  rosterError={rosterError}
                  onAdd={() => { setEditTarget(null); setRosterModalOpen(true); }}
                  onEditModal={(t) => { setEditTarget(t); setRosterModalOpen(true); }}
                  onToggleFollowUps={toggleFollowUps}
                  onToggleAbsent={toggleAbsent}
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
                    Per-telecaller NeoDove performance (live) — sourced from the NeoDove worker database.
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
                    <span className="text-zinc-700 dark:text-zinc-300 font-semibold">≥ {genDash.data.meta.targets.leadsPerAgentPerDay} leads</span> (in-progress + converted). Traffic light: 🟢 ≥100% · 🟡 60–99% · 🔴 &lt;60%
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
                          <span className="text-[10px] text-zinc-600 dark:text-zinc-500">{t.neodoveUserName ?? "—"}</span>
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
                          {t.conversion.won} won / {t.conversion.assigned} assigned
                        </span>
                      </div>
                      {(() => {
                        const open = expandedId === t.id;
                        const view = getAgentView(t.id);
                        return (
                          <div className="pt-1 border-t border-zinc-200/80 dark:border-zinc-800/80">
                            <button
                              onClick={() => setExpandedId(open ? null : t.id)}
                              className="w-full inline-flex items-center justify-between gap-2 text-xs font-semibold text-indigo-500 dark:text-indigo-400 hover:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                            >
                              <span>Assigned estimates ({view?.agent?.followUpCount ?? t.conversion.assigned})</span>
                              <span className={`text-[10px] text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
                            </button>
                            {open && (
                              <div className="mt-2 space-y-1.5">
                                {agentViews.loading && !view && <p className="text-[11px] text-zinc-500">Loading…</p>}
                                {!agentViews.loading && !view && Boolean(agentViews.error) && (
                                  <p className="text-[11px] text-rose-500">Couldn't load estimates — <button className="underline font-semibold" onClick={() => agentViews.refresh()}>retry</button>.</p>
                                )}
                                {!agentViews.loading && view && (view?.followUps?.length ?? 0) === 0 && (
                                  <p className="text-[11px] text-zinc-500">No assigned estimates.</p>
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
                                    <CallTagControl f={f} compact onSaved={() => void refreshOneAgent(t.id)} onTag={applyTagOverride} />
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
                  <p className="text-sm text-zinc-500">No active telecallers yet — add them in the Dashboard roster and link each to their NeoDove user.</p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

interface OverrideEstimate {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  status: string;
  total: number;
  date: string;
  assignedTelecallerId: string | null;
  lockedTelecallerId: string | null;
  skipAssignment: boolean;
}

/**
 * MIS-only estimate assignment overrides: lock an estimate to a single agent
 * (never re-poached, even when red/zombie) or mark it never-assign (excluded
 * from the assignment engine entirely). Both take precedence over everything.
 */
function EstimateOverridesSection({
  rosterRows,
  busy,
  setBusy,
}: {
  rosterRows: RosterRow[];
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OverrideEstimate[]>([]);
  const [modified, setModified] = useState<OverrideEstimate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const agentName = (id: string | null | undefined) =>
    id ? rosterRows.find((r) => r.id === id)?.name ?? "—" : "—";

  const search = useCallback(async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/estimates/assignment-overrides?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setResults(data.estimates ?? []);
      setLoaded(true);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, [q, setBusy]);

  const loadModified = useCallback(async () => {
    try {
      const res = await fetch("/api/estimates/assignment-overrides?modified=1");
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setModified(data.estimates ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // On load, only show estimates that already have an override. The search
    // results list stays empty until the user actually searches.
    void loadModified();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save on every change — no save button. Updates the view optimistically
  // (instant), then persists to the backend. The PUT route broadcasts a live
  // `telecalling` event which refreshes the dashboard automatically — no manual
  // refetch here (avoids duplicate API calls).
  const apply = async (est: OverrideEstimate, locked: string, skip: boolean) => {
    setSavingId(est.estimateId);
    const patch = { ...est, lockedTelecallerId: locked || null, skipAssignment: skip };
    setResults((prev) => prev.map((r) => (r.estimateId === est.estimateId ? patch : r)));
    setModified((prev) => {
      const rest = prev.filter((r) => r.estimateId !== est.estimateId);
      return patch.lockedTelecallerId || patch.skipAssignment ? [patch, ...rest] : rest;
    });
    try {
      const res = await fetch(`/api/estimates/${est.estimateId}/assignment-override`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockedTelecallerId: locked || null, skipAssignment: skip }),
      });
      // A non-OK HTTP status is a failure too — fetch only throws on network
      // errors, so check explicitly (a 401/403/500 must revert, not persist).
      if (!res.ok) throw new Error(`Override save failed (${res.status})`);
    } catch {
      // revert on failure so the UI never lies about the saved state
      setResults((prev) => prev.map((r) => (r.estimateId === est.estimateId ? est : r)));
      setModified((prev) => {
        const rest = prev.filter((r) => r.estimateId !== est.estimateId);
        return est.lockedTelecallerId || est.skipAssignment ? [est, ...rest] : rest;
      });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h3 className="text-lg font-bold">🔒 Estimate Assignment Overrides</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Lock an estimate to <span className="font-semibold text-zinc-700 dark:text-zinc-300">one agent</span> (never re-poached, even at EOD) or mark it{" "}
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">never-assign</span> (stays unassigned). Overrides beat the assignment engine —{" "}
            <span className="font-semibold">changes save automatically</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
            placeholder="Search estimate # / customer / id…"
            className="px-3 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-400 w-64"
          />
          <button
            onClick={() => void search()}
            disabled={busy}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
          >
            Search
          </button>
        </div>
      </div>

      {busy && results.length === 0 && <p className="text-xs text-zinc-500">Loading…</p>}
      {!busy && loaded && results.length === 0 && q.trim() && (
        <p className="text-xs text-zinc-500">No estimates found. Search by estimate number, customer name or id.</p>
      )}
      {!busy && !q.trim() && results.length === 0 && (
        <p className="text-xs text-zinc-500">Search for an estimate above to set its assignment override.</p>
      )}

      <div className="space-y-2">
        {results.map((est) => {
          const isLocked = !!est.lockedTelecallerId;
          const lockedName = agentName(est.lockedTelecallerId || null);
          const saving = savingId === est.estimateId;
          return (
            <div key={est.estimateId} className={`rounded-lg border bg-white dark:bg-zinc-950 px-3 py-2.5 space-y-2 ${isLocked || est.skipAssignment ? "border-indigo-400/40 dark:border-indigo-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                    {est.estimateNumber} · {est.customerName}
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                    {est.status} · ₹{fmtNum(Number(est.total ?? 0))} · now: {agentName(est.assignedTelecallerId)}
                    {est.lockedTelecallerId ? " · 🔒 locked" : ""}
                    {est.skipAssignment ? " · 🚫 never-assign" : ""}
                  </div>
                </div>
                {saving && <span className="text-[10px] text-indigo-400 font-semibold shrink-0">saving…</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 whitespace-nowrap">Lock to:</label>
                  <select
                    value={est.lockedTelecallerId ?? ""}
                    onChange={(e) => void apply(est, e.target.value, est.skipAssignment)}
                    disabled={saving}
                    className="px-2 py-1 text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 focus:outline-none disabled:opacity-50"
                  >
                    <option value="">— no lock —</option>
                    {rosterRows.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={est.skipAssignment}
                    onChange={(e) => void apply(est, est.lockedTelecallerId ?? "", e.target.checked)}
                    disabled={saving}
                    className="accent-rose-500 disabled:opacity-50"
                  />
                  Never assign
                </label>
              </div>
              {(isLocked || est.skipAssignment) && (
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {isLocked && <span className="text-indigo-500 dark:text-indigo-400">🔒 Locked to {lockedName} — never re-poached, even if red/zombie.</span>}
                  {isLocked && est.skipAssignment && <span> </span>}
                  {est.skipAssignment && <span className="text-rose-500 dark:text-rose-400">🚫 Never assigned to any agent.</span>}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Modified estimates summary — every estimate with an active override. */}
      {modified.length > 0 && (
        <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Modified assignments ({modified.length})
            </h4>
            <span className="text-[10px] text-zinc-400">auto-saved</span>
          </div>
          <div className="grid gap-1.5 md:grid-cols-2">
            {modified.map((est) => (
              <div key={est.estimateId} className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 bg-white dark:bg-zinc-950">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-zinc-900 dark:text-white truncate">{est.estimateNumber}</div>
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                    {est.lockedTelecallerId
                      ? `🔒 → ${agentName(est.lockedTelecallerId)}`
                      : "🔒 → (locked)"}
                    {est.lockedTelecallerId && est.skipAssignment ? " · " : ""}
                    {est.skipAssignment ? "🚫 never-assign" : ""}
                  </div>
                </div>
                <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 shrink-0 whitespace-nowrap">
                  now: {agentName(est.assignedTelecallerId)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Query error banner with retry — pairs with the useLiveQuery fetch timeout so
 * a stalled/slow backend surfaces as an actionable error instead of an
 * eternal spinner (the endless-loader incident, 2026-09-08).
 */
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

/**
 * MIS-only bulk modification: hand-pick individual estimates (search by number
 * / customer / id), tick them, choose ONE target agent and move them all at
 * once. The correction tool for AI hallucinations and misassignments — moves
 * are one-time assigns (ledger rows written, NO locks, NO score penalties).
 */
function BulkModifySection({
  rosterRows,
  refreshAll,
  setRosterError,
}: {
  rosterRows: RosterRow[];
  refreshAll: () => void;
  setRosterError: (msg: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OverrideEstimate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [report, setReport] = useState<{ moved: any[]; skipped: any[]; errors: any[] } | null>(null);

  const agentName = (id: string | null | undefined) =>
    id ? rosterRows.find((r) => r.id === id)?.name ?? "—" : "unassigned";

  const search = useCallback(async () => {
    if (!q.trim()) return;
    setSearching(true);
    setReport(null);
    try {
      const res = await fetch(`/api/estimates/assignment-overrides?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setResults(data.estimates ?? []);
      setSelected(new Set());
      setLoaded(true);
    } catch {
      setRosterError("Bulk search failed — please retry");
    } finally {
      setSearching(false);
    }
  }, [q, setRosterError]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => (prev.size === results.length ? new Set() : new Set(results.map((r) => r.estimateId))));
  };

  const assign = async () => {
    if (selected.size === 0 || !targetId) return;
    setAssigning(true);
    setRosterError(null);
    setReport(null);
    try {
      const res = await fetch("/api/estimates/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moves: [...selected].map((estimateId) => ({ estimateId, telecallerId: targetId })),
          reason: reason.trim() || "MIS bulk modification",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      setReport({ moved: body.moved ?? [], skipped: body.skipped ?? [], errors: body.errors ?? [] });
      if ((body.errors ?? []).length > 0) {
        setRosterError(`Bulk assign completed with ${(body.errors ?? []).length} error(s) — see report below`);
      }
      // Reflect the moves locally so the list stays truthful without a re-search.
      const movedIds = new Set((body.moved ?? []).map((m: any) => m.estimateNumber));
      setResults((prev) =>
        prev.map((r) => (movedIds.has(r.estimateNumber) ? { ...r, assignedTelecallerId: targetId } : r)),
      );
      setSelected(new Set());
      refreshAll();
    } catch (e: any) {
      setRosterError(e?.message ?? "Bulk assign failed");
    } finally {
      setAssigning(false);
    }
  };

  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h3 className="text-lg font-bold">🔀 Bulk Modification</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Fix misassignments (AI hallucinations etc.): tick estimates below and move them all to{" "}
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">one agent</span>. One-time move —{" "}
            <span className="font-semibold">no locks, no penalties</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
            placeholder="Search estimate # / customer / id…"
            className="px-3 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-400 w-64"
          />
          <button
            onClick={() => void search()}
            disabled={searching}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
          >
            {searching ? "…" : "Search"}
          </button>
        </div>
      </div>

      {searching && results.length === 0 && <p className="text-xs text-zinc-500">Loading…</p>}
      {!searching && loaded && results.length === 0 && q.trim() && (
        <p className="text-xs text-zinc-500">No estimates found. Search by estimate number, customer name or id.</p>
      )}
      {!searching && !q.trim() && results.length === 0 && (
        <p className="text-xs text-zinc-500">Search for estimates above, tick the ones to fix, then assign them to an agent.</p>
      )}

      {results.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <button onClick={toggleAll} className="text-xs font-semibold text-indigo-500 dark:text-indigo-400 hover:underline">
              {selected.size === results.length ? "Deselect all" : `Select all (${results.length})`}
            </button>
            <span className="text-xs text-zinc-500">{selected.size} selected</span>
          </div>
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {results.map((est) => {
              const checked = selected.has(est.estimateId);
              return (
                <label
                  key={est.estimateId}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${checked ? "border-indigo-400/60 dark:border-indigo-500/60 bg-indigo-500/5" : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOne(est.estimateId)}
                    className="accent-indigo-600 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                      {est.estimateNumber} · {est.customerName}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                      {est.status} · ₹{fmtNum(Number(est.total ?? 0))} · now: {agentName(est.assignedTelecallerId)}
                      {est.lockedTelecallerId ? " · 🔒 locked" : ""}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <label className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 whitespace-nowrap">Move to:</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              disabled={assigning}
              className="px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 focus:outline-none disabled:opacity-50"
            >
              <option value="">— choose agent —</option>
              {rosterRows.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.assignEstimateFollowUps ? "" : " (lead-gen)"}</option>
              ))}
            </select>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, shown in history)…"
              className="flex-1 min-w-40 px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-indigo-400"
            />
            <button
              onClick={() => void assign()}
              disabled={assigning || selected.size === 0 || !targetId}
              className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
            >
              {assigning ? "Moving…" : `Assign selected (${selected.size})`}
            </button>
          </div>
        </>
      )}

      {report && (
        <div className="mt-3 text-xs space-y-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2">
          <div className="font-bold text-emerald-500 dark:text-emerald-400">✓ Moved {report.moved.length}</div>
          {report.skipped.length > 0 && (
            <div className="text-zinc-500 dark:text-zinc-400">
              Skipped ({report.skipped.length}): {report.skipped.map((s: any) => `${s.estimateNumber} (${s.reason ?? s.status})`).join(", ")}
            </div>
          )}
          {report.errors.length > 0 && (
            <div className="text-rose-500 dark:text-rose-400">
              Errors ({report.errors.length}): {report.errors.map((e: any) => `${e.estimateNumber ?? e.ident ?? "?"} — ${e.error}`).join("; ")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RosterSection({
  rosterRows,
  busy,
  rosterError,
  onAdd,
  onEditModal,
  onToggleFollowUps,
  onToggleAbsent,
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
  onToggleAbsent: (id: string, isAbsent: boolean) => void;
  onDelete: (t: RosterRow) => void;
  onRestore: (id: string) => void;
  deletedRows: RosterRow[];
  showDeleted: boolean;
  onToggleShowDeleted: (open: boolean) => void;
}) {
  return (
    <section className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold">Telecaller Roster</h3>
        <button onClick={onAdd} disabled={busy}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-60">
          + Add agent
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
              <div className="flex items-center gap-1">
                {t.absentSince && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 font-semibold">
                    Absent
                  </span>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${t.assignEstimateFollowUps ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-200 dark:bg-zinc-800 text-zinc-500"}`}>
                  {t.assignEstimateFollowUps ? "Follow-ups" : "Lead-gen only"}
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
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Total assigned: {t.totalAssigned}</div>
            <div className="flex gap-2 mt-3 flex-wrap">
              <button onClick={() => onEditModal(t)} className="flex-1 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 py-1.5 font-semibold hover:bg-zinc-200 dark:hover:bg-zinc-700">Edit</button>
              <button onClick={() => onToggleFollowUps(t.id, t.assignEstimateFollowUps)} className={`flex-1 text-xs rounded-lg py-1.5 font-semibold ${
                t.assignEstimateFollowUps
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              }`} title="Toggles whether this telecaller receives estimate follow-up assignments">
                {t.assignEstimateFollowUps ? "No follow-ups" : "Assign follow-ups"}
              </button>
              <button
                onClick={() => onToggleAbsent(t.id, !!t.absentSince)}
                disabled={busy}
                className={`flex-1 text-xs rounded-lg py-1.5 font-semibold disabled:opacity-40 ${
                  t.absentSince
                    ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    : "bg-amber-500/10 text-amber-500 dark:text-amber-400 hover:bg-amber-500/20"
                }`}
                title={t.absentSince
                  ? "Mark present — her temp-covered estimates return to her and normal scoring resumes"
                  : "Mark absent — all her open estimates are dealt equally to the active conversion agents (no penalties; they come back when she returns)"}
              >
                {t.absentSince ? "Mark present" : "Mark absent"}
              </button>
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
        {rosterRows.length === 0 && <p className="text-sm text-zinc-500">No telecallers yet — add one below.</p>}
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
                  Total assigned: {t.totalAssigned}
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
  onSave: (updates: { name: string; email: string; phone: string; whatsapp: string; assignEstimateFollowUps: boolean }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [followUps, setFollowUps] = useState(true);

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
    } else {
      setName(""); setEmail(""); setPhone(""); setWhatsapp(""); setFollowUps(true);
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
          <h4 className="font-bold text-zinc-900 dark:text-white">{isCreate ? "Add agent" : "Edit agent"}</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {isCreate ? "Create a roster entry with contact details." : "Update contact details and role. NeoDove mapping is read-only."}
          </p>
        </div>

        <div className="space-y-3">
          {field("Name", <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Full name" />)}
          {field("Email", <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="Email" />)}
          {field("Phone", <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="Phone" />)}
          {field("WhatsApp", <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={inputCls} placeholder="WhatsApp" />)}

          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={followUps} onChange={(e) => setFollowUps(e.target.checked)} className="accent-indigo-500" />
            Receives estimate follow-ups
          </label>

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
            onClick={() => onSave({ name, email, phone, whatsapp, assignEstimateFollowUps: followUps })}
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
      const data: DashData = await res.json();
      const wanted = subsetRows();
      const wantedIds = new Set(wanted.map((r) => r.id));

      const stamp = new Date().toISOString().slice(0, 10);
      const periodLabel = data.meta?.periodLabel ?? period;
      const base = `founder-os_all_${periodLabel.replace(/\s+/g, "_").toLowerCase()}_${stamp}.csv`;
      const rows: (string | number | null | undefined)[][] = [];

      // Section 1 — Performance (per-telecaller leaderboard)
      rows.push(["═══ PERFORMANCE (LEADERBOARD) ═══"]);
      rows.push([
        "Rank", "Telecaller", "Follow-ups", "NeoDove user",
        "Assigned", "Won", "Conv %", "Pipeline ₹", "Est. Closed ₹",
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
            r.assignEstimateFollowUps ? "yes" : "no",
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
      rows.push(["Telecaller", "Assigned", "Won", "Conv %", "Pipeline ₹", "Est. Closed ₹"]);
      data.leaderboard
        .filter((r) => wantedIds.has(r.id))
        .forEach((r) => {
          rows.push([
            r.name,
            r.conversion.assigned,
            r.conversion.won,
            r.conversion.conversionRate,
            r.conversion.pipelineValue,
            r.conversion.acceptedValue ?? r.conversion.estimatedConversion?.value ?? 0,
          ]);
        });
      rows.push([]);

      // Section 3 — Risk (open pipeline about to be re-poached). Skipped while
      // EOD Reassignment is OFF (nothing can be snatched).
      if (showRisk) {
      rows.push(["═══ RISK (OPEN PIPELINE) ═══"]);
      rows.push([
        "Estimate", "Customer", "Telecaller", "Total ₹", "Risk",
        "Last Comment", "Stale (h)", "Snatch In (h)", "Reason",
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
            r.snatchInHours,
            r.snatchReason ?? r.reasoning,
          ]);
        });
      }

      // Section 4 — Daily (per-day × per-agent: every tag, call, lead)
      rows.push([]);
      rows.push(["═══ DAILY (DAY × AGENT — MIS DETAIL) ═══"]);
      rows.push(["NOTE: Declined day ≈ status-change day (lastSyncTime watermark); declined holder = current assignee. Accepted day = conversion day from the +100 ledger."]);
      if (data.dailyError) {
        rows.push([`Daily unavailable: ${data.dailyError}`]);
      } else {
        rows.push([
          "Date", "Day", "Telecaller",
          "Assigned", "Won", "Closed ₹", "Closed Estimates",
          "Declined", "Declined ₹", "Declined Estimates", "Snatches",
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
            assigned: 0, won: 0, closedValue: 0, declined: 0, declinedValue: 0,
            snatches: 0, callsAttempted: 0, callsConnected: 0, callsNotConnected: 0,
            talkTimeMin: 0, leadsGenerated: 0, leadsConverted: 0, score: 0,
          };
          const closedTags: string[] = [];
          const declinedTags: string[] = [];
          for (const d of list) {
            team.assigned += d.assigned; team.won += d.won; team.closedValue += d.closedValue;
            team.declined += d.declined; team.declinedValue += d.declinedValue;
            team.snatches += d.snatches; team.callsAttempted += d.callsAttempted;
            team.callsConnected += d.callsConnected; team.callsNotConnected += d.callsNotConnected;
            team.talkTimeMin += d.talkTimeMin; team.leadsGenerated += d.leadsGenerated;
            team.leadsConverted += d.leadsConverted; team.score += d.score;
            if (d.closedEstimates) closedTags.push(`${d.telecallerName}: ${d.closedEstimates}`);
            if (d.declinedEstimates) declinedTags.push(`${d.telecallerName}: ${d.declinedEstimates}`);
            rows.push([
              d.date, d.weekday, d.telecallerName,
              d.assigned, d.won, d.closedValue, d.closedEstimates,
              d.declined, d.declinedValue, d.declinedEstimates, d.snatches,
              d.callsAttempted, d.callsConnected, d.callsNotConnected, d.talkTimeMin,
              d.leadsGenerated, d.leadsConverted, d.score,
            ]);
          }
          rows.push([
            date, list[0]?.weekday ?? "", "— TEAM —",
            team.assigned, team.won, team.closedValue, closedTags.join(" ‖ "),
            team.declined, team.declinedValue, declinedTags.join(" ‖ "), team.snatches,
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
