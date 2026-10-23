// scoring.ts — event-ledger scoring (sales leaderboard source of truth).
//
// Region model (Phase-R split — replaces the individual-dealing model):
// a close credits the ENQUIRY GENERATOR (Estimate.createdBy) 20% of the slab
// automatically via recordConversionClose; the other 80% is credited to a
// CLOSER picked by sales-head via creditCloserShare (kind='closer' row).
// remarked/snatch penalties were part of the old held-estimate machinery and
// are retired — no new negative rows are written; historic ones still read.
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { DATE_RE, IN_BATCH, istDate } from './util';

// ── Event-ledger scoring ─────────────────────────────────────────────────────
// The leaderboard is driven by an append-only score ledger. Each row records
// the IST day, so any timeframe (week/month/year) can be summed with a simple
// day-range filter — the weekly view restarts at zero automatically.
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
/** Exact 20/80 split credited per close (generator 20% — creating the lead;
 *  closer 80% — carrying the follow-up to the win): 50→10/40 · 75→15/60 ·
 *  100→20/80 · 200→40/160. */
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
// Legacy ledger deltas from the held-estimate era (kept readable for history;
// the engines that wrote them are retired).
export const SNATCH_PENALTY = -15;
export const REMARK_PENALTY = -10;

// ── History epoch (founder-approved live reset) ─────────────────────────────
// reset-history purges every close-credit ledger row AND stamps Setting
// `salesboard:epoch` = purge day. All ledger reads gate day >= epoch, so the
// board starts from zero on that day while non-close rows (old penalties) and
// non-ledger data stay untouched.
export const EPOCH_SETTING_KEY = 'salesboard:epoch';

export async function getEpochDate(): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: EPOCH_SETTING_KEY } });
    const v = String(row?.value ?? '').trim();
    return DATE_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

async function setEpochDate(day: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: EPOCH_SETTING_KEY },
    update: { value: day },
    create: { key: EPOCH_SETTING_KEY, value: day },
  });
}

/**
 * Append a score event to the ledger. day is the IST date the event happened.
 * Idempotent callers guard duplicates at the call site.
 */
async function recordScoreEvent(telecallerId: string, estimateId: string, kind: string, delta: number, day: string, reason: string | null = null): Promise<void> {
  try {
    await prisma.telecallerScoreEvent.create({
      data: { telecallerId, estimateId, kind, delta, day, reason, createdAt: new Date() },
    });
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordScoreEvent failed — continuing without event');
  }
}

/**
 * Credit the generator's 20% share of the close slab, written automatically
 * the moment an estimate converts. The closer's 80% is NOT written here — it
 * stays pending until sales-head picks a closer (creditCloserShare), so
 * unpicked closes can be surfaced for the pick.
 * Duplicate-guarded: a kind='generator' row per estimate gates re-entry.
 */
export async function recordConversionClose(estimateId: string, opts?: { day?: string }): Promise<boolean> {
  try {
    const est = await prisma.estimate.findUnique({
      where: { estimateId },
      select: { status: true, total: true, createdBy: true },
    });
    if (!est || !(est.status === 'accepted' || est.status === 'confirmed')) return false;
    const generator = (est as any).createdBy || null;
    if (!generator) return false;
    const existing = await prisma.telecallerScoreEvent.findMany({
      where: { estimateId },
      select: { kind: true, delta: true },
    });
    // A legacy full-slab/half close row also means the deal is already
    // credited. Without this, a status replay after the October
    // reclassification would add a second 20% generator row on top of the
    // reclassified legacy credit.
    const alreadyCredited = (existing as any[]).some((e) => {
      const kind = String(e.kind ?? '');
      const delta = Number(e.delta) || 0;
      return kind === 'generator' || (kind === '' && delta > 0 && isCloseDelta(delta));
    });
    if (alreadyCredited) return false;
    const day = opts?.day && DATE_RE.test(opts.day) ? opts.day : istDate();
    const total = Math.round(Number((est as any).total ?? 0) || 0);
    const { generator: gPts, closer: cPts } = splitClosePoints((est as any).total);
    await recordScoreEvent(String(generator), estimateId, 'generator', gPts, day, `Estimate converted ₹${total.toLocaleString('en-IN')} — ${gPts} points lead-generator share (closer share ${cPts} pending pick)`);
    return true;
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordConversionClose failed');
    return false;
  }
}

