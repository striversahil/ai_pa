import { prisma, useInMemoryDb } from '../../shared/prisma';
import { StorageRepository } from '../storage/repository';

export class AuditService {
  static async record(action: string, entityType: string, entityId?: string | null, metadata?: Record<string, any> | null) {
    await StorageRepository.recordAuditEntry(action, entityType, entityId, metadata);
  }

  static async query(options: { action?: string; entityType?: string; limit?: number; since?: Date }) {
    return StorageRepository.queryAuditEntries(options);
  }

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
