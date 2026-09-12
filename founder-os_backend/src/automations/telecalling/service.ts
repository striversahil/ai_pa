/**
 * Telecalling automation — single unified automation that surfaces, per active
 * telecaller, both halves of daily performance:
 *
 *   1. Lead Conversion — Zoho estimates programmatically assigned to each
 *      telecaller (round-robin by default; the assignment policy is pluggable).
 *   2. Lead Generation — NeoDove calls connected + leads generated per day,
 *      refreshed live from the NeoDove backend push.
 *
 * Plus team KPIs and a live daily leaderboard.
 *
 * The handler runs the Lead Conversion engine (deal unassigned estimates to
 * conversion specialists). Risk re-poaching stays in code behind the MIS "EOD
 * Reassignment" switch but is switched OFF — holders keep everything, and
 * red-risk holdings are scored −10 at the EOD remark-deduction run instead.
 * The data() provider aggregates everything for the dashboard.
 */
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { Telecaller } from '@prisma/client';
import type { AutomationContext } from '../../modules/automation/types';
import { getNeodoveAgentMap, getAllNeodoveAgents, getLatestNeodoveDay, getNeodoveRangeMap, CONNECTED_CALLS_PER_DAY, LEADS_PER_AGENT_PER_DAY } from '../neodove-telecaller-report';
import { isSystemGeneratedComment } from '../../shared/systemComment';
import { cached, cacheDel, cacheDelPrefix } from '../../shared/cache';
import { evaluateShield } from './effort-shield';
import { normPhone10, readEffortSnapshot, type EffortRow } from './effort-sync';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
// ── Estimate risk model (live pre-warning) ───────────────────────────────────
// Real-time risk states over the open `sent` pipeline so trouble is visible
// BEFORE the end-of-day remark-deduction run:
//   zombie  — no comment in > 3 days (the AI already treats stale comments as
//             not meaningful, so these estimates are dead weight)
//   red     — latest AI verdict has meaningfulUpdate=false, OR the latest
//             comment is older than 24h even though it was satisfactory (a
//             stale-but-positive comment still means nobody chased it today —
//             costs −10 at the EOD remark run)
//   pending — no AI verdict yet
//   ok      — latest comment was meaningful AND fresh (< 24h)
export const ZOMBIE_DAYS = 3;
/** A meaningful comment older than this (hours) still counts red (costs −10 at EOD). */
export const FRESH_HOURS = 24;
const RISK_LIST_CAP = 25;

// ── Conversion-maximising assignment tuning ──────────────────────────────────
// Stability-first policy: healthy estimates stay put; only unassigned + at-risk
// (red/zombie) estimates are (re)dealt. New/reassigned estimates are given to
// proven converters balanced by current load, high-value estimates first.
const ASSIGN_TUNING = {
  conversionWeight: 0.6, // how much an agent's historical win rate drives routing
  loadWeight: 0.4,       // how strongly current load balances the deal
  baseWin: 0.2,          // floor conversion rate for new/unknown agents
} as const;

// ── Accepted-value KPI targets ─────────────────────────────────────────────
// "Est. Conv ₹" = total ₹ of ACCEPTED estimates closed in the selected period
// (from the slab close-event ledger, valued at each estimate's total).
// Daily thresholds (founder-set): ₹5L = target hit (celebrate), ₹10L = gold.
// Period targets scale linearly by working days (Mon–Sat): a week holds up to
// 6× the daily bar, a month ~26×, so every filter has a fair proportional goal.
export const CONVERSION_TARGET_DAILY = 500_000;
export const CONVERSION_GOLD_DAILY = 1_000_000;

/** Per-risk close-probability factor used for estimated-conversion projection. */
export function toCloseMultiplier(risk: EstimateRisk): number {
  switch (risk) {
    case 'ok': return 1.0;
    case 'pending': return 0.7;
    case 'red': return 0.35;
    case 'zombie': return 0.15;
    default: return 0.7;
  }
}


export type EstimateRisk = 'ok' | 'pending' | 'red' | 'zombie';

export interface RiskItem {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  telecallerId: string;
  telecallerName: string | null;
  total: number;
  risk: EstimateRisk;
  lastCommentDate: string | null;
  staleHours: number | null;
  reasoning: string | null;
  /** Why this estimate is about to be / was re-poached (surfaced to the agent). */
  snatchReason: string | null;
  /** Hours remaining until the EOD (21:00 IST) remark-deduction run. */
  snatchInHours: number | null;
  /** MIS override: estimate is locked to one agent — never re-poached, even when red/zombie. */
  locked: boolean;
  /** MIS override: estimate is never assigned to any agent. */
  skipAssignment: boolean;
  /** Dated customer commitment set by the holder/MIS (null when none). */
  nextStep: string | null;
  nextStepDate: string | null;
  /** True when today's NeoDove effort on this customer shields the EOD −10. */
  effortShielded: boolean;
}

/** Hours until the next EOD remark-deduction run (21:00 IST). Null if already past. */
export function hoursUntilEod(now: Date = new Date()): number | null {
  try {
    const istParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(now);
    const get = (t: string) => Number(istParts.find((p) => p.type === t)?.value ?? 0);
    const hour = get('hour') % 24;
    const minute = get('minute');
    const second = get('second');
    const secsSinceMidnight = hour * 3600 + minute * 60 + second;
    const eodSecs = 21 * 3600;
    const diff = eodSecs - secsSinceMidnight;
    return diff <= 0 ? null : Math.round((diff / 3600) * 10) / 10;
  } catch {
    return null;
  }
}

function parseCommentDateMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  // Zoho's dateFormatted is IST local, e.g. "05/09/2026 02:23 PM". Parsing it as
  // UTC (or the date-only `date` column, "2026-09-05", as midnight UTC) makes
  // every today-comment look ~12h stale — so build an explicit +05:30 instant.
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let h = parseInt(m[4], 10);
    if (m[6].toUpperCase() === 'PM' && h !== 12) h += 12;
    if (m[6].toUpperCase() === 'AM' && h === 12) h = 0;
    const iso = `${m[3]}-${m[2]}-${m[1]}T${String(h).padStart(2, '0')}:${m[5]}:00+05:30`;
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/**
 * Latest comment date (raw string as stored by the Zoho sync) per estimate.
 * Degrades to an empty map if the comment query fails — the risk model then
 * relies on the Classification verdict alone (graceful degradation).
 */
async function latestCommentDates(estimateIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (estimateIds.length === 0) return out;
  try {
    const comments = await prisma.comment.findMany({
      where: { estimateId: { in: estimateIds } },
      select: { estimateId: true, date: true, dateFormatted: true },
    });
    for (const c of comments) {
      if (!c?.estimateId) continue;
      // Prefer the full IST timestamp (has time-of-day); the plain `date` is
      // date-only and would read as midnight UTC. Keep the true newest comment
      // per estimate (orderBy date is ambiguous within a day).
      const raw = c.dateFormatted ?? c.date ?? '';
      const ts = parseCommentDateMs(raw);
      const cur = out.get(c.estimateId);
      const curTs = cur ? parseCommentDateMs(cur) : null;
      if (curTs === null || (ts !== null && ts > curTs)) out.set(c.estimateId, raw);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'latestCommentDates failed — risk model degrades to classification only');
  }
  return out;
}

function classifyRisk(
  cls: { meaningfulUpdate: boolean } | null | undefined,
  lastCommentDate: string | null,
  nowMs: number,
): { risk: EstimateRisk; staleHours: number | null } {
  const ts = parseCommentDateMs(lastCommentDate);
  const staleHours = ts !== null ? (nowMs - ts) / 3600000 : null;
  if (staleHours === null || staleHours > ZOMBIE_DAYS * 24) return { risk: 'zombie', staleHours };
  if (!cls) return { risk: 'pending', staleHours };
  // A satisfactory comment only keeps the estimate safe while it's FRESH.
  // If the last meaningful comment is older than FRESH_HOURS, nobody has chased
  // it today — it counts red (costs −10 at the EOD remark run) even though the
  // AI verdict was positive.
  if (!cls.meaningfulUpdate || (staleHours !== null && staleHours > FRESH_HOURS)) {
    return { risk: 'red', staleHours };
  }
  return { risk: 'ok', staleHours };
}

/**
 * Why an estimate costs its holder −10 at the EOD remark run. Mirrors the AI
 * verdict so the agent sees exactly what lost them points. Falls back to the
 * classification reasoning when available (e.g. "customer not answering").
 */
function buildSnatchReason(
  est: { estimateId: string; classification?: { meaningfulUpdate?: boolean; reasoning?: string | null } | null },
  risk: EstimateRisk,
): string {
  if (risk === 'zombie') return 'No reply in over 3 days — dead weight on the board';
  // Satisfactory-but-stale: the AI verdict was positive but the last comment is
  // older than FRESH_HOURS — nobody chased it today, so it costs −10 at EOD.
  if (risk === 'red' && est.classification?.meaningfulUpdate) {
    return 'Last update was satisfactory but stale (older than 24h) — 10 points deducted at EOD';
  }
  const reasoning = est.classification?.reasoning;
  if (reasoning && reasoning.trim() && reasoning.trim() !== 'No sales agent comment found.') {
    const verdict = est.classification?.meaningfulUpdate ? 'meaningful update' : 'unsatisfactory remark';
    const clipped = reasoning.trim().slice(0, 140);
    return `EOD remark penalty (${verdict}): ${clipped}`;
  }
  return 'Unsatisfactory remark at end of day — 10 points deducted';
}

// ── Risk cache (KV-backed, D1 row-read budget protection) ───────────────────
// The risk model scans all open estimates + their latest comment dates, which
// is expensive. Dashboards refetch on every runner WebSocket broadcast (every
// 15 min, the Zoho analyzer cadence), so the scan is cached in KV with a short
// TTL. Stale-upon-error: if the cached copy is older than TTL it is still
// served when a refresh fails (graceful degradation, no retry loops).
export const RISK_CACHE_KEY = 'telecalling:risk_cache';
const RISK_CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedRiskItem extends Omit<RiskItem, 'telecallerName'> {
  telecallerName: string | null;
}

interface RiskCache {
  items: CachedRiskItem[];
  computedAt: string;
}

async function computeRiskCache(): Promise<RiskCache> {
  const nowMs = Date.now();
  const telecallers = await prisma.telecaller.findMany({ orderBy: { order: 'asc' } });
  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));
  const neodoveIdByTelecaller = new Map<string, string>();
  for (const t of telecallers as any[]) {
    const nid = String(t?.neodoveUserId ?? '');
    if (nid) neodoveIdByTelecaller.set(String(t.id), nid);
  }

  const sentOpen = await prisma.estimate.findMany({
    where: { status: 'sent', assignedTelecallerId: { not: null } },
    include: { classification: true },
  });
  const lastComments = await latestCommentDates(sentOpen.map((e) => e.estimateId));

  // Today's per-customer effort (NeoDove call-log snapshot): holder × customer
  // phone → effective attempts. Drives the effort shield below.
  const effortByKey = new Map<string, EffortRow>();
  try {
    const effortRows = await readEffortSnapshot(istDate(new Date(nowMs)));
    for (const r of effortRows ?? []) {
      if (r?.u && r?.p) effortByKey.set(`${r.u}|${r.p}`, r);
    }
  } catch { /* no effort data — no shields */ }
  const todayIST = istDate(new Date(nowMs));

  const items: CachedRiskItem[] = sentOpen.map((e) => {
    const cls = (e as any).classification ?? null;
    const lastCommentDate = lastComments.get(e.estimateId) ?? null;
    const nextStep = (e as any).nextStep != null ? String((e as any).nextStep) : null;
    const nsRaw = (e as any).nextStepDate != null ? String((e as any).nextStepDate) : null;
    const nextStepDate = nsRaw && DATE_RE.test(nsRaw) ? nsRaw : null;
    // Next-step discipline beats AI mood-reading: a dated customer commitment
    // protects the holding through its date; a missed date reads red until
    // chased. No next step → the existing verdict + freshness rules apply.
    let risk: EstimateRisk;
    let staleHours: number | null;
    let snatchReason: string | null;
    if (nextStepDate) {
      const ts = parseCommentDateMs(lastCommentDate);
      staleHours = ts !== null ? (nowMs - ts) / 3600000 : null;
      if (nextStepDate >= todayIST) {
        risk = 'ok';
        snatchReason = `Next step due ${nextStepDate}${nextStep ? `: ${nextStep.slice(0, 120)}` : ''} — protected from EOD deduction`;
      } else {
        risk = 'red';
        snatchReason = `Next step${nextStep ? ` "${nextStep.slice(0, 120)}"` : ''} was due ${nextStepDate} — commitment missed`;
      }
    } else {
      const c = classifyRisk(cls, lastCommentDate, nowMs);
      risk = c.risk;
      staleHours = c.staleHours;
      snatchReason = buildSnatchReason(e, risk);
    }
    const owner = String(e.assignedTelecallerId);
    // Effort shield: genuine spread effort on THIS customer today — 2+
    // effective NeoDove attempts at least 3 hours apart (spanH), or a
    // connected call. Two redials in one burst never shields: n merges
    // sub-30-min redials and spanH enforces the gap. NeoDove-verified, not
    // comment-verified — failed pickups with real effort don't punish.
    let effortShielded = false;
    const nid = neodoveIdByTelecaller.get(owner);
    const phone = normPhone10((e as any).contactPhone);
    if (risk === 'red' && nid && phone) {
      const row = effortByKey.get(`${nid}|${phone}`);
      effortShielded = !!row && ((Number(row.n) >= 2 && Number(row.spanH) >= 3) || Number(row.conn) >= 1);
    }
    return {
      estimateId: e.estimateId,
      estimateNumber: e.estimateNumber,
      customerName: e.customerName,
      telecallerId: owner,
      telecallerName: nameById.get(owner) ?? null,
      total: Number(e.total ?? 0) || 0,
      risk,
      lastCommentDate,
      staleHours,
      reasoning: cls?.reasoning ?? null,
      snatchReason,
      snatchInHours: hoursUntilEod(new Date(nowMs)),
      locked: !!(e as any).lockedTelecallerId,
      skipAssignment: !!(e as any).skipAssignment,
      nextStep,
      nextStepDate,
      effortShielded,
    };
  });
  return { items, computedAt: new Date(nowMs).toISOString() };
}

/**
 * Risk items for the open pipeline, served from a 15-min KV cache.
 * On refresh failure, serves the stale snapshot (graceful degradation) rather
 * than burning more D1 row reads with retry loops.
 */
async function getRiskItems(): Promise<CachedRiskItem[]> {
  return cached<CachedRiskItem[]>(RISK_CACHE_KEY, RISK_CACHE_TTL_MS, async () => {
    const computed = await computeRiskCache();
    return computed.items;
  });
}

/**
 * Invalidate the risk cache when underlying estimate/comment data changes
 * (status transition, classification, comment sync, or a manual re-deal).
 * Also invalidates every cached dashboard payload so the leaderboard/lead-gen
 * views re-aggregate from fresh state on the next read.
 */
export async function invalidateRiskCache(): Promise<void> {
  await cacheDel(RISK_CACHE_KEY);
  try { await cacheDelPrefix('telecalling:dashboard'); } catch { /* non-fatal */ }
  // The MIS per-estimate export reads ?converters= from its own cache key —
  // stale Converted-By survives every close/snatch without this.
  try { await cacheDelPrefix('telecalling:converters'); } catch { /* non-fatal */ }
}

// ── Agent call-disposition tags ─────────────────────────────────────────────
// Per-estimate tags the sales team sets from the Lead Conversion view:
//   NO_ANSWER — client not picking up the phone
//   BUSY      — client busy, call back later (no fixed date)
//   CALLBACK  — follow up on a specific date (callbackDate, max +10 days IST)
// Sticky until the agent changes/clears them; NO engine writes or clears these
// columns (assignment, snatch, bulk-assign all leave them untouched).
export const CALL_TAGS = ['NO_ANSWER', 'BUSY', 'CALLBACK'] as const;
export type CallTag = (typeof CALL_TAGS)[number];
/** Callback dates may not be more than this many days after today (IST). */
export const CALLBACK_MAX_DAYS = 10;

function istDayPlus(n: number): string {
  return istDate(new Date(Date.now() + n * 86400000));
}

