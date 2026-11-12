// Extracted verbatim from TelecallingDashboard.tsx by scripts/refactor/split-module.mjs.
// TelecallingDashboard.tsx re-exports everything public here, so existing imports keep working.
import type { RegionTarget, TeamTarget } from "@/telecalling/targets";
import type { BoardRegion, BoardBucket } from "@/telecalling/view-types";

export interface LeaderRow {
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
  /** Period-window split of this staff's own closes (server-computed). */
  consumerWon?: number;
  consumerValue?: number;
  resellerWon?: number;
  resellerValue?: number;
  unclassifiedWon?: number;
  unclassifiedValue?: number;
}

export interface RiskRow {
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
export interface RegionInfo {
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
  /** Leaderboard position by target attainment (server-computed). */
  rank?: number;
  /** Same money as `won` plus slab points (accepted-estimate source). */
  accepted?: { count: number; value: number; points: number };
  /** The closed estimates behind `won`, newest acceptance first (capped). */
  acceptedItems?: BoardClosedItemLite[];
  /** Estimates that BECAME declined inside the selected period. */
  declined: { count: number; value: number };
  /** The declined estimates behind `declined`, newest decline first (capped). */
  declinedItems?: BoardClosedItemLite[];
  /** ₹1L/day target + weekly carry-forward ledger (server-computed). */
  target?: RegionTarget | null;
  /** Filter-period consumer target (server-computed, no carry-in). */
  periodTarget?: import("@/telecalling/targets").PeriodTarget | null;
  /** Consumer / reseller / needs-review split of `won` (server-computed). */
  wonSplit?: {
    consumer: { count: number; value: number };
    reseller: { count: number; value: number };
    unclassified: { count: number; value: number };
  };
}

/** One accepted estimate behind a region's `Won` figure (BoardClosedItem). */
export type BoardClosedItemLite = NonNullable<BoardRegion["acceptedItems"]>[number];

/** Estimate with no region ('' — link it so region ownership works). Any live
 * status: sent, accepted, confirmed or declined. */
export interface UnmappedItem {
  estimateId: string;
  estimateNumber?: string | null;
  customerName?: string | null;
  total?: number | null;
  status?: string | null;
  generatedBy?: string | null;
  organizationId?: string | null;
  lastSync?: string | null;
}

export interface UnmappedAcceptedItem {
  estimateId: string;
  estimateNumber?: string | null;
  customerName?: string | null;
  total?: number | null;
  status?: string | null;
  date?: string | null;
  generatedBy?: string | null;
  hasCreator?: boolean;
}

export interface DashData {  meta: { day: string; requestedDay?: string; unassignedSent: number; activeCount: number; telecallerCount: number; generatedAt: string; period?: string; periodLabel?: string; periodFrom?: string | null; periodTo?: string | null; workingDays?: number; targets?: { connectedCallsPerDay: number; leadsPerAgentPerDay: number }; conversionTarget?: { perDay: number; goldPerDay: number; workingDays: number; target: number; gold: number; value: number; pct: number; status: "below" | "hit" | "gold" }; agents?: { id: string; name: string; active: boolean }[]; selfAgentId?: string | null; canManage?: boolean; taxonomy?: { id: string; name: string; tl: string; states: string[] }[]; epoch?: string | null; viewer?: { staffId: string | null; name: string | null; region: string | null; tlLevel: string | null } | null; teamTarget?: TeamTarget | null; };
  /** Winning-value buckets that can never win a region target (server-computed). */
  direct?: BoardBucket | null;
  unlinked?: BoardBucket | null;
  kpi: {
    assigned: number;
    won: number;
    conversionRate: number;
    pipelineValue: number;
    acceptedValue?: number;
    callsConnected: number;
    leadsGenerated: number;
    talkTimeSec: number;
    /** Reconciliation slices: regions vs. direct (Sales Head) vs. unlinked. */
    regionWon?: number;
    regionValue?: number;
    directWon?: number;
    directValue?: number;
    unlinkedWon?: number;
    unlinkedValue?: number;
    /** Consumer-only cohort split (server-computed, whole acceptance window). */
    consumerWon?: number;
    consumerValue?: number;
    resellerWon?: number;
    resellerValue?: number;
    unclassifiedWon?: number;
    unclassifiedValue?: number;
  };
  leaderboard: LeaderRow[];
  recent: any[];
  /** Per-day × per-agent manager breakdown (only when fetched with ?daily=1). */
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
  /** TL1 reseller targets — one row per TL1 with a region pair (server-computed). */
  tlTargets?: import("@/telecalling/view-types").TlTarget[];
  /** Roster staff with no region yet (root should map them). */
  unmappedStaff?: LeaderRow[];
  /** Unmapped open estimates (managers only). */
  unmapped?: { count: number; value: number; items: UnmappedItem[] } | null;
  /** Accepted estimates with no lead region (managers only). */
  unmappedAccepted?: { count: number; value: number; points: number; items: UnmappedAcceptedItem[] } | null;
  /** History reset epoch — points read only from this day onward. */
  epoch?: string | null;
}

/** One day × one telecaller of manager detail (backend `daily` block, ?daily=1). */
export interface DailyRow {
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

export interface FollowUp {  estimateId: string;
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
  /** Dated customer commitment (free text, set by holder/root). */
  nextStep?: string | null;
  /** Date the commitment is due (YYYY-MM-DD, max +30 days). */
  nextStepDate?: string | null;
  /** True when today's NeoDove effort on this customer shields the EOD −10. */
  effortShielded?: boolean | null;
  /** Zoho Books org (multi-org sync; null/'' = primary). */
  organizationId?: string | null;
}

/** Agent call-disposition tags for a conversion follow-up: the sales team
 *  marks each estimate Not answering / Busy / Callback (+ follow-up date,
 *  max 10 days out). Saved per estimate via PUT /api/estimates/:id/call-tag. */
export type CallTagValue = "NO_ANSWER" | "BUSY" | "CALLBACK";

/** Local-model patch for one estimate's call tag (optimistic echo + live-event deltas). */
export interface CallTagDelta {
  callTag: CallTagValue | null;
  callbackDate: string | null;
  callTagBy?: string | null;
  callTagByName?: string | null;
  callTagAt?: string | null;
}

export interface AgentViewData {
  meta: { analysis: string; title: string; day: string; requestedDay?: string; agents?: { id: string; name: string; active: boolean }[]; generatedAt: string; error?: string; region?: string; regionName?: string };
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

export interface RosterRow {
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
  /** Secondary region for TL1s (two regions at once, 2026-11-05). */
  region2?: string;
  type?: string;
  closerEligible?: boolean;
  linkedUser?: { id: string; email: string; name: string; isRoot: boolean } | null;
}

export type View = "dashboard" | "conversion" | "generation";

export type TrafficLight = "green" | "amber" | "red";
