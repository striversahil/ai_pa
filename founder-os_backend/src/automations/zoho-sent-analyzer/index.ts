import { prisma } from '../../shared/prisma';
import { SalesCopilotService } from './service';

export async function handler() {
  await new SalesCopilotService().runSync();
}

/**
 * Dashboard data provider — `GET /api/automations/zoho-sent-analyzer/data`.
 * KPI summary of the Zoho sent-estimate pipeline. The full interactive board
 * lives in the frontend (founder-os_frontend ZohoEstimates), which reads the
 * same estimate rows via GET /api/estimates.
 */
export async function data() {
  const where = { OR: [{ status: 'sent' }, { status: 'accepted' }, { status: 'declined' }, { status: 'confirmed' }] };
  const [estimates, sent, sentClassified, accepted, declined, latestSync] = await Promise.all([
    prisma.estimate.findMany({ where, select: { estimateId: true, estimateNumber: true, customerName: true, total: true, status: true, lastSyncTime: true } }),
    prisma.estimate.count({ where: { status: 'sent' } }),
    prisma.estimate.count({ where: { status: 'sent', classification: { isNot: null } } }),
    prisma.estimate.count({ where: { status: { in: ['accepted', 'confirmed'] } } }),
    prisma.estimate.count({ where: { status: 'declined' } }),
    prisma.estimate.aggregate({ _max: { lastSyncTime: true } }),
  ]);

  const totalValue = estimates.filter((e) => e.status === 'sent').reduce((sum, e) => sum + e.total, 0);

  return {
    totalEstimates: estimates.length,
    sentEstimates: sent,
    classifiedEstimates: sentClassified,
    unclassifiedEstimates: Math.max(0, sent - sentClassified),
    acceptedEstimates: accepted,
    declinedEstimates: declined,
    totalSentValue: totalValue,
    lastSyncAt: latestSync._max.lastSyncTime,
    recent: estimates
      .sort((a, b) => new Date(b.lastSyncTime).getTime() - new Date(a.lastSyncTime).getTime())
      .slice(0, 10)
      .map((e) => ({ estimateNumber: e.estimateNumber, customerName: e.customerName, total: e.total, status: e.status })),
  };
}