/**
 * Validate + persist an agent's call-disposition tag on one estimate.
 * Returns { ok, error?, status? } so route handlers stay thin.
 * CALLBACK requires callbackDate (YYYY-MM-DD, today..today+10 IST); any other
 * tag clears a stale date. tag null/undefined clears the whole disposition.
 */
export async function setEstimateCallTag(opts: {
  estimateId: string;
  tag: string | null | undefined;
  callbackDate?: string | null | undefined;
  actorTelecallerId?: string | null | undefined;
}): Promise<{ ok: boolean; error?: string; status?: number; estimate?: any }> {
  const estimateId = String(opts.estimateId || '').trim();
  if (!estimateId) return { ok: false, error: 'estimate id required', status: 400 };
  const rawTag = opts.tag === null || opts.tag === undefined || opts.tag === '' ? null : String(opts.tag).toUpperCase();
  if (rawTag !== null && !(CALL_TAGS as readonly string[]).includes(rawTag)) {
    return { ok: false, error: `tag must be one of ${CALL_TAGS.join(', ')}`, status: 400 };
  }
  let date: string | null = null;
  if (rawTag === 'CALLBACK') {
    const d = String(opts.callbackDate || '').trim();
    if (!DATE_RE.test(d)) return { ok: false, error: 'callbackDate (YYYY-MM-DD) required for CALLBACK', status: 400 };
    const today = istDate();
    const max = istDayPlus(CALLBACK_MAX_DAYS);
    if (d < today) return { ok: false, error: 'callbackDate cannot be in the past', status: 400 };
    if (d > max) return { ok: false, error: `callbackDate cannot be more than ${CALLBACK_MAX_DAYS} days out (max ${max})`, status: 400 };
    date = d;
  }
  const exists = await prisma.estimate.findUnique({
    where: { estimateId },
    select: { estimateId: true },
  });
  if (!exists) return { ok: false, error: 'estimate not found', status: 404 };
  const estimate = await prisma.estimate.update({
    where: { estimateId },
    data: {
      callTag: rawTag,
      callbackDate: date,
      callTagBy: rawTag ? (opts.actorTelecallerId ?? null) : null,
      callTagAt: rawTag ? new Date().toISOString() : null,
    },
  });
  // DELIBERATELY no invalidateRiskCache(): tags bypass the dashboard cache via
  // the post-cache overlay in getTelecallingDashboardData (Sheets-style — the
  // write is a single-row UPDATE and the next read merges it live, so a tag
  // save never forces the multi-second risk/leaderboard recompute).
  return { ok: true, estimate };
}

/** Max horizon for a dated next step (IST days out). Commitments further out
 *  than this are planning noise, not protection. */
export const NEXT_STEP_MAX_DAYS = 30;

/**
 * Validate + persist a dated next step (customer commitment) on one estimate.
 * Holder or MIS only (enforced at the route). Date must be today..today+30
 * IST; null clears both columns. Engines never write these — the risk model
 * only reads them (future/today date protects from red + EOD, past date reads
 * red until chased).
 */
export async function setEstimateNextStep(opts: {
  estimateId: string;
  date: string | null | undefined;
  note?: string | null | undefined;
}): Promise<{ ok: boolean; error?: string; status?: number; estimate?: any }> {
  const estimateId = String(opts.estimateId || '').trim();
  if (!estimateId) return { ok: false, error: 'estimate id required', status: 400 };
  const raw = opts.date === null || opts.date === undefined || opts.date === '' ? null : String(opts.date).trim();
  let date: string | null = null;
  if (raw !== null) {
    if (!DATE_RE.test(raw)) return { ok: false, error: 'date must be YYYY-MM-DD', status: 400 };
    const today = istDate();
    const max = istDayPlus(NEXT_STEP_MAX_DAYS);
    if (raw < today) return { ok: false, error: 'next-step date cannot be in the past', status: 400 };
    if (raw > max) return { ok: false, error: `next-step date cannot be more than ${NEXT_STEP_MAX_DAYS} days out (max ${max})`, status: 400 };
    date = raw;
  }
  const note = date ? String(opts.note ?? '').trim().slice(0, 200) : null;
  const exists = await prisma.estimate.findUnique({
    where: { estimateId },
    select: { estimateId: true },
  });
  if (!exists) return { ok: false, error: 'estimate not found', status: 404 };
  const estimate = await prisma.estimate.update({
    where: { estimateId },
    data: { nextStep: note, nextStepDate: date },
  });
  return { ok: true, estimate };
}

/**
 * Sheets-style freshness for holder-written next steps (mirrors
 * overlayCallTags): merges the LIVE nextStep columns onto cached follow-up
 * rows with one indexed query, so a save is visible on the very next read
 * without busting the 5-min dashboard cache. Also busts the risk cache — the
 * risk verdict itself depends on these columns (unlike tags).
 */
export async function overlayNextSteps(rows: any[]): Promise<void> {
  const ids = [...new Set((rows || []).map((r) => String(r?.estimateId || '')).filter(Boolean))];
  if (ids.length === 0) return;
  const found = await prisma.estimate.findMany({
    where: { estimateId: { in: ids } },
    select: { estimateId: true, nextStep: true, nextStepDate: true },
  });
  const byId = new Map((found as any[]).map((e) => [String(e.estimateId), e]));
  for (const r of rows) {
    const live = byId.get(String(r?.estimateId ?? ''));
    if (!live) continue;
    r.nextStep = (live as any).nextStep ?? null;
    r.nextStepDate = (live as any).nextStepDate ?? null;
  }
}

/**
 * Sheets-style freshness for agent-written tags: merge the LIVE tag columns
 * onto cached follow-up rows with one indexed query (~ms), AFTER the KV
 * cache. The 5-min dashboard payload stays warm (no recompute storms) while
 * tag taps are visible on the very next read. Best-effort — cached rows
 * render untouched if the overlay query fails.
 */
export async function overlayCallTags(rows: any[]): Promise<void> {
  const ids = [...new Set((rows || []).map((r) => String(r?.estimateId || '')).filter(Boolean))];
  if (ids.length === 0) return;
  const found = await prisma.estimate.findMany({
    where: { estimateId: { in: ids } },
    select: { estimateId: true, callTag: true, callbackDate: true, callTagBy: true, callTagAt: true },
  });
  const byId = new Map((found as any[]).map((e) => [String(e.estimateId), e]));
  let names: Map<string, string> | null = null;
  for (const r of rows) {
    const live = byId.get(String(r?.estimateId ?? ''));
    if (!live) continue;
    r.callTag = (live as any).callTag ?? null;
    r.callbackDate = (live as any).callbackDate ?? null;
    r.callTagBy = (live as any).callTagBy ?? null;
    r.callTagAt = (live as any).callTagAt ?? null;
    const by = (live as any).callTagBy ? String((live as any).callTagBy) : '';
    if (by) {
      if (!names) {
        try {
          const tcs = await prisma.telecaller.findMany({ select: { id: true, name: true } });
          names = new Map((tcs as any[]).map((t) => [String(t.id), String(t.name ?? '')]));
        } catch { names = new Map(); }
      }
      r.callTagByName = names.get(by) ?? null;
    } else {
      r.callTagByName = null;
    }
  }
}

/**
 * Idempotently seed the Telecaller roster

/**
 * Idempotently seed the Telecaller roster from the unique NeoDove agents across
 * ALL stored report days. Each unique agent (by NeoDove userId/userName) becomes
 * an active Telecaller; existing rows are linked (neodoveUserId/userName) without
 * changing their name/order/active state. No-op once the roster already covers
 * every agent, so it is safe to call on every dashboard load.
 */
async function syncTelecallersFromNeodove(): Promise<void> {
  try {
    const agents = await getAllNeodoveAgents();
    if (agents.length === 0) return;

    const existing = (await prisma.telecaller.findMany()) as (Telecaller & {
      neodoveUserId: string | null;
      neodoveUserName: string | null;
    })[];
    const byId = new Map<string, (typeof existing)[number]>();
    const byName = new Map<string, (typeof existing)[number]>();
    for (const t of existing) {
      if (t.neodoveUserId) byId.set(t.neodoveUserId, t);
      if (t.neodoveUserName) byName.set(t.neodoveUserName, t);
    }

    let writesNeeded = 0;
    for (const a of agents) {
      const existingT =
        (a.userId && byId.get(a.userId)) || (a.userName && byName.get(a.userName));
      if (existingT) {
        if (!existingT.neodoveUserId || !existingT.neodoveUserName) writesNeeded++;
      } else {
        writesNeeded++;
      }
    }
    if (writesNeeded === 0) return; // already fully synced

    let maxOrder = existing.reduce((m, t) => Math.max(m, t.order ?? 0), 0);
    for (const a of agents) {
      const existingT =
        (a.userId && byId.get(a.userId)) || (a.userName && byName.get(a.userName));
      if (existingT) {
        if (!existingT.neodoveUserId || !existingT.neodoveUserName) {
          await prisma.telecaller.update({
            where: { id: existingT.id },
            data: {
              neodoveUserId: existingT.neodoveUserId || a.userId || null,
              neodoveUserName: existingT.neodoveUserName || a.userName || null,
            },
          });
        }
        continue;
      }
      maxOrder += 1;
      await prisma.telecaller.create({
        data: {
          name: a.userName,
          // New hires start as lead-gen only — they must be reviewed/flagged as
          // conversion specialists by MIS before receiving estimate follow-ups.
          assignEstimateFollowUps: false,
          order: maxOrder,
          neodoveUserId: a.userId || null,
          neodoveUserName: a.userName,
        },
      });
    }
    logger.info({ agents: agents.length, created: writesNeeded }, 'Synced telecallers from NeoDove');
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'syncTelecallersFromNeodove failed');
  }
}

// The conversion-specialist pool: only telecallers flagged to hold estimate
// follow-ups receive assignments (new deals + EOD re-poaching). Everyone else
// still generates leads but never holds estimates.
async function getFollowUpSpecialists(): Promise<Telecaller[]> {
  return prisma.telecaller.findMany({ where: { assignEstimateFollowUps: true, deleted: false, absentSince: null }, orderBy: { order: 'asc' } });
}

// ── Round-robin rotation ─────────────────────────────────────────────────────
// Single source of truth: `Estimate.assignedTelecallerId`. No history table —
// every morning the whole active `sent` pool is re-dealt across the active
// roster, continuing from the previous rotation's stop point so consecutive
// mornings stay fair even when the sent-pool size changes.

const ROTATION_POINTER_KEY = 'telecalling_rotation:pointer';

async function getRotationPointer(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: ROTATION_POINTER_KEY } });
  return row ? String(row.value ?? '') : '';
}

async function setRotationPointer(telecallerId: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: ROTATION_POINTER_KEY },
    update: { value: telecallerId },
    create: { key: ROTATION_POINTER_KEY, value: telecallerId },
  });
}

/**
 * Deal every active `sent` estimate round-robin across active telecallers.
 * Runs once each morning (08:00 IST cron → POST /api/trigger/telecalling).
 */
export async function rotateEstimatesRoundRobin(): Promise<{ assigned: number }> {
  const telecallers = await getFollowUpSpecialists();
  if (telecallers.length === 0) return { assigned: 0 };

  const sent = await prisma.estimate.findMany({
    where: { status: 'sent', skipAssignment: false },
    orderBy: [{ date: 'asc' }, { estimateId: 'asc' }],
    select: { estimateId: true, lockedTelecallerId: true, assignedTelecallerId: true },
  });
  if (sent.length === 0) return { assigned: 0 };

  const lastId = await getRotationPointer();
  let idx = telecallers.findIndex((t) => t.id === lastId);
  idx = idx >= 0 ? (idx + 1) % telecallers.length : 0;

  let assigned = 0;
  let lastUsed = '';
  for (const est of sent) {
    // Locked estimates (MIS override) always go to their locked agent and are
    // never rotated away — "despite whatever the case".
    const locked = (est as any).lockedTelecallerId as string | null;
    const tcId = locked || telecallers[idx].id;
    lastUsed = tcId;
    if (!locked) idx = (idx + 1) % telecallers.length;
    await prisma.estimate.update({
      where: { estimateId: est.estimateId },
      data: { assignedTelecallerId: tcId },
    });
    assigned++;
  }

  if (lastUsed) await setRotationPointer(lastUsed);
  logger.info(
    { assigned, estimates: sent.length, telecallers: telecallers.length },
    'Round-robin estimate rotation complete',
  );
  return { assigned };
}

/**
 * Stability-first, conversion-maximising assignment.
 *
 * Keeps the open pipeline on the agent who has momentum with it:
 *   - healthy estimates (risk ok/pending) stay exactly where they are;
 *   - unassigned estimates generated TODAY go to their generator (creator-first,
 *     lead-gen or converter — the generator owns the fresh relationship);
 *   - other unassigned `sent` estimates are dealt to the best-fit agent;
 *   - at-risk (red/zombie) estimates are re-poached to a better converter —
 *     unless the MIS "EOD Reassignment" switch is OFF (holders keep everything,
 *     EXCEPT estimates held by lead-gen-only agents — those are always
 *     corrected back to a conversion specialist, switch-independent).
 *
 * Candidates are dealt high-value-first, favouring proven converters while a
 * load penalty keeps anyone from being buried. This maximises expected closed
 * value without resetting live customer relationships every morning.
 */
