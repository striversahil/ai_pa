// Extracted verbatim from index.ts by scripts/refactor/split-module.mjs.
// index.ts re-exports everything public here, so existing imports keep working.


export interface NeodoveAgentRow {
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
  /** True "leads generated" (created) count from the get-leads API. */
  leadsGenerated: number;
}

export type TrafficLight = 'green' | 'amber' | 'red';

export interface AgentKra {
  /** Effective target for the whole range (daily × active days). */
  connectedTarget: number;
  connectedDailyTarget: number;
  connected: number;
  connectedAvgPerDay: number;
  connectedPct: number;
  connectedStatus: TrafficLight;
  /** Effective target for the whole range (daily × active days). */
  leadsTarget: number;
  leadsDailyTarget: number;
  leads: number;
  leadsAvgPerDay: number;
  leadsPct: number;
  leadsStatus: TrafficLight;
  overall: TrafficLight;
  overallLabel: string;
  zohoEstimates: number;
  zohoPipelineValue: number;
}
