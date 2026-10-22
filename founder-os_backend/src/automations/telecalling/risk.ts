// risk.ts — estimate risk model + KV cache (live pre-warning).
//
// Region model (Phase-R split): the open `sent` pipeline still carries the
// ok/pending/red/zombie risk states over the next-step discipline, but it is
// informational only — the EOD remark deduction that consumed these states is
// retired. Risk items now attribute the estimate to its REGION and the staff
// who GENERATED the enquiry (Estimate.createdBy), never to an individual
// holder. Uses a 15-min KV cache. No engine writes here.
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { cached, cacheDel, cacheDelPrefix } from '../../shared/cache';
import { DATE_RE, IN_BATCH, istDate } from './util';

// ── Estimate risk model (live pre-warning, informational) ────────────────────
// Real-time risk states over the open `sent` pipeline so trouble is visible:
//   zombie  — no comment in > 3 days (the AI already treats stale comments as
//             not meaningful, so these estimates are dead weight)
//   red     — latest AI verdict has meaningfulUpdate=false, OR the latest
//             comment is older than 24h even though it was satisfactory (a
//             stale-but-positive comment still means nobody chased it today)
//   pending — no AI verdict yet
//   ok      — latest comment was meaningful AND fresh (< 24h)
export const ZOMBIE_DAYS = 3;
/** A meaningful comment older than this (hours) counts red. */
export const FRESH_HOURS = 24;

export type EstimateRisk = 'ok' | 'pending' | 'red' | 'zombie';

export interface RiskItem {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  generatorId: string | null;
  generatorName: string | null;
  /** Sales region (R1–R4; '' unmapped). */
  region: string;
  total: number;
  risk: EstimateRisk;
  lastCommentDate: string | null;
  staleHours: number | null;
  reasoning: string | null;
  /** Why the risk state fired (mirrors the AI verdict for the agent). */
  staleReason: string | null;
  /** Dated customer commitment set by the staff/MIS (null when none). */
  nextStep: string | null;
  nextStepDate: string | null;
}

