// scoring.ts — event-ledger scoring (leaderboard source of truth).
//
// Verbatim extract from service.ts (Phase-3 split): slab close credits,
// penalties, MIS toggles, and the ledger writers. Consumers: runLeadConversion
// (closes), runEodRemarkDeduction (remark penalties), dashboard (reads).
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { DATE_RE, IN_BATCH, istDate } from './util';

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
export const SNATCH_PENALTY = -15;
/** EOD remark penalty: one −10 per red-risk estimate held, charged daily. */
export const REMARK_PENALTY = -10;
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
    // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      const rows = await prisma.telecaller.findMany({
        where: { id: { in: ids.slice(i, i + IN_BATCH) } },
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
export async function recordSnatchPenalty(telecallerId: string, estimateId: string, day: string, reason: string | null): Promise<void> {
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
export async function recordRemarkPenalty(telecallerId: string, estimateId: string, day: string, reason: string | null): Promise<boolean> {
  try {
    const existing = await prisma.telecallerScoreEvent.findFirst({
      where: { telecallerId, estimateId, delta: REMARK_PENALTY, day },
    });
    if (existing) return false;
  } catch { /* lookup failed — fall through and record once rather than skip */ }
  await recordScoreEvent(telecallerId, estimateId, REMARK_PENALTY, day, reason ?? 'EOD remark penalty — unsatisfactory remark');
  return true;
}
