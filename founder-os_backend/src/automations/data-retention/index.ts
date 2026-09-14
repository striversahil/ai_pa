import { logger } from '../../shared/logger';
import { prisma } from '../../shared/prisma';

export async function handler() {
  logger.info('Cron: Running data retention cleanup...');
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;
  let batchDeleted = 0;

  do {
    const batch = await prisma.message.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: 1000,
    });
    if (batch.length === 0) break;

    const ids = batch.map((b) => b.id);
    // Chunked at 90 — D1 caps bound SQL variables at 100/statement.
    let batchDeletedInner = 0;
    for (let i = 0; i < ids.length; i += 90) {
      const res = await prisma.message.deleteMany({ where: { id: { in: ids.slice(i, i + 90) } } });
      batchDeletedInner += res.count;
    }
    batchDeleted = batchDeletedInner;
    totalDeleted += batchDeleted;
  } while (batchDeleted > 0);

  logger.info({ totalDeleted }, 'Cleaned up messages older than 90 days');
}
