import { prisma, useInMemoryDb } from '../../shared/prisma';
import { StorageRepository } from '../storage/repository';

export class AuditService {
  static async getPendingItems(options: { since?: Date; category?: string; priority?: string }) {
    if (useInMemoryDb) return [];
    const where: any = { classification: 'PENDING' };
    if (options.since) where.classifiedAt = { gte: options.since };
    return prisma.message.findMany({
      where,
      orderBy: [{ classification: 'desc' }, { classifiedAt: 'asc' }],
    });
  }

  static async getSLABreaches(since: Date) {
    if (useInMemoryDb) return [];
    return prisma.message.findMany({
      where: { slaDeadline: { lt: new Date() }, timestamp: { gte: since }, processed: true },
      orderBy: { slaDeadline: 'asc' },
    });
  }
}