import { prisma } from '../../shared/prisma';
import { SalesCopilotService } from './service';

export async function handler() {
  await new SalesCopilotService().runSync();
}

import { PENDING_AI_MARKER } from './service';

/**
 * Dashboard data provider — `GET /api/automations/zoho-sent-analyzer/data`.
 * KPI summary of the Zoho sent-estimate pipeline. The full interactive board
 * lives in the frontend (founder-os_frontend ZohoEstimates), which reads the
 * same estimate rows via GET /api/estimates.
 */
export async function data() {
  const where = { OR: [{ status: 'sent' }, { status: 'accepted' }, { status: 'declined' }, { status: 'confirmed' }] };
  // "Accepted" KPI replaced by live Zoho Books sales orders created today (IST),
  // fetched with the same curl credentials as the estimates sync (5-min refresh).
  const [estimates, sent, sentClassifiedRaw, pendingAiCount, declined, lastCompleteSync, salesOrdersToday] = await Promise.all([
    prisma.estimate.findMany({ where, select: { estimateId: true, estimateNumber: true, customerName: true, total: true, status: true, lastSyncTime: true } }),
    prisma.estimate.count({ where: { status: 'sent' } }),
    prisma.estimate.count({ where: { status: 'sent', classification: { isNot: null } } }),
    prisma.classification.count({ where: { reasoning: PENDING_AI_MARKER } }),
    prisma.estimate.count({ where: { status: 'declined' } }),
    prisma.setting.findUnique({ where: { key: 'sales_copilot:last_complete_sync_at' } }),
    new SalesCopilotService().getActiveSalesOrdersToday(),
  ]);

  const totalValue = estimates.filter((e) => e.status === 'sent').reduce((sum, e) => sum + e.total, 0);
  const classifiedEstimates = Math.max(0, sentClassifiedRaw - pendingAiCount);

  return {
    totalEstimates: estimates.length,
    sentEstimates: sent,
    classifiedEstimates,
    unclassifiedEstimates: Math.max(0, sent - classifiedEstimates),
    pendingAiEstimates: pendingAiCount,
    activeSalesOrdersToday: salesOrdersToday.count,
    salesOrdersTodayValue: salesOrdersToday.totalValue,
    salesOrdersTodayStatuses: salesOrdersToday.statuses,
    salesOrdersTodayOrders: salesOrdersToday.orders,
    declinedEstimates: declined,
    totalSentValue: totalValue,
    // Only the last fully-completed processing pass counts as "last synced" —
    // not a partial/incremental sync run. Null until the first complete pass.
    lastSyncAt: lastCompleteSync?.value ? new Date(lastCompleteSync.value) : null,
    recent: estimates
      .sort((a, b) => new Date(b.lastSyncTime).getTime() - new Date(a.lastSyncTime).getTime())
      .slice(0, 10)
      .map((e) => ({ estimateNumber: e.estimateNumber, customerName: e.customerName, total: e.total, status: e.status })),
  };
}
