// service.ts — NeoDove campaign push orchestration.
//
// Flow: preview (pure selection, no writes) → createPush (batch + ledger rows)
// → runBatch (send one chunk) repeated by the client → cron drain for anything
// left behind. A dry run goes preview → createPush and stops: every ledger row
// is written as `skipped/dry_run` and no network call is made.
//
// Routing: each region has a pair of NeoDove agents (NeoDoveAgent table), each
// with its own campaign URL in a Worker secret. A push either targets one agent
// ("single") or splits the state across the pair ("split") using a stable hash
// of the mobile number — see selection.assignAgents for why it is hashed rather
// than alternated.
//
// Safety rails:
//   - campaign URLs live in Worker secrets (never logged, never returned); only
//     the host is stored on the batch for history.
//   - `NEODOVE_CAMPAIGN_LIVE=1` must be set for a real send. Otherwise the mode
//     always resolves to dry-run, even if the client asks for live.
//   - a push is refused outright if any participating agent has no URL — a
//     half-routed state is worse than a refused one.
//   - non-2xx responses are recorded as failures and NEVER retried (the URL is
//     a non-idempotent POST that creates a lead).
//   - only transport errors are retried, once, because nothing was created.

import {
  agentTallies, batchesWithPending, claimPending, getAgentRow, getBatch, insertBatch, insertLeadRows,
  lastLivePushes, listAgents, listBatches, listCustomersByState, listFailedLeads, listStateCounts,
  markOutcomes, recountBatch, recoverStuckClaims, setAgentUrl, updateBatch,
} from './store';
import { assignAgents, maskMobile, selectLeads } from './selection';
import type {
  Actor, AgentTally, CampaignAgent, CampaignAgentPlan, CampaignPreview, Distribution,
  PushBatch, PushProgress, StateCount,
} from './types';

const REGIONS = ['R1', 'R2', 'R3', 'R4'];
const DEFAULT_CHUNK = 20;
const MAX_CHUNK = 25;
const CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 20_000;

/** Only a properly-named agent secret may be dereferenced from the registry. */
const AGENT_SECRET_RE = /^NEODOVE_AGENT_[A-Z0-9_]+_URL$/;

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

function normalizeState(state: unknown): string {
  const value = String(state ?? '').trim();
  if (!value) throw new CampaignError('state is required', 400);
  if (value.length > 80) throw new CampaignError('state is too long', 400);
  return value;
}

/** Default is split — the founder's stated preference when nothing is chosen. */
export function normalizeDistribution(value: unknown): Distribution {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'split';
  if (text === 'single' || text === 'split') return text;
  throw new CampaignError("distribution must be 'single' or 'split'", 400);
}

/**
 * Normalize a DB or secret URL value into a sendable campaign URL. Query
 * params are stripped — the push builds its own body. Returns '' when the
 * value is not a usable absolute http(s) URL (treated as "not configured").
 */
