// drill.ts — the sales leaderboard's region drill (`?region=R1..R4|unmapped`).
//
// EXTRACTED from service-parts/io.ts (2026-11-21). The drill used to be a
// branch at the END of computeTelecallingDashboardData: every "what is this
// region working on?" request paid for the complete leaderboard aggregation
// (accepted snapshot ×2, declined snapshot, client classify, target ledger,
// KPI, all four regions) and then threw all of it away. The Sales dashboard
// pre-fetches one drill per region, so a single page load ran that aggregation
// FIVE extra times.
//
// The drill only needs the region's open (`sent`) estimates plus their
// classification, latest real note, risk verdict and call-tag overlay. That is
// all this module reads — no leaderboard aggregation runs here.
import { prisma } from '../../../shared/prisma';
import { logger } from '../../../shared/logger';
import { isSystemGeneratedComment } from '../../../shared/systemComment';
import { DATE_RE, IN_BATCH, istDate } from '../util';
import { getRiskItems, parseCommentDateMs, buildSnatchReason } from '../risk';
import type { EstimateRisk, RiskItem } from '../risk';
import { REGIONS } from '../regions';
import { displayNameForEmail } from '../../../shared/employee-name';
import { loadEmployeeNameIndex } from '../../../shared/employee-name-store';
import { overlayCallTags, overlayNextSteps } from '../call-tags';

/** Region key used by the dashboard tabs: '' → "UNMAPPED". */
export const UNMAPPED_KEY = 'UNMAPPED';

export interface DrillScope {
  /** Region id the drill is scoped to ('' = unmapped). */
  regionId: string;
  /** Staff row when the drill was requested by/for a person, else null. */
  staff: any | null;
}

export interface DrillQuery {
  region?: unknown;
  agent?: unknown;
  selfAgentId?: unknown;
}

/**
 * Resolve a drill request to one region, mirroring the rules the dashboard has
 * always used:
 *  • a SCOPED staff member (?selfAgentId, server-injected) may only ever drill
 *    into their OWN region — any client-supplied ?region=/?agent= is coerced;
 *  • ?agent= accepts a roster id or a roster name;
 *  • ?region= takes R1..R4 or "unmapped".
 * Returns null when this is a plain leaderboard request (no drill asked for).
 */
export function resolveDrillScope(
  q: DrillQuery,
  telecallers: any[],
): { scope: DrillScope | null; error?: string } {
  const selfAgentId = typeof q.selfAgentId === 'string' && q.selfAgentId ? q.selfAgentId : null;
  const requestedAgent = typeof q.agent === 'string' && q.agent ? q.agent : undefined;
  const rawRegion = typeof q.region === 'string' ? String(q.region).trim() : '';
  const requestedRegion: string | undefined = rawRegion
    ? (rawRegion.toLowerCase() === 'unmapped' ? '' : rawRegion.toUpperCase())
    : undefined;
  const agentFilter = requestedAgent ? (selfAgentId ?? requestedAgent) : undefined;

  if (selfAgentId) {
    // A plain dashboard request (no ?region=, no ?agent=) must keep returning
    // the full leaderboard — only an explicit drill is coerced to self.
    if (!agentFilter && requestedRegion === undefined) return { scope: null };
    const self = (telecallers ?? []).find((t) => String(t?.id) === selfAgentId) ?? null;
    return { scope: { regionId: String(self?.region ?? ''), staff: self } };
  }
  if (agentFilter) {
    const tc = (telecallers ?? []).find(
      (t: any) => String(t.id) === agentFilter
        || String(t.name ?? '') === agentFilter,
    ) as any;
    if (!tc) return { scope: null, error: 'agent not found' };
    return { scope: { regionId: String(tc.region ?? ''), staff: tc } };
  }
  if (requestedRegion !== undefined) return { scope: { regionId: requestedRegion, staff: null } };
  return { scope: null };
}

