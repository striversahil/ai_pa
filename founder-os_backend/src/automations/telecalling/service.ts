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
import {
  ZOMBIE_DAYS, FRESH_HOURS, hoursUntilEod, parseCommentDateMs, latestCommentDates,
  classifyRisk, buildSnatchReason, RISK_CACHE_KEY, computeRiskCache, getRiskItems,
  invalidateRiskCache,
  type EstimateRisk, type RiskItem, type CachedRiskItem, type RiskCache,
} from './risk';
import {
  CLOSE_SLABS, closePointsFor, isCloseDelta, splitClosePoints,
  isPenaltiesEnabled, setPenaltiesEnabled, isEodReassignEnabled, setEodReassignEnabled,
  recordConversionClose, catchUpConversionCloses, getConvertersMap,
  recordSnatchPenalty, recordRemarkPenalty,
  SNATCH_PENALTY, REMARK_PENALTY,
} from './scoring';
import {
  getFollowUpSpecialists, rotateEstimatesRoundRobin, bulkAssignEstimates, recordAssignment,
} from './rotation';
import { syncTelecallersFromNeodove, markTelecallerAbsent, markTelecallerPresent } from './roster';
import {
  CALL_TAGS, CALLBACK_MAX_DAYS, setEstimateCallTag,
  NEXT_STEP_MAX_DAYS, setEstimateNextStep, overlayNextSteps, overlayCallTags,
  type CallTag,
} from './call-tags';
import { linkEnquiryEstimate, sweepEnquiryEstimateLinks, type EnquiryLinkResult } from './enquiry-links';

// ── D1 bound-variable cap ────────────────────────────────────────────────────
// D1 allows max 100 bound SQL variables per statement (the shim already batches
// relation IN-clauses at 90 — see d1-prisma.ts attachIncludes), but raw
// `where: { id: { in: [...] } }` filters are inlined as bound params. ANY such
// list longer than ~90 throws "too many SQL variables" — and several readers
// below swallow the throw (graceful degradation), so an unchunked query fails
// SILENTLY (e.g. the risk model degrading to classification-only with ∅ stale
// chips on every row once the open pipeline crossed 100 estimates). Every bulk
// read in this file chunks its id list at IN_BATCH (imported from ./util
// to keep one definition — see the split note below).

import { DATE_RE, IN_BATCH, istDate } from './util';

// ── Split modules (Phase-3) ──────────────────────────────────────────────────
// Risk model + cache → risk.ts · scoring ledger + toggles → scoring.ts ·
// round-robin + bulk + history chain → rotation.ts · roster + absentee cover →
// roster.ts · call tags + next steps → call-tags.ts · enquiry attribution →
// enquiry-links.ts · shared date/chunk primitives → util.ts. service.ts keeps
// the runs, the assignment engine, and the dashboard; moved names are
// re-exported at the bottom so existing importers keep working.
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

// ── Risk cache lives in risk.ts ──────────────────────────────────────────────
// (computeRiskCache, getRiskItems, invalidateRiskCache, RISK_CACHE_KEY —
// re-exported from the facade block at the bottom).

// ── Agent call-disposition tags live in call-tags.ts ─────────────────────────
// (CALL_TAGS, setEstimateCallTag, setEstimateNextStep, overlayNextSteps,
// overlayCallTags — re-exported from the facade block at the bottom).

// Roster sync + absentee cover live in roster.ts ───────────────────────────────
// (syncTelecallersFromNeodove, markTelecallerAbsent, markTelecallerPresent —
// re-exported below).

