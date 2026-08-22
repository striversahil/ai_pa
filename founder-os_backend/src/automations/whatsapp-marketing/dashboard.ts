import { prisma } from '../../shared/prisma';
import type { AutomationContext } from '../../modules/automation/types';
import { getCampaignStats, normalizePhone } from './service';
import { WabaClient } from '../../modules/waba/client';

// GET /api/automations/whatsapp-marketing/data
export async function getMarketingDashboardData(ctx: AutomationContext): Promise<any> {
  const [campaigns, totalLeads, recentRuns] = await Promise.all([
    prisma.marketingCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        runs: { orderBy: { startedAt: 'desc' }, take: 3 },
      },
    }),
    prisma.marketingLead.count(),
    prisma.marketingCampaignRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
  ]);

  const campaignRows = await Promise.all(
    campaigns.map(async (c) => {
      const stats = c.statsJson ? JSON.parse(c.statsJson) : await getCampaignStats(c.id);
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        type: c.type,
        provider: c.provider,
        status: c.status,
        scheduleType: c.scheduleType,
        scheduledAt: c.scheduledAt,
        cron: c.cron,
        timezone: c.timezone,
        templateName: c.templateName,
        messageBody: c.messageBody,
        mediaUrl: c.mediaUrl,
        enabled: c.enabled,
        lastRunAt: c.lastRunAt,
        runCount: c.runCount,
        stats,
        recentRuns: c.runs,
      };
    })
  );

  const byStatus = (s: string) => campaignRows.filter((c) => c.status === s).length;

  return {
    meta: { analysis: 'marketing', generatedAt: new Date().toISOString() },
    kpis: {
      campaigns: campaignRows.length,
      active: byStatus('active'),
      draft: byStatus('draft'),
      paused: byStatus('paused'),
      completed: byStatus('completed'),
      totalLeads,
      providers: {
        waba: { configured: WabaClient.isConfigured() },
      },
    },
    campaigns: campaignRows,
    recentRuns,
  };
}

export { normalizePhone, getCampaignStats };