export interface FollowUpContext {
  day: string;
  nowMs: number;
  riskByEstimate: Map<string, RiskItem>;
  /** estimateId → the most recent non-system comment on that estimate. */
  latestCommentByEst: Map<string, { text: string; commentedBy: string; dateFormatted: string | null }>;
  /** telecallerId → name (call-tag "set by" attribution). */
  nameByTelecallerId: Map<string, string>;
}

/** One open estimate → the row shape the Lead Conversion / Generation lists render. */
export function mapFollowUpRow(e: any, ctx: FollowUpContext): Record<string, unknown> {
  const lastCommentDate = ctx.riskByEstimate.get(e.estimateId)?.lastCommentDate ?? null;
  const ts = parseCommentDateMs(lastCommentDate);
  const staleHours = ts !== null ? (ctx.nowMs - ts) / 3600000 : null;
  const riskItem = ctx.riskByEstimate.get(e.estimateId);
  const risk: EstimateRisk = riskItem?.risk ?? 'pending';
  const callTagBy = e.callTagBy ?? null;
  return {
    estimateId: e.estimateId,
    estimateNumber: e.estimateNumber,
    customerName: e.customerName,
    status: e.status,
    total: e.total,
    // Zoho org (multi-org sync) — drives the dashboard org badge/filter.
    organizationId: e.organizationId ?? null,
    region: String(e.region ?? ''),
    day: ctx.day,
    satisfactory: e.classification ? !!(e.classification as any).meaningfulUpdate : null,
    intentScore: (e.classification as any)?.intentScore ?? null,
    analysisSummary: (e.classification as any)?.summary ?? null,
    lastCommentDate,
    staleHours,
    // Most recent real sales note on THIS estimate (see loadLatestComments).
    latestComment: ctx.latestCommentByEst.get(e.estimateId) ?? null,
    // Lead details: per-estimate capture ONLY (stored by the GH runner from this
    // estimate's own Zoho comments). NO company-name enquiry fallback — a fuzzy
    // company match can surface a DIFFERENT customer's POC/mobile/enquiry number
    // as wrong chips.
    enquiryNumber: e.enquiryNumber ?? null,
    sourceLead: e.sourceLead ?? null,
    location: e.location ?? null,
    contactName: e.contactName ?? null,
    contactPhone: e.contactPhone ?? null,
    contactEmail: e.contactEmail ?? null,
    detailsCaptured: !!e.detailsCaptured,
    // Terminal AI give-up: 10 capture turns with <3 fields.
    detailsFailed: !!e.detailsFailed,
    // "Lead generated by" = the originating staff (creator), hidden until recorded.
    leadOf: e.createdBy ? ctx.nameByTelecallerId.get(String(e.createdBy)) ?? null : null,
    risk,
    staleReason: riskItem?.staleReason ?? (risk === 'red' || risk === 'zombie' ? buildSnatchReason(e, risk) : null),
    // Agent call-disposition tag (Lead Conversion view). Sticky, engine-untouched.
    callTag: e.callTag ?? null,
    callbackDate: e.callbackDate ?? null,
    callTagBy,
    callTagByName: callTagBy ? ctx.nameByTelecallerId.get(String(callTagBy)) ?? null : null,
    callTagAt: e.callTagAt ?? null,
    // Dated next step (migration 0028).
    nextStep: e.nextStep ?? null,
    nextStepDate: e.nextStepDate ?? null,
  };
}

