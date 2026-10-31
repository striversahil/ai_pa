// types.ts — NeoDove campaign lead-push shapes.
//
// Isolation rule: this module reads the Customer Master (MasterCustomer) but
// never writes it. Every push is recorded in its own append-only ledger so the
// customer book stays a clean Zoho mirror.
//
// Routing model (2026-10-31): every region has a PAIR of NeoDove agents, each
// with its own campaign URL. A push goes to one named agent ("single") or is
// split across the pair ("split"). The registry lives in the NeoDoveAgent
// table; the URLs live in Worker secrets.

/** One customer row resolved into a pushable lead. */
export interface CampaignLead {
  customerId: string;
  zohoCustomerId: string;
  region: string;
  state: string;
  /** Bare 10-digit Indian mobile (NeoDove's expected shape). */
  mobile: string;
  /** Company first, then display name — the name NeoDove show on the lead. */
  name: string;
  email: string;
}

/** A lead paired with the agent whose campaign receives it. */
export interface AssignedLead {
  lead: CampaignLead;
  agentKey: string;
}

/** A row that cannot be pushed, with a reason the UI can show. */
export interface SkippedLead {
  customerId: string;
  name: string;
  reason: 'no_phone' | 'invalid_phone' | 'duplicate_mobile_in_batch';
}

export interface StateCount {
  state: string;
  total: number;
  withPhone: number;
  /** Rows already pushed in the most recent live batch for this region+state. */
  lastPushedAt: string | null;
  lastPushedCount: number;
}

/**
 * single → every lead in the push goes to one agent.
 * split  → both agents, assigned by a stable hash of the mobile number.
 */
export type Distribution = 'single' | 'split';

/** One configurable NeoDove agent (a row in NeoDoveAgent). */
export interface CampaignAgent {
  /** Stable routing key, e.g. R1_NEHA_VERMA. */
  key: string;
  region: string;
  name: string;
  /** The agent's campaign URL secret is present in this environment. */
  configured: boolean;
  active: boolean;
  /**
   * Which value wins for this agent: the Controller-mapped DB URL ('db'),
   * the Worker secret fallback ('secret'), or nothing ('none').
   * The URL itself is never exposed — only this flag plus `configured`.
   */
  source: 'db' | 'secret' | 'none';
}

export interface CampaignAgentPlan extends CampaignAgent {
  /** Leads this agent would receive for the current selection. */
  planned: number;
}

export interface CampaignPreview {
  region: string;
  state: string;
  total: number;
  ready: number;
  skipped: SkippedLead[];
  sample: Array<{ name: string; mobileMasked: string; email: string }>;
  /** Per-agent split of the selection — sums to `ready`. */
  agents: CampaignAgentPlan[];
  distribution: Distribution;
  /** Every participating agent has a campaign URL configured. */
  configured: boolean;
  /** Server-wide live switch — when false every push is a dry run. */
  liveEnabled: boolean;
  /** NeoDove field 1: state name. */
  detail1: string;
  /** NeoDove field 2: region code. */
  detail2: string;
}

export type PushMode = 'dry-run' | 'live';
export type PushStatus = 'queued' | 'running' | 'done' | 'failed';

export interface PushBatch {
  id: string;
  region: string;
  state: string;
  mode: PushMode;
  status: PushStatus;
  total: number;
  /** Pushable leads resolved when the batch was created. */
  planned: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  distribution: Distribution;
  /** Set in single mode only; '' when split. */
  agentKey: string;
  requestedBy: string;
  requestedByName: string;
  campaignHost: string;
  detail1: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

/** Per-agent tally inside a batch, derived from the ledger. */
export interface AgentTally {
  agentKey: string;
  name: string;
  planned: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

export interface PushProgress extends PushBatch {
  /** Rows processed by THIS run call (not cumulative). */
  processedNow: number;
  /** True when nothing is left to send. */
  complete: boolean;
  failures: Array<{ name: string; mobileMasked: string; httpStatus: number | null; error: string | null }>;
  agentTallies: AgentTally[];
}

export interface Actor {
  id: string;
  name: string;
}