export async function assignEstimatesForMaxConversion(): Promise<{ assigned: number; reassigned: number; shielded: number; roleCorrected: number }> {
  const telecallers = await getFollowUpSpecialists();
  if (telecallers.length === 0) return { assigned: 0, reassigned: 0, shielded: 0, roleCorrected: 0 };
  // Specialist id set — anyone holding a `sent` estimate who is NOT in here
  // (lead-gen-only, deleted, absent, unknown) is a role-correction candidate:
  // follow-ups belong with conversion specialists, EOD-switch-independent.
  const specialistIds = new Set(telecallers.map((t) => String(t.id)));
  // Runtime "Active Penalty" toggle (MIS) — read once per engine run.
  const penaltiesEnabled = await isPenaltiesEnabled();
  // Runtime "EOD Reassignment" master switch (MIS Controller) — read once per
  // run. OFF = no risk-based re-poaching between specialists: holders keep
  // everything, the engine only deals unassigned estimates, enforces MIS locks,
  // and corrects non-specialist (lead-gen-only) holds back to specialists.
  const eodReassignEnabled = await isEodReassignEnabled();
  // All non-deleted, PRESENT telecallers, for creator inference — a lead-gen
  // creator who isn't flagged for follow-ups can still claim the estimate they
  // generated, but an ABSENT creator never receives claims while away.
  const allTelecallers = await prisma.telecaller.findMany({ where: { deleted: false, absentSince: null }, orderBy: { order: 'asc' } });

  const sent = await prisma.estimate.findMany({
    where: { status: 'sent', skipAssignment: false },
    include: { classification: true },
  });
  if (sent.length === 0) return { assigned: 0, reassigned: 0, shielded: 0, roleCorrected: 0 };

  // Live risk for every open estimate (served from the 5-min risk cache).
  let riskItems: CachedRiskItem[] = [];
  try { riskItems = await getRiskItems(); } catch (e: any) {
    logger.warn({ err: e?.message }, 'assign: risk cache unavailable — treating all as pending');
  }
  const riskByEstimate = new Map<string, EstimateRisk>();
  for (const r of riskItems) riskByEstimate.set(r.estimateId, r.risk);

  // Historical win stats — conversion rate per agent.
  const allOwned = await prisma.estimate.findMany({
    where: { assignedTelecallerId: { not: null } },
    select: { assignedTelecallerId: true, status: true },
  });
  const assignedTot = new Map<string, number>();
  const wonTot = new Map<string, number>();
  for (const e of allOwned) {
    const id = String(e.assignedTelecallerId);
    assignedTot.set(id, (assignedTot.get(id) ?? 0) + 1);
    if (e.status === 'accepted' || e.status === 'confirmed') wonTot.set(id, (wonTot.get(id) ?? 0) + 1);
  }
  const conversionRate = (id: string): number => {
    const a = assignedTot.get(id) ?? 0;
    const w = wonTot.get(id) ?? 0;
    return a + w > 0 ? w / (a + w) : 0;
  };

  // Current load = healthy open estimates the agent already owns (not the ones
  // about to be re-poached). Count-normalised so the penalty is comparable.
  const loadCount = new Map<string, number>();
  for (const est of sent) {
    if (!est.assignedTelecallerId) continue;
    const risk = riskByEstimate.get(est.estimateId) ?? 'pending';
    if (risk === 'ok' || risk === 'pending') {
      const id = String(est.assignedTelecallerId);
      loadCount.set(id, (loadCount.get(id) ?? 0) + 1);
    }
  }
  const maxLoad = Math.max(1, ...loadCount.values());

  // Candidates: unassigned OR at-risk — highest value first. Locked estimates
  // (MIS override) are only candidates if they are NOT already with their locked
  // agent, so they get placed/enforced but are NEVER re-poached away from it —
  // even when red/zombie ("despite whatever the case"). When the EOD
  // Reassignment switch is OFF, assigned estimates are never risk candidates —
  // holders keep everything, EXCEPT estimates held by a non-specialist
  // (lead-gen-only / deleted / absent holder): those are always corrected back
  // to a conversion specialist, switch-independent.
  const candidates = sent
    .filter((e) => {
      const locked = (e as any).lockedTelecallerId as string | null;
      if (locked) return String(e.assignedTelecallerId ?? '') !== String(locked);
      if (!e.assignedTelecallerId) return true;
      if (!specialistIds.has(String(e.assignedTelecallerId))) return true;
      if (!eodReassignEnabled) return false;
      const risk = riskByEstimate.get(e.estimateId);
      return risk === 'red' || risk === 'zombie';
    })
    .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));

  let assigned = 0;
  let reassigned = 0;
  let shielded = 0;
  let roleCorrected = 0;
  const { conversionWeight, loadWeight } = ASSIGN_TUNING;
  const today = istDate();
  // Effort-shield snapshots (today + 2 prior IST days) — loaded LAZILY, only
  // when the first snatch candidate appears, so quiet runs cost zero API/DB
  // reads beyond these three indexed Setting rows. Null = no evidence.
  let effortSnaps: [EffortRow[] | null, EffortRow[] | null, EffortRow[] | null] | null = null;
  async function getEffortSnaps(): Promise<[EffortRow[] | null, EffortRow[] | null, EffortRow[] | null]> {
    if (!effortSnaps) {
      const dayMinus = (n: number) => istDate(new Date(Date.now() - n * 86400000));
      try {
        effortSnaps = [
          await readEffortSnapshot(dayMinus(0)),
          await readEffortSnapshot(dayMinus(1)),
          await readEffortSnapshot(dayMinus(2)),
        ];
      } catch (e: any) {
        // Fail-open: snapshot unreadable → run unshielded, exactly as before.
        logger.warn({ err: e?.message }, 'assign: effort snapshots unreadable — running unshielded');
        effortSnaps = [null, null, null];
      }
    }
    return effortSnaps;
  }
  for (const est of candidates) {
    const wasAssigned = !!est.assignedTelecallerId;
    const risk = riskByEstimate.get(est.estimateId) ?? 'pending';
    const locked = (est as any).lockedTelecallerId as string | null;
    // Locked estimates go straight to their locked agent — no creator inference,
    // no best-fit routing, no snatch penalty (this is an MIS lock, not an EOD
    // snatch). "Despite whatever the case."
    const reason = buildSnatchReason(est, risk);
    // Role correction: the holder is not a conversion specialist (lead-gen-only,
    // deleted, absent, unknown). Follow-ups belong with specialists — this move
    // happens on every run regardless of the EOD switch, skips the effort
    // shield (not a performance snatch) and never charges the −15 penalty.
    const isRoleCorrection = wasAssigned && !locked && !!est.assignedTelecallerId
      && !specialistIds.has(String(est.assignedTelecallerId));
    const moveReason = locked
      ? null
      : isRoleCorrection
        ? 'Lead-gen hold — moved to a conversion specialist'
        : wasAssigned ? reason : null;
    let bestId = locked ?? '';
    if (!bestId) {
      // Creator-first (founder rule): a NEVER-ASSIGNED estimate generated TODAY
      // is dealt to the agent who generated it — whether lead-gen or converter —
      // before any best-fit routing. The generator owns the fresh relationship.
      // Older unassigned estimates keep best-fit conversion routing.
      if (!wasAssigned) {
        const knownCreator = String((est as any).createdBy ?? '');
        const creatorPresent = !!knownCreator
          && (allTelecallers as any[]).some((t) => String(t.id) === knownCreator);
        const generatedToday = String((est as any).date ?? '').slice(0, 10) === today;
        if (creatorPresent && generatedToday) {
          bestId = knownCreator;
          logger.info(
            { estimateId: est.estimateId, creator: knownCreator },
            'creator-first: today\'s lead dealt to its generator',
          );
        } else if (!knownCreator) {
          // Sole-creator first claim: a never-assigned estimate whose first comments
          // name a sales agent is dealt to that agent (he generated the lead), before
          // falling back to best-fit conversion routing for unassigned estimates.
          const creatorId = await inferEstimateCreator(est.estimateId, allTelecallers);
          if (creatorId) {
            bestId = creatorId;
            await prisma.estimate.update({
              where: { estimateId: est.estimateId },
              data: { createdBy: creatorId },
            });
          }
        }
      }
    }
    let bestScore = -Infinity;
    let bestLoad = Infinity;
    if (!bestId) {
      for (const tc of telecallers) {
        const id = tc.id;
        const conv = conversionRate(id);
        const load = loadCount.get(id) ?? 0;
        const loadFactor = maxLoad > 0 ? load / maxLoad : 0;
        const score = conversionWeight * conv - loadWeight * loadFactor;
        if (score > bestScore || (score === bestScore && load < bestLoad)) {
          bestScore = score;
          bestId = id;
          bestLoad = load;
        }
      }
    }
    if (!bestId) continue;
    // Effort shield: a red/zombie estimate about to be re-poached STAYS with
    // its holder (no snatch, no −15) when the holder earned it today — ≥3
    // outgoing calls on the lead with ≥2h spread (connects irrelevant).
    // Evaluated for the CURRENT holder at snatch time, from the 15-min
    // snapshots (fail-open: any error → snatch as before). Skipped for role
    // corrections — a non-specialist hold moves regardless of effort.
    if (wasAssigned && !locked && !isRoleCorrection && est.assignedTelecallerId && bestId !== String(est.assignedTelecallerId)) {
      try {
        const holder = (allTelecallers as any[]).find((t) => String(t.id) === String(est.assignedTelecallerId));
        const holderNeoId = String(holder?.neodoveUserId ?? '');
        const phone10 = normPhone10((est as any).contactPhone);
        const verdict = evaluateShield(phone10, holderNeoId, await getEffortSnaps());
        if (verdict.shielded) {
          shielded += 1;
          logger.info(
            { estimateId: est.estimateId, holder: est.assignedTelecallerId, streak: verdict.streak, evidence: verdict.evidence },
            `effort-shield: ${verdict.reason} — staying put`,
          );
          continue;
        }
        if (verdict.expired) {
          logger.info(
            { estimateId: est.estimateId, holder: est.assignedTelecallerId, streak: verdict.streak, evidence: verdict.evidence },
            `effort-shield: ${verdict.reason}`,
          );
        }
      } catch (e: any) {
        logger.warn({ err: e?.message, estimateId: est.estimateId }, 'effort-shield check failed — snatching as before');
      }
    }
    // Absent-cover awareness: read the CURRENT open ledger row (recordAssignment
    // resolves it below). If the estimate is a temp cover for an absent agent,
    // the losing temp holder is NEVER charged the snatch penalty, and the new
    // row auto-carries the original absent agent's id (see recordAssignment).
    let openRow: any = null;
    if (wasAssigned) {
      try {
        openRow = await prisma.estimateAssignment.findFirst({
          where: { estimateId: est.estimateId, status: 'assigned' },
          orderBy: { assignedAt: 'desc' },
        });
      } catch { /* non-fatal — penalty guard defaults to not penalising */ }
    }
    // If the current holder is being re-poached, the NEW row keeps the same
    // snatchReason (why the estimate left the previous holder). Fresh deals get
    // a null reason. Lock enforcement is not a snatch — no snatchReason.
    const movedFrom = est.assignedTelecallerId;
    // Self-hold no-op: best-fit re-picked the current holder (common — the best
    // converter holds reds). No write, no churn ledger row, no reassigned count,
    // no −15 — penalising an agent for "snatching" from themselves is a bug.
    if (wasAssigned && bestId === String(movedFrom)) continue;
    await prisma.estimate.update({
      where: { estimateId: est.estimateId },
      data: { assignedTelecallerId: bestId },
    });
    await recordAssignment(est.estimateId, bestId, moveReason);
    loadCount.set(bestId, (loadCount.get(bestId) ?? 0) + 1);
    if (wasAssigned) {
      reassigned += 1;
      if (isRoleCorrection) roleCorrected += 1;
      // The agent who lost the estimate at the EOD snatch gets -15 (unsatisfactory
      // remark or silent > 3 days). Charged to the holder who was re-poached FROM.
      // Lock enforcement is NOT a snatch, and neither is losing a TEMP absent-cover
      // hold — nor a role correction (the holder didn't earn the snatch; the
      // creator-first rule dealt it to them). The snatch penalty follows the
      // MIS "Active Penalty" toggle (runtime Setting — default OFF). Fail-open:
      // the penalty fires only with a confirmed non-temp open row — a failed
      // lookup (openRow null) or a legacy estimate with no ledger row never
      // penalises.
      if (movedFrom && !locked && !isRoleCorrection && penaltiesEnabled && !!openRow && !openRow.tempForTelecallerId) {
        await recordSnatchPenalty(String(movedFrom), est.estimateId, today, reason);
      }
    } else {
      assigned += 1;
    }
  }

  logger.info(
    { assigned, reassigned, shielded, roleCorrected, candidates: candidates.length, telecallers: telecallers.length, eodReassignEnabled },
    'Stability-first conversion-maximising assignment complete',
  );
  // Assignments changed the open-pipeline ownership — invalidate the risk cache
  // so the next dashboard read reflects the fresh state.
  if (assigned > 0 || reassigned > 0) {
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
  }
  return { assigned, reassigned, shielded, roleCorrected };
}

/**
 * Bulk assignment core — shared by the MIS controller endpoint and the
 * secret-gated ops runner endpoint. One-time assign: sets
 * Estimate.assignedTelecallerId + ledger rows, NO locks, NO score events or
 * penalties (a correction is never a snatch). Only `sent` estimates move;
 * anything else is reported as skipped. Temp-cover provenance is explicitly
 * cleared (these are real assignments, not absent covers).
 *
 * Runs on BOTH runtimes (module prisma is D1-shimmed in the worker build):
 * batched raw-SQL fast path with a sequential prisma-API fallback (the
 * fallback is also what the Express runtime uses, since real Prisma has no
 * .batch).
 */
export async function bulkAssignEstimates(
  moves: Array<{ estimateNumber?: string; estimateId?: string; telecallerId: string }>,
  opts?: { followUpAgents?: string[]; reason?: string },
): Promise<{
  moved: Array<Record<string, unknown>>;
  skipped: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
  flagsUpdated: string[];
}> {
  const reason = opts?.reason || 'MIS bulk assignment';
  const followUpAgents = opts?.followUpAgents ?? [];
  const moved: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  if (moves.length > 500) return { moved, skipped, errors: [{ error: 'max 500 moves per call' }], flagsUpdated: [] };

  // Resolve + validate everything BEFORE writing (fail fast per item).
  const plan: Array<{ estimateId: string; estimateNumber: string; from: string | null; to: string }> = [];
  for (const m of moves) {
    const ident = m.estimateNumber ?? m.estimateId;
    if (!ident || !m.telecallerId) { errors.push({ ident, error: 'estimateNumber/estimateId + telecallerId required' }); continue; }
    const est = m.estimateNumber
      ? await prisma.estimate.findFirst({ where: { estimateNumber: String(m.estimateNumber) } })
      : await prisma.estimate.findUnique({ where: { estimateId: String(m.estimateId) } });
    if (!est) { errors.push({ ident, error: 'estimate not found' }); continue; }
    if ((est as any).status !== 'sent') { skipped.push({ estimateNumber: (est as any).estimateNumber, status: (est as any).status, reason: 'not sent — left untouched' }); continue; }
    const tc = await prisma.telecaller.findUnique({ where: { id: String(m.telecallerId) } });
    if (!tc || (tc as any).deleted) { errors.push({ estimateNumber: (est as any).estimateNumber, error: 'target telecaller not found/deleted' }); continue; }
    if ((est as any).assignedTelecallerId === (tc as any).id) { skipped.push({ estimateNumber: (est as any).estimateNumber, reason: `already with ${(tc as any).name}` }); continue; }
    plan.push({ estimateId: (est as any).estimateId, estimateNumber: (est as any).estimateNumber, from: (est as any).assignedTelecallerId ?? null, to: (tc as any).id });
  }

  // Resolve open ledger rows for everything being moved (history chain).
  const openByEstimate = new Map<string, string>();
  if (plan.length > 0) {
    const ids = plan.map((p) => p.estimateId);
    for (let i = 0; i < ids.length; i += 400) {
      const rows = await prisma.estimateAssignment.findMany({
        where: { estimateId: { in: ids.slice(i, i + 400) }, status: 'assigned' },
      });
      for (const r of rows as any[]) openByEstimate.set(r.estimateId, r.id);
    }
  }

  const nowIso = new Date().toISOString();
  const day = istDate();
  const stmts: { sql: string; params: any[] }[] = [];
  for (const p of plan) {
    const priorOpenId = openByEstimate.get(p.estimateId) ?? null;
    stmts.push({ sql: 'UPDATE Estimate SET assignedTelecallerId = ? WHERE estimateId = ?', params: [p.to, p.estimateId] });
    if (priorOpenId) stmts.push({ sql: 'UPDATE EstimateAssignment SET status = ? WHERE id = ?', params: ['resolved', priorOpenId] });
    stmts.push({
      sql: 'INSERT INTO EstimateAssignment (id, estimateId, telecallerId, assignedAt, day, reassignedFromId, status, snatchReason, tempForTelecallerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params: [crypto.randomUUID(), p.estimateId, p.to, nowIso, day, priorOpenId, 'assigned', reason, null],
    });
  }
  try {
    for (let i = 0; i < stmts.length; i += 25) {
      await (prisma as any).batch(stmts.slice(i, i + 25));
    }
    for (const p of plan) moved.push({ estimateNumber: p.estimateNumber, from: p.from, to: p.to });
  } catch {
    // Fallback: sequential writes (also the Express-runtime path).
    for (const p of plan) {
      try {
        await prisma.estimate.update({ where: { estimateId: p.estimateId }, data: { assignedTelecallerId: p.to } });
        await recordAssignment(p.estimateId, p.to, reason, null);
        moved.push({ estimateNumber: p.estimateNumber, from: p.from, to: p.to, via: 'sequential-fallback' });
      } catch (e2: any) {
        errors.push({ estimateNumber: p.estimateNumber, error: e2?.message || String(e2) });
      }
    }
  }

  const flagsUpdated: string[] = [];
  for (const id of followUpAgents) {
    try {
      await prisma.telecaller.update({ where: { id: String(id) }, data: { assignEstimateFollowUps: true } as any });
      flagsUpdated.push(String(id));
    } catch (e: any) {
      errors.push({ telecallerId: id, error: e?.message || String(e) });
    }
  }

  if (moved.length > 0 || flagsUpdated.length > 0) {
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
  }
  return { moved, skipped, errors, flagsUpdated };
}

/**
 * Record an assignment into the EstimateAssignment chain (single source of truth
 * for fair close-credit). Resolves the previous open row first (if any), then
 * inserts the new holder linked via reassignedFromId. `snatchReason` (why the
 * previous holder lost it at EOD) is persisted so the losing agent sees exactly
 * what cost them the deal.
 */