/** Latest non-system note per estimate — chunked at IN_BATCH (D1 caps binds at 100). */
async function loadLatestComments(ids: string[]): Promise<FollowUpContext['latestCommentByEst']> {
  const best = new Map<string, { ts: number; v: { text: string; commentedBy: string; dateFormatted: string | null } }>();
  if (ids.length === 0) return new Map();
  try {
    const rows: any[] = [];
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      rows.push(...await prisma.comment.findMany({
        where: { estimateId: { in: ids.slice(i, i + IN_BATCH) } },
        select: { estimateId: true, description: true, commentedBy: true, date: true, dateFormatted: true },
      }));
    }
    for (const c of rows as any[]) {
      const text = String(c.description || '').trim();
      if (!text) continue;
      if (isSystemGeneratedComment(text, String(c.commentedBy || ''))) continue;
      const ts = parseCommentDateMs(String(c.dateFormatted ?? c.date ?? ''));
      if (ts === null) continue;
      const cur = best.get(String(c.estimateId));
      if (cur && cur.ts >= ts) continue;
      best.set(String(c.estimateId), {
        ts,
        v: {
          text,
          commentedBy: String(c.commentedBy || ''),
          dateFormatted: (c.dateFormatted ?? c.date ?? null) as string | null,
        },
      });
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'follow-up latest-comment lookup failed — rows render without notes');
  }
  return new Map([...best].map(([k, v]) => [k, v.v]));
}

/**
 * Open (`sent`) estimates for ONE region → rendered follow-up rows. Pass
 * `region: null` to load every region's rows in one pass (the dashboard's
 * single-request mode), which also returns the open count/₹ per region.
 */
export async function loadFollowUps(opts: {
  region: string | null;
  nameByTelecallerId: Map<string, string>;
  day?: string;
}): Promise<{ rows: Record<string, unknown>[]; openByRegion: Map<string, { count: number; value: number }> }> {
  const day = opts.day && DATE_RE.test(opts.day) ? opts.day : istDate();
  const where = opts.region === null ? { status: 'sent' } : { region: opts.region, status: 'sent' };
  const openByRegion = new Map<string, { count: number; value: number }>();
  let estimates: any[] = [];
  try {
    estimates = await prisma.estimate.findMany({
      where,
      // Highest-value estimates first — staff see the biggest deals at the top.
      orderBy: [{ total: 'desc' }, { date: 'asc' }],
      // 15-min Zoho analyzer verdict — drives the Satisfactory chip. D1's shim
      // resolves relations via `include`, not a nested `select` relation.
      include: { classification: true },
    }) as any[];
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'follow-up estimate read failed');
    return { rows: [], openByRegion };
  }
  for (const e of estimates) {
    const r = String(e?.region ?? '');
    const cur = openByRegion.get(r) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(e?.total ?? 0) || 0;
    openByRegion.set(r, cur);
  }
  let riskItems: RiskItem[] = [];
  try { riskItems = await getRiskItems(); } catch { /* risk is informational */ }
  const riskByEstimate = new Map<string, RiskItem>(riskItems.map((r) => [String(r.estimateId), r]));
  const latestCommentByEst = await loadLatestComments(estimates.map((e) => String(e.estimateId)));
  const ctx: FollowUpContext = { day, nowMs: Date.now(), riskByEstimate, latestCommentByEst, nameByTelecallerId: opts.nameByTelecallerId };
  const rows = estimates.map((e) => mapFollowUpRow(e, ctx));
  // Call-tag / next-step overlays ride OUTSIDE the payload caches: a tag tap is
  // a single-row write with no invalidation, and this merge makes it visible on
  // the very next read without forcing a full recompute.
  try {
    if (rows.length > 0) {
      await overlayCallTags(rows);
      await overlayNextSteps(rows);
    }
  } catch { /* overlay best-effort; rows render as stored */ }
  return { rows, openByRegion };
}

/** Telecaller names for attribution + the roster the scope resolver needs. */
export async function loadRoster(): Promise<{ telecallers: any[]; nameById: Map<string, string> }> {
  let telecallers: any[] = [];
  try {
    telecallers = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } }) as any[];
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'drill roster read failed');
  }
  let nameById = new Map<string, string>();
  try {
    const employees = await loadEmployeeNameIndex();
    nameById = new Map(telecallers.map((t) => [
      String(t.id), displayNameForEmail(employees, (t as any).email, String(t.name ?? '')),
    ]));
  } catch {
    nameById = new Map(telecallers.map((t) => [String(t.id), String(t.name ?? '')]));
  }
  return { telecallers, nameById };
}