// ── Round-robin rotation lives in rotation.ts ────────────────────────────────
// (getFollowUpSpecialists, rotation pointer, rotateEstimatesRoundRobin,
// bulkAssignEstimates, recordAssignment — re-exported below).

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

  // Enquiry → creator map (PRIMARY source for Lead of): Enquiry.estNumber =
  // Estimate.estimateNumber. Fail-open — falls back to createdBy / comment
  // inference below when no enquiry maps.
  let enquiryCreatorByEst = new Map<string, string>();
  try {
    const { enquiryAgentByEstNumber } = await import('../../modules/enquiries/estimate-link');
    enquiryCreatorByEst = await enquiryAgentByEstNumber(sent.map((e) => String((e as any).estimateNumber ?? '')));
  } catch { /* fallback below */ }
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
      // The ONLY source is the mapping B2B enquiry (Enquiry.estNumber); there
      // is no comment-inference fallback — unmapped rows go best-fit.
      // Older unassigned estimates keep best-fit conversion routing.
      if (!wasAssigned) {
        // Org-scoped creator first (cross-org number clashes resolve to the
        // same-org enquiry), legacy bare-number key as fallback.
        const estNum = String((est as any).estimateNumber ?? '').trim();
        const estOrg = String((est as any).organizationId ?? '').trim();
        const enquiryCreator = (estOrg && enquiryCreatorByEst.get(`${estOrg}||${estNum}`))
          || enquiryCreatorByEst.get(estNum) || '';
        const knownCreator = enquiryCreator || String((est as any).createdBy ?? '');
        // Self-heal: enquiry mapping always wins for createdBy.
        if (enquiryCreator && String((est as any).createdBy ?? '') !== enquiryCreator) {
          try {
            await prisma.estimate.update({
              where: { estimateId: est.estimateId },
              data: { createdBy: enquiryCreator },
            });
            (est as any).createdBy = enquiryCreator;
          } catch { /* best-effort */ }
        }
        const creatorPresent = !!knownCreator
          && (allTelecallers as any[]).some((t) => String(t.id) === knownCreator);
        const generatedToday = String((est as any).date ?? '').slice(0, 10) === today;
        if (creatorPresent && generatedToday) {
          bestId = knownCreator;
          logger.info(
            { estimateId: est.estimateId, creator: knownCreator },
            'creator-first: today\'s lead dealt to its generator',
          );
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

// Bulk assignment core lives in rotation.ts (bulkAssignEstimates).

// ── Absentee cover (MIS) lives in roster.ts ──────────────────────────────────
// (markTelecallerAbsent, markTelecallerPresent — re-exported below).

// ── Enquiry-sourced lead generation ──────────────────────────────────────────
// "Leads generated" = enquiries created per agent per IST day (Sales Enquiries
// dashboard: Enquiry.createdAt × assignedAgentId). This REPLACES the NeoDove
// get-leads count on the telecalling boards. NeoDove still feeds calls,
// talk-time, call outcomes, the effort-shield snapshots and the EOD
// non-working-day gate — only the leads-generated numerator moved.

/** Day → agent lead counts for an inclusive IST range. Key `${day}|${agentId}`.
 *  Unattributed rows (assignedAgentId empty — no roster match) are counted
 *  under the UNATTRIBUTED_LEADS_KEY sentinel so they surface in meta instead
 *  of vanishing silently. Callers must skip the sentinel when attributing. */
export const UNATTRIBUTED_LEADS_KEY = '|unattributed';
async function getEnquiryLeadCounts(from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    // Unfiltered read + JS-side IST-day gate (portable across D1/Postgres
    // date storage; the Enquiry table is small).
    const rows = await prisma.enquiry.findMany({
      select: { assignedAgentId: true, createdAt: true },
    });
    for (const r of (rows as any[]) ?? []) {
      const d = istDayOf(r?.createdAt);
      if (!d || d < from || d > to) continue;
      const agent = String(r?.assignedAgentId ?? '').trim();
      const k = agent ? `${d}|${agent}` : UNATTRIBUTED_LEADS_KEY;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'enquiry lead counts read failed — leads show 0');
  }
  return out;
}

/** Daily engine: refresh the roster, resolve pending enquiry→estimate links, then deal the sent pool. */
export async function runLeadConversion(): Promise<{ assigned: number }> {
  await syncTelecallersFromNeodove();
  try { await sweepEnquiryEstimateLinks(); } catch { /* non-fatal — engine still deals */ }
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
    // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      const chunk = ids.slice(i, i + IN_BATCH);
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
  // Enquiry-sourced leads (replaces NeoDove get-leads): one count map for the
  // whole range, looked up per (day, agent) cell below.
  const enquiryLeadsDaily = await getEnquiryLeadCounts(from, to).catch(() => new Map<string, number>());
  for (const d of dates) {
    const neoMap = neoByDay.get(d) ?? {};
    for (const tc of telecallers as any[]) {
      const id = String(tc.id);
      const c = agg.get(`${d}|${id}`);
      const nd = (tc.neodoveUserName && neoMap[tc.neodoveUserName])
        || (tc.neodoveUserId && neoMap[tc.neodoveUserId])
        || undefined;
      const callsConnected = nd?.callsConnected ?? 0;
      // Enquiry-sourced (Sales Enquiries dashboard) — not NeoDove get-leads.
      const leadsGenerated = enquiryLeadsDaily.get(`${d}|${id}`) ?? 0;
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
      // Chunked at IN_BATCH — D1 caps bound variables at 100/statement
      // (NOT 999 — that is the SQLite default; D1 enforces 100).
      for (let i = 0; i < estIds.length; i += IN_BATCH) {
        const chunk = estIds.slice(i, i + IN_BATCH);
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
    // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
    for (let i = 0; i < allCloseIds.length; i += IN_BATCH) {
      const chunk = allCloseIds.slice(i, i + IN_BATCH);
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
  // Enquiry-sourced leads (Sales Enquiries dashboard — replaces NeoDove
  // get-leads): per-agent enquiry-creation totals over the leaderboard window.
  // The UNATTRIBUTED_LEADS_KEY sentinel is peeled off into unattributedLeads
  // (meta) — never attributed to an agent id of ''.
  const leadFrom = periodMode && periodRangeInfo ? periodRangeInfo.from : day;
  const leadTo = periodMode && periodRangeInfo ? periodRangeInfo.to : day;
  const leadsByAgent = new Map<string, number>();
  let unattributedLeads = 0;
  try {
    const enquiryLeads = await getEnquiryLeadCounts(leadFrom, leadTo);
    for (const [k, n] of enquiryLeads) {
      if (k === UNATTRIBUTED_LEADS_KEY) { unattributedLeads += n; continue; }
      const agent = k.slice(k.indexOf('|') + 1);
      leadsByAgent.set(agent, (leadsByAgent.get(agent) ?? 0) + n);
    }
  } catch { /* getEnquiryLeadCounts already warns — leads default 0 */ }
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
    // Leads generated = enquiries this agent created in the window (Sales
    // Enquiries dashboard). NeoDove-sourced call outcomes below are untouched.
    const leadsGenerated = leadsByAgent.get(tc.id) ?? 0;

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
        // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
        const rows: any[] = [];
        for (let i = 0; i < ids.length; i += IN_BATCH) {
          rows.push(...await prisma.comment.findMany({
            where: { estimateId: { in: ids.slice(i, i + IN_BATCH) } },
            select: { estimateId: true, description: true, commentedBy: true, date: true, dateFormatted: true },
          }));
        }
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
        // Zoho org (multi-org sync) — drives the dashboard org badge/filter.
        organizationId: (e as any).organizationId ?? null,
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
      // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
      for (let i = 0; i < ids.length; i += IN_BATCH) {
        const chunkRows: any[] = await prisma.estimate.findMany({
          where: { estimateId: { in: ids.slice(i, i + IN_BATCH) } },
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
      // Enquiries in the window with no roster match (assignedAgentId empty).
      // Surfaced so MIS can fix attribution instead of silently undercounting.
      unattributedLeads,
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

// ── Facade re-exports (Phase-3 split) ─────────────────────────────────────────
// service.ts keeps the runs, the assignment engine, and the dashboard. Every
// name moved to a sibling module is re-exported here so existing importers
// (`worker/routes/*`, triggers, runners, estimate-link) keep working with zero
// call-site changes.
export {
  ZOMBIE_DAYS, FRESH_HOURS, hoursUntilEod, parseCommentDateMs, latestCommentDates,
  classifyRisk, buildSnatchReason, RISK_CACHE_KEY, computeRiskCache, getRiskItems,
  invalidateRiskCache,
} from './risk';
export type { EstimateRisk, RiskItem, CachedRiskItem, RiskCache } from './risk';
export {
  CLOSE_SLABS, closePointsFor, isCloseDelta, splitClosePoints,
  isPenaltiesEnabled, setPenaltiesEnabled, isEodReassignEnabled, setEodReassignEnabled,
  recordConversionClose, catchUpConversionCloses, getConvertersMap,
  recordSnatchPenalty, recordRemarkPenalty,
} from './scoring';
export {
  getFollowUpSpecialists, rotateEstimatesRoundRobin, bulkAssignEstimates, recordAssignment,
} from './rotation';
export { syncTelecallersFromNeodove, markTelecallerAbsent, markTelecallerPresent } from './roster';
export {
  CALL_TAGS, CALLBACK_MAX_DAYS, setEstimateCallTag,
  NEXT_STEP_MAX_DAYS, setEstimateNextStep, overlayNextSteps, overlayCallTags,
} from './call-tags';
export type { CallTag } from './call-tags';
export { linkEnquiryEstimate, sweepEnquiryEstimateLinks, type EnquiryLinkResult } from './enquiry-links';
export { DATE_RE, IN_BATCH, istDate } from './util';
