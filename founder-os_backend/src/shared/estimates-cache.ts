import { prisma } from './prisma';
import { logger } from './logger';
import { isSystemGeneratedComment } from './systemComment';

// ── /api/estimates payload cache (D1 row-read budget protection) ─────────────
// The Zoho Estimates dashboard payload includes every open estimate with its
// FULL comment timeline. Dashboards refetch on every runner WebSocket
// broadcast (every 5–15 min), so serving it from a short-TTL Setting snapshot
// cuts D1 row reads by ~100×. Same pattern as the telecalling risk cache.
const KEY = 'sales_copilot:estimates_cache';
const TTL_MS = 5 * 60 * 1000;

interface EstimatesPayload {
  estimates: any[];
  lastCompleteSyncAt: string | null;
  computedAt: string;
}

async function computeEstimatesPayload(): Promise<EstimatesPayload> {
  const [estimates, lastCompleteSync] = await Promise.all([
    prisma.estimate.findMany({
      where: { OR: [{ status: 'sent' }, { status: 'accepted' }, { status: 'declined' }, { status: 'confirmed' }] },
      include: { classification: true, comments: { orderBy: { commentId: 'desc' } } },
    }),
    prisma.setting.findUnique({ where: { key: 'sales_copilot:last_complete_sync_at' } }),
  ]);
  return {
    estimates: estimates.map((e: any) => ({
      ...e,
      comments: (e.comments || []).filter(
        (c: any) => !isSystemGeneratedComment(c.description, c.commentedBy),
      ),
    })),
    lastCompleteSyncAt: lastCompleteSync?.value ?? null,
    computedAt: new Date().toISOString(),
  };
}

export async function getEstimatesPayload(): Promise<EstimatesPayload> {
  let cached: EstimatesPayload | null = null;
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    if (row?.value) cached = JSON.parse(String(row.value)) as EstimatesPayload;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'estimates cache read failed');
  }
  if (cached && Date.now() - Date.parse(cached.computedAt) < TTL_MS) return cached;

  try {
    const computed = await computeEstimatesPayload();
    await prisma.setting.upsert({
      where: { key: KEY },
      update: { value: JSON.stringify(computed), updatedAt: new Date() },
      create: { key: KEY, value: JSON.stringify(computed), updatedAt: new Date() },
    });
    return computed;
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'estimates compute failed — serving stale cache if present');
    if (cached) return cached;
    throw e;
  }
}