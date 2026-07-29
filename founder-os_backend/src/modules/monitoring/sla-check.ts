import { prisma, useInMemoryDb } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { Alerter } from './alerter';
import { StorageRepository } from '../storage/repository';

export class SLAChecker {
  static async check() {
    const now = new Date();
    const deadline = new Date(now.getTime() - 15 * 60 * 1000);

    let breached: any[] = [];

    if (useInMemoryDb) {
      const unprocessed = await StorageRepository.fetchUnprocessedMessages();
      breached = unprocessed.filter(m => m.timestamp <= deadline);
    } else {
      breached = await prisma.message.findMany({
        where: { processed: false, timestamp: { lte: deadline } },
        orderBy: { timestamp: 'asc' },
        take: 100,
      });
    }

    if (breached.length > 0) {
      logger.error({ count: breached.length, oldest: breached[0].timestamp }, 'SLA BREACHED');
      await Alerter.alert(`${breached.length} messages breached 15-min SLA`, 'critical');

      if (!useInMemoryDb) {
        for (const msg of breached) {
          if (new Date().getTime() - msg.timestamp.getTime() > 30 * 60 * 1000) {
            await prisma.message.update({
              where: { id: msg.id },
              data: {
                processed: true,
                classification: 'NOT_PENDING',
                classificationReason: 'SLA_EXCEEDED',
                classifiedAt: new Date(),
              },
            });
            logger.warn({ messageId: msg.id }, 'Message auto-resolved after 30-min SLA breach');
          }
        }
      }
    }

    return breached;
  }
}