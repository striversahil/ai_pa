import { Queue } from 'bullmq';
import { config } from '../../config';
import { logger } from '../../shared/logger';
import { ClassificationService } from '../classification/service';
import { OutboundService } from '../whatsapp/outbound';
import { prisma, useInMemoryDb } from '../../shared/prisma';
import { StorageRepository } from '../storage/repository';

const connection = { host: config.REDIS_HOST, port: config.REDIS_PORT };

export const classificationQueue = new Queue('whatsapp-classification', { connection });

const CHUNK_SIZE = 20;

export class MessageQueueService {
  static morningQueue = new Queue('whatsapp-morning-delayed', { connection });

  static async enqueueClassification(
    messageId: string, chatId: string, sender: string, body: string, timestamp: Date, mediaType?: string | null
  ) {
    const job = await classificationQueue.add('classify', {
      messageId, chatId, sender, body, timestamp, mediaType,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 500,
    });
    return job.id;
  }

  static async enqueueDelayedMorning(chatId: string, messageBody: string) {
    const now = new Date();
    const target = new Date(now);
    target.setHours(8, 0, 0, 0);
    if (now >= target) target.setDate(target.getDate() + 1);
    const delayMs = target.getTime() - now.getTime();

    await this.morningQueue.add('send-morning', { chatId, messageBody }, {
      delay: delayMs,
      attempts: 2,
      removeOnComplete: true,
    });
  }

  /**
   * Drains the morning queue — picks up delayed/waiting jobs that are now due and sends them.
   * Called by the 5-minute cron during working hours (8AM–10PM).
   * If rate-limited or outside hours, the job stays in the queue for the next cycle.
   */
  static async drainMorningQueue() {
    const jobs = await this.morningQueue.getJobs(['delayed', 'waiting']);
    const now = Date.now();
    const due = jobs.filter(j => (j.delay || 0) + (j.timestamp || 0) <= now);
    if (due.length === 0) return;

    logger.info({ count: due.length }, 'Morning queue: sending deferred messages');

    for (const job of due) {
      try {
        const { chatId, messageBody } = job.data;
        const result = await OutboundService.sendWithJitter(chatId, messageBody);
        // Only remove if actually sent. If rate_limited or outside_hours,
        // keep in queue — next drain cycle will retry.
        if (result === 'sent') {
          await job.remove();
        }
      } catch (err: any) {
        logger.error({ jobId: job.id, error: err.message }, 'Morning queue: job failed');
      }
    }
  }

  /**
   * Drains waiting classification jobs from Redis and processes them in chunks.
   * Called by the 5-minute cron — messages are stored in Redis RAM, then
   * batch-processed and written to PostgreSQL in chunks of 20.
   */
  static async drainAndProcessBatch() {
    const waiting = await classificationQueue.getJobs(['waiting', 'active']);
    if (waiting.length === 0) return;

    logger.info({ count: waiting.length }, 'Batch processor: draining classification queue');

    const chunks: typeof waiting[] = [];
    for (let i = 0; i < waiting.length; i += CHUNK_SIZE) {
      chunks.push(waiting.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      await Promise.allSettled(
        chunk.map(async (job) => {
          try {
            const { messageId, chatId, sender, body, timestamp, mediaType } = job.data;
            if (messageId) {
              let alreadyProcessed = false;
              if (useInMemoryDb) {
                const msgs = await StorageRepository.fetchUnprocessedMessages();
                alreadyProcessed = !msgs.some(m => m.id === messageId);
              } else {
                const msg = await prisma.message.findUnique({ where: { id: messageId } });
                alreadyProcessed = !!(msg && msg.processed);
              }
              if (alreadyProcessed) {
                await job.remove();
                return;
              }
            }
            await ClassificationService.processSingleMessage(
              messageId, chatId, sender, body, new Date(timestamp), mediaType
            );
          } catch (err: any) {
            logger.error({ jobId: job.id, error: err.message }, 'Batch processor: job failed');
          }
        })
      );

      const completedIds = chunk.filter(j => !j.isFailed).map(j => j.id!);

      if (completedIds.length > 0) {
        await Promise.all(completedIds.map(id => classificationQueue.remove(id)));
      }
    }

    logger.info({ processed: waiting.length, chunkSize: CHUNK_SIZE }, 'Batch processor: queue drained');
  }
}