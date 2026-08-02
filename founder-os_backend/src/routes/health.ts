import { Router } from 'express';
import { prisma, useInMemoryDb } from '../shared/prisma';
import { config } from '../config';
import { StorageRepository } from '../modules/storage/repository';
import { logger } from '../shared/logger';
import { classificationQueue } from '../modules/queue/service';
import { AIService } from '../modules/ai/service';

const router = Router();

router.get('/whatsapp', async (req, res) => {
  const now = new Date();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);

  let wahaStatus = 'unknown';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const sr = await fetch(`${config.WAHA_API_URL}/api/sessions/${config.WAHA_SESSION_NAME}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (sr.ok) {
      const sData = await sr.json();
      wahaStatus = sData.status || 'unknown';
    }
  } catch { wahaStatus = 'unreachable'; }

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

  res.json({
    status: (breachedCount === 0 && wahaStatus === 'WORKING') ? 'healthy' : 'degraded',
    waha: { status: wahaStatus },
    metrics: {
      unprocessedMessages: unprocessedCount,
      slaBreaches: breachedCount,
      pendingItems: pendingCount,
      lastWebhookAt,
      lagMs: lastWebhookAt ? now.getTime() - lastWebhookAt.getTime() : null,
      queueDepth,
      ai: { totalCalls: aiMetrics.totalCalls, failedCalls: aiMetrics.failedCalls, failureRate: `${aiFailureRate}%` },
    },
  });
});

export default router;