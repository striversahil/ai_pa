// neodove-campaign.ts — frontend shapes + pure helpers for the Controller's
// NeoDove campaign section.
//
// Backend mirror: src/modules/neodove-campaign/types.ts. Keep names and
// semantics identical — the payload is consumed verbatim.
//
// The agent-assignment hash deliberately does NOT exist on this side: the
// server computes it and returns per-agent counts in the preview, so there is
// nothing for the UI to derive and no second implementation to drift.

export type PushMode = "dry-run" | "live";
export type PushStatus = "queued" | "running" | "done" | "failed";
export type Distribution = "single" | "split";

export interface CampaignStateCount {
  state: string;
  total: number;
  withPhone: number;
  lastPushedAt: string | null;
  lastPushedCount: number;
}

export interface CampaignAgent {
  key: string;
  region: string;
  name: string;
  configured: boolean;
  active: boolean;
  /** db = mapped in Controller, secret = Worker-secret fallback, none = unset. */
  source: "db" | "secret" | "none";
}

export interface CampaignAgentPlan extends CampaignAgent {
  planned: number;
}

export interface CampaignStatesPayload {
  region: string;
  configured: boolean;
  liveEnabled: boolean;
  agents: CampaignAgent[];
  states: CampaignStateCount[];
}

export interface CampaignSkip {
  customerId: string;
  name: string;
  reason: "no_phone" | "invalid_phone" | "duplicate_mobile_in_batch";
}

export interface CampaignPreview {
  region: string;
  state: string;
  total: number;
  ready: number;
  skipped: CampaignSkip[];
  sample: Array<{ name: string; mobileMasked: string; email: string }>;
  agents: CampaignAgentPlan[];
  distribution: Distribution;
  configured: boolean;
  liveEnabled: boolean;
  detail1: string;
  detail2: string;
}

export interface PushBatch {
  id: string;
  region: string;
  state: string;
  mode: PushMode;
  status: PushStatus;
  total: number;
  planned: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  distribution: Distribution;
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
  processedNow: number;
  complete: boolean;
  failures: Array<{ name: string; mobileMasked: string; httpStatus: number | null; error: string | null }>;
  agentTallies: AgentTally[];
}

export const REGION_CODES = ["R1", "R2", "R3", "R4"] as const;

export const SKIP_LABELS: Record<CampaignSkip["reason"], string> = {
  no_phone: "No phone on file",
  invalid_phone: "Phone is not a reachable Indian number",
  duplicate_mobile_in_batch: "Same mobile already in this push",
};

/**
 * "Both agents — split evenly" vs one named agent.
 * The single-agent option carries the agent key in `agentKey`.
 */
export interface DistributionOption {
  id: string;
  label: string;
  hint: string;
  distribution: Distribution;
  agentKey: string;
  disabled: boolean;
}

/** Build the selector options for a region's agent pair. */
export function distributionOptions(
  agents: CampaignAgent[],
  stateName: string,
): DistributionOption[] {
  const usable = agents.filter((a) => a.active);
  if (usable.length === 0) return [];

  const both: DistributionOption = {
    id: "split",
    label: usable.length >= 2 ? "Both agents — split evenly" : `All to ${usable[0]?.name ?? "agent"}`,
    hint:
      usable.length >= 2
        ? `Each lead goes to one agent, fixed by their mobile number so a re-push never moves them.`
        : "Only one agent is active in this region.",
    distribution: usable.length >= 2 ? "split" : "single",
    agentKey: usable.length >= 2 ? "" : (usable[0]?.key ?? ""),
    disabled: usable.length >= 2 && usable.some((a) => !a.configured),
  };

  const singles: DistributionOption[] = usable.map((agent) => ({
    id: `single:${agent.key}`,
    label: `All to ${agent.name}`,
    hint: agent.configured
      ? `Every lead in ${stateName || "this state"} goes to ${agent.name}.`
      : `${agent.name} has no campaign URL configured yet.`,
    distribution: "single",
    agentKey: agent.key,
    disabled: !agent.configured,
  }));

  return [both, ...singles];
}

/** "Neha 59 / Arjun 59" — the preview's per-agent split. */
export function agentSplitLabel(agents: CampaignAgentPlan[]): string {
  return agents
    .map((a) => `${firstName(a.name)} ${a.planned}`)
    .join(" / ");
}

function firstName(name: string): string {
  const value = String(name ?? "").trim();
  if (!value) return "Agent";
  return value.split(/\s+/)[0];
}

/** Human summary of who receives this push. */
export function distributionSummary(
  distribution: Distribution,
  agents: CampaignAgentPlan[],
): string {
  const names = agents.map((a) => a.name).join(" and ");
  if (distribution === "single" || agents.length === 1) {
    return `all ${agents[0]?.planned ?? 0} leads to ${names}`;
  }
  return `split between ${names}`;
}

/** 0–100, clamped — drives the progress bar. */
export function batchPct(batch: PushBatch | null): number {
  if (!batch || batch.total <= 0) return 0;
  const done = batch.sent + batch.failed + batch.skipped;
  return Math.max(0, Math.min(100, Math.round((done / batch.total) * 100)));
}

/** Human label for a batch row: dry runs never claim leads were sent. */
export function batchOutcome(batch: PushBatch): string {
  if (batch.mode === "dry-run") {
    return `Dry run · ${batch.planned} would send`;
  }
  if (batch.status === "done") {
    return `Sent ${batch.sent}${batch.failed ? ` · ${batch.failed} failed` : ""}`;
  }
  if (batch.status === "failed") return "Stopped";
  return `Running · ${batch.pending} left`;
}

/** Compact distribution badge text for the history table. */
export function batchDistributionLabel(batch: PushBatch): string {
  return batch.distribution === "single" ? "single agent" : "split";
}

export function formatStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
