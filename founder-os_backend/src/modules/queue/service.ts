import { Queue, Worker } from 'bullmq';
import { config } from '../../config';
import { logger } from '../../shared/logger';
import { nextKolkataTimeUtc } from '../../shared/ist-time';
import { ClassificationService } from '../classification/service';
import { OutboundService } from '../whatsapp/outbound';
import { prisma, useInMemoryDb } from '../../shared/prisma';
import { StorageRepository } from '../storage/repository';

const connection = { host: config.REDIS_HOST, port: config.REDIS_PORT };

export const classificationQueue = new Queue('whatsapp-classification', { connection });

export class MessageQueueService {
  static morningQueue = new Queue('whatsapp-morning-delayed', { connection });

  // Guard against overlapping drain runs. The morning drain cron fires every
  // minute and a single cycle can take longer than that when WAHA is slow or
  // down — without this lock two overlapping drains would grab the same jobs
  // and double-send.
  private static morningDrainInFlight = false;

  // Hard cap on how many deferred messages a single drain cycle processes.
  // Prevents a giant 8 AM backlog from monopolizing the (serialized) drain
  // chain for hours; leftover jobs simply wait for the next minute's cycle.
  private static readonly MAX_DRAIN_SENDS_PER_CYCLE = 60;

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

  static async enqueueDelayedMorning(chatId: string, messageBody: string, delayMs?: number) {
    // Default target: next 8:00 AM in Asia/Kolkata (business hours are IST, not server-local time).
    // When delayMs is given (e.g. rate-limited retry), defer by that relative window instead.
    const target = delayMs !== undefined
      ? new Date(Date.now() + delayMs)
      : nextKolkataTimeUtc(new Date(), 8);
    const delay = target.getTime() - Date.now();

    try {
      await this.morningQueue.add('send-morning', { chatId, messageBody }, {
        delay,
        attempts: 2,
        removeOnComplete: true,
      });
    } catch (err: any) {
      // Redis is down: the deferred job can't be created. Persist the intent so
      // the recovery sweep re-deferrals it once Redis is back — never lose an
      // outbound message to a Redis outage.
      logger.error({ chatId, error: err.message }, 'Morning queue: Redis unavailable, persisting outbound intent');
      await this.persistOutboundIntent(chatId, messageBody, delayMs);
    }
  }

