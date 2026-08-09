import { prisma, useInMemoryDb } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { Alerter } from '../../modules/monitoring/alerter';
import { StorageRepository } from '../../modules/storage/repository';
import { AuditService } from '../../modules/audit/service';

export class SLAChecker {
  private static consecutiveBreaches = 0;

  static async check() {
    const now = new Date();
    const warningDeadline = new Date(now.getTime() - 10 * 60 * 1000);
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

      const warning = await prisma.message.findMany({
        where: { processed: false, timestamp: { gte: deadline, lte: warningDeadline } },
        take: 50,
      });

      if (warning.length > 0) {
        logger.warn({ count: warning.length }, 'SLA WARNING: messages approaching 15-min deadline');
        await Alerter.alert(`${warning.length} messages approaching 15-min SLA deadline`, 'warning');
      }
    }

    if (breached.length > 0) {
      this.consecutiveBreaches++;
      logger.error({ count: breached.length, oldest: breached[0].timestamp, consecutiveBreaches: this.consecutiveBreaches }, 'SLA BREACHED');
      await Alerter.alert(`${breached.length} messages breached 15-min SLA (${this.consecutiveBreaches}x consecutive)`, 'critical');
      AuditService.record('SLA_BREACHED', 'MESSAGE', null, { count: breached.length, oldestTimestamp: breached[0].timestamp, consecutiveBreaches: this.consecutiveBreaches, breachedIds: breached.map((m: any) => m.id) }).catch(() => {});

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
    } else {
      this.consecutiveBreaches = 0;
    }

    return breached;
  }
}