export function parseCommentDateMs(raw: string | null | undefined): number | null {
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
export async function latestCommentDates(estimateIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (estimateIds.length === 0) return out;
  try {
    // Chunked at IN_BATCH — D1 caps bound variables at 100/statement (see above).
    for (let i = 0; i < estimateIds.length; i += IN_BATCH) {
      const comments = await prisma.comment.findMany({
        where: { estimateId: { in: estimateIds.slice(i, i + IN_BATCH) } },
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
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'latestCommentDates failed — risk model degrades to classification only');
  }
  return out;
}

export function classifyRisk(
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
  // it today — it counts red even though the AI verdict was positive.
  if (!cls.meaningfulUpdate || (staleHours !== null && staleHours > FRESH_HOURS)) {
    return { risk: 'red', staleHours };
  }
  return { risk: 'ok', staleHours };
}

/**
 * Why the risk state fired. Mirrors the AI verdict so the agent sees exactly
 * what the state means. (Named for the old EOD remark flow it replaced —
 * wording now reads as an attention flag, not a penalty.)
 */
export function buildSnatchReason(
  est: { estimateId: string; classification?: { meaningfulUpdate?: boolean; reasoning?: string | null } | null },
  risk: EstimateRisk,
): string {
  if (risk === 'zombie') return 'No reply in over 3 days — dead weight on the board';
  // Satisfactory-but-stale: the AI verdict was positive but the last comment is
  // older than FRESH_HOURS — nobody has chased it today.
  if (risk === 'red' && est.classification?.meaningfulUpdate) {
    return 'Last update was satisfactory but stale (older than 24h) — needs a chase';
  }
  const reasoning = est.classification?.reasoning;
  if (reasoning && reasoning.trim() && reasoning.trim() !== 'No sales agent comment found.') {
    const verdict = est.classification?.meaningfulUpdate ? 'meaningful update' : 'unsatisfactory remark';
    const clipped = reasoning.trim().slice(0, 140);
    return `Attention (${verdict}): ${clipped}`;
  }
  return 'Unsatisfactory remark — needs a chase';
}

// ── Risk cache (KV-backed, D1 row-read budget protection) ───────────────────
// The risk model scans all open estimates + their latest comment dates, which
// is expensive. Dashboards refetch on every runner WebSocket broadcast (every
// 15 min, the Zoho analyzer cadence), so the scan is cached in KV with a short
// TTL. Stale-upon-error: if the cached copy is older than TTL it is still
// served when a refresh fails (graceful degradation, no retry loops).
export const RISK_CACHE_KEY = 'telecalling:risk_cache_v2';
const RISK_CACHE_TTL_MS = 15 * 60 * 1000;

export interface CachedRiskItem extends Omit<RiskItem, 'generatorName'> {
  generatorName: string | null;
}

export interface RiskCache {
  items: CachedRiskItem[];
  computedAt: string;
}

export async function computeRiskCache(): Promise<RiskCache> {
  const nowMs = Date.now();
  const telecallers = await prisma.telecaller.findMany({ orderBy: { order: 'asc' } });
  const nameById = new Map(telecallers.map((t) => [t.id, t.name]));

  const sentOpen = await prisma.estimate.findMany({
    where: { status: 'sent' },
    include: { classification: true },
  });
  const lastComments = await latestCommentDates(sentOpen.map((e) => e.estimateId));

  const todayIST = istDate(new Date(nowMs));

  const items: CachedRiskItem[] = sentOpen.map((e) => {
    const cls = (e as any).classification ?? null;
    const lastCommentDate = lastComments.get(e.estimateId) ?? null;
    const nextStep = (e as any).nextStep != null ? String((e as any).nextStep) : null;
    const nsRaw = (e as any).nextStepDate != null ? String((e as any).nextStepDate) : null;
    const nextStepDate = nsRaw && DATE_RE.test(nsRaw) ? nsRaw : null;
    // Next-step discipline beats AI mood-reading: a dated customer commitment
    // protects the estimate through its date; a missed date reads red until
    // chased. No next step → the existing verdict + freshness rules apply.
    let risk: EstimateRisk;
    let staleHours: number | null;
    let staleReason: string | null;
    if (nextStepDate) {
      const ts = parseCommentDateMs(lastCommentDate);
      staleHours = ts !== null ? (nowMs - ts) / 3600000 : null;
      if (nextStepDate >= todayIST) {
        risk = 'ok';
        staleReason = `Next step due ${nextStepDate}${nextStep ? `: ${nextStep.slice(0, 120)}` : ''} — commitment on record`;
      } else {
        risk = 'red';
        staleReason = `Next step${nextStep ? ` "${nextStep.slice(0, 120)}"` : ''} was due ${nextStepDate} — commitment missed`;
      }
    } else {
      const c = classifyRisk(cls, lastCommentDate, nowMs);
      risk = c.risk;
      staleHours = c.staleHours;
      staleReason = buildSnatchReason(e, risk);
    }
    const generatorId = (e as any).createdBy ? String((e as any).createdBy) : null;
    return {
      estimateId: e.estimateId,
      estimateNumber: e.estimateNumber,
      customerName: e.customerName,
      generatorId,
      generatorName: generatorId ? nameById.get(generatorId) ?? null : null,
      region: String((e as any).region ?? ''),
      total: Number(e.total ?? 0) || 0,
      // Zoho org (multi-org sync) — drives the dashboard org badge/filter.
      organizationId: (e as any).organizationId ?? null,
      risk,
      lastCommentDate,
      staleHours,
      reasoning: cls?.reasoning ?? null,
      staleReason,
      nextStep,
      nextStepDate,
    };
  });
  return { items, computedAt: new Date(nowMs).toISOString() };
}

/**
 * Risk items for the open pipeline, served from a 15-min KV cache.
 * On refresh failure, serves the stale snapshot (graceful degradation) rather
 * than burning more D1 row reads with retry loops.
 */
export async function getRiskItems(): Promise<CachedRiskItem[]> {
  return cached<CachedRiskItem[]>(RISK_CACHE_KEY, RISK_CACHE_TTL_MS, async () => {
    const computed = await computeRiskCache();
    return computed.items;
  });
}

/**
 * Invalidate the risk cache when underlying estimate/comment data changes
 * (status transition, classification, comment sync, or a region re-aim).
 * Also invalidates every cached dashboard payload so the sales-leaderboard
 * views re-aggregate from fresh state on the next read.
 */
export async function invalidateRiskCache(): Promise<void> {
  await cacheDel(RISK_CACHE_KEY);
  try { await cacheDelPrefix('telecalling:dashboard'); } catch { /* non-fatal */ }
  // The per-estimate export reads ?converters= from its own cache key —
  // stale Converted-By survives every close without this.
  try { await cacheDelPrefix('telecalling:converters'); } catch { /* non-fatal */ }
}