/**
 * Credit the closer's 80% share, written by sales-head's pick. Same region as
 * the estimate is enforced at the route (closer roster region must match the
 * estimate's region). Re-picking rewrites: the previous closer row for the
 * estimate is replaced. Points attach to the GENERATOR row's day (the close
 * day), not the pick day.
 */
export async function creditCloserShare(estimateId: string, closerTelecallerId: string, pickedBy: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const est = await prisma.estimate.findUnique({
      where: { estimateId },
      select: { status: true, total: true, region: true },
    });
    if (!est) return { ok: false, error: 'Estimate not found' };
    if (!(est.status === 'accepted' || est.status === 'confirmed')) return { ok: false, error: 'Estimate is not converted (accepted/confirmed)' };
    const genRow = await prisma.telecallerScoreEvent.findFirst({
      where: { estimateId, kind: 'generator' },
    });
    if (!genRow) return { ok: false, error: 'No generator credit on this estimate — cannot pick a closer' };
    const closer = await prisma.telecaller.findUnique({ where: { id: closerTelecallerId } });
    if (!closer) return { ok: false, error: 'Closer not found in the roster' };
    if (String((closer as any).type ?? 'telecaller') === 'field_staff') return { ok: false, error: 'Field staff cannot be a closer — pick a telecaller from the same region' };
    if (!(closer as any).assignEstimateFollowUps) return { ok: false, error: 'Closer is not marked as a conversion specialist' };
    const estRegion = String((est as any).region ?? '');
    const closerRegion = String((closer as any).region ?? '');
    if (estRegion && closerRegion && estRegion !== closerRegion) {
      return { ok: false, error: 'Closer must belong to the same region as the estimate' };
    }
    if (estRegion && !closerRegion) {
      return { ok: false, error: 'Closer has no region on the roster — set their region first' };
    }
    // Re-pick support: drop any existing closer row for this estimate first.
    const prev = await prisma.telecallerScoreEvent.findMany({
      where: { estimateId, kind: 'closer' },
      select: { id: true },
    });
    if ((prev as any[]).length > 0) {
      await prisma.telecallerScoreEvent.deleteMany({
        where: { id: { in: (prev as any[]).map((r) => String(r.id)) } },
      });
    }
    const total = Math.round(Number((est as any).total ?? 0) || 0);
    const { closer: cPts } = splitClosePoints((est as any).total);
    const day = String(genRow.day ?? '') || istDate();
    await recordScoreEvent(String(closerTelecallerId), estimateId, 'closer', cPts, day, `Close credited to ${(closer as any).name} (picked by ${pickedBy}) — ₹${total.toLocaleString('en-IN')}, ${cPts} points closer share`);
    return { ok: true };
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'creditCloserShare failed');
    return { ok: false, error: e?.message ?? 'creditCloserShare failed' };
  }
}

/**
 * Converted estimates WITH a generator credit but WITHOUT a closer pick,
 * newest first. Sales-head picks a closer for each (80% share pending).
 */
