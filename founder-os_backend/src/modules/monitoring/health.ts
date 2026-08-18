import { prisma, useInMemoryDb } from '../../shared/prisma';
import { StorageRepository } from '../storage/repository';
import { logger } from '../../shared/logger';
import { classificationQueue } from '../queue/service';
import { AIService } from '../ai/service';
import { getWaEngineStatus } from '../whatsapp/session-status';
import type { WaEngineStatus } from '../whatsapp/session-status';

/**
 * Shared platform health payload used by GET /health, GET /api/health and the
 * WA Engine session monitor dashboard. Pass a pre-fetched waEngineStatus to
 * avoid a duplicate WA Engine Pro call (the dashboard already fetched it).
 */
export async function buildHealthPayload(waEngineStatus?: WaEngineStatus) {
  const now = new Date();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);

  const waEngine = waEngineStatus ?? await getWaEngineStatus();

  let unprocessedCount = 0;
  let breachedCount = 0;
  let lastWebhookAt: Date | null = null;
  let pendingCount = 0;
  let queueDepth = 0;

  if (useInMemoryDb) {
    const unprocessed = await StorageRepository.fetchUnprocessedMessages();
    unprocessedCount = unprocessed.length;
    breachedCount = unprocessed.filter(m => m.timestamp <= fifteenMinAgo).length;
    pendingCount = 0;
    lastWebhookAt = null;
  } else {
    try {
      const results = await Promise.all([
        prisma.message.count({ where: { processed: false } }),
        prisma.message.count({ where: { processed: false, timestamp: { lte: fifteenMinAgo } } }),
        prisma.message.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
        prisma.message.count({ where: { classification: 'PENDING' } }),
        classificationQueue.getWaitingCount().catch(() => 0),
      ]);
      unprocessedCount = results[0];
      breachedCount = results[1];
      lastWebhookAt = results[2]?.createdAt || null;
      pendingCount = results[3];
      queueDepth = results[4] as number;
    } catch {
      logger.warn('Health endpoint: database unavailable');
    }
  }

  const aiMetrics = AIService.metrics;
  const aiFailureRate = aiMetrics.totalCalls > 0 ? (aiMetrics.failedCalls / aiMetrics.totalCalls * 100).toFixed(2) : '0';

  return {
    status: (breachedCount === 0 && waEngine.status === 'WORKING') ? 'healthy' : 'degraded',
    waEngine: { status: waEngine.status, reachable: waEngine.reachable },
    metrics: {
      unprocessedMessages: unprocessedCount,
      slaBreaches: breachedCount,
      pendingItems: pendingCount,
      lastWebhookAt,
      lagMs: lastWebhookAt ? now.getTime() - lastWebhookAt.getTime() : null,
      queueDepth,
      ai: { totalCalls: aiMetrics.totalCalls, failedCalls: aiMetrics.failedCalls, failureRate: `${aiFailureRate}%` },
    },
  };
}
