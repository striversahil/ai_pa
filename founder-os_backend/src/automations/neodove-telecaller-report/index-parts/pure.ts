// Extracted verbatim from index.ts by scripts/refactor/split-module.mjs.
// index.ts re-exports everything public here, so existing imports keep working.
import type { NeodoveAgentRow, TrafficLight, AgentKra } from "./types";

export const CONNECTED_CALLS_PER_DAY = 120;

export const LEADS_PER_AGENT_PER_DAY = 10;

export const NUMERIC_KEYS: (keyof NeodoveAgentRow)[] = [
  'callsAttempted', 'callsConnected', 'callsNotConnected',
  'incomingCalls', 'outgoingCalls', 'incomingMissed', 'outgoingMissed',
  'talkTimeSec', 'leadsConverted', 'leadsInProgress', 'leadsLost',
  'leadsClosed', 'followupLeads', 'pendingScheduledLeads', 'leadsGenerated',
];

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function aggregate(rows: any[]): NeodoveAgentRow[] {
  const byUser = new Map<string, NeodoveAgentRow>();
  for (const r of rows) {
    // NeoDove can return multiple user-day rows (one per lead bucket);
    // merge them so each agent appears exactly once.
    //
    // Identity is userId + userName, NOT userId alone: NeoDove RECYCLES ids
    // across staff (2026-11: 3518625a was Muskan Jul→Oct 1, Kamal from Oct 20).
    // Keying by id alone merged two people into one agent with last-write-wins
    // on the name, so the older name (Muskan) won: the new hire never appeared
    // as an agent (roster sync could never link him) and inherited the
    // predecessor's history. A rename across days splits instead — the roster
    // sync then flags it via the userId-claim warning rather than merging two
    // strangers.
    const uid = String(r.userId || '').trim();
    const uname = String(r.userName || '').trim();
    const key = uid || uname ? `${uid}‖${uname}` : 'unknown';
    const name = uname || (uid ? uid.slice(0, 8) : 'unknown');
    let agg = byUser.get(key);
    if (!agg) {
      agg = {
        userName: name,
        userId: r.userId || '',
        managerName: r.managerName ?? null,
        callsAttempted: 0, callsConnected: 0, callsNotConnected: 0,
        incomingCalls: 0, outgoingCalls: 0, incomingMissed: 0, outgoingMissed: 0,
        talkTimeSec: 0, leadsConverted: 0, leadsInProgress: 0, leadsLost: 0,
        leadsClosed: 0, followupLeads: 0, pendingScheduledLeads: 0, leadsGenerated: 0,
      };
      byUser.set(key, agg);
    }
    for (const k of NUMERIC_KEYS) {
      const v = Number(r[k] ?? 0);
      if (Number.isFinite(v)) (agg as any)[k] += v;
    }
    // Always prefer a real userName over the sliced-id fallback so that any
    // day's report (even one where userName is missing) merges correctly.
    // Trimmed: the aggregate key is trimmed, so the stored name must be too,
    // or map lookups miss on stray spaces.
    if (uname) agg.userName = uname;
    if (uid) agg.userId = uid;
    if (!agg.managerName && r.managerName) agg.managerName = r.managerName;
  }
  // Match the NeoDove portal's USER_REPORT headline, which reports COMBINED
  // outgoing + incoming activity. The API's totalCallAttempted /
  // totalCallConnected fields describe a narrower dialer-only subset and
  // understate what managers see (e.g. Rani: app 178/56 vs those fields
  // 146/37). All four component fields are already summed above, so derive:
  for (const a of byUser.values()) {
    a.callsAttempted = a.outgoingCalls + a.incomingCalls;
    a.callsConnected =
      (a.outgoingCalls - a.outgoingMissed) + (a.incomingCalls - a.incomingMissed);
    a.callsNotConnected = a.outgoingMissed + a.incomingMissed;
  }
  return [...byUser.values()].sort((a, b) => b.callsAttempted - a.callsAttempted);
}

export function lightFor(pct: number): TrafficLight {
  if (pct >= 100) return 'green';
  if (pct >= 60) return 'amber';
  return 'red';
}

export const ORDER: Record<TrafficLight, number> = { green: 0, amber: 1, red: 2 };

export function computeAgentKra(
  agent: NeodoveAgentRow,
  connectedTarget: number,
  leadsTarget: number,
  zoho?: { estimates: number; value: number },
  days = 1,
): AgentKra {
  const d = Math.max(1, days);
  // Prefer the true "leads generated" count from the get-leads API; fall back
  // to the legacy leadsInProgress + leadsConverted for snapshots that predate
  // it (the field is absent → undefined → old formula).
  const leads =
    typeof agent.leadsGenerated === 'number' ? agent.leadsGenerated : agent.leadsInProgress + agent.leadsConverted;
  // Benchmark scales with the range: e.g. a week of data targets 7 × daily.
  const effConnectedTarget = Math.round(connectedTarget * d);
  const effLeadsTarget = Math.round(leadsTarget * d);
  const connectedAvg = agent.callsConnected / d;
  const leadsAvg = leads / d;
  const connectedPct = Math.round((agent.callsConnected / effConnectedTarget) * 100);
  const leadsPct = Math.round((leads / effLeadsTarget) * 100);
  const connectedStatus = lightFor(connectedPct);
  const leadsStatus = lightFor(leadsPct);
  const overall = ORDER[connectedStatus] >= ORDER[leadsStatus] ? connectedStatus : leadsStatus;
  const overallLabel =
    overall === 'green' ? 'On Target 🟢' : overall === 'amber' ? 'Partially On Target 🟡' : 'Below Target 🔴';
  return {
    connectedTarget: effConnectedTarget,
    connectedDailyTarget: connectedTarget,
    connected: agent.callsConnected,
    connectedAvgPerDay: Number(connectedAvg.toFixed(1)),
    connectedPct,
    connectedStatus,
    leadsTarget: effLeadsTarget,
    leadsDailyTarget: leadsTarget,
    leads,
    leadsAvgPerDay: Number(leadsAvg.toFixed(1)),
    leadsPct,
    leadsStatus,
    overall,
    overallLabel,
    zohoEstimates: zoho?.estimates ?? 0,
    zohoPipelineValue: zoho?.value ?? 0,
  };
}
