// Extracted verbatim from service.ts by scripts/refactor/split-module.mjs.
// service.ts re-exports everything public here, so existing imports keep working.
import { listAgents, listTeamLeads, getAgentRow, setAgentUrl, listStateCounts, lastLivePushes, listTypeCounts, listCustomersByState, listBatches, insertBatch, insertLeadRows, recountBatch, updateBatch, getBatch, agentTallies, recoverStuckClaims, claimPending, markOutcomes, listFailedLeads, batchesWithPending } from "../store";
import type { CampaignAgent, StateCount, TypeCount, CampaignPreview, CampaignAgentPlan, PushBatch, Actor, AgentTally, PushProgress } from "../types";
import { selectLeads, assignAgents, maskMobile } from "../selection";
import type { ResolvedAgent, SendOutcome } from "./types";
import { normalizeCampaignUrl, urlFromSecret, CampaignError, hostOf, validateAgentUrl, normalizeRegion, normalizeClientType, liveEnabled, normalizeState, normalizeDistribution, participantsFor, newId, FETCH_TIMEOUT_MS, DEFAULT_CHUNK, MAX_CHUNK, CONCURRENCY } from "./pure";

/**
 * Registry rows joined with their URLs. The Controller-mapped DB value wins;
 * the Worker secret is the fallback. Includes inactive agents so a batch in
 * flight when an agent is disabled can still finish.
 */
