import { logger } from '../../shared/logger';
import { prisma, useInMemoryDb } from '../../shared/prisma';
import { WhatsAppService } from './service';
import { MessageQueueService } from '../queue/service';

export interface BufferedMessage {
  chatId: string;
  sender: string;
  body: string;
  timestamp: Date;
  wahaMessageId?: string | null;
  isHistorical?: boolean;
  mediaType?: string | null;
  quotedMessageId?: string | null;
  quotedBody?: string | null;
  quotedSender?: string | null;
}

const FLUSH_THRESHOLD = 50;
const FLUSH_INTERVAL_MS = 3000;

/**
 * Transient write-behind buffer for inbound webhook messages.
 *
 * Instead of issuing one SQL statement per incoming payload, messages are
 * buffered in memory and flushed as a single batch INSERT ... ON CONFLICT (id)
 * DO NOTHING (Prisma createManyAndReturn + skipDuplicates). This satisfies the
 * bulk-upsert + duplicate-avoidance requirements: historical replay packets are
 * discarded atomically and the DB is not hammered one query per message.
 */
class MessageBuffer {
  private buffer: BufferedMessage[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  push(msg: BufferedMessage): void {
    this.buffer.push(msg);
    if (this.buffer.length >= FLUSH_THRESHOLD) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const batch = this.buffer.splice(0);
    if (batch.length === 0) {
      this.flushing = false;
      return;
    }

    try {
      if (useInMemoryDb) {
        // No real DB to batch against — fall back to per-message inserts.
        for (const m of batch) {
          const saved = await WhatsAppService.saveMessage(m);
          if (!m.isHistorical) {
            await MessageQueueService.enqueueClassification(saved.id, m.chatId, m.sender, m.body, m.timestamp, m.mediaType || null);
          }
        }
      } else {
        // Atomic ON CONFLICT DO NOTHING: only NEW rows come back, so a replayed
        // duplicate is skipped without raising and without re-triggering AI.
        const rows = batch.map(m => ({
          chatId: m.chatId,
          sender: m.sender,
          body: m.body,
          timestamp: m.timestamp,
          isHistorical: m.isHistorical || false,
          wahaMessageId: m.wahaMessageId || null,
          quotedMessageId: m.quotedMessageId || null,
          quotedBody: m.quotedBody || null,
          quotedSender: m.quotedSender || null,
        }));
        const created = await prisma.message.createManyAndReturn({
          data: rows,
          skipDuplicates: true,
        });
        for (let i = 0; i < created.length; i++) {
          const rec = created[i];
          if (rec.isHistorical) continue;
          await MessageQueueService.enqueueClassification(rec.id, rec.chatId, rec.sender, rec.body, rec.timestamp, batch[i].mediaType || null);
        }
      }
      logger.debug({ count: batch.length }, 'Bulk flushed buffered messages');
    } catch (err: any) {
      logger.error({ error: err.message, count: batch.length }, 'Bulk message flush failed');
    } finally {
      this.flushing = false;
    }
  }
}

export const messageBuffer = new MessageBuffer();
