// Extracted verbatim from NeodoveTelecallerDashboard.tsx by scripts/refactor/split-module.mjs.
// NeodoveTelecallerDashboard.tsx re-exports everything public here, so existing imports keep working.


export type TrafficLight = "green" | "amber" | "red";

export type Kra = {
  connectedTarget: number;
  connectedDailyTarget?: number;
  connected: number;
  connectedAvgPerDay?: number;
  connectedPct: number;
  connectedStatus: TrafficLight;
  leadsTarget: number;
  leadsDailyTarget?: number;
  leads: number;
  leadsAvgPerDay?: number;
  leadsPct: number;
  leadsStatus: TrafficLight;
  overall: TrafficLight;
  overallLabel: string;
  zohoEstimates: number;
  zohoPipelineValue: number;
};

export type AgentRow = {
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
  kra?: Kra;
};

export type Totals = Record<string, number>;

export type DataResponse = {
  meta: {
    analysis: string;
    reportDate: string | null;
    range?: { from: string | null; to: string | null; days: number } | null;
    dates?: string[];
    fetchedAt?: string;
    generatedAt: string;
    agentCount?: number;
    error?: string;
  };
  benchmarks?: { connectedCallsPerDay: number; leadsPerAgentPerDay: number };
  agents: AgentRow[];
  totals: Totals | null;
  zohoUnmapped?: { zohoName: string; estimates: number; value: number }[];
};

export type PresetKey =
  | "today" | "yesterday" | "this_week" | "last_week"
  | "this_month" | "last_month" | "last_7_days" | "last_30_days"
  | "all_time" | "custom";
