// types.ts — Customer push shapes.
//
// One batch per "push this region + state" action, one append-only ledger row
// per lead. The ONLY destination is the Founder OS auto dialer
// (modules/dialer): a push queues the selected customers on their agent's
// phone. core_customer is READ ONLY here — a push never edits the book.

/** One customer row resolved into a pushable lead. */
export interface CampaignLead {
  customerId: string;
  zohoCustomerId: string;
  region: string;
  state: string;
  /** Bare 10-digit Indian mobile (what the dialer expects). */
  mobile: string;
  /** Company first, then display name — the name the agent reads. */
  name: string;
  email: string;
}

/** A lead paired with the agent whose dialer queue receives it. */
export interface AssignedLead {
  lead: CampaignLead;
  agentKey: string;
}

export type SkipReason = 'no_phone' | 'invalid_phone' | 'duplicate_mobile_in_batch' | 'already_queued';

/** A row that cannot be pushed, with a reason the UI can show. */
export interface SkippedLead {
  customerId: string;
  name: string;
  reason: SkipReason;
}

export interface StateCount {
  state: string;
  total: number;
  withPhone: number;
  /** Rows already queued in the most recent completed push for this state. */
  lastPushedAt: string | null;
  lastPushedCount: number;
}

export interface TypeCount {
  base: string;
  total: number;
  withPhone: number;
}

/** One district inside a region + state — the drill-down's source. */
export interface DistrictCount {
  district: string;
  total: number;
  withPhone: number;
  lastPushedAt: string | null;
  lastPushedCount: number;
}

/**
 * single → every lead in the push goes to one agent.
 * split  → both pair agents, assigned by a stable hash of the mobile number.
 */
export type Distribution = 'single' | 'split';

/** One roster destination: a telecaller in the region, or a Team Lead. */
export interface CampaignAgent {
  /** Employee id (the dialer queue's telecallerId). */
  key: string;
  region: string;
  name: string;
  /** The agent has a paired phone. Leads still queue when they do not. */
  configured: boolean;
  active: boolean;
  /** 'device' = a phone is paired, 'none' = leads wait in the queue. */
  source: 'device' | 'none';
  /**
   * Roster regions this Team Lead covers (HumanResourcesMember.salesRegions).
   * Hint only — a full-copy push is never blocked on it. Empty for pair agents.
   */
  covers?: string[];
}

export interface CampaignAgentPlan extends CampaignAgent {
  /** Leads this agent would receive for the current selection. */
  planned: number;
}

export interface CampaignPreview {
  region: string;
  state: string;
  /** '' = whole state; otherwise the single filtered district. */
  district: string;
  /** '' = all client types; otherwise the single filtered customerTypeBase. */
  clientType: string;
  total: number;
  ready: number;
  skipped: SkippedLead[];
  sample: Array<{ name: string; mobileMasked: string; email: string }>;
  /** Per-agent split of the selection — sums to `ready`. */
  agents: CampaignAgentPlan[];
  distribution: Distribution;
}

/** Historical rows from the retired NeoDove target still read as 'neodove'. */
export type PushTarget = 'dialer' | 'neodove';
/** Every new push is live; dry-run rows survive from the NeoDove era. */
export type PushMode = 'dry-run' | 'live';
export type PushStatus = 'queued' | 'running' | 'done' | 'failed';

export interface PushBatch {
  id: string;
  region: string;
  state: string;
  /** '' = whole state; otherwise the single pushed district. */
  district: string;
  /** '' = all client types; otherwise the single filtered customerTypeBase. */
  clientType: string;
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
  /** Where it went — 'Founder OS dialer' now, host text on old rows. */
  campaignHost: string;
  /** State label ('' for legacy rows). */
  detail1: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  target: PushTarget;
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

export interface Actor {
  id: string;
  name: string;
}
