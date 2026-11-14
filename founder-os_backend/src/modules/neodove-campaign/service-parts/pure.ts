// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import type { Distribution } from "../types";
import type { ResolvedAgent } from "./types";

export const REGIONS = ['R1', 'R2', 'R3', 'R4'];

export const DEFAULT_CHUNK = 20;

export const MAX_CHUNK = 25;

export const CONCURRENCY = 3;

export const FETCH_TIMEOUT_MS = 20_000;

/** Only a properly-named agent secret may be dereferenced from the registry. */
export const AGENT_SECRET_RE = /^NEODOVE_AGENT_[A-Z0-9_]+_URL$/;

export class CampaignError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CampaignError';
    this.status = status;
  }
}

/** Region validation — the customer master only knows R1–R4. */
export function normalizeRegion(region: unknown): string {
  const value = String(region ?? '').trim().toUpperCase();
  if (!REGIONS.includes(value)) throw new CampaignError('region must be one of R1, R2, R3, R4', 400);
  return value;
}

export function normalizeState(state: unknown): string {
  const value = String(state ?? '').trim();
  if (!value) throw new CampaignError('state is required', 400);
  if (value.length > 80) throw new CampaignError('state is too long', 400);
  return value;
}

/** '' = whole state; otherwise the district name (max 80, like state). */
export function normalizeDistrict(value: unknown): string {
  const text = String(value ?? '').trim().slice(0, 80);
  return text;
}

/** Default is split — the founder's stated preference when nothing is chosen. */
export function normalizeDistribution(value: unknown): Distribution {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'split';
  if (text === 'single' || text === 'split') return text;
  throw new CampaignError("distribution must be 'single' or 'split'", 400);
}

/** '' = all client types; otherwise the exact customerTypeBase family. The
 *  value is validated against the book at read time (unknown → 400) so a
 *  crafted type can never silently push zero rows. */
export function normalizeClientType(value: unknown): string {
  const text = String(value ?? '').trim().slice(0, 80);
  if (!text) return '';
  return text;
}

/**
 * Normalize a DB or secret URL value into a sendable campaign URL. Query
 * params are stripped — the push builds its own body. Returns '' when the
 * value is not a usable absolute http(s) URL (treated as "not configured").
 */
export function normalizeCampaignUrl(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    url.search = '';
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * Resolve one agent's campaign URL from its secret. Anything that is not an
 * absolute URL resolves to '' (treated as "not configured", never sent to).
 */
export function urlFromSecret(env: any, secretName: string): string {
  const name = String(secretName ?? '').trim();
  if (!AGENT_SECRET_RE.test(name)) return '';
  return normalizeCampaignUrl((env as any)?.[name]);
}

/** A pasted value may be a bare URL or a full curl command — pull the URL out. */
export function extractUrlFromPaste(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const match = text.match(/https?:\/\/[^\s'"]+/);
  return (match?.[0] ?? text).trim().replace(/[),;]+$/, '');
}

/**
 * Validate a Controller-mapped URL before it is stored. SSRF guard: the leads
 * carry customer PII, so a DB-mapped URL must be an https NeoDove
 * custom-integration endpoint — nothing else is accepted.
 */
export function validateAgentUrl(raw: unknown): string {
  const url = normalizeCampaignUrl(extractUrlFromPaste(raw));
  if (!url) throw new CampaignError('paste a valid NeoDove campaign URL or curl command', 400);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CampaignError('paste a valid NeoDove campaign URL or curl command', 400);
  }
  if (parsed.protocol !== 'https:') {
    throw new CampaignError('agent URL must be https', 400);
  }
  if (!parsed.host.endsWith('.neodove.com')) {
    throw new CampaignError('agent URL must be a NeoDove (*.neodove.com) integration URL', 400);
  }
  if (!parsed.pathname.includes('/integration/custom/')) {
    throw new CampaignError('agent URL must be a NeoDove custom-integration URL (/integration/custom/…/leads)', 400);
  }
  if (!parsed.pathname.endsWith('/leads')) {
    throw new CampaignError('agent URL must end with /leads', 400);
  }
  return url;
}

/** Server-wide live switch. Off means every push is a dry run. */
export function liveEnabled(env: any): boolean {
  return String((env as any)?.NEODOVE_CAMPAIGN_LIVE ?? '').trim() === '1';
}

/** Who receives this push. `single` names one agent (pair member or TL);
 *  `split` uses the region pair ONLY (a third bucket would reshuffle every
 *  re-push — see selection.assignAgents). */
export function participantsFor(
  agents: ResolvedAgent[],
  teamLeads: ResolvedAgent[],
  distribution: Distribution,
  agentKey: unknown,
): ResolvedAgent[] {
  if (distribution === 'single') {
    const key = String(agentKey ?? '').trim();
    if (!key) throw new CampaignError('agentKey is required when distribution is single', 400);
    const found = agents.find((a) => a.key === key) ?? teamLeads.find((a) => a.key === key);
    if (!found) throw new CampaignError(`unknown agent for this region: ${key}`, 400);
    return [found];
  }
  return agents;
}

export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