export async function recordAssignment(estimateId: string, telecallerId: string, snatchReason: string | null = null, tempForTelecallerId?: string | null): Promise<void> {
  try {
    const current = await prisma.estimateAssignment.findFirst({
      where: { estimateId, status: 'assigned' },
      orderBy: { assignedAt: 'desc' },
    });
    let reassignedFromId: string | null = null;
    if (current) {
      await prisma.estimateAssignment.update({ where: { id: current.id }, data: { status: 'resolved' } });
      reassignedFromId = current.id;
    }
    await prisma.estimateAssignment.create({
      data: {
        estimateId, telecallerId, assignedAt: new Date(), day: istDate(), reassignedFromId, status: 'assigned',
        snatchReason,
        // Absentee-cover provenance: a temp-covered estimate that is re-poached
        // at EOD carries the ORIGINAL absent agent's id forward so it still
        // returns to her when she is marked present. Pass undefined to
        // auto-carry from the resolved row; pass null to explicitly clear
        // (e.g. when the estimate returns to the original holder).
        tempForTelecallerId: tempForTelecallerId === undefined
          ? (((current as any)?.tempForTelecallerId as string | undefined) ?? null)
          : tempForTelecallerId,
      },
    });
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordAssignment failed — continuing without history');
  }
}

// ── Absentee cover (MIS) ─────────────────────────────────────────────────────
// When MIS marks an agent ABSENT, her entire open pipeline is dealt equally
// (round-robin by roster order) across the active conversion specialists as
// TEMP covers. The redistribution itself is never a snatch — no score event of
// any kind is written. Each cover ledger row carries `tempForTelecallerId` =
// the ABSENT agent's id (carried forward through later EOD re-poaches), so
// marking her PRESENT hands every still-open estimate straight back to her.
// A cover agent's conversions credit the LEAD GENERATOR (founder rule —
// recordConversionClose credits createdBy, holder only as fallback);
// converted/declined estimates do not come back. Locked and never-assign
// estimates are left untouched.

export async function markTelecallerAbsent(telecallerId: string): Promise<{ redistributed: number; covers: number }> {
  // ── Phase 1: parallel reads (3 independent D1 round-trips at once) ─────────
  const [tc, held, covers] = await Promise.all([
    prisma.telecaller.findUnique({ where: { id: telecallerId } }),
    prisma.estimate.findMany({
      // NOTE: temp-cover provenance (tempForTelecallerId) lives on the
      // EstimateAssignment ledger, NOT on Estimate — so it cannot be filtered
      // here (unknown column → SQL error). Nested-absence exclusion happens in
      // Phase 2 via the open ledger rows instead.
      where: { assignedTelecallerId: telecallerId, status: 'sent', skipAssignment: false, lockedTelecallerId: null },
      select: { estimateId: true, total: true },
    }),
    prisma.telecaller.findMany({
      where: { assignEstimateFollowUps: true, deleted: false, absentSince: null, id: { not: telecallerId } },
      orderBy: { order: 'asc' },
    }),
  ]);
  if (!tc) throw new Error('telecaller not found');
  if (held.length === 0 || covers.length === 0) {
    // Nothing to move (or nobody to cover) — still flag absent so the roster hides him.
    await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: new Date() } });
    logger.info({ telecallerId, name: tc.name, held: held.length, covers: covers.length }, 'Agent marked absent — nothing to redistribute');
    return { redistributed: 0, covers: covers.length };
  }

  // ── Phase 2: read the currently-open assignment rows (for the history chain) ─
  // One batched query resolves the previous holder for every held estimate.
  // Nested-absence guard lives here (not in Phase 1): an estimate whose open
  // ledger row is ALREADY a temp cover for another absent agent belongs to
  // someone else who's away and must NOT be swept into this redistribution —
  // otherwise two agents would both pull it back on return.
  const heldIds = held.map((e) => e.estimateId);
  const openRows = await prisma.estimateAssignment.findMany({
    where: { estimateId: { in: heldIds }, status: 'assigned' },
    select: { id: true, estimateId: true, tempForTelecallerId: true },
  });
  const openByEstimate = new Map(openRows.map((r) => [r.estimateId, r.id]));
  const tempCovered = new Set(
    openRows.filter((r) => (r as any).tempForTelecallerId != null).map((r) => r.estimateId),
  );
  const movable = held.filter((e) => !tempCovered.has(e.estimateId));
  if (movable.length !== held.length) {
    logger.info(
      { telecallerId, held: held.length, movable: movable.length, skipped: held.length - movable.length },
      'markTelecallerAbsent: skipping estimates already temp-covering another absent agent',
    );
  }

  // ── Phase 3: build ALL writes, then fire them in chunks of D1 round-trips ─
  // Equal round-robin across the active conversion specialists (random start so it
  // isn't always the top of the roster). Batching collapses ~N×4 sequential
  // round-trips into a handful — this is what takes the call from ~10s to well
  // under 1s. Statements are chunked (D1 batch has practical size limits) and
  // each chunk is one network round-trip.
  const stmts: { sql: string; params: any[] }[] = [];
  const now = new Date();
  const nowIso = now.toISOString();
  const day = istDate();

  // (a) flag the agent absent
  stmts.push({ sql: 'UPDATE Telecaller SET absentSince = ? WHERE id = ?', params: [nowIso, telecallerId] });

  let idx = Math.floor(Math.random() * covers.length);
  for (const est of movable) {
    const cover = covers[idx % covers.length];
    const priorOpenId = openByEstimate.get(est.estimateId) ?? null;

    // (b) reassign the estimate to its cover
    stmts.push({ sql: 'UPDATE Estimate SET assignedTelecallerId = ? WHERE estimateId = ?', params: [cover.id, est.estimateId] });

    // (c) close the previous open assignment row (history chain)
    if (priorOpenId) {
      stmts.push({ sql: 'UPDATE EstimateAssignment SET status = ? WHERE id = ?', params: ['resolved', priorOpenId] });
    }

    // (d) open a new cover row, tagged with the absent agent so it returns on "present"
    stmts.push({
      sql: 'INSERT INTO EstimateAssignment (id, estimateId, telecallerId, assignedAt, day, reassignedFromId, status, snatchReason, tempForTelecallerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params: [crypto.randomUUID(), est.estimateId, cover.id, nowIso, day, priorOpenId, 'assigned', `Absent cover — ${tc.name} marked absent`, telecallerId],
    });

    idx += 1;
  }

  // Fire in chunks of 25 statements per D1 batch round-trip.
  const CHUNK = 25;
  try {
    for (let i = 0; i < stmts.length; i += CHUNK) {
      const chunk = stmts.slice(i, i + CHUNK);
      await (prisma as any).batch(chunk);
    }
  } catch (e: any) {
    logger.error(
      { telecallerId, error: e?.message || String(e), stmtCount: stmts.length, chunkSize: CHUNK, firstSql: stmts[0]?.sql },
      'markTelecallerAbsent: batched writes failed — falling back to sequential',
    );
    // Fallback: sequential writes so the feature still works while batching is debugged.
    await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: new Date() } });
    let fidx = Math.floor(Math.random() * covers.length);
    for (const est of movable) {
      const cover = covers[fidx % covers.length];
      await prisma.estimate.update({ where: { estimateId: est.estimateId }, data: { assignedTelecallerId: cover.id } });
      await recordAssignment(est.estimateId, cover.id, `Absent cover — ${tc.name} marked absent`, telecallerId);
      fidx += 1;
    }
  }

  logger.info(
    { telecallerId, name: tc.name, held: held.length, movable: movable.length, covers: covers.length, statements: stmts.length },
    'Agent marked absent — estimates redistributed (batched) as temp covers',
  );
  try { await invalidateRiskCache(); } catch { /* non-fatal */ }
  return { redistributed: movable.length, covers: covers.length };
}

export async function markTelecallerPresent(telecallerId: string): Promise<{ returned: number }> {
  // ── Phase 1: parallel reads ───────────────────────────────────────────────
  // Read the agent (for the history note) and all still-open temp-cover rows in one shot.
  const [tc, tempRows] = await Promise.all([
    prisma.telecaller.findUnique({ where: { id: telecallerId } }),
    prisma.estimateAssignment.findMany({
      where: { tempForTelecallerId: telecallerId, status: 'assigned' },
      orderBy: { assignedAt: 'asc' },
      select: { id: true, estimateId: true },
    }),
  ]);
  if (!tc) throw new Error('telecaller not found');

  // ── Phase 2: which of those are still open (not converted/declined while covered)?
  // One batched read over the candidate estimate ids.
  let returned = 0;
  if (tempRows.length > 0) {
    const estIds = tempRows.map((r) => r.estimateId);
    const estRows = await prisma.estimate.findMany({
      where: { estimateId: { in: estIds } },
      select: { estimateId: true, status: true },
    });
    const statusByEstimate = new Map(estRows.map((e) => [e.estimateId, e.status]));
    const openTempRows = tempRows.filter((r) => statusByEstimate.get(r.estimateId) === 'sent');

    if (openTempRows.length > 0) {
      // ── Phase 3: clear absent flag + return every open estimate, all batched ──
      const stmts: { sql: string; params: any[] }[] = [];
      const nowIso = new Date().toISOString();
      const day = istDate();

      // (a) clear the absent flag
      stmts.push({ sql: 'UPDATE Telecaller SET absentSince = ? WHERE id = ?', params: [null, telecallerId] });

      for (const row of openTempRows) {
        const priorOpenId = row.id; // the temp-cover row becomes the "reassigned from" link

        // (b) hand the estimate back to the original agent
        stmts.push({ sql: 'UPDATE Estimate SET assignedTelecallerId = ? WHERE estimateId = ?', params: [telecallerId, row.estimateId] });

        // (c) close the temp-cover row
        stmts.push({ sql: 'UPDATE EstimateAssignment SET status = ? WHERE id = ?', params: ['resolved', priorOpenId] });

        // (d) open a fresh row for the original agent (temp provenance cleared)
        stmts.push({
          sql: 'INSERT INTO EstimateAssignment (id, estimateId, telecallerId, assignedAt, day, reassignedFromId, status, snatchReason, tempForTelecallerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          params: [crypto.randomUUID(), row.estimateId, telecallerId, nowIso, day, priorOpenId, 'assigned', `Returned from absence — back to ${tc.name}`, null],
        });
        returned += 1;
      }

      try {
        await (prisma as any).batch(stmts);
      } catch (e: any) {
        logger.error(
          { telecallerId, error: e?.message || String(e), stmtCount: stmts.length },
          'markTelecallerPresent: batch failed — falling back to sequential writes',
        );
        await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: null } });
        for (const row of openTempRows) {
          await prisma.estimate.update({ where: { estimateId: row.estimateId }, data: { assignedTelecallerId: telecallerId } });
          await recordAssignment(row.estimateId, telecallerId, `Returned from absence — back to ${tc.name}`, null);
        }
      }
    } else {
      // Temp rows exist but none are still open (all converted/declined while
      // covered) — nothing to return, but the agent is back: clear the flag
      // or they stay absent forever with no path forward.
      await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: null } });
    }
  } else {
    // No temp rows — just clear the flag.
    await prisma.telecaller.update({ where: { id: telecallerId }, data: { absentSince: null } });
  }

  logger.info({ telecallerId, name: tc.name, tempRows: tempRows.length, returned }, 'Agent marked present — temp-covered estimates returned (batched)');
  try { await invalidateRiskCache(); } catch { /* non-fatal */ }
  return { returned };
}

// ── Creator inference ────────────────────────────────────────────────────────
// When a new estimate is created, sales agents usually write their name in the
// first 1-2 comments (e.g. "muskan", "samar" for Samarjeet). Infer which active
// telecaller created it so the estimate is saved to him and he gets first claim
// as the sole creator of that lead generation.

/** Normalise a name for fuzzy matching (lowercase, strip non-alpha). */
function normName(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Match a comment author name against a telecaller name (prefix/substring
 * tolerant so "samar" matches "Samarjeet"). Requires a minimum length to avoid
 * false positives from initials. */
function creatorMatches(author: string, name: string): boolean {
  const a = normName(author);
  const b = normName(name);
  if (!a || !b) return false;
  if (a === b) return true;
  // prefix match: samar → samarjeet (either direction)
  if (a.length >= 3 && (b.startsWith(a) || a.startsWith(b))) return true;
  // token match: "samarjeet s" vs "samarjeet" — check each whitespace token
  const aTokens = a.split(' ').filter((t) => t.length >= 3);
  const bTokens = b.split(' ').filter((t) => t.length >= 3);
  return aTokens.some((t) => bTokens.some((bt) => bt.startsWith(t) || t.startsWith(bt)));
}

/**
 * Infer which active telecaller created this estimate from its first real sales
 * comments (skipping Zoho system auto-logs). Returns the telecaller id, or null
 * when the author can't be matched to any active telecaller.
 */
async function inferEstimateCreator(estimateId: string, telecallers: Telecaller[]): Promise<string | null> {
  try {
    const comments = await prisma.comment.findMany({
      where: { estimateId },
      orderBy: { date: 'asc' },
      take: 3,
      select: { description: true, commentedBy: true },
    });
    for (const c of comments) {
      if (isSystemGeneratedComment(c.description, c.commentedBy)) continue;
      const author = (c.commentedBy || '').trim();
      if (!author) continue;
      for (const tc of telecallers) {
        if (creatorMatches(author, tc.name) || creatorMatches(author, tc.neodoveUserName ?? '')) {
          return tc.id;
        }
      }
    }
    return null;
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'inferEstimateCreator failed');
    return null;
  }
}

// ── Event-ledger scoring ─────────────────────────────────────────────────────
// The leaderboard is driven by an append-only score ledger: a slab-based
// close credit when an estimate converts (credited to the LEAD GENERATOR,
// not the holder), -10 per unsatisfactory (red-risk) estimate held at the
// EOD remark-deduction run, -15 per EOD snatch (legacy — risk re-poaching is
// removed, so no new −15 rows are written; historical ones still count where
// read). Each row records the IST day, so any timeframe (week/month/year) can
// be summed with a simple day-range filter — the weekly view restarts at zero
// automatically.
/** Conversion close slabs by estimate total (founder rule, ₹):
 *  ₹0–1L → 50 · ₹1L–2.5L → 75 · ₹2.5–5L → 100 · ₹5L and above → 200.
 *  Boundary totals join the higher slab (exactly ₹1L → 75, ₹2.5L → 100,
 *  ₹5L → 200); zero/unknown totals fall in the lowest slab. The cascading
 *  `<` checks below implement exactly these between-bands. */
export const CLOSE_SLABS = [50, 75, 100, 200];
export function closePointsFor(total: unknown): number {
  const v = Number(total ?? 0) || 0;
  if (v < 100_000) return 50;
  if (v < 250_000) return 75;
  if (v < 500_000) return 100;
  return 200;
}
/** Exact 20/80 split credited per close (generator 20%, closer 80% — the
 *  closer carries the penalty risk, so the closer carries the reward):
 *  50→10/40 · 75→15/60 · 100→20/80 · 200→40/160. */
const CLOSE_HALVES = new Set([10, 15, 20, 40, 60, 80, 160]);
/** True for any conversion-close delta (full slabs legacy + split halves). */
export function isCloseDelta(delta: unknown): boolean {
  const n = Number(delta);
  return CLOSE_SLABS.includes(n) || CLOSE_HALVES.has(n);
}
export function splitClosePoints(total: unknown): { generator: number; closer: number } {
  const slab = closePointsFor(total);
  const generator = Math.round(slab * 0.2);
  return { generator, closer: slab - generator };
}
const SNATCH_PENALTY = -15;
/** EOD remark penalty: one −10 per red-risk estimate held, charged daily. */
const REMARK_PENALTY = -10;
// The old −20 decline penalty is RETIRED (founder: too heavy) — historical −20
// rows stay in the ledger but the score loop below ignores any delta that isn't
// slab-close/−10/−15, so they no longer affect any board.
// The −15 snatch is legacy (risk re-poaching removed — no new −15 rows are
// written; historical ones still count). It remains governed at runtime by the
// MIS "Active Penalty" toggle (Setting `telecalling:penalties_enabled`,
// default OFF). The −10 remark penalty applies ALWAYS, independent of that
// toggle. Slab conversion-close credit is ALWAYS recorded regardless of the toggle.
// Temp absent-cover holds are penalty-free even when the toggle is ON
// (guarded at the call sites).
const PENALTIES_SETTING_KEY = 'telecalling:penalties_enabled';