  /**
   * Durability fallback for the morning queue. Writes the deferred send to the
   * DB so it survives a Redis outage; dedupes rapid retries of the same send.
   */
  private static async persistOutboundIntent(chatId: string, messageBody: string, delayMs?: number) {
    if (useInMemoryDb) return;
    try {
      const recent = await prisma.outboundIntent.findFirst({
        where: { chatId, messageBody, status: 'PENDING', createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
        select: { id: true },
      });
      if (recent) {
        logger.debug({ chatId }, 'Outbound intent: identical send already pending, skipping');
        return;
      }
      await prisma.outboundIntent.create({
        data: { chatId, messageBody, status: 'PENDING', targetDelayMs: delayMs ?? null },
      });
    } catch (err: any) {
      logger.error({ error: err.message }, 'Outbound intent: could not persist');
    }
  }

  /**
   * Recovery sweep for outbound intents persisted while Redis was down. Re-runs
   * enqueueDelayedMorning for each PENDING intent once Redis is reachable.
   */
  static async recoverOutboundIntents() {
    if (useInMemoryDb) return;
    try {
      const pending = await prisma.outboundIntent.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      if (pending.length === 0) return;

      logger.info({ count: pending.length }, 'Recovery: re-enqueuing persisted outbound intents');
      for (const p of pending) {
        try {
          await this.enqueueDelayedMorning(p.chatId, p.messageBody, p.targetDelayMs ?? undefined);
          await prisma.outboundIntent.update({
            where: { id: p.id },
            data: { status: 'ENQUEUED', enqueuedAt: new Date() },
          });
        } catch (err: any) {
          // Redis still down — enqueueDelayedMorning will have re-persisted (and
          // deduped) the intent; stop hammering and let the next cycle retry.
          logger.error({ id: p.id, error: err.message }, 'Outbound intent: still cannot enqueue, will retry next cycle');
          break;
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, 'Recovery: outbound intent sweep failed');
    }
  }

  /**
   * Drains the morning queue — picks up delayed/waiting jobs that are now due and sends them.
   * Called by the every-minute cron. OutboundService is a pure sender, so the
   * outside-hours deferral is owned here: the job is re-queued targeting the
   * next 8 AM IST window and the now-superseded job removed. If rate-limited,
   * the job stays in the queue for the next cycle.
   */
  static async drainMorningQueue() {
    if (this.morningDrainInFlight) {
      logger.debug('Morning queue: previous drain still running, skipping this cycle');
      return;
    }
    this.morningDrainInFlight = true;
    try {
      const jobs = await this.morningQueue.getJobs(['delayed', 'waiting']);
      const now = Date.now();
      const due = jobs.filter(j => (j.delay || 0) + (j.timestamp || 0) <= now);
      if (due.length === 0) return;

      logger.info({ count: due.length, capped: due.length > this.MAX_DRAIN_SENDS_PER_CYCLE }, 'Morning queue: sending deferred messages');

      let processed = 0;
      for (const job of due) {
        if (processed >= this.MAX_DRAIN_SENDS_PER_CYCLE) break;
        processed++;
        try {
          const { chatId, messageBody } = job.data;
          const result = await OutboundService.sendWithJitter(chatId, messageBody);
          // Remove only when the job is truly done: sent, or re-deferred for a
          // later window (outside hours re-queues to the next 8 AM, superseding
          // this job). If rate_limited, keep the job — the next drain cycle
          // retries it.
          if (result === 'sent') {
            await job.remove();
          } else if (result === 'outside_hours') {
            await this.enqueueDelayedMorning(chatId, messageBody);
            await job.remove();
          }
        } catch (err: any) {
          logger.error({ jobId: job.id, error: err.message }, 'Morning queue: job failed');
        }
      }
    } finally {
      this.morningDrainInFlight = false;
    }
  }

  /**
   * Recovery sweep for messages that were written to the database but never
   * classified. This happens when Redis is down during a buffer flush: the
   * INSERT succeeds but enqueueClassification throws, leaving the message stuck
   * at processed=false with no job in the queue. Runs periodically from the
   * scheduler and re-enqueues anything still unprocessed past a grace window.
   * The atomic processed-guard in the storage layer makes re-enqueue idempotent.
   */
  static async recoverOrphanedMessages() {
    if (useInMemoryDb) return;
    try {
      const grace = new Date(Date.now() - 2 * 60 * 1000);
      const orphans = await prisma.message.findMany({
        where: { processed: false, isHistorical: false, createdAt: { lte: grace } },
        take: 100,
      });
      if (orphans.length === 0) return;

      logger.info({ count: orphans.length }, 'Recovery: re-enqueuing orphaned unprocessed messages');
      for (const m of orphans) {
        await this.enqueueClassification(m.id, m.chatId, m.sender, m.body, m.timestamp, null);
      }
    } catch (err: any) {
      logger.error({ error: err.message }, 'Recovery: orphaned message sweep failed');
    }
  }

  static startWorker() {
    const worker = new Worker('whatsapp-classification', async (job) => {
      const { messageId, chatId, sender, body, timestamp, mediaType } = job.data;
      // Idempotency guard: the recovery sweep may re-enqueue messages that are
      // already processed; skip them instead of re-running AI classification.
      if (messageId) {
        let alreadyProcessed = false;
        try {
          if (useInMemoryDb) {
            const msgs = await StorageRepository.fetchUnprocessedMessages();
            alreadyProcessed = !msgs.some(m => m.id === messageId);
          } else {
            const msg = await prisma.message.findUnique({ where: { id: messageId } });
            alreadyProcessed = !!(msg && msg.processed);
          }
        } catch {
          alreadyProcessed = false;
        }
        if (alreadyProcessed) {
          logger.debug({ jobId: job.id, messageId }, 'Classification worker: already processed, skipping');
          return;
        }
      }
      await ClassificationService.processSingleMessage(
        messageId, chatId, sender, body, new Date(timestamp), mediaType
      );
    }, {
      connection,
      concurrency: 5,
      maxStalledCount: 2,
      lockDuration: 60000,
    });

    worker.on('completed', (job) => {
      logger.info({ jobId: job.id }, 'Classification worker: job completed');
    });
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, error: err.message }, 'Classification worker: job failed');
    });

    logger.info('Classification BullMQ worker started (concurrency=5)');
    return worker;
  }
}