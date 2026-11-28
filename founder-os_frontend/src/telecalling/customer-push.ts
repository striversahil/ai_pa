// customer-push.ts — the Controller's "Customer push": shapes, API and pure
// helpers.
//
// Backend mirror: founder-os_backend/src/modules/customer-push/types.ts. Keep
// names and semantics identical — the payload is consumed verbatim.
//
// The agent-assignment hash deliberately does NOT exist on this side: the
// server computes it and returns per-agent counts, so there is nothing for the
// UI to derive and no second implementation to drift.
import { api } from "@/api/client";

export type Distribution = "single" | "split";
export type PushMode = "dry-run" | "live";
export type PushStatus = "queued" | "running" | "done" | "failed";
/** 'neodove' only appears on history rows from the retired target. */
export type PushTarget = "dialer" | "neodove";

export interface CampaignStateCount {
  state: string;
  total: number;
  withPhone: number;
  lastPushedAt: string | null;
  lastPushedCount: number;
}

/** One district inside a region + state — the drill-down's source. */
export interface CampaignDistrictCount {
  district: string;
  total: number;
  withPhone: number;
  lastPushedAt: string | null;
  lastPushedCount: number;
}

export interface CampaignTypeCount {
  base: string;
  total: number;
  withPhone: number;
}

export interface CampaignAgent {
  key: string;
  region: string;
  name: string;
  /** A phone is paired; leads still queue when it is not. */
  configured: boolean;
  active: boolean;
  source: "device" | "none";
  covers?: string[];
}

export interface CampaignAgentPlan extends CampaignAgent {
  planned: number;
}

export interface CampaignStatesPayload {
  region: string;
  clientType: string;
  agents: CampaignAgent[];
  teamLeads: CampaignAgent[];
  states: CampaignStateCount[];
  types: CampaignTypeCount[];
}

export interface CampaignSkip {
  customerId: string;
  name: string;
  reason: "no_phone" | "invalid_phone" | "duplicate_mobile_in_batch" | "already_queued";
}

export interface CampaignPreview {
  region: string;
  state: string;
  district: string;
  clientType: string;
  total: number;
  ready: number;
  skipped: CampaignSkip[];
  sample: Array<{ name: string; mobileMasked: string; email: string }>;
  agents: CampaignAgentPlan[];
  distribution: Distribution;
}

export interface PushBatch {
  id: string;
  region: string;
  state: string;
  district: string;
  clientType: string;
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
  target: PushTarget;
}

export const REGION_CODES = ["R1", "R2", "R3", "R4"] as const;

export const SKIP_LABELS: Record<CampaignSkip["reason"], string> = {
  no_phone: "No phone on file",
  invalid_phone: "Phone is not a reachable Indian number",
  duplicate_mobile_in_batch: "Same mobile already in this push",
  already_queued: "Already waiting in that agent's dialer queue",
};

/** Live-event filter: a push writes the dialer queue. */
export const CUSTOMER_PUSH_EVENTS = ["device-calls"];

export interface PreviewQuery {
  region: string;
  state: string;
  district?: string;
  clientType?: string;
  distribution: Distribution;
  agentKey?: string;
}

function query(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  const text = qs.toString();
  return text ? `?${text}` : "";
}

export const customerPushApi = {
  states: (region: string, clientType = "") =>
    api.get<CampaignStatesPayload>(`/api/customer-push/states${query({ region, clientType })}`),
  districts: (region: string, state: string, clientType = "") =>
    api.get<{ region: string; state: string; districts: CampaignDistrictCount[] }>(
      `/api/customer-push/districts${query({ region, state, clientType })}`),
  preview: (q: PreviewQuery) =>
    api.get<{ preview: CampaignPreview }>(`/api/customer-push/preview${query({
      region: q.region, state: q.state, district: q.district, clientType: q.clientType,
      distribution: q.distribution, agent: q.agentKey,
    })}`),
  push: (q: PreviewQuery) =>
    api.post<{ batch: PushBatch }>("/api/customer-push/push", {
      region: q.region, state: q.state, district: q.district, clientType: q.clientType,
      distribution: q.distribution, agentKey: q.agentKey,
    }),
  batches: (region: string, limit = 20) =>
    api.get<{ batches: PushBatch[] }>(`/api/customer-push/batches${query({ region, limit: String(limit) })}`),
};