/** Region metadata for the drill header. */
function regionLabel(regionId: string): { name: string; tl: string } {
  const def = REGIONS.find((r) => r.id === regionId) ?? null;
  return { name: def?.name ?? 'Unmapped', tl: def?.tl ?? '' };
}

/**
 * The drill payload (`?region=` / `?agent=`). Same shape the dashboard has
 * always consumed — the four period aggregates (`won`/`points`/`callsConnected`/
 * `leadsGenerated`) are null because they belong to the leaderboard window, not
 * to the drill; no surface reads them here.
 */
export async function buildRegionDrill(input: {
  regionId: string;
  staff: any | null;
  requestedDay: string;
}): Promise<any> {
  const t0 = Date.now();
  const day = input.requestedDay;
  const { telecallers, nameById } = await loadRoster();
  const { rows, openByRegion } = await loadFollowUps({ region: input.regionId, nameByTelecallerId: nameById, day });
  const label = regionLabel(input.regionId);
  const staffName = input.staff ? String(input.staff.name ?? '') : null;
  return {
    meta: {
      analysis: 'sales-leaderboard-region',
      title: staffName ? `Sales Leaderboard — ${staffName}` : `Sales Leaderboard — ${label.name}`,
      day,
      requestedDay: day,
      region: input.regionId,
      regionName: label.name,
      agents: telecallers.map((t: any) => ({
        id: String(t.id), name: nameById.get(String(t.id)) ?? String(t.name ?? ''),
        region: String(t.region ?? ''), region2: String(t.region2 ?? ''),
        tlLevel: String(t.tlLevel ?? ''),
        active: !!t.assignEstimateFollowUps,
      })),
      generatedAt: new Date().toISOString(),
      computeMs: Date.now() - t0,
    },
    agent: {
      id: input.staff ? String(input.staff.id) : input.regionId,
      name: staffName ?? label.name,
      region: input.regionId,
      tlLevel: input.staff ? String(input.staff.tlLevel ?? '') : label.tl,
      // Period aggregates live on the leaderboard payload; the drill does not
      // compute them (this is what made a region tab cost a full aggregation).
      won: null,
      points: null,
      callsConnected: null,
      leadsGenerated: null,
      regionOpen: openByRegion.get(input.regionId) ?? { count: 0, value: 0 },
      followUpCount: rows.length,
    },
    followUps: rows,
  };
}

/**
 * Every region's follow-ups in ONE pass — the dashboard's single-request mode
 * (`?follow_ups=1`). Replaces N parallel `?region=` requests, each of which used
 * to run a full leaderboard aggregation to return one region's list.
 */
export async function buildAllRegionFollowUps(input: {
  /** Region keys the viewer may see (scoped staff: own region(s) only). */
  allowedRegions?: string[] | null;
  day?: string;
}): Promise<Record<string, any>> {
  const { nameById } = await loadRoster();
  const { rows, openByRegion } = await loadFollowUps({ region: null, nameByTelecallerId: nameById, day: input.day });
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const key = String(r.region ?? '') || UNMAPPED_KEY;
    const list = grouped.get(key) ?? [];
    list.push(r);
    grouped.set(key, list);
  }
  const out: Record<string, any> = {};
  const keys = input.allowedRegions && input.allowedRegions.length > 0
    ? input.allowedRegions
    : [...REGIONS.map((r) => r.id), UNMAPPED_KEY];
  for (const key of keys) {
    const regionId = key === UNMAPPED_KEY ? '' : key;
    const list = grouped.get(key) ?? [];
    const label = regionLabel(regionId);
    out[key] = {
      agent: {
        id: regionId,
        name: label.name,
        region: regionId,
        tlLevel: label.tl,
        won: null,
        points: null,
        callsConnected: null,
        leadsGenerated: null,
        regionOpen: openByRegion.get(regionId) ?? { count: 0, value: 0 },
        followUpCount: list.length,
      },
      followUps: list,
    };
  }
  return out;
}