function normalizeCampaignUrl(raw: unknown): string {
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
function urlFromSecret(env: any, secretName: string): string {
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

interface ResolvedAgent extends CampaignAgent {
  secretName: string;
  /** '' when neither the DB mapping nor the secret yields a URL. */
  url: string;
}

/**
 * Registry rows joined with their URLs. The Controller-mapped DB value wins;
 * the Worker secret is the fallback. Includes inactive agents so a batch in
 * flight when an agent is disabled can still finish.
 */
async function resolveAgents(env: any, region: string): Promise<ResolvedAgent[]> {
  const rows = await listAgents(region);
  return rows.map((row) => {
    const dbUrl = normalizeCampaignUrl(row.campaignUrl);
    const secretUrl = urlFromSecret(env, row.secretName);
    const url = dbUrl || secretUrl;
    const source = dbUrl ? 'db' : (secretUrl ? 'secret' : 'none');
    return { ...row, url, configured: !!url, source };
  });
}

/**
 * Map (or clear) an agent's campaign URL from the Controller. Accepts a bare
 * URL or a full curl command; empty clears the DB override so the Worker
 * secret becomes effective again. Returns the host + source for the UI — the
 * URL itself is never returned.
 */
export async function setAgentCampaignUrl(
  env: any,
  agentKey: unknown,
  raw: unknown,
): Promise<{ key: string; name: string; region: string; host: string; source: 'db' | 'secret' | 'none'; configured: boolean; cleared: boolean }> {
  const key = String(agentKey ?? '').trim();
  if (!key) throw new CampaignError('agent key is required', 400);
  const row = await getAgentRow(key);
  if (!row) throw new CampaignError(`unknown agent: ${key}`, 404);
  const text = String(raw ?? '').trim();
  if (!text) {
    await setAgentUrl(key, '');
    const secretUrl = urlFromSecret(env, (await listAgents(row.region)).find((a) => a.key === key)?.secretName ?? '');
    return {
      key, name: row.name, region: row.region,
      host: hostOf(secretUrl), source: secretUrl ? 'secret' : 'none',
      configured: !!secretUrl, cleared: true,
    };
  }
  const url = validateAgentUrl(text);
  await setAgentUrl(key, url);
  return {
    key, name: row.name, region: row.region,
    host: hostOf(url), source: 'db', configured: true, cleared: false,
  };
}

/** Who receives this push. `single` names one; `split` uses the whole pair. */
function participantsFor(
  agents: ResolvedAgent[],
  distribution: Distribution,
  agentKey: unknown,
): ResolvedAgent[] {
  if (distribution === 'single') {
    const key = String(agentKey ?? '').trim();
    if (!key) throw new CampaignError('agentKey is required when distribution is single', 400);
    const found = agents.find((a) => a.key === key);
    if (!found) throw new CampaignError(`unknown agent for this region: ${key}`, 400);
    return [found];
  }
  return agents;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ''; }
}

function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Region-scoped agents + state dropdown with phone coverage and last pushes. */
export async function getCampaignStates(env: any, region: unknown): Promise<{
  region: string;
  configured: boolean;
  liveEnabled: boolean;
  agents: CampaignAgent[];
  states: StateCount[];
}> {
  const code = normalizeRegion(region);
  const [counts, last, resolved] = await Promise.all([
    listStateCounts(code), lastLivePushes(code), resolveAgents(env, code),
  ]);
  const active = resolved.filter((a) => a.active);
  const agents: CampaignAgent[] = active.map((a) => ({
    key: a.key,
    region: a.region,
    name: a.name,
    configured: a.configured,
    active: a.active,
    source: a.source,
  }));
  const states: StateCount[] = counts.map((row) => {
    const prior = last.get(row.state);
    return {
      state: row.state,
      total: row.total,
      withPhone: row.withPhone,
      lastPushedAt: prior?.at || null,
      lastPushedCount: prior?.count ?? 0,
    };
  });
  return {
    region: code,
    configured: agents.length > 0 && agents.every((a) => a.configured),
    liveEnabled: liveEnabled(env),
    agents,
    states,
  };
}

/** Exact roster of what a push would send — no writes. */
export async function getCampaignPreview(
  env: any,
  region: unknown,
  state: unknown,
  distribution?: unknown,
  agentKey?: unknown,
): Promise<CampaignPreview> {
  const code = normalizeRegion(region);
  const stateName = normalizeState(state);
  const dist = normalizeDistribution(distribution);

  const active = (await resolveAgents(env, code)).filter((a) => a.active);
  if (active.length === 0) throw new CampaignError(`no NeoDove agents configured for ${code}`, 400);
  const participants = participantsFor(active, dist, agentKey);

  const rows = await listCustomersByState(code, stateName);
  if (rows.length === 0) throw new CampaignError('no customers in that region and state', 404);
  const { leads, skipped } = selectLeads(rows, code, stateName);

  // Same function the push uses — preview counts cannot drift from what sends.
  const assigned = assignAgents(leads, dist, participants.map((a) => a.key));
  const counts = new Map<string, number>();
  for (const item of assigned) counts.set(item.agentKey, (counts.get(item.agentKey) ?? 0) + 1);

  const agents: CampaignAgentPlan[] = participants.map((a) => ({
    key: a.key,
    region: a.region,
    name: a.name,
    configured: a.configured,
    active: a.active,
    source: a.source,
    planned: counts.get(a.key) ?? 0,
  }));

  return {
    region: code,
    state: stateName,
    total: rows.length,
    ready: leads.length,
    skipped,
    sample: leads.slice(0, 5).map((l) => ({
      name: l.name,
      mobileMasked: maskMobile(l.mobile),
      email: l.email,
    })),
    agents,
    distribution: dist,
    configured: agents.every((a) => a.configured),
    liveEnabled: liveEnabled(env),
    detail1: stateName,
    detail2: code,
  };
}

export async function getCampaignBatches(region: unknown, limit = 20): Promise<PushBatch[]> {
  const code = region ? normalizeRegion(region) : '';
  return listBatches(code, Math.min(Math.max(limit, 1), 50));
}

// ── Writes ─────────────────────────────────────────────────────────────────

/** Create a batch + its ledger rows. Never sends anything. */
export async function createPush(
  env: any,
  input: {
    region: unknown;
    state: unknown;
    distribution?: unknown;
    agentKey?: unknown;
    actor: Actor;
  },
): Promise<PushBatch> {
  const code = normalizeRegion(input.region);
  const stateName = normalizeState(input.state);
  const dist = normalizeDistribution(input.distribution);

  const active = (await resolveAgents(env, code)).filter((a) => a.active);
  if (active.length === 0) throw new CampaignError(`no NeoDove agents configured for ${code}`, 400);
  const participants = participantsFor(active, dist, input.agentKey);

  // Fail closed: never send a state half-routed.
  const missing = participants.filter((a) => !a.configured);
  if (missing.length > 0) {
    const names = missing.map((a) => `${a.name} (${a.key})`).join(', ');
    throw new CampaignError(`no campaign URL configured for ${names}`, 400);
  }

  const rows = await listCustomersByState(code, stateName);
  if (rows.length === 0) throw new CampaignError('no customers in that region and state', 404);
  const { leads, skipped } = selectLeads(rows, code, stateName);
  if (leads.length === 0) throw new CampaignError('no pushable leads (every row is missing a valid phone)', 400);

  const assigned = assignAgents(leads, dist, participants.map((a) => a.key));

  // Dry run unless the server switch is explicitly on.
  const live = liveEnabled(env);
  const now = new Date().toISOString();
  const batch: PushBatch = {
    id: newId('ndp'),
    region: code,
    state: stateName,
    mode: live ? 'live' : 'dry-run',
    status: live ? 'queued' : 'done',
    total: leads.length + skipped.length,
    planned: leads.length,
    sent: 0,
    failed: 0,
    skipped: live ? skipped.length : leads.length + skipped.length,
    pending: live ? leads.length : 0,
    distribution: dist,
    agentKey: dist === 'single' ? participants[0].key : '',
    requestedBy: String(input.actor?.id ?? ''),
    requestedByName: String(input.actor?.name ?? ''),
    campaignHost: hostOf(participants[0]?.url ?? ''),
    detail1: stateName,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: live ? null : now,
  };

  await insertBatch(batch);
  await insertLeadRows(batch.id, code, stateName, assigned, skipped, !live);

  const recounted = await recountBatch(batch.id);
  if (!live) {
    await updateBatch(batch.id, { status: 'done', finishedAt: now, updatedAt: now, error: null });
    return (await recountBatch(batch.id)) ?? recounted ?? batch;
  }
  await updateBatch(batch.id, { status: 'running', updatedAt: now });
  return (await getBatch(batch.id)) ?? batch;
}

interface SendOutcome {
  id: string;
  ok: boolean;
  httpStatus: number | null;
  body: string;
}

/**
 * One lead → one POST. Non-2xx is a terminal failure (never retried).
 *
 * `mobile` is sent as a JSON NUMBER to match NeoDove's documented example:
 * {"name":"...","mobile":9509624540,"email":"...","detail1":"...","detail2":"..."}
 * The value is always a normalized 10-digit Indian number, so it is exact in
 * IEEE-754 and has no leading zero to lose.
 */
async function sendOne(url: string, lead: any, detail1: string, detail2: string): Promise<SendOutcome> {
  const id = String(lead?.id ?? '');
  const payload = {
    name: String(lead?.name ?? ''),
    mobile: Number(lead?.mobile ?? 0),
    email: String(lead?.email ?? ''),
    detail1,
    detail2,
  };

  const attempt = async (): Promise<Response> =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

  let res: Response;
  try {
    res = await attempt();
  } catch {
    // Transport error only — nothing was created, so exactly one retry is safe.
    try {
      res = await attempt();
    } catch (e: any) {
      return { id, ok: false, httpStatus: null, body: `network: ${String(e?.message ?? e).slice(0, 200)}` };
    }
  }

  let body = '';
  try { body = await res.text(); } catch { body = ''; }
  return { id, ok: res.ok, httpStatus: res.status, body: body.slice(0, 500) };
}

/** Per-agent tallies with display names filled in from the registry. */
async function talliesFor(env: any, batchId: string, region: string): Promise<AgentTally[]> {
  const [raw, agents] = await Promise.all([agentTallies(batchId), resolveAgents(env, region)]);
  const nameByKey = new Map(agents.map((a) => [a.key, a.name]));
  return raw.map((t) => ({ ...t, name: nameByKey.get(t.agentKey) ?? t.agentKey }));
}

/**
 * Send the next chunk of a batch. Safe to call repeatedly; returns progress.
 * The client loops until `complete`, and the cron drain catches stragglers.
 */
export async function runBatchChunk(env: any, batchId: string, chunk = DEFAULT_CHUNK): Promise<PushProgress> {
  const id = String(batchId ?? '').trim();
  if (!id) throw new CampaignError('batch id is required', 400);
  const batch = await getBatch(id);
  if (!batch) throw new CampaignError('batch not found', 404);
  if (batch.mode === 'dry-run') {
    return {
      ...batch, processedNow: 0, complete: true, failures: [],
      agentTallies: await talliesFor(env, batch.id, batch.region),
    };
  }
  if (batch.status === 'done' || batch.status === 'failed') {
    return {
      ...batch, processedNow: 0, complete: true, failures: await failedView(batch.id),
      agentTallies: await talliesFor(env, batch.id, batch.region),
    };
  }
  if (!liveEnabled(env)) {
    throw new CampaignError('live sending is disabled (NEODOVE_CAMPAIGN_LIVE is not set)', 400);
  }

  // Includes inactive agents so a batch in flight when an agent is disabled can
  // still finish instead of stalling forever.
  const agents = await resolveAgents(env, batch.region);
  const urlByAgent = new Map<string, string>();
  for (const agent of agents) {
    if (agent.url) urlByAgent.set(agent.key, agent.url);
  }

  const limit = Math.min(Math.max(Number(chunk) || DEFAULT_CHUNK, 1), MAX_CHUNK);
  // Recycle claims abandoned by a closed tab before taking new work.
  await recoverStuckClaims(id);
  const pending = await claimPending(id, limit);
  let processedNow = 0;

  // Small worker pool — Workers cap simultaneous outbound connections at 6.
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const slice = pending.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(slice.map(async (lead) => {
      const agentKey = String(lead?.agentKey ?? '');
      const url = urlByAgent.get(agentKey);
      if (!url) {
        // Never guess a destination — record it and move on.
        return {
          id: String(lead?.id ?? ''),
          ok: false,
          httpStatus: null,
          body: `no campaign URL configured for agent ${agentKey || '(none)'}`,
        } satisfies SendOutcome;
      }
      return sendOne(url, lead, batch.detail1 || batch.state, batch.region);
    }));
    await markOutcomes(outcomes);
    processedNow += outcomes.length;
  }

  const recount = await recountBatch(id);
  const now = new Date().toISOString();
  const complete = !recount || recount.pending === 0;
  if (complete) {
    await updateBatch(id, { status: 'done', finishedAt: now, updatedAt: now });
  } else {
    await updateBatch(id, { status: 'running', updatedAt: now });
  }
  const fresh = (await getBatch(id)) ?? recount ?? batch;
  return {
    ...fresh,
    processedNow,
    complete,
    failures: await failedView(id),
    agentTallies: await talliesFor(env, id, fresh.region),
  };
}

async function failedView(batchId: string): Promise<PushProgress['failures']> {
  const rows = await listFailedLeads(batchId);
  return rows.map((row) => ({
    name: String(row?.name ?? ''),
    mobileMasked: maskMobile(String(row?.mobile ?? '')),
    httpStatus: row?.httpStatus == null ? null : Number(row.httpStatus),
    error: row?.responseText == null ? null : String(row.responseText).slice(0, 200),
  }));
}

/** Cron drain: finish batches a closed tab left behind. Never throws. */
export async function drainPendingPushes(env: any, chunk = DEFAULT_CHUNK): Promise<{ batches: number; processed: number }> {
  if (!liveEnabled(env)) return { batches: 0, processed: 0 };
  let batches = 0;
  let processed = 0;
  try {
    const ids = await batchesWithPending(3);
    for (const id of ids) {
      try {
        const progress = await runBatchChunk(env, id, chunk);
        batches++;
        processed += progress.processedNow;
      } catch (e: any) {
        console.error(`[neodove-campaign] drain ${id} failed:`, e?.message);
      }
    }
  } catch (e: any) {
    console.error('[neodove-campaign] drain failed:', e?.message);
  }
  return { batches, processed };
}