/** Runtime state of the MIS "Active Penalty" toggle. Default: ON — the master
 *  switch for every penalty (the −10 EOD remark deduction and the legacy −15
 *  snatch). Only an explicit 'false' disables. */
export async function isPenaltiesEnabled(): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: PENALTIES_SETTING_KEY } });
    // Only an explicit 'false' disables — missing/any other value means ON.
    return String(row?.value ?? '').trim().toLowerCase() !== 'false';
  } catch {
    return true;
  }
}

/** Flip the MIS "Active Penalty" toggle. */
export async function setPenaltiesEnabled(enabled: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: PENALTIES_SETTING_KEY },
    update: { value: String(enabled) },
    create: { key: PENALTIES_SETTING_KEY, value: String(enabled) },
  });
}

// ── EOD risk-reassignment master switch (MIS Controller) ────────────────────
// ON (default) = red/zombie estimates are re-poached to a better converter at
// the engine runs. OFF = holders keep everything; the engine only deals
// unassigned estimates and enforces MIS locks. Same Setting-table pattern as
// the Active Penalty toggle above.
const EOD_REASSIGN_SETTING_KEY = 'telecalling:eod_reassign_enabled';

/** Runtime state of the MIS "EOD Reassignment" toggle. Default: ON. */
export async function isEodReassignEnabled(): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: EOD_REASSIGN_SETTING_KEY } });
    // Only an explicit 'false' disables — missing/any other value means ON.
    return String(row?.value ?? '').trim().toLowerCase() !== 'false';
  } catch {
    return true;
  }
}

/** Flip the MIS "EOD Reassignment" toggle. */
export async function setEodReassignEnabled(enabled: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: EOD_REASSIGN_SETTING_KEY },
    update: { value: String(enabled) },
    create: { key: EOD_REASSIGN_SETTING_KEY, value: String(enabled) },
  });
}

/**
 * Append a score event to the ledger. day is the IST date the event happened.
 * Idempotent callers guard duplicates at the call site.
 */
async function recordScoreEvent(telecallerId: string, estimateId: string, delta: number, day: string, reason: string | null = null): Promise<void> {
  try {
    await prisma.telecallerScoreEvent.create({
      data: { telecallerId, estimateId, delta, day, reason, createdAt: new Date() },
    });
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordScoreEvent failed — continuing without event');
  }
}

/**
 * Credit the slab-based close points, split 20/80 between the LEAD GENERATOR
 * (Estimate.createdBy — 20% for creating the lead) and the CLOSER
 * (assignedTelecallerId — 80% for carrying the follow-up plus all the
 * penalty risk). Founder rule: risk and reward sit with the same person. Falls back to the
 * current holder when the creator is unknown (old estimates pre-dating creator
 * capture). Same person generating + holding takes a single full-slab row.
 * Duplicate-guarded: close rows (any slab or half delta) per estimate gate
 * re-entry, so a re-run after a slab change can never double-credit.
 */
export async function recordConversionClose(estimateId: string, opts?: { day?: string; backfill?: boolean }): Promise<boolean> {
  try {
    const est = await prisma.estimate.findUnique({
      where: { estimateId },
      select: { status: true, total: true, assignedTelecallerId: true, createdBy: true },
    });
    if (!est || !(est.status === 'accepted' || est.status === 'confirmed')) return false;
    const generator = (est as any).createdBy || null;
    const holder = est.assignedTelecallerId || null;
    const earner = generator || holder;
    if (!earner) return false;
    const existing = await prisma.telecallerScoreEvent.findMany({
      where: { estimateId },
      select: { delta: true },
    });
    if ((existing as any[]).some((e) => isCloseDelta(e.delta))) return false;
    const day = opts?.day && DATE_RE.test(opts.day) ? opts.day : istDate();
    const total = Math.round(Number((est as any).total ?? 0) || 0);
    const tag = opts?.backfill ? ' (catch-up)' : '';
    if (generator && holder && String(generator) !== String(holder)) {
      const { generator: gPts, closer: cPts } = splitClosePoints((est as any).total);
      await recordScoreEvent(String(generator), estimateId, gPts, day, `Estimate converted ₹${total.toLocaleString('en-IN')} — ${gPts} points lead-generator share${tag}`);
      await recordScoreEvent(String(holder), estimateId, cPts, day, `Estimate converted ₹${total.toLocaleString('en-IN')} — ${cPts} points closer share${tag}`);
    } else {
      const points = closePointsFor((est as any).total);
      await recordScoreEvent(String(earner), estimateId, points, day, `Estimate converted ₹${total.toLocaleString('en-IN')} — ${points} points to lead generator${tag}`);
    }
    return true;
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordConversionClose failed');
    return false;
  }
}

/**
 * One-time catch-up: credit accepted/confirmed estimates whose close never
 * reached the ledger (pre-split era, missing creator links resolved since).
 * Runs at the start of the EOD deduction (self-healing — later runs no-op via
 * the close guard). Backfill rows carry the run day with a catch-up note.
 */
export async function catchUpConversionCloses(day: string): Promise<{ credited: number; estimates: number }> {
  let credited = 0;
  const seen = new Set<string>();
  try {
    for (const status of ['accepted', 'confirmed']) {
      const rows = await prisma.estimate.findMany({
        where: { status },
        select: { estimateId: true },
      }).catch(() => []);
      for (const r of (rows as any[]) ?? []) {
        const id = String(r?.estimateId ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (await recordConversionClose(id, { day, backfill: true })) credited += 1;
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'catchUpConversionCloses failed');
  }
  return { credited, estimates: seen.size };
}

/**
 * Converters map for the MIS per-estimate export: estimateId → { name, day }
 * sourced from the close ledger (slab deltas, credited to the lead generator
 * per the founder rule). Only converted estimates ever have a row
 * (duplicate-guarded: one close credit per estimate); declined/open estimates
 * resolve to nothing so the export leaves "Converted By" blank for them.
 */
export async function getConvertersMap(sinceDay: string = ''): Promise<Record<string, { name: string; day: string }>> {
  try {
    const events = await prisma.telecallerScoreEvent.findMany({
      where: {
        ...(DATE_RE.test(sinceDay) ? { day: { gte: sinceDay } } : {}),
      },
      select: { telecallerId: true, estimateId: true, day: true, delta: true, reason: true },
    });
    const ids = [...new Set((events as any[]).map((e) => String(e.telecallerId ?? '')).filter(Boolean))];
    const nameById = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await prisma.telecaller.findMany({
        where: { id: { in: ids.slice(i, i + 500) } },
        select: { id: true, name: true },
      });
      for (const r of rows as any[]) nameById.set(String(r.id), String(r.name ?? ''));
    }
    const out: Record<string, { name: string; day: string }> = {};
    const isGeneratorRow = (e: any) => String(e?.reason ?? '').includes('lead-generator share')
      || String(e?.reason ?? '').includes('to lead generator');
    // Two passes: generator-share rows first (split closes write generator +
    // closer rows — "Converted By" names the lead generator), then any close
    // row for the rest (legacy full-slab rows, same-person closes).
    for (const pass of [true, false]) {
      for (const e of events as any[]) {
        if (!isCloseDelta(e.delta)) continue;
        const estId = String(e.estimateId ?? '');
        if (!estId || out[estId]) continue;
        if (pass && !isGeneratorRow(e)) continue;
        if (!pass && isGeneratorRow(e)) continue;
        out[estId] = { name: nameById.get(String(e.telecallerId)) ?? '', day: String(e.day ?? '') };
      }
    }
    return out;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'converters map read failed — export Converted-By falls back to blank');
    return {};
  }
}

/**
 * Charge -15 to the agent who lost an estimate at the EOD snatch. Called when a
 * red/zombie estimate is re-poached away from its current holder.
 * Duplicate-guarded: one −15 per holder per estimate per day, so concurrent or
 * repeated engine runs can never double-charge the same snatch.
 */
async function recordSnatchPenalty(telecallerId: string, estimateId: string, day: string, reason: string | null): Promise<void> {
  try {
    const existing = await prisma.telecallerScoreEvent.findFirst({
      where: { telecallerId, estimateId, delta: SNATCH_PENALTY, day },
    });
    if (existing) return;
  } catch { /* lookup failed — fall through and record once rather than skip */ }
  await recordScoreEvent(telecallerId, estimateId, SNATCH_PENALTY, day, reason ?? 'EOD snatch — unsatisfactory remark');
}

/**
 * Charge -10 to the agent holding a red-risk (unsatisfactory) estimate at the
 * EOD remark-deduction run. Called once per red estimate per day — zombies are
 * excluded (silence already shows as 0 calls), as are MIS-locked and
 * skip-assignment estimates (out of the game by founder override).
 * Duplicate-guarded: one −10 per holder per estimate per day, so repeated
 * runs can never double-charge. Governed by the MIS "Active Penalty" toggle
 * (the EOD run skips charging entirely while it is OFF).
 */
async function recordRemarkPenalty(telecallerId: string, estimateId: string, day: string, reason: string | null): Promise<boolean> {
  try {
    const existing = await prisma.telecallerScoreEvent.findFirst({
      where: { telecallerId, estimateId, delta: REMARK_PENALTY, day },
    });
    if (existing) return false;
  } catch { /* lookup failed — fall through and record once rather than skip */ }
  await recordScoreEvent(telecallerId, estimateId, REMARK_PENALTY, day, reason ?? 'EOD remark penalty — unsatisfactory remark');
  return true;
}

/** Daily engine: refresh the roster from NeoDove, then deal the sent pool. */
export async function runLeadConversion(): Promise<{ assigned: number }> {
  await syncTelecallersFromNeodove();
  return assignEstimatesForMaxConversion();
}

/**
 * The day's NeoDove call activity (from the native 5-min report snapshot in
 * Setting). Drives the non-working-day rule: zero calls pushed that day means
 * nobody worked, so the EOD run deducts nothing.
 */
async function getNeodoveDayCalls(day: string): Promise<{ attempted: number; connected: number; hasReport: boolean }> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: `neodove_user_report:${day}` } });
    const payload = row?.value ? JSON.parse(String(row.value)) : null;
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    let attempted = 0;
    let connected = 0;
    for (const r of rows) {
      attempted += Number(r?.callsAttempted ?? 0) || 0;
      connected += Number(r?.callsConnected ?? 0) || 0;
    }
    return { attempted, connected, hasReport: rows.length > 0 };
  } catch {
    return { attempted: 0, connected: 0, hasReport: false };
  }
}

export interface EodPreviewRow {
  telecallerId: string;
  name: string;
  charges: number;
  shielded: number;
}

/**
 * EOD remark deduction: −10 per red-risk estimate currently held, one charge
 * per estimate per day. Risk re-poaching is removed (holders keep everything),
 * so this run never moves estimates — it only scores. Zombies, MIS-locked and
 * skip-assignment estimates are excluded. Gated by the MIS "Active Penalty"
 * toggle (default ON) — when OFF the run reports red holdings but charges
 * nothing. Non-working days (zero NeoDove call activity for the day — Sundays,
 * holidays) deduct nothing, even with the toggle ON: no work happened, so no
 * one is punished. Effort-shielded holdings (2+ NeoDove attempts or a connect
 * on that customer today) are reported but never charged. dryRun computes the
 * full preview without writing anything (MIS "what would tonight charge").
 * The run also sweeps close catch-ups (accepted/confirmed converts that never
 * reached the ledger). Triggered by the 21:00 IST telecalling-eod job via
 * POST /api/trigger/telecalling/eod.
 */
export async function runEodRemarkDeduction(day?: string, opts?: { dryRun?: boolean }): Promise<{
  deducted: number; agents: number; redHeld: number; shielded: number;
  closesCredited: number; day: string; penaltiesEnabled: boolean;
  preview: EodPreviewRow[]; skipped?: string;
}> {
  const dryRun = !!opts?.dryRun;
  const today = day && DATE_RE.test(day) ? day : istDate();
  const penaltiesEnabled = await isPenaltiesEnabled();
  let items: CachedRiskItem[] = [];
  try {
    items = await getRiskItems();
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'eod-deduction: risk items unavailable — deducting nothing');
    return { deducted: 0, agents: 0, redHeld: 0, shielded: 0, closesCredited: 0, day: today, penaltiesEnabled, preview: [] };
  }
  let redHeld = 0;
  for (const r of items) {
    if (r.risk !== 'red') continue;
    if (!r.telecallerId) continue;
    if (r.locked || r.skipAssignment) continue;
    redHeld += 1;
  }
  // Non-working day: the day's NeoDove push totals zero calls (Sunday,
  // holiday) — or is entirely missing — so nobody worked and nobody pays.
  // Read AFTER counting redHeld so the report still shows what WOULD have
  // been charged. A missing/unreadable report also skips (no evidence of
  // work); the empty NeoDove dashboard + this log line surface the breakage.
  const activity = await getNeodoveDayCalls(today);
  if (activity.attempted + activity.connected === 0) {
    logger.info({ redHeld, day: today, hasReport: activity.hasReport, dryRun }, 'EOD remark deduction skipped — non-working day (zero NeoDove calls)');
    return { deducted: 0, agents: 0, redHeld, shielded: 0, closesCredited: 0, day: today, penaltiesEnabled, preview: [], skipped: 'non-working-day' };
  }
  if (!penaltiesEnabled) {
    logger.info({ redHeld, day: today, dryRun }, 'EOD remark deduction skipped — Active Penalty is OFF');
    return { deducted: 0, agents: 0, redHeld, shielded: 0, closesCredited: 0, day: today, penaltiesEnabled, preview: [] };
  }
  // Close catch-up (self-healing): accepted/confirmed converts that never
  // reached the ledger get their split credit now. Skipped on dry runs.
  let closesCredited = 0;
  if (!dryRun) {
    try {
      closesCredited = (await catchUpConversionCloses(today)).credited;
    } catch { /* non-fatal */ }
    // Close rows change points too — bust with the deduction below.
  }
  let deducted = 0;
  let shielded = 0;
  const agents = new Set<string>();
  const previewByHolder = new Map<string, EodPreviewRow>();
  // Already charged today (re-run / dry-run accuracy): the live path is
  // duplicate-guarded inside recordRemarkPenalty, but the preview must not
  // count rows that would be skipped.
  const alreadyCharged = new Set<string>();
  try {
    const rows = await prisma.telecallerScoreEvent.findMany({
      where: { day: today, delta: REMARK_PENALTY },
      select: { telecallerId: true, estimateId: true },
    });
    for (const e of (rows as any[]) ?? []) {
      alreadyCharged.add(`${String(e.telecallerId)}|${String(e.estimateId)}`);
    }
  } catch { /* guard best-effort — live path still guards per row */ }
  const previewRow = (r: CachedRiskItem): EodPreviewRow => {
    const id = String(r.telecallerId);
    let row = previewByHolder.get(id);
    if (!row) {
      row = { telecallerId: id, name: String((r as any).telecallerName ?? ''), charges: 0, shielded: 0 };
      previewByHolder.set(id, row);
    }
    return row;
  };
  for (const r of items) {
    if (r.risk !== 'red') continue;
    if (!r.telecallerId) continue;
    if (r.locked || r.skipAssignment) continue;
    // Effort shield: genuine spread effort on THIS customer today (2+
    // effective attempts 3h apart or a connect) — reported, never charged.
    if ((r as any).effortShielded) {
      shielded += 1;
      previewRow(r).shielded += 1;
      continue;
    }
    if (alreadyCharged.has(`${String(r.telecallerId)}|${String(r.estimateId)}`)) continue;
    const reasoning = (r.reasoning ?? '').trim();
    const reason = reasoning && reasoning !== 'No sales agent comment found.'
      ? `EOD remark penalty (unsatisfactory): ${reasoning.slice(0, 140)}`
      : 'Unsatisfactory remark at end of day — 10 points deducted';
    if (dryRun) {
      deducted += 1;
      agents.add(String(r.telecallerId));
      previewRow(r).charges += 1;
      continue;
    }
    try {
      if (await recordRemarkPenalty(String(r.telecallerId), r.estimateId, today, reason)) {
        deducted += 1;
        agents.add(String(r.telecallerId));
        previewRow(r).charges += 1;
      }
    } catch (e: any) {
      logger.warn({ err: e?.message, estimateId: r.estimateId }, 'eod-deduction: charge failed — continuing');
    }
  }
  logger.info({ deducted, agents: agents.size, redHeld, shielded, closesCredited, day: today, dryRun }, 'EOD remark deduction complete');
  if (!dryRun && (deducted > 0 || closesCredited > 0)) {
    // Leaderboard points changed — bust the risk + dashboard caches (also the
    // converters map, which is close-derived) so the next read recomputes.
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
  }
  return {
    deducted, agents: agents.size, redHeld, shielded, closesCredited,
    day: today, penaltiesEnabled, preview: [...previewByHolder.values()],
  };
}

