// scoring.ts — event-ledger scoring (sales leaderboard source of truth).
//
// Region model: a close credits the ENQUIRY GENERATOR (Estimate.createdBy)
// with the FULL slab automatically via recordConversionClose (kind='generator').
// The old 20/80 closer-pick split is retired — no manual closer step, no new
// kind='closer' rows. Historic rows still read for the ledger/CSV.
// Remarked/snatch penalties were part of the old held-estimate machinery and
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
 * Credit the creator's FULL close slab, written automatically the moment an
 * estimate converts. Closer picks were retired — no 80% hand-off remains.
 * Duplicate-guarded: a kind='generator' row (or a positive legacy close row)
 * per estimate gates re-entry.
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
    const pts = closePointsFor((est as any).total);
    await recordScoreEvent(String(generator), estimateId, 'generator', pts, day, `Estimate converted ₹${total.toLocaleString('en-IN')} — ${pts} points close credit to lead creator`);
    return true;
  } catch (e: any) {
    logger.warn({ err: e?.message, estimateId }, 'recordConversionClose failed');
    return false;
  }
}

/**
 * Converters map for the per-estimate export: estimateId → { name, day }.
 * Historical kind='closer' rows still win "Converted By"; every estimate
 * without one (all new closes) falls back to the creator/generator name.
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
