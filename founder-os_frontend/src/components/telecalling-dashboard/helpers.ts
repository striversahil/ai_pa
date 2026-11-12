// Extracted verbatim from TelecallingDashboard.tsx by scripts/refactor/split-module.mjs.
// TelecallingDashboard.tsx re-exports everything public here, so existing imports keep working.
import type { BoardStaff } from "@/telecalling/view-types";
import type { CallTagValue, TrafficLight, LeaderRow, DashData, RegionInfo, RiskRow, AgentViewData, View } from "./types";

export const CALL_TAG_META: Record<CallTagValue, { label: string; icon: string; cls: string; title: string }> = {
  NO_ANSWER: { label: "Not answering", icon: "📵", cls: "text-orange-600 dark:text-orange-400 border-orange-500/30 bg-orange-500/5", title: "Client is not picking up the phone" },
  BUSY: { label: "Busy", icon: "⏳", cls: "text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5", title: "Client is busy — call back later" },
  CALLBACK: { label: "Callback", icon: "📞", cls: "text-sky-600 dark:text-sky-400 border-sky-500/30 bg-sky-500/5", title: "Follow up on a fixed date (max 10 days out)" },
};

/** Local YYYY-MM-DD of today + offset days (bounds the callback date input). */
export function localIsoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Region payload → legacy UI adapter ───────────────────────────────────────
// The backend is region-owned (full close slab credited automatically to the
// lead creator). This dashboard keeps its pre-region visual language, so the
// payload is reshaped here into the shapes the JSX below already speaks —
// adapter only, no business logic duplicated.
export function kraStatus(pct: number): TrafficLight {
  return pct >= 100 ? "green" : pct >= 60 ? "amber" : "red";
}

/** Cache key for a region drill: '' → "UNMAPPED". */
export function regionKey(region: string | null | undefined): string {
  return region ? String(region) : "UNMAPPED";
}

/** Query value for the drill endpoint. */
export function regionQuery(key: string): string {
  return key === "UNMAPPED" ? "unmapped" : key;
}

export function adaptLeaderRow(s: any, region: any, targets: any): LeaderRow {
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
    consumerWon: Number(s?.consumerWon ?? 0),
    consumerValue: Number(s?.consumerValue ?? 0),
    resellerWon: Number(s?.resellerWon ?? 0),
    resellerValue: Number(s?.resellerValue ?? 0),
    unclassifiedWon: Number(s?.unclassifiedWon ?? 0),
    unclassifiedValue: Number(s?.unclassifiedValue ?? 0),
  };
}

/** Payload staff row → the narrow `BoardStaff` shape the podium renders.
 *  The Worker flattens staff stats per region; the board wants the nested
 *  conversion/generation view, so the split happens here (adapter only — every
 *  number still comes from the server payload). */
export function adaptBoardStaff(s: any, region: any, riskByStaff: Map<string, number>): BoardStaff {
  const connectedTarget = Number(region?.kra?.connectedTarget ?? 0);
  const leadsTarget = Number(region?.kra?.leadsTarget ?? 0);
  const callsConnected = Number(s?.callsConnected ?? 0);
  const leadsGenerated = Number(s?.leadsGenerated ?? 0);
  const connectedPct = connectedTarget > 0 ? Math.round((callsConnected / connectedTarget) * 100) : 0;
  const leadsPct = leadsTarget > 0 ? Math.round((leadsGenerated / leadsTarget) * 100) : 0;
  return {
    id: String(s?.id ?? ""),
    name: String(s?.name ?? ""),
    tlLevel: String(s?.tlLevel ?? ""),
    type: String(s?.type ?? "telecaller"),
    score: Number(s?.score ?? 0),
    region: String(s?.region ?? region?.id ?? ""),
    regionName: String(region?.name ?? ""),
    consumerWon: Number(s?.consumerWon ?? 0),
    consumerValue: Number(s?.consumerValue ?? 0),
    resellerWon: Number(s?.resellerWon ?? 0),
    resellerValue: Number(s?.resellerValue ?? 0),
    unclassifiedWon: Number(s?.unclassifiedWon ?? 0),
    unclassifiedValue: Number(s?.unclassifiedValue ?? 0),
    conversion: {
      assigned: Number(region?.open?.count ?? 0),
      won: Number(s?.won ?? 0),
      acceptedValue: Number(s?.closedValue ?? 0),
    },
    generation: {
      callsConnected,
      leadsGenerated,
      talkTimeSec: Number(s?.talkTimeSec ?? 0),
      connectedTarget,
      connectedPct,
      connectedStatus: kraStatus(connectedPct),
      leadsTarget,
      leadsPct,
      leadsStatus: kraStatus(leadsPct),
    },
    risk: { atRisk: riskByStaff.get(String(s?.id ?? "")) ?? 0, zombie: 0 },
  };
}

export function adaptDashData(d: any): DashData {
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
      regionWon: Number(kpi.regionWon ?? 0),
      regionValue: Number(kpi.regionValue ?? 0),
      directWon: Number(kpi.directWon ?? 0),
      directValue: Number(kpi.directValue ?? 0),
      unlinkedWon: Number(kpi.unlinkedWon ?? 0),
      unlinkedValue: Number(kpi.unlinkedValue ?? 0),
      consumerWon: Number(kpi.consumerWon ?? 0),
      consumerValue: Number(kpi.consumerValue ?? 0),
      resellerWon: Number(kpi.resellerWon ?? 0),
      resellerValue: Number(kpi.resellerValue ?? 0),
      unclassifiedWon: Number(kpi.unclassifiedWon ?? 0),
      unclassifiedValue: Number(kpi.unclassifiedValue ?? 0),
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
    direct: d?.direct ?? null,
    unlinked: d?.unlinked ?? null,
    tlTargets: Array.isArray(d?.tlTargets) ? d.tlTargets : [],
    unmappedStaff: (d?.unmappedStaff ?? []).map((s: any) => adaptLeaderRow(s, null, targets)),
    unmapped: d?.unmapped ?? null,
    unmappedAccepted: d?.unmappedAccepted ?? null,
    epoch: d?.meta?.epoch ?? null,
  };
}

export function adaptAgentView(v: any): AgentViewData {
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
export const TELECALLING_EVENTS = ["automation", "telecalling", "estimates", "baseline"];

export const TABS: { key: View; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "conversion", label: "Lead Conversion", icon: "📨" },
  { key: "generation", label: "Lead Generation", icon: "📞" },
];

export function fmtTalk(sec: number): string {
  if (!sec) return "—";
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtNum(n: number): string {
  return n === 0 ? "0" : n.toLocaleString();
}

// "500000" → "₹5.0L", "10000000" → "₹1.0Cr" (compact target labels).
export function fmtLakh(n: number): string {
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
export function convTier(
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
export { fmtDayMonth as fmtDate } from "@/lib/format";

export const LIGHT_TEXT: Record<string, string> = {
  green: "text-emerald-400",
  amber: "text-amber-400",
  red: "text-rose-400",
};

export const LIGHT_BG: Record<string, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};

export const LIGHT_CHIP: Record<string, string> = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  red: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

export function worst(a: TrafficLight, b: TrafficLight): TrafficLight {
  if (a === "red" || b === "red") return "red";
  if (a === "amber" || b === "amber") return "amber";
  return "green";
}

export const OVERALL_LABEL: Record<TrafficLight, string> = {
  green: "On Track",
  amber: "At Risk",
  red: "Behind",
};
