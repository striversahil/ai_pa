import { cached, cacheDel, cacheDelPrefix } from './cache';
import { prisma } from './prisma';
import { logger } from './logger';
import { isSystemGeneratedComment } from './systemComment';

// ── /api/estimates payload cache (KV-backed) ─────────────────────────────────
// The Zoho Estimates dashboard payload includes every open estimate with its
// FULL comment timeline. Dashboards refetch on every runner WebSocket
// broadcast (every 5–15 min), so serving it from a short-TTL KV snapshot cuts
// D1 row reads by ~100×. Same pattern as the telecalling risk cache.
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

/**
 * Invalidate the estimates cache when the underlying Zoho data changes (a
 * runner sync, comment sync, status/classification transition, or bulk upsert).
 * Call sites: the runner endpoints that mutate Estimate/Comment/Classification.
 */
export async function invalidateEstimatesCache(): Promise<void> {
  await cacheDel(KEY);
}

/**
 * Invalidate every derived cache that depends on the estimates payload (e.g.
 * the telecalling KRA attribution reads the same estimates). Called alongside
 * invalidateEstimatesCache() on any mutation.
 */
export async function invalidateDerivedEstimateCaches(): Promise<void> {
  await Promise.all([
    cacheDelPrefix('neodove:kra'),
    cacheDelPrefix('telecalling:risk'),
    cacheDelPrefix('telecalling:dashboard'),
    cacheDel(KEY),
  ]);
}

export async function getEstimatesPayload(): Promise<EstimatesPayload> {
  return cached<EstimatesPayload>(KEY, TTL_MS, async () => {
    const computed = await computeEstimatesPayload();
    logger.debug({ estimates: computed.estimates.length }, 'estimates payload computed');
    return computed;
  });
}