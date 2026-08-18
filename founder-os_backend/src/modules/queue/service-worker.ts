import { config } from '../../config';
import { logger } from '../../shared/logger';
import { nextKolkataTimeUtc } from '../../shared/ist-time';
import { ClassificationService } from '../classification/service';
import { OutboundService } from '../whatsapp/outbound';
import { prisma, useInMemoryDb } from '../../shared/prisma';
import { StorageRepository } from '../storage/repository';

// Worker-safe queue: no BullMQ/Redis. Classification runs inline; the morning
// queue is persisted in D1 (OutboundIntent) and drained by trigger endpoints.

export const classificationQueue = {
  async getWaitingCount(): Promise<number> {
    if (useInMemoryDb) return 0;
    try {
      return prisma.message.count({ where: { processed: false } });
    } catch {
      return 0;
    }
  },
};

export class MessageQueueService {
  private static morningDrainInFlight = false;
  private static readonly MAX_DRAIN_SENDS_PER_CYCLE = 60;

  static async enqueueClassification(
    messageId: string, chatId: string, sender: string, body: string, timestamp: Date, mediaType?: string | null
  ) {
    await ClassificationService.processSingleMessage(messageId, chatId, sender, body, timestamp, mediaType);
    return messageId;
  }

  static async enqueueDelayedMorning(chatId: string, messageBody: string, delayMs?: number) {
    await this.persistOutboundIntent(chatId, messageBody, delayMs);
  }

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
          logger.error({ id: p.id, error: err.message }, 'Outbound intent: still cannot enqueue, will retry next cycle');
          break;
        }
      }
    } catch (err: any) {
      logger.error({ error: err.message }, 'Recovery: outbound intent sweep failed');
    }
  }

  static async drainMorningQueue() {
    if (this.morningDrainInFlight) {
      logger.debug('Morning queue: previous drain still running, skipping this cycle');
      return;
    }
    this.morningDrainInFlight = true;
    try {
      const due = await prisma.outboundIntent.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      if (due.length === 0) return;
      logger.info({ count: due.length, capped: due.length > this.MAX_DRAIN_SENDS_PER_CYCLE }, 'Morning queue: sending deferred messages');

      let processed = 0;
      for (const intent of due) {
        if (processed >= this.MAX_DRAIN_SENDS_PER_CYCLE) break;
        processed++;
        try {
          const { chatId, messageBody } = intent;
          const result = await OutboundService.sendWithJitter(chatId, messageBody);
          if (result === 'sent') {
            await prisma.outboundIntent.update({ where: { id: intent.id }, data: { status: 'ENQUEUED', enqueuedAt: new Date() } });
          } else if (result === 'outside_hours') {
            await this.enqueueDelayedMorning(chatId, messageBody);
            await prisma.outboundIntent.update({ where: { id: intent.id }, data: { status: 'ENQUEUED', enqueuedAt: new Date() } });
          }
        } catch (err: any) {
          logger.error({ id: intent.id, error: err.message }, 'Morning queue: send failed');
        }
      }
    } finally {
      this.morningDrainInFlight = false;
    }
  }

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
    logger.info('Worker-mode classification: inline processing enabled (no BullMQ worker)');
    return null;
  }
}