export interface TelecallerDayMetrics {
  id: string;
  name: string;
  assignEstimateFollowUps: boolean;
  neodoveUserName: string | null;
  conversion: {
    assigned: number;
    won: number;
    conversionRate: number;
    pipelineValue: number;
    // Accepted-value KPI: total ₹ of estimates this agent closed in the period
    // (valued from slab close events — the number behind "Est. Conv ₹").
    acceptedValue: number;
    // Forward-looking: expected closed value given the agent's win rate and the
    // live risk of each open estimate. count = expected number of closes.
    // Kept for the leaderboard tie-break + API compat; the KPI card shows
    // acceptedValue (actuals), not this projection.
    estimatedConversion: { count: number; value: number };
  };
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
    connectedStatus: 'green' | 'amber' | 'red';
    leadsTarget: number;
    leadsPct: number;
    leadsStatus: 'green' | 'amber' | 'red';
  };
  score: number;
  // Event-ledger points for the period: slab close credit per converted estimate (credited
  // to the lead generator), -10 per red-risk estimate held at the EOD remark
  // run, -15 per legacy EOD snatch. Summed over the period so the weekly view
  // resets to zero naturally.
  points: { closes: number; snatches: number; remarks: number; total: number };
  // Live pipeline risk: open estimates currently red (no meaningful update) or
  // zombie (silent > 3 days) — the EOD reassignment candidates.
  risk: { atRisk: number; zombie: number };
}

/** Shift a YYYY-MM-DD string by N days (UTC arithmetic on the date parts). */
function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** IST date range for a leaderboard period. null = today (default view). */
export function periodRange(period: string, todayStr: string): { from: string; to: string; label: string } | null {  const [y, m, d] = todayStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  const backToMonday = (dow + 6) % 7;
  switch (period) {
    case 'week': {
      const monday = shiftDays(todayStr, -backToMonday);
      return { from: monday, to: todayStr, label: 'This Week' };
    }
    case 'lastweek': {
      const monday = shiftDays(todayStr, -backToMonday);
      return { from: shiftDays(monday, -7), to: shiftDays(monday, -1), label: 'Last Week' };
    }
    case 'month':
      return { from: todayStr.slice(0, 8) + '01', to: todayStr, label: 'This Month' };
    case 'lastmonth': {
      const prevLast = new Date(Date.UTC(y, m - 1, 0));
      return { from: prevLast.toISOString().slice(0, 8) + '01', to: prevLast.toISOString().slice(0, 10), label: 'Last Month' };
    }
    case 'year':
      return { from: `${y}-01-01`, to: todayStr, label: 'This Year' };
    case 'lastyear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: 'Last Year' };
    default:
      return null;
  }
}

/** Working days (Mon–Sat, 6-day work week) inclusive between two IST dates. */
function workingDaysBetween(from: string, to: string): number {  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  if (end < start) return 0;
  let days = 0;
  for (let t = start; t <= end; t += 86400000) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0) days += 1; // exclude Sunday only (6-day work week)
  }
  return Math.max(1, days);
}

/**
 * Unified dashboard payload: per-telecaller Lead Conversion + Lead Generation
 * metrics for a given day (default: today, IST), team KPIs, and a live
 * leaderboard. `?period=week|lastweek|month|lastmonth|year|lastyear` switches
 * the leaderboard to an aggregated period view (assignment history + summed
 * NeoDove daily reports).
 *
 * `?daily=1` (period mode only) additionally attaches `daily`: a per-day ×
 * per-agent breakdown (closes with estimate tags, declines, calls, leads) for
 * the MIS export. Gated because it re-reads per-day NeoDove snapshots.
 *
 * The payload is cached in KV per (period, day, agent) so switching filters and
 * refreshing dashboards is fast — the underlying aggregation reads the full
 * EstimateAssignment history + score events, which is expensive on every hit.
 * A short TTL + single-flight means concurrent users share one compute.
 */
export interface TelecallingDailyRow {
  date: string;
  weekday: string;
  telecallerId: string;
  telecallerName: string;
  assigned: number;
  won: number;
  closedValue: number;
  /** Accepted estimate numbers that day ("EST-.., EST-.." or ""). */
  closedEstimates: string;
  declined: number;
  declinedValue: number;
  /** Declined estimate numbers that day. Day ≈ status-change day (see below). */
  declinedEstimates: string;
  snatches: number;
  /** EOD remark penalties that day (−10 per red-risk estimate held). */
  remarks: number;
  callsAttempted: number;
  callsConnected: number;
  callsNotConnected: number;
  talkTimeMin: number;
  leadsGenerated: number;
  leadsConverted: number;
  score: number;
}

/** YYYY-MM-DD list inclusive. null when the range exceeds the cap. */
function listDays(from: string, to: string, cap = 93): string[] | null {
  const out: string[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if ([fy, fm, fd, ty, tm, td].some((n) => !Number.isFinite(n))) return [];
  let t = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  if (end < t) return [];
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > cap) return null;
    t += 86400000;
  }
  return out;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function weekdayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if ([y, m, d].some((n) => !Number.isFinite(n))) return '';
  return WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
}

/** IST day (YYYY-MM-DD) of a stored Date/ISO value. null when unparseable. */
function istDayOf(val: unknown): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(String(val));
  if (Number.isNaN(d.getTime())) return null;
  return istDate(d);
}

/**
 * Per-day × per-agent MIS breakdown for an inclusive IST range.
 * Sources per day: slab close-credit events (accepted-day truth, valued at the
 * estimate total), `declined` estimates whose `lastSyncTime` falls that day
 * (approximation — declined rows are untouched after leaving `sent`, so the
  * watermark ≈ status-change day; holder = current assignee), assignment rows
  * dealt that day, −10 remark + −15 legacy snatch events, and the stored
  * NeoDove day snapshot.
 */
export async function computeTelecallingDaily(
  from: string,
  to: string,
): Promise<{ rows: TelecallingDailyRow[] } | { error: string }> {
  const dates = listDays(from, to);
  if (dates === null) return { error: 'daily breakdown capped at 93 days — pick week/month, not year' };
  if (dates.length === 0) return { rows: [] };
  const penaltiesEnabled = await isPenaltiesEnabled();
  const telecallers = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } });
  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));

  type DayAgg = {
    assigned: number; won: number; closePoints: number; snatches: number; remarks: number;
    closeIds: string[]; declinedIds: string[];
  };
  const agg = new Map<string, DayAgg>(); // `${day}|${owner}`
  const cell = (day: string, owner: string): DayAgg => {
    const k = `${day}|${owner}`;
    let c = agg.get(k);
    if (!c) { c = { assigned: 0, won: 0, closePoints: 0, snatches: 0, remarks: 0, closeIds: [], declinedIds: [] }; agg.set(k, c); }
    return c;
  };

  try {
    const events = await prisma.telecallerScoreEvent.findMany({
      where: { day: { gte: from, lte: to } },
      select: { telecallerId: true, delta: true, estimateId: true, day: true },
    });
    for (const ev of events as any[]) {
      const day = String(ev.day ?? '');
      if (!day) continue;
      if (isCloseDelta(ev.delta)) {
        const c = cell(day, String(ev.telecallerId));
        // Split closes write two rows (generator + closer share) — count one
        // win per estimate, but sum both halves into closePoints.
        if (ev.estimateId && !c.closeIds.includes(String(ev.estimateId))) {
          c.won += 1;
          c.closeIds.push(String(ev.estimateId));
        }
        c.closePoints += Number(ev.delta) || 0;
      } else if (ev.delta === SNATCH_PENALTY) {
        cell(day, String(ev.telecallerId)).snatches += 1;
      } else if (ev.delta === REMARK_PENALTY) {
        cell(day, String(ev.telecallerId)).remarks += 1;
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'daily: score events read failed');
  }

  try {
    const rows = await prisma.estimateAssignment.findMany({
      where: { day: { gte: from, lte: to } },
      select: { telecallerId: true, day: true },
    });
    for (const r of rows as any[]) {
      if (!r?.day) continue;
      cell(String(r.day), String(r.telecallerId)).assigned += 1;
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'daily: assignment rows read failed');
  }

  // Value + tags for closes (chunked for SQLite's bound limit).
  const valueById = new Map<string, number>();
  const numberById = new Map<string, string>();
  try {
    const ids = [...new Set([...agg.values()].flatMap((c) => c.closeIds))];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      if (chunk.length === 0) continue;
      const rows = await prisma.estimate.findMany({
        where: { estimateId: { in: chunk } },
        select: { estimateId: true, estimateNumber: true, total: true },
      });
      for (const r of rows as any[]) {
        valueById.set(r.estimateId, Number(r.total ?? 0) || 0);
        if (r.estimateNumber) numberById.set(r.estimateId, String(r.estimateNumber));
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'daily: close-estimate lookup failed');
  }

  // Declines grouped by watermark day (approximation, see docstring).
  try {
    const declined = await prisma.estimate.findMany({
      where: { status: 'declined' },
      select: { estimateId: true, estimateNumber: true, total: true, assignedTelecallerId: true, lastSyncTime: true },
    });
    for (const e of declined as any[]) {
      const d = istDayOf(e.lastSyncTime);
      if (!d || d < from || d > to) continue;
      if (!e.assignedTelecallerId) continue;
      cell(d, String(e.assignedTelecallerId)).declinedIds.push(String(e.estimateId));
      if (e.estimateNumber) numberById.set(String(e.estimateId), String(e.estimateNumber));
      valueById.set(String(e.estimateId), Number(e.total ?? 0) || 0);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'daily: declined lookup failed');
  }

  // NeoDove snapshots, one cached read per day.
  const neoByDay = new Map<string, Record<string, any>>();
  for (const d of dates) {
    try {
      neoByDay.set(d, await getNeodoveAgentMap(d));
    } catch {
      neoByDay.set(d, {});
    }
  }

  const out: TelecallingDailyRow[] = [];
  for (const d of dates) {
    const neoMap = neoByDay.get(d) ?? {};
    for (const tc of telecallers as any[]) {
      const id = String(tc.id);
      const c = agg.get(`${d}|${id}`);
      const nd = (tc.neodoveUserName && neoMap[tc.neodoveUserName])
        || (tc.neodoveUserId && neoMap[tc.neodoveUserId])
        || undefined;
      const callsConnected = nd?.callsConnected ?? 0;
      const leadsGenerated = typeof nd?.leadsGenerated === 'number'
        ? nd.leadsGenerated
        : ((nd?.leadsInProgress ?? 0) + (nd?.leadsConverted ?? 0));
      const won = c?.won ?? 0;
      const closePoints = c?.closePoints ?? 0;
      const snatches = c?.snatches ?? 0;
      const remarks = c?.remarks ?? 0;
      const closedValue = Math.round((c?.closeIds ?? []).reduce((s, eid) => s + (valueById.get(eid) ?? 0), 0));
      const declinedIds = c?.declinedIds ?? [];
      out.push({
        date: d,
        weekday: weekdayOf(d),
        telecallerId: id,
        telecallerName: nameById.get(tc.id) ?? tc.name,
        assigned: c?.assigned ?? 0,
        won,
        closedValue,
        closedEstimates: (c?.closeIds ?? []).map((eid) => numberById.get(eid) ?? eid).join(' | '),
        declined: declinedIds.length,
        declinedValue: Math.round(declinedIds.reduce((s, eid) => s + (valueById.get(eid) ?? 0), 0)),
        declinedEstimates: declinedIds.map((eid) => numberById.get(eid) ?? eid).join(' | '),
        snatches,
        remarks,
        callsAttempted: nd?.callsAttempted ?? 0,
        callsConnected,
        callsNotConnected: nd?.callsNotConnected ?? 0,
        talkTimeMin: Math.round((nd?.talkTimeSec ?? 0) / 60),
        leadsGenerated,
        leadsConverted: nd?.leadsConverted ?? 0,
        score: closePoints + (penaltiesEnabled ? (-snatches * 15 + remarks * REMARK_PENALTY) : 0) + leadsGenerated * 15 + Math.round(callsConnected * 0.5),
      });
    }
  }
  return { rows: out };
}

export async function getTelecallingDashboardData(ctx?: AutomationContext): Promise<any> {
  const q = (ctx?.subject ?? {}) as Record<string, unknown>;
  // 5-min TTL (not 30s): every write path invalidates these keys explicitly
  // (invalidateRiskCache / estimates-cache / neodove report), and live events
  // refetch — so the TTL only governs idle re-reads. A short TTL meant every
  // filter click + every 30s of idle viewing re-ran the full aggregation, and
  // a page load's ~10 concurrent cold computes contended into 30s+ timeouts
  // (2026-09-08 filter incident).
  const DASH_TTL_MS = 5 * 60 * 1000;
  // Converters-only shortcut for the MIS per-estimate export
  // (GET /api/automations/telecalling/data?converters=1&since=YYYY-MM-DD):
  // returns just { converters } from the slab close ledger and skips the full
  // dashboard aggregation entirely. Same endpoint on both runtimes, no new
  // route needed.
  const wantConverters = String(q.converters ?? '') === '1' || String(q.converters ?? '').toLowerCase() === 'true';
  if (wantConverters) {
    const since = typeof q.since === 'string' && DATE_RE.test(q.since) ? q.since : '';
    return cached<any>(`telecalling:converters:${since || 'all'}`, DASH_TTL_MS, () => getConvertersMap(since));
  }
  const requestedDay = typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : istDate();
  const period = typeof q.period === 'string' && q.period ? q.period : 'today';
  const agent = typeof q.agent === 'string' && q.agent ? q.agent : '';
  const selfAgentId = typeof q.selfAgentId === 'string' && q.selfAgentId ? q.selfAgentId : '';
  // Include selfAgentId so a scoped agent never receives a cached team-wide
  // (admin) payload — each user's view is isolated in the cache.
  const wantDaily = String(q.daily ?? '') === '1' || String(q.daily ?? '').toLowerCase() === 'true';
  const cacheKey = `telecalling:dashboard:${period}:${requestedDay}:${agent}:${selfAgentId}:${wantDaily ? 'daily' : ''}`;
  const payload = await cached<any>(cacheKey, DASH_TTL_MS, async () => {
    return computeTelecallingDashboardData(ctx);
  });
  // Agent call tags ride OUTSIDE the 5-min cache (see overlayCallTags): a tag
  // tap is a single-row write with zero invalidation, and this merge makes it
  // visible on the very next read — millisecond-grade propagation without the
  // multi-second full-aggregation recompute a cache bust would force.
  try {
    const rows: any[] = Array.isArray((payload as any)?.followUps) ? (payload as any).followUps : [];
    if (rows.length > 0) {
      await overlayCallTags(rows);
      await overlayNextSteps(rows);
    }
  } catch { /* overlay best-effort; cached rows render as-is */ }
  return payload;
}

/**
 * The actual (expensive) aggregation. Exposed for reuse and clarity; the public
 * `getTelecallingDashboardData` wraps this in the KV cache.
 */