/** "phone paired" / "no phone yet — leads wait in the queue" hint. */
export function pairLabel(agent: CampaignAgent): string {
  return agent.source === "device" ? "phone paired" : "no phone yet — leads wait in the queue";
}

/**
 * "Both agents — split evenly" vs one named agent vs a full copy to a TL.
 * The single-agent option carries the agent key in `agentKey`. TL entries
 * always mean the whole state copy (split stays pair-only — hash stability).
 */
export interface DistributionOption {
  id: string;
  label: string;
  hint: string;
  distribution: Distribution;
  agentKey: string;
  disabled: boolean;
  /** Set on Team-Lead options (full-copy coverage target). */
  teamLead?: boolean;
}

/** Build the selector options for a region's agent pair + Team-Lead copies. */
export function distributionOptions(
  agents: CampaignAgent[],
  teamLeads: CampaignAgent[],
  stateName: string,
): DistributionOption[] {
  const usable = agents.filter((a) => a.active);
  if (usable.length === 0) return [];

  const both: DistributionOption = {
    id: "split",
    label: usable.length >= 2 ? "Both agents — split evenly" : `All to ${usable[0]?.name ?? "agent"}`,
    hint:
      usable.length >= 2
        ? "Each lead goes to one agent, fixed by their mobile number so a re-push never moves them."
        : "Only one agent is active in this region.",
    distribution: usable.length >= 2 ? "split" : "single",
    agentKey: usable.length >= 2 ? "" : (usable[0]?.key ?? ""),
    disabled: false,
  };

  const singles: DistributionOption[] = usable.map((agent) => ({
    id: `single:${agent.key}`,
    label: `All to ${agent.name}`,
    hint: `Every lead in ${stateName || "this state"} goes to ${agent.name}.`,
    distribution: "single",
    agentKey: agent.key,
    disabled: false,
  }));

  const tls: DistributionOption[] = teamLeads
    .filter((t) => t.active)
    .map((tl) => {
      const covers = (tl.covers ?? []).filter(Boolean);
      return {
        id: `single:${tl.key}`,
        label: `Full copy to ${tl.name} (TL)`,
        hint: `Every lead in ${stateName || "this state"} also goes to TL ${tl.name}${covers.length > 0 ? ` (covers ${covers.join("+")})` : ""} — coverage copy, agents keep theirs.`,
        distribution: "single" as Distribution,
        agentKey: tl.key,
        disabled: false,
        teamLead: true,
      };
    });

  return [both, ...singles, ...tls];
}

/** "Neha 59 / Arjun 59" — the preview's per-agent split. */
export function agentSplitLabel(agents: CampaignAgentPlan[]): string {
  return agents.map((a) => `${firstName(a.name)} ${a.planned}`).join(" / ");
}

function firstName(name: string): string {
  const value = String(name ?? "").trim();
  if (!value) return "Agent";
  return value.split(/\s+/)[0];
}

/** Human summary of who receives this push. */
export function distributionSummary(distribution: Distribution, agents: CampaignAgentPlan[]): string {
  const names = agents.map((a) => a.name).join(" and ");
  if (distribution === "single" || agents.length === 1) {
    return `all ${agents[0]?.planned ?? 0} leads to ${names}`;
  }
  return `split between ${names}`;
}

/** Human label for a batch row. */
export function batchOutcome(batch: PushBatch): string {
  if (batch.mode === "dry-run") return `Dry run · ${batch.planned} would send`;
  if (batch.target === "dialer") {
    return `Queued ${batch.sent}${batch.skipped ? ` · ${batch.skipped} skipped` : ""}`;
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

/** Where a historical batch went (NeoDove rows predate the dialer target). */
export function batchTargetLabel(batch: PushBatch): string {
  return batch.target === "dialer" ? "Dialer" : "NeoDove (retired)";
}

export function formatStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