export async function resolveAgents(env: any, region: string): Promise<ResolvedAgent[]> {
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
 * Team-Lead campaign targets with URLs resolved (same DB-wins/secret-fallback
 * rule). TLs only ever receive `single` full-copy pushes — never split.
 */
export async function resolveTeamLeads(env: any): Promise<ResolvedAgent[]> {
  const rows = await listTeamLeads();
  return rows.map((row) => {
    const dbUrl = normalizeCampaignUrl(row.campaignUrl);
    const secretUrl = urlFromSecret(env, row.secretName);
    const url = dbUrl || secretUrl;
    const source = dbUrl ? 'db' : (secretUrl ? 'secret' : 'none');
    return { ...row, url, configured: !!url, source };
  });
}

/**
 * Live roster pairs for team leads (`type='team_lead'`, not deleted):
 * normalized name → covered regions. Pure hint for the Controller (which TL
 * owns this region) — routing is never blocked on it; the sales-head decides.
 */
export async function teamLeadCoverage(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    const { campaignDb } = await import('../store');
    const db = campaignDb();
    if (!db) return out;
    const res = await db
      .prepare(`SELECT name, region, region2 FROM Telecaller WHERE type = 'team_lead' AND deleted = 0`)
      .all();
    for (const r of ((res as any)?.results ?? []) as any[]) {
      const key = String(r?.name ?? '').trim().toLowerCase();
      if (!key) continue;
      const pair = [String(r?.region ?? '').trim(), String(r?.region2 ?? '').trim()].filter(Boolean);
      if (pair.length > 0) out.set(key, [...new Set(pair)]);
    }
  } catch { /* roster read failed — covers hints stay empty, pushes unaffected */ }
  return out;
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

// ── Reads ──────────────────────────────────────────────────────────────────

/** Region-scoped agents + state dropdown with phone coverage and last pushes. */
export async function getCampaignStates(env: any, region: unknown, clientType?: unknown): Promise<{
  region: string;
  clientType: string;
  configured: boolean;
  liveEnabled: boolean;
  agents: CampaignAgent[];
  /** Team-Lead full-copy targets (all TLs; the UI hints the covering one). */
  teamLeads: CampaignAgent[];
  states: StateCount[];
  types: TypeCount[];
}> {
  const code = normalizeRegion(region);
  const type = normalizeClientType(clientType);
  const [counts, last, resolved, types, resolvedTls, coverage] = await Promise.all([
    listStateCounts(code, type), lastLivePushes(code, type), resolveAgents(env, code), listTypeCounts(code),
    resolveTeamLeads(env), teamLeadCoverage(),
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
  const teamLeads: CampaignAgent[] = resolvedTls.filter((a) => a.active).map((a) => ({
    key: a.key,
    region: a.region,
    name: a.name,
    configured: a.configured,
    active: a.active,
    source: a.source,
    covers: coverage.get(String(a.name ?? '').trim().toLowerCase()) ?? [],
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
    clientType: type,
    configured: agents.length > 0 && agents.every((a) => a.configured),
    liveEnabled: liveEnabled(env),
    agents,
    teamLeads,
    states,
    types,
  };
}

/** Exact roster of what a push would send — no writes. */
export async function getCampaignPreview(
  env: any,
  region: unknown,
  state: unknown,
  distribution?: unknown,
  agentKey?: unknown,
  clientType?: unknown,
): Promise<CampaignPreview> {
  const code = normalizeRegion(region);
  const stateName = normalizeState(state);
  const dist = normalizeDistribution(distribution);
  const type = normalizeClientType(clientType);

  const active = (await resolveAgents(env, code)).filter((a) => a.active);
  if (active.length === 0) throw new CampaignError(`no NeoDove agents configured for ${code}`, 400);
  const tls = (await resolveTeamLeads(env)).filter((a) => a.active);
  const participants = participantsFor(active, tls, dist, agentKey);

  const rows = await listCustomersByState(code, stateName, type);
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
    clientType: type,
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

/** Client-type dropdown for one region (+ optional state): bases + coverage. */
export async function getCampaignTypes(env: any, region: unknown, state?: unknown): Promise<{
  region: string;
  state: string;
  types: TypeCount[];
}> {
  void env;
  const code = normalizeRegion(region);
  const st = String(state ?? '').trim();
  return { region: code, state: st, types: await listTypeCounts(code, st) };
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
    clientType?: unknown;
    actor: Actor;
  },
): Promise<PushBatch> {
  const code = normalizeRegion(input.region);
  const stateName = normalizeState(input.state);
  const dist = normalizeDistribution(input.distribution);
  const type = normalizeClientType((input as any)?.clientType);

  const active = (await resolveAgents(env, code)).filter((a) => a.active);
  if (active.length === 0) throw new CampaignError(`no NeoDove agents configured for ${code}`, 400);
  const tls = (await resolveTeamLeads(env)).filter((a) => a.active);
  const participants = participantsFor(active, tls, dist, input.agentKey);

  // Fail closed: never send a state half-routed.
  const missing = participants.filter((a) => !a.configured);
  if (missing.length > 0) {
    const names = missing.map((a) => `${a.name} (${a.key})`).join(', ');
    throw new CampaignError(`no campaign URL configured for ${names}`, 400);
  }

  const rows = await listCustomersByState(code, stateName, type);
  if (rows.length === 0) throw new CampaignError('no customers in that region, state and type', 404);
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
    clientType: type,
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

/**
 * One lead → one POST. Non-2xx is a terminal failure (never retried).
 *
 * `mobile` is sent as a JSON NUMBER to match NeoDove's documented example:
 * {"name":"...","mobile":9509624540,"email":"...","detail1":"...","detail2":"..."}
 * The value is always a normalized 10-digit Indian number, so it is exact in
 * IEEE-754 and has no leading zero to lose.
 */
export async function sendOne(url: string, lead: any, detail1: string, detail2: string): Promise<SendOutcome> {
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
export async function talliesFor(env: any, batchId: string, region: string): Promise<AgentTally[]> {
  const [raw, agents, tls] = await Promise.all([
    agentTallies(batchId), resolveAgents(env, region), resolveTeamLeads(env),
  ]);
  const nameByKey = new Map([...agents, ...tls].map((a) => [a.key, a.name]));
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
  // still finish instead of stalling forever. Team leads included: a TL batch
  // is just a single-mode batch with a TL agent key.
  const [agents, tls] = await Promise.all([resolveAgents(env, batch.region), resolveTeamLeads(env)]);
  const urlByAgent = new Map<string, string>();
  for (const agent of [...agents, ...tls]) {
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

export async function failedView(batchId: string): Promise<PushProgress['failures']> {
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