export async function computeTelecallingDashboardData(ctx?: AutomationContext): Promise<any> {
  const q = (ctx?.subject ?? {}) as Record<string, unknown>;
  const date = typeof q.date === 'string' && DATE_RE.test(q.date) ? q.date : undefined;
  const requestedDay = date ?? istDate();
  const periodRangeInfo = periodRange(typeof q.period === 'string' ? q.period : 'today', istDate());
  const periodMode = periodRangeInfo !== null;

  // Auto-sync the Telecaller roster from the unique NeoDove agents (all stored
  // days). Idempotent — no-op once every agent is already present.
  await syncTelecallersFromNeodove();

  // If the requested day has no NeoDove data yet, fall back to the latest stored
  // NeoDove day so Lead Generation shows real numbers instead of all zeros.
  let day = requestedDay;
  let neodoveMap: Record<string, any> = {};
  let usingLatestAvailable = false;
  if (periodMode && periodRangeInfo) {
    // Period leaderboard: sum the stored daily NeoDove reports across the range.
    neodoveMap = await getNeodoveRangeMap(periodRangeInfo.from, periodRangeInfo.to);
  } else {
    neodoveMap = await getNeodoveAgentMap(requestedDay);
    if (Object.keys(neodoveMap).length === 0) {
      const latest = await getLatestNeodoveDay();
      if (latest && latest !== requestedDay) {
        day = latest;
        neodoveMap = await getNeodoveAgentMap(latest);
        usingLatestAvailable = true;
      }
    }
  }

  const telecallers = await prisma.telecaller.findMany({ where: { deleted: false }, orderBy: { order: 'asc' } });
  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));
  // Leaderboard reflects the runtime "Active Penalty" toggle: when OFF (default)
  // the score only counts positive actions.
  const penaltiesEnabled = await isPenaltiesEnabled();

  // Risk model over the open pipeline — served from the 5-min cache (D1
  // row-read budget protection). Stale chips in the agent view read from the
  // same snapshot, so the comment table is scanned at most once per TTL.
  const nowMs = Date.now();
  const riskItems = await getRiskItems();
  const riskByOwner = new Map<string, { atRisk: number; zombie: number }>();
  for (const r of riskItems) {
    if (r.risk === 'ok' || r.risk === 'pending') continue;
    const cur = riskByOwner.get(r.telecallerId) ?? { atRisk: 0, zombie: 0 };
    if (r.risk === 'zombie') cur.zombie += 1;
    else cur.atRisk += 1;
    riskByOwner.set(r.telecallerId, cur);
  }

  // Single source of truth: Estimate.assignedTelecallerId — one query, grouped
  // in memory. No assignment-history table involved.
  const owned = await prisma.estimate.findMany({
    where: { assignedTelecallerId: { not: null } },
    select: { estimateId: true, assignedTelecallerId: true, status: true, total: true },
  });
  let openByOwner = new Map<string, { count: number; value: number }>();
  for (const e of owned) {
    const owner = String(e.assignedTelecallerId);
    if (e.status === 'sent') {
      const cur = openByOwner.get(owner) ?? { count: 0, value: 0 };
      cur.count += 1;
      cur.value += Number(e.total ?? 0) || 0;
      openByOwner.set(owner, cur);
    }
  }

  // ── Period mode: conversion from the assignment history (EstimateAssignment
  // rows whose `day` falls inside the range). Assigned = assignment rows in the
  // period; Won = those estimates that have since closed; pipeline = the open
  // `sent` estimates assigned in the period. Credit split is today-only.
  let assignedByOwner: Map<string, number> | null = null;
  let periodOpenIds: Set<string> | null = null;
  if (periodMode && periodRangeInfo) {
    const { from, to } = periodRangeInfo;
    openByOwner = new Map();
    assignedByOwner = new Map();
    periodOpenIds = new Set();
    let assignRows: any[] = [];
    try {
      assignRows = await prisma.estimateAssignment.findMany({
        where: { day: { gte: from, lte: to } },
        select: { telecallerId: true, estimateId: true },
      });
    } catch (e: any) {
      logger.warn({ err: e?.message }, 'period assignment read failed — period leaderboard shows generation only');
    }
    const estIds = [...new Set(assignRows.map((r: any) => r.estimateId))];
    const estById = new Map<string, any>();
    if (estIds.length > 0) {
      // Chunk to stay under SQLite's ~999 bound-parameter limit per query.
      for (let i = 0; i < estIds.length; i += 500) {
        const chunk = estIds.slice(i, i + 500);
        try {
          const ests = await prisma.estimate.findMany({
            where: { estimateId: { in: chunk } },
            select: { estimateId: true, status: true, total: true },
          });
          for (const e of ests) estById.set(e.estimateId, e);
        } catch (e: any) {
          logger.warn({ err: e?.message, chunk: i }, 'period estimate chunk read failed');
        }
      }
    }
    for (const r of assignRows) {
      const id = String(r.telecallerId);
      assignedByOwner.set(id, (assignedByOwner.get(id) ?? 0) + 1);
      const e = estById.get(r.estimateId);
      if (!e) continue;
      if (e.status === 'sent') {
        periodOpenIds.add(r.estimateId);
        const cur = openByOwner.get(id) ?? { count: 0, value: 0 };
        cur.count += 1;
        cur.value += Number(e.total ?? 0) || 0;
        openByOwner.set(id, cur);
      }
    }
  }

  // Event-ledger points for the leaderboard period: slab close credits per
  // converted estimate (credited to the lead generator), −10 per red-risk
  // estimate held at the EOD remark run, −15 per legacy EOD snatch (no new
  // rows; still counted where present). Penalties count in the composite
  // score only while the MIS "Active Penalty" toggle is ON. Filtered by day
  // range so the weekly view restarts at zero — everyone gets a fair shot
  // on the table each week.
  const pointsFrom = periodMode && periodRangeInfo ? periodRangeInfo.from : day;
  const pointsTo = periodMode && periodRangeInfo ? periodRangeInfo.to : day;
  const pointsByOwner = new Map<string, { closes: number; snatches: number; remarks: number; total: number }>();
  // Estimate ids behind each close — valued below into accepted ₹ totals.
  const closeIdsByOwner = new Map<string, string[]>();
  try {
    const events = await prisma.telecallerScoreEvent.findMany({
      where: { day: { gte: pointsFrom, lte: pointsTo } },
      select: { telecallerId: true, delta: true, estimateId: true },
    });
    for (const ev of events) {
      const cur = pointsByOwner.get(String(ev.telecallerId)) ?? { closes: 0, snatches: 0, remarks: 0, total: 0 };
      // Only live deltas count: slab close credits, −10 remark penalties and
      // −15 snatches. Retired −20 decline rows still sit in the ledger but are
      // ignored everywhere.
      if (isCloseDelta(ev.delta)) {
        // Split closes write two rows per estimate — count one close per
        // estimate, summing both halves into the total.
        if ((ev as any).estimateId) {
          const arr = closeIdsByOwner.get(String(ev.telecallerId)) ?? [];
          const estId = String((ev as any).estimateId);
          if (!arr.includes(estId)) {
            arr.push(estId);
            closeIdsByOwner.set(String(ev.telecallerId), arr);
            cur.closes += 1;
          }
        } else {
          cur.closes += 1;
        }
        cur.total += ev.delta;
      }
      else if (ev.delta === SNATCH_PENALTY) { cur.snatches += 1; cur.total += ev.delta; }
      else if (ev.delta === REMARK_PENALTY) { cur.remarks += 1; cur.total += ev.delta; }
      pointsByOwner.set(String(ev.telecallerId), cur);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'score events read failed — leaderboard points unavailable');
  }

  // Value each close at its estimate's total (chunked for SQLite's bound limit).
  // Missing rows (deleted estimates) count the win but value ₹0.
  const valueByEstimate = new Map<string, number>();
  try {
    const allCloseIds = [...new Set([...closeIdsByOwner.values()].flat())];
    for (let i = 0; i < allCloseIds.length; i += 500) {
      const chunk = allCloseIds.slice(i, i + 500);
      if (chunk.length === 0) continue;
      const rows = await prisma.estimate.findMany({
        where: { estimateId: { in: chunk } },
        select: { estimateId: true, total: true },
      });
      for (const r of rows) valueByEstimate.set(r.estimateId, Number((r as any).total ?? 0) || 0);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'close-estimate totals read failed — accepted ₹ falls back to 0');
  }
  const acceptedByOwner = new Map<string, number>();
  for (const [owner, ids] of closeIdsByOwner) {
    acceptedByOwner.set(owner, ids.reduce((s, id) => s + (valueByEstimate.get(id) ?? 0), 0));
  }

  const leaderboard: TelecallerDayMetrics[] = [];
  // Lead Generation targets scale with the period's working days (6-day work
  // week, Mon–Sat) — a week target is one day × working days, never 1×.
  const workingDays = periodMode && periodRangeInfo ? workingDaysBetween(periodRangeInfo.from, periodRangeInfo.to) : 1;
  const kpiAcc = {
    assigned: 0,
    won: 0,
    pipelineValue: 0,
    acceptedValue: 0,
    callsConnected: 0,
    leadsGenerated: 0,
    talkTimeSec: 0,
  };

  for (const tc of telecallers as (Telecaller & { neodoveUserName: string | null })[]) {
    // Current workload straight off the single assignment field.
    const open = openByOwner.get(tc.id) ?? { count: 0, value: 0 };
    // "Won" = estimates actually CONVERTED in this timeframe, from the slab-close
    // event ledger (day = the day the estimate converted). NOT the count of
    // currently-held accepted/confirmed estimates (that's lifetime and would
    // show wins from weeks ago on "Today"). The weekly view therefore restarts
    // at zero naturally.
    const won = pointsByOwner.get(tc.id)?.closes ?? 0;
    const assignedToday = periodMode && assignedByOwner ? (assignedByOwner.get(tc.id) ?? 0) : open.count;
    const pipelineValue = open.value;
    // Accepted ₹ in this period: sum of totals of the estimates this agent
    // closed here (valued from the slab-close ledger rows above). This is the number
    // behind the "Est. Conv ₹" KPI — actuals, not the projection below.
    const acceptedValue = Math.round(acceptedByOwner.get(tc.id) ?? 0);
    const conversionRate = assignedToday + won > 0 ? Math.round((won / (assignedToday + won)) * 100) : 0;

    // Lead Generation: copy this telecaller's live NeoDove metrics (matched by
    // the linked NeoDove user name) into the dashboard.
    const nd =
      (tc.neodoveUserName && neodoveMap[tc.neodoveUserName]) ||
      (tc.neodoveUserId && neodoveMap[tc.neodoveUserId]) ||
      undefined;
    const callsAttempted = nd?.callsAttempted ?? 0;
    const callsConnected = nd?.callsConnected ?? 0;
    const callsNotConnected = nd?.callsNotConnected ?? 0;
    const incomingCalls = nd?.incomingCalls ?? 0;
    const outgoingCalls = nd?.outgoingCalls ?? 0;
    const talkTimeSec = nd?.talkTimeSec ?? 0;
    const leadsConverted = nd?.leadsConverted ?? 0;
    const leadsInProgress = nd?.leadsInProgress ?? 0;
    const leadsLost = nd?.leadsLost ?? 0;
    const followupLeads = nd?.followupLeads ?? 0;
    // True "leads generated" count from the get-leads API (stored on the
    // NeoDove agent row). Fall back to the legacy leadsInProgress +
    // leadsConverted for snapshots predating the field.
    const leadsGenerated =
      typeof nd?.leadsGenerated === 'number' ? nd.leadsGenerated : leadsInProgress + leadsConverted;

    // Lead Generation KRA vs NeoDove daily benchmarks (exact same interface as
    // the NeoDove telecaller report): traffic light 🟢 ≥100% · 🟡 60–99% · 🔴 <60%.
    const connectedTarget = CONNECTED_CALLS_PER_DAY * workingDays;
    const connectedPct = connectedTarget > 0 ? Math.round((callsConnected / connectedTarget) * 100) : 0;
    const connectedStatus: 'green' | 'amber' | 'red' =
      connectedPct >= 100 ? 'green' : connectedPct >= 60 ? 'amber' : 'red';
    const leadsTarget = LEADS_PER_AGENT_PER_DAY * workingDays;
    const leadsPct = leadsTarget > 0 ? Math.round((leadsGenerated / leadsTarget) * 100) : 0;
    const leadsStatus: 'green' | 'amber' | 'red' =
      leadsPct >= 100 ? 'green' : leadsPct >= 60 ? 'amber' : 'red';

    // Composite score (tunable, the leaderboard norm): a converted estimate
    // weighs +100, a generated lead +15 and a connected call +0.5. Penalties
    // (−10 remarks, legacy −15 snatches) only count while the MIS "Active
    // Penalty" toggle is ON.
    const snatches = pointsByOwner.get(tc.id)?.snatches ?? 0;
    const remarkTotal = (pointsByOwner.get(tc.id)?.remarks ?? 0) * REMARK_PENALTY;
    const score = won * 100 + (penaltiesEnabled ? (-snatches * 15 + remarkTotal) : 0) + leadsGenerated * 15 + Math.round(callsConnected * 0.5);

    kpiAcc.assigned += assignedToday;
    kpiAcc.won += won;
    kpiAcc.pipelineValue += pipelineValue;
    kpiAcc.acceptedValue += acceptedValue;
    kpiAcc.callsConnected += callsConnected;
    kpiAcc.leadsGenerated += leadsGenerated;
    kpiAcc.talkTimeSec += talkTimeSec;

    // Estimated conversion: expected closed value from this agent's open
    // pipeline, weighted by their win rate and each estimate's live risk.
    // Floored win rate so a brand-new agent isn't projected at 0.
    const agentWinRate = assignedToday + won > 0 ? won / (assignedToday + won) : 0;
    const baseWin = Math.max(agentWinRate, ASSIGN_TUNING.baseWin);
    const cap = (x: number) => Math.max(0.05, Math.min(0.95, x));
    let estCount = 0;
    let estValue = 0;
    for (const r of riskItems) {
      if (r.telecallerId !== tc.id) continue;
      if (periodMode && periodOpenIds && !periodOpenIds.has(r.estimateId)) continue;
      const prob = cap(baseWin * toCloseMultiplier(r.risk));
      estCount += prob;
      estValue += r.total * prob;
    }
    const estimatedConversion = { count: Math.round(estCount * 10) / 10, value: Math.round(estValue) };

    leaderboard.push({
      id: tc.id,
      name: tc.name,
      assignEstimateFollowUps: tc.assignEstimateFollowUps,
      neodoveUserName: tc.neodoveUserName,
      conversion: { assigned: assignedToday, won, conversionRate, pipelineValue, acceptedValue, estimatedConversion },
      generation: {
        callsAttempted,
        callsConnected,
        callsNotConnected,
        incomingCalls,
        outgoingCalls,
        talkTimeSec,
        leadsConverted,
        leadsInProgress,
        leadsLost,
        leadsGenerated,
        followupLeads,
        connectedTarget,
        connectedPct,
        connectedStatus,
        leadsTarget,
        leadsPct,
        leadsStatus,
      },
      score,
      points: pointsByOwner.get(tc.id) ?? { closes: 0, snatches: 0, remarks: 0, total: 0 },
      risk: riskByOwner.get(tc.id) ?? { atRisk: 0, zombie: 0 },
    });
  }

  // Rank by event-ledger points first (conversion outcomes: slab close credits, −10
  // remarks, legacy −15 snatches) — the metric that reflects who actually
  // converted pipeline in the period. Tie-break by accepted closed ₹, then
  // projected value, then score.
  leaderboard.sort((a, b) => {
    const rankA = b.points.total - a.points.total;
    if (rankA !== 0) return rankA;
    const accA = (a.conversion as any).acceptedValue ?? 0;
    const accB = (b.conversion as any).acceptedValue ?? 0;
    if (accB - accA !== 0) return accB - accA;
    const estA = a.conversion.estimatedConversion.value;
    const estB = b.conversion.estimatedConversion.value;
    if (estB - estA !== 0) return estB - estA;
    return b.score - a.score;
  });

  // Self-contained agent list so the dashboard can build the per-agent dropdown
  // without a second round-trip.
  const agentList = telecallers.map((t) => ({ id: t.id, name: t.name, active: t.assignEstimateFollowUps }));

  // Agent dropdown: ?agent=<id|name> returns that agent's open follow-up
  // estimates (what they must call) plus their own metrics.
  // A non-admin sales agent may only ever see THEIR OWN agent view: any
  // explicit ?agent= is coerced to self (blocks reading other agents). The
  // team view (no ?agent=) keeps the full leaderboard but scopes the risk
  // payload to self (scopedRiskItems below).
  const selfAgentId = typeof q.selfAgentId === 'string' && q.selfAgentId ? q.selfAgentId : null;
  const requestedAgent = typeof q.agent === 'string' && q.agent ? q.agent : undefined;
  const agentFilter = requestedAgent ? (selfAgentId ?? requestedAgent) : undefined;
  if (agentFilter) {
    const tc = telecallers.find(
      (t) => t.id === agentFilter || t.name === agentFilter || (t.neodoveUserName ?? '') === agentFilter,
    );
    if (!tc) {
      return {
        meta: {
          analysis: 'telecalling',
          title: 'Telecalling — Daily Performance',
          day,
          agents: agentList,
          generatedAt: new Date().toISOString(),
          error: 'agent not found',
        },
      };
    }
    const followUpEsts = await prisma.estimate.findMany({
      where: { assignedTelecallerId: tc.id, status: 'sent' },
      // Highest-value estimates first — agents see the biggest deals at the
      // top of their conversion list.
      orderBy: [{ total: 'desc' }, { date: 'asc' }],
      // 15-min Zoho analyzer verdict — drives the Satisfactory/Unsatisfactory
      // chip. Note: D1PrismaClient resolves relations via `include`, not a
      // nested relation under `select`.
      include: { classification: true },
    });
    // Lead details from the enquiry tracker: the sales agent writes the
    // contact/location/source/enquiry-number block in the enquiry comments,
    // and we surface it here so the agent can follow up without switching
    // views. Matched to the Zoho estimate by normalized company name.
    const enquiryByCompany = new Map<string, any>();
    try {
      const enquiries = await prisma.enquiry.findMany({});
      const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const enq of enquiries as any[]) {
        const key = norm(enq.clientCompany);
        if (key && !enquiryByCompany.has(key)) enquiryByCompany.set(key, enq);
      }
    } catch (e: any) {
      logger.warn({ err: e?.message }, 'enquiry lead-details lookup failed — follow-ups show without lead details');
    }
    const followLastComments = new Map<string, string>();
    for (const r of riskItems) {
      if (r.lastCommentDate) followLastComments.set(r.estimateId, r.lastCommentDate);
    }
    // Most recent real sales note per follow-up estimate (text shown inline on
    // each conversion row). Timestamp-ordered (Zoho ids aren't chronological);
    // system auto-logs excluded. Fail-open: rows render without the note.
    const latestCommentByEst = new Map<string, { text: string; commentedBy: string; dateFormatted: string | null }>();
    try {
      const ids = followUpEsts.map((e) => e.estimateId);
      if (ids.length > 0) {
        const rows = await prisma.comment.findMany({
          where: { estimateId: { in: ids } },
          select: { estimateId: true, description: true, commentedBy: true, date: true, dateFormatted: true },
        });
        const best = new Map<string, { ts: number; v: { text: string; commentedBy: string; dateFormatted: string | null } }>();
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
        for (const [eid, v] of best) latestCommentByEst.set(eid, v.v);
      }
    } catch (e: any) {
      logger.warn({ err: e?.message }, 'follow-up latest-comment lookup failed — rows render without notes');
    }
    // Effort shield, agent-facing: red/zombie follow-ups the holder earned
    // (≥3 outgoing, ≥2h spread — connects irrelevant) carry their verdict so
    // the agent SEES the protection inline. Snapshots load once, only when at
    // least one follow-up is actually at risk; any failure → no shield fields
    // (fail-open, rows render exactly as before).
    const shieldByEstimate = new Map<string, { status: string; reason: string; n: number; spanH: number; streak: number }>();
    try {
      const atRisk = followUpEsts.filter((e) => {
        const rk = riskItems.find((r) => r.estimateId === e.estimateId)?.risk;
        return rk === 'red' || rk === 'zombie';
      });
      if (atRisk.length > 0) {
        const dayMinus = (n: number) => istDate(new Date(Date.now() - n * 86400000));
        const snaps: [EffortRow[] | null, EffortRow[] | null, EffortRow[] | null] = [
          await readEffortSnapshot(dayMinus(0)),
          await readEffortSnapshot(dayMinus(1)),
          await readEffortSnapshot(dayMinus(2)),
        ];
        const holderNeoId = String((tc as any)?.neodoveUserId ?? '');
        for (const e of atRisk) {
          try {
            const v = evaluateShield(normPhone10((e as any).contactPhone), holderNeoId, snaps);
            if (v.shielded || v.expired) {
              shieldByEstimate.set(e.estimateId, {
                status: v.status, reason: v.reason,
                n: v.evidence?.n ?? 0, spanH: v.evidence?.spanH ?? 0, streak: v.streak,
              });
            }
          } catch { /* per-row fail-open */ }
        }
      }
    } catch (e: any) {
      logger.warn({ err: e?.message, agent: (tc as any)?.id }, 'follow-up shield attach failed — rows render unshielded');
    }
    // Telecaller names for the call-tag "set by" attribution below.
    const nameByTelecallerId = new Map<string, string>(
      (telecallers as any[]).map((t) => [String(t.id), String(t.name ?? '')]),
    );
    const followUps = followUpEsts.map((e) => {
      const lastCommentDate = followLastComments.get(e.estimateId) ?? null;
      const ts = parseCommentDateMs(lastCommentDate);
      const staleHours = ts !== null ? (nowMs - ts) / 3600000 : null;
      const riskItem = riskItems.find((r) => r.estimateId === e.estimateId);
      const risk = riskItem?.risk ?? 'pending';
      const enquiry = enquiryByCompany.get(String(e.customerName || '').toLowerCase().replace(/[^a-z0-9]/g, '')) ?? null;
      const callTagBy = (e as any).callTagBy ?? null;
      return {
        estimateId: e.estimateId,
        estimateNumber: e.estimateNumber,
        customerName: e.customerName,
        status: e.status,
        total: e.total,
        day,
        assignmentStatus: 'assigned',
        satisfactory: e.classification ? !!e.classification.meaningfulUpdate : null,
        intentScore: e.classification?.intentScore ?? null,
        analysisSummary: e.classification?.summary ?? null,
        lastCommentDate,
        staleHours,
        // Most recent real sales note on THIS estimate (see lookup above).
        latestComment: latestCommentByEst.get(e.estimateId) ?? null,
        // Lead details: per-estimate capture ONLY (stored by the GH runner from this
        // estimate's own Zoho comments). NO company-name enquiry fallback — a
        // fuzzy company match can surface a DIFFERENT customer's POC/mobile/
        // enquiry number as wrong chips. Chips stay blank (UI shows the
        // "AI capturing" state) until the runner stores real per-estimate data.
        enquiryNumber: (e as any).enquiryNumber ?? null,
        sourceLead: (e as any).sourceLead ?? null,
        location: (e as any).location ?? null,
        contactName: (e as any).contactName ?? null,
        contactPhone: (e as any).contactPhone ?? null,
        contactEmail: (e as any).contactEmail ?? null,
        clientCompany: enquiry?.clientCompany ?? null,
        detailsCaptured: !!(e as any).detailsCaptured,
        // Terminal AI give-up: 10 capture turns with <3 fields (see the
        // lead-details route). UI shows "Details unavailable" instead of the
        // perpetual "AI capturing…" state.
        detailsFailed: !!(e as any).detailsFailed,
        // "Lead generated by" = the originating agent (creator) ONLY — never the
        // current holder. Hidden (null) until the creator is recorded.
        leadOf: (e as any).createdBy ? nameById.get(String((e as any).createdBy)) ?? null : null,
        risk,
        snatchReason: riskItem?.snatchReason ?? (risk === 'red' || risk === 'zombie' ? buildSnatchReason(e, risk) : null),
        snatchInHours: riskItem?.snatchInHours ?? hoursUntilEod(new Date(nowMs)),
        // Effort-shield verdict for at-risk rows (null otherwise) — the agent
        // sees 🛡 + reason inline in their conversion list.
        shield: shieldByEstimate.get(e.estimateId) ?? null,
        // Agent call-disposition tag (Lead Conversion view): NO_ANSWER /
        // BUSY / CALLBACK (+callbackDate, max +10d). Sticky, engine-untouched.
        callTag: (e as any).callTag ?? null,
        callbackDate: (e as any).callbackDate ?? null,
        callTagBy,
        callTagByName: callTagBy ? (nameByTelecallerId.get(String(callTagBy)) ?? null) : null,
        callTagAt: (e as any).callTagAt ?? null,
      };
    });
    const lb = leaderboard.find((l) => l.id === tc.id);
    return {
      meta: {
        analysis: 'telecalling-agent',
        title: `Telecalling — ${tc.name}`,
        day,
        requestedDay,
        usingLatestAvailable,
        agents: agentList,
        generatedAt: new Date().toISOString(),
      },
      agent: {
        id: tc.id,
        name: tc.name,
        active: tc.assignEstimateFollowUps,
        conversion: lb?.conversion ?? null,
        generation: lb?.generation ?? null,
        score: lb?.score ?? 0,
        followUpCount: followUps.length,
      },
      followUps,
    };
  }

  const unassignedSent = await prisma.estimate.count({
    where: { status: 'sent', assignedTelecallerId: null },
  });

  const recentRows = await prisma.estimate.findMany({
    where: { assignedTelecallerId: { not: null } },
    orderBy: { lastSyncTime: 'desc' },
    take: 25,
    select: {
      estimateNumber: true,
      customerName: true,
      status: true,
      assignedTelecallerId: true,
    },
  });
  const recent = recentRows.map((e) => ({
    estimateNumber: e.estimateNumber,
    customerName: e.customerName,
    status: e.status,
    telecallerName: nameById.get(String(e.assignedTelecallerId)) ?? null,
  }));

  const activeCount = telecallers.filter((t) => t.assignEstimateFollowUps).length;

  // Non-admin sales agents are scoped to their OWN data: the leaderboard stays
  // team-wide, but the risk/at-risk list + recent activity are filtered to the
  // agent signed in (selfAgentId injected by the worker route). Root/admin/MIS
  // get the full team view.
  const scopedRiskItems = selfAgentId ? riskItems.filter((r) => r.telecallerId === selfAgentId) : riskItems;

  // Team-wide effort-shield strip for the Lead Conversion tab: red/zombie
  // holdings whose holder earned protection (or exhausted it today). Same
  // self-scope as risk. Snapshots load once and only when reds exist; any
  // failure → null (fail-open, tab renders without the strip).
  let shielded: Array<{
    estimateId: string; estimateNumber: string; customerName: string;
    holderName: string | null; status: string; reason: string;
    n: number; spanH: number; streak: number;
  }> | null = null;
  try {
    const reds = scopedRiskItems.filter((r) => r.risk === 'red' || r.risk === 'zombie');
    if (reds.length === 0) {
      shielded = [];
    } else {
      const ids = [...new Set(reds.map((r) => r.estimateId))];
      const phoneById = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 500) {
        const chunkRows: any[] = await prisma.estimate.findMany({
          where: { estimateId: { in: ids.slice(i, i + 500) } },
          select: { estimateId: true, contactPhone: true },
        });
        for (const e of chunkRows) phoneById.set(e.estimateId, String(e.contactPhone ?? ''));
      }
      const dayMinus = (n: number) => istDate(new Date(Date.now() - n * 86400000));
      const snaps: [EffortRow[] | null, EffortRow[] | null, EffortRow[] | null] = [
        await readEffortSnapshot(dayMinus(0)),
        await readEffortSnapshot(dayMinus(1)),
        await readEffortSnapshot(dayMinus(2)),
      ];
      const neoById = new Map<string, string>();
      for (const t of telecallers as any[]) neoById.set(String(t.id), String(t.neodoveUserId ?? ''));
      shielded = [];
      for (const r of reds) {
        try {
          const v = evaluateShield(normPhone10(phoneById.get(r.estimateId) ?? ''), neoById.get(String(r.telecallerId)) ?? '', snaps);
          if (v.shielded || v.expired) {
            shielded.push({
              estimateId: r.estimateId, estimateNumber: r.estimateNumber, customerName: r.customerName,
              holderName: r.telecallerName, status: v.status, reason: v.reason,
              n: v.evidence?.n ?? 0, spanH: v.evidence?.spanH ?? 0, streak: v.streak,
            });
          }
        } catch { /* per-row fail-open */ }
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'team shield strip failed — payload renders without it');
    shielded = null;
  }

  return {
    meta: {
      analysis: 'telecalling',
      title: 'Telecalling — Daily Performance',
      day,
      requestedDay,
      usingLatestAvailable,
      period: periodMode && periodRangeInfo ? q.period : 'today',
      periodLabel: periodRangeInfo?.label ?? 'Today',
      periodFrom: periodRangeInfo?.from ?? null,
      periodTo: periodRangeInfo?.to ?? null,
      generatedAt: new Date().toISOString(),
      unassignedSent,
      telecallerCount: telecallers.length,
      activeCount,
      agents: agentList,
      targets: {
        connectedCallsPerDay: CONNECTED_CALLS_PER_DAY * workingDays,
        leadsPerAgentPerDay: LEADS_PER_AGENT_PER_DAY * workingDays,
      },
      // Accepted-₹ goal for the "Est. Conv ₹" KPI, scaled by working days so
      // every period filter has a fair proportional target:
      // today = ₹5L / gold ₹10L; week (Mon–Sat) up to 6×; month ~26×, etc.
      conversionTarget: {
        perDay: CONVERSION_TARGET_DAILY,
        goldPerDay: CONVERSION_GOLD_DAILY,
        workingDays,
        target: CONVERSION_TARGET_DAILY * workingDays,
        gold: CONVERSION_GOLD_DAILY * workingDays,
        value: kpiAcc.acceptedValue,
        pct: (() => {
          const t = CONVERSION_TARGET_DAILY * workingDays;
          return t > 0 ? Math.round((kpiAcc.acceptedValue / t) * 100) : 0;
        })(),
        status: kpiAcc.acceptedValue >= CONVERSION_GOLD_DAILY * workingDays
          ? 'gold'
          : kpiAcc.acceptedValue >= CONVERSION_TARGET_DAILY * workingDays
            ? 'hit'
            : 'below',
      },
      workingDays,
      selfAgentId,
    },
    kpi: {
      ...kpiAcc,
      conversionRate: kpiAcc.assigned > 0 ? Math.round((kpiAcc.won / kpiAcc.assigned) * 100) : 0,
    },
    // Founder pre-warning: open estimates that will cost −10 at the EOD remark
    // run, sorted by value. Red = latest AI verdict found no meaningful update;
    // zombie = silent for more than ZOMBIE_DAYS. Scoped to the signed-in agent
    // when selfAgentId is present.
    risk: {
      counts: {
        open: scopedRiskItems.length,
        ok: scopedRiskItems.filter((r) => r.risk === 'ok').length,
        pending: scopedRiskItems.filter((r) => r.risk === 'pending').length,
        red: scopedRiskItems.filter((r) => r.risk === 'red').length,
        zombie: scopedRiskItems.filter((r) => r.risk === 'zombie').length,
      },
      valueAtRisk: scopedRiskItems
        .filter((r) => r.risk === 'red' || r.risk === 'zombie')
        .reduce((s, r) => s + r.total, 0),
      atRisk: scopedRiskItems
        .filter((r) => r.risk === 'red' || r.risk === 'zombie')
        .sort((a, b) => b.total - a.total)
        .slice(0, RISK_LIST_CAP),
    },
    // Team-wide effort shields (earned red/zombie holdings). Null when the
    // snapshots were unreadable — the tab hides the strip instead of erroring.
    shielded,
    leaderboard,
    recent,
    // MIS daily breakdown (only when ?daily=1 in period mode): per-day ×
    // per-agent closes w/ estimate tags, declines, calls, leads. Absent
    // otherwise so dashboard loads stay light.
    ...(await buildDailySection(q, periodMode, periodRangeInfo)),
  };
}

/** Daily MIS section for period payloads. Empty (no keys) unless requested. */
async function buildDailySection(
  q: Record<string, unknown>,
  periodMode: boolean,
  periodRangeInfo: { from: string; to: string; label: string } | null,
): Promise<{ daily?: TelecallingDailyRow[]; dailyError?: string | null }> {
  const wantDaily = String(q.daily ?? '') === '1' || String(q.daily ?? '').toLowerCase() === 'true';
  if (!wantDaily || !periodMode || !periodRangeInfo) return {};
  const res = await computeTelecallingDaily(periodRangeInfo.from, periodRangeInfo.to);
  if ('error' in res) return { dailyError: res.error };
  return { daily: res.rows, dailyError: null };
}