export async function pendingCloserPicks(limit: number = 50): Promise<Array<Record<string, unknown>>> {
  try {
    const genRows = await prisma.telecallerScoreEvent.findMany({
      where: { kind: 'generator' },
      select: { estimateId: true, day: true },
    });
    const byEstimate = new Map<string, string>();
    for (const r of genRows as any[]) {
      const id = String(r.estimateId ?? '');
      if (id && !byEstimate.has(id)) byEstimate.set(id, String(r.day ?? ''));
    }
    const pickable = [...byEstimate.keys()];
    if (pickable.length === 0) return [];
    const estimates = await prisma.estimate.findMany({
      where: { estimateId: { in: pickable }, status: { in: ['accepted', 'confirmed'] } },
      select: { estimateId: true, estimateNumber: true, customerName: true, total: true, region: true, organizationId: true, lastSyncTime: true },
    });
    // Drop ones already picked.
    const closerRows = await prisma.telecallerScoreEvent.findMany({
      where: { estimateId: { in: (estimates as any[]).map((e) => String(e.estimateId)) }, kind: 'closer' },
      select: { estimateId: true },
    });
    const picked = new Set((closerRows as any[]).map((r) => String(r.estimateId)));
    const pending = (estimates as any[]).filter((e) => !picked.has(String(e.estimateId)))
      .sort((a, b) => String(b.lastSyncTime ?? '').localeCompare(String(a.lastSyncTime ?? '')))
      .slice(0, limit);
    return pending.map((e) => ({
      estimateId: e.estimateId,
      estimateNumber: e.estimateNumber,
      customerName: e.customerName,
      total: Number(e.total ?? 0),
      region: String(e.region ?? ''),
      closeDay: byEstimate.get(String(e.estimateId)) ?? '',
      organizationId: String(e.organizationId ?? ''),
    }));
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'pendingCloserPicks failed');
    return [];
  }
}

/**
 * Converters map for the per-estimate export: estimateId → { name, day }.
 * Region model: the CLOSER (kind='closer' row) is "Converted By"; estimates
 * not yet picked fall back to the generator's name. Only converted estimates
 * ever have a close row.
 */
export async function getConvertersMap(sinceDay: string = ''): Promise<Record<string, { name: string; day: string }>> {
  try {
    const events = await prisma.telecallerScoreEvent.findMany({
      where: {
        kind: { in: ['generator', 'closer'] },
        ...(DATE_RE.test(sinceDay) ? { day: { gte: sinceDay } } : {}),
      },
      select: { telecallerId: true, estimateId: true, day: true, kind: true },
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
    // Two passes: closer rows first ("Converted By" = who closed it), then
    // generator rows for estimates not yet picked.
    for (const targetKind of ['closer', 'generator']) {
      for (const e of events as any[]) {
        if (String(e.kind ?? '') !== targetKind) continue;
        const estId = String(e.estimateId ?? '');
        if (!estId || out[estId]) continue;
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
 * Founder-approved live reset: delete every close-credit ledger row (all
 * kinds — legacy full slabs, generator/closer shares) and stamp the history
 * epoch so every ledger read starts from zero on that day. Non-close rows
 * (legacy −10/−15 penalties) and all other data are kept. dryRun=true only
 * counts what would go. Returns the per-shape counts for the confirmation UI.
 */
export async function deleteCloseHistory(
  dryRun: boolean = false,
): Promise<{ dryRun: boolean; deleted: Record<string, number>; epoch: string | null }> {
  const counts = { closeRows: 0 };
  try {
    const ids: string[] = [];
    for (const kindChunk of [['generator', 'closer'], []]) {
      const where = kindChunk.length === 2
        ? { kind: { in: kindChunk } }
        : { kind: '', delta: { gte: 0 } };
      const rows = await prisma.telecallerScoreEvent.findMany({
        where,
        select: { id: true },
      });
      for (const r of rows as any[]) {
        const id = String(r.id ?? '');
        // Second query set may overlap the first (legacy rows with a kind't /
        // full-slab delta) — the id set dedupes before any delete runs.
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
    counts.closeRows = ids.length;
    if (!dryRun && ids.length > 0) {
      // Chunked at IN_BATCH — D1 caps bound variables at 100/statement.
      for (let i = 0; i < ids.length; i += IN_BATCH) {
        await prisma.telecallerScoreEvent.deleteMany({
          where: { id: { in: ids.slice(i, i + IN_BATCH) } },
        });
      }
      await setEpochDate(istDate());
    }
    const epoch = dryRun ? await getEpochDate() : istDate();
    return { dryRun, deleted: counts, epoch };
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'deleteCloseHistory failed');
    throw e;
  }
}
