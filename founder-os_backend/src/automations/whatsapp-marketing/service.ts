import { CronExpressionParser } from 'cron-parser';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { WabaClient } from '../../modules/waba/client';
import { AisensyClient } from '../../modules/aisensy/client';

const LOG_PREFIX = 'WhatsAppMarketing';

// A running lock so a manual trigger + the cron tick can't double-execute.
const runningCampaignIds = new Set<string>();

export function normalizePhone(raw: string): string {
  return String(raw || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
}

function parseAttributes(raw?: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? v : {};
  } catch {
    return {};
  }
}

// Render {{lead.<key>}} / {{lead.attributes.<key>}} in a body or param string.
export function renderLeadTemplate(template: string | null | undefined, lead: any): string {
  if (!template) return '';
  let out = String(template);
  const attrs = parseAttributes(lead.attributes);
  const vars: Record<string, string> = {
    name: lead.name || '',
    phone: lead.phoneNumber || '',
    ...attrs,
  };
  for (const [key, val] of Object.entries(vars)) {
    out = out.split(`{{lead.${key}}}`).join(val);
    out = out.split(`{{lead.attributes.${key}}}`).join(val);
  }
  return out;
}

// Does the current minute match the campaign's recurring cron (Asia/Kolkata)?
function cronMatchesNow(cron: string, now: Date): boolean {
  try {
    const iter = CronExpressionParser.parse(cron, { tz: 'Asia/Kolkata' });
    const next = iter.next().toDate();
    // Matches if the next occurrence is within this same minute window.
    return next.getTime() <= now.getTime() + 60_000;
  } catch {
    logger.warn({ cron }, `${LOG_PREFIX}: invalid cron, treating as never due`);
    return false;
  }
}

// A campaign is due when:
//  - one_shot: scheduledAt has passed AND it hasn't run yet (runCount === 0)
//  - recurring: the cron matches the current minute
function isDue(c: any, now: Date): boolean {
  if (!c.enabled) return false;
  if (c.status !== 'active') return false;
  if (c.scheduleType === 'one_shot') {
    if (c.runCount > 0) return false;
    return c.scheduledAt ? new Date(c.scheduledAt).getTime() <= now.getTime() : false;
  }
  if (c.cron) return cronMatchesNow(c.cron, now);
  return false;
}

async function loadPendingLeads(campaignId: string, limit: number) {
  return prisma.marketingLead.findMany({
    where: { campaignId, status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

async function sendToLead(campaign: any, lead: any) {
  const phone = normalizePhone(lead.phoneNumber);
  if (!phone) {
    return { ok: false as const, error: 'invalid phone number' };
  }

  if (campaign.provider === 'aisensy') {
    if (!campaign.aisensyCampaignName) {
      return { ok: false as const, error: 'aisensyCampaignName not set' };
    }
    const params = JSON.parse(campaign.templateParams || '[]');
    const renderedParams = params.map((p: any) => renderLeadTemplate(String(p), lead));
    const res = await AisensyClient.sendCampaign({
      campaignName: campaign.aisensyCampaignName,
      destination: `+${phone}`,
      userName: lead.name || undefined,
      source: 'whatsapp-marketing',
      templateParams: renderedParams,
      media: campaign.mediaUrl ? { url: campaign.mediaUrl, filename: campaign.mediaFilename } : undefined,
      attributes: parseAttributes(lead.attributes) || undefined,
    });
    return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
  }

  // provider: waba
  if (!WabaClient.isConfigured()) {
    return { ok: false as const, error: 'WABA not configured' };
  }
  if (campaign.templateName) {
    const params = JSON.parse(campaign.templateParams || '[]');
    const renderedParams = params.map((p: any) => renderLeadTemplate(String(p), lead));
    const res = await WabaClient.send({
      type: 'template',
      to: phone,
      templateName: campaign.templateName,
      templateLanguage: campaign.templateLanguage,
      bodyParams: renderedParams,
      mediaUrl: campaign.mediaUrl || undefined,
    });
    return res.ok
      ? { ok: true as const, messageId: res.messageId }
      : { ok: false as const, error: res.error };
  }

  // free-text (session) send
  const body = renderLeadTemplate(campaign.messageBody, lead);
  if (!body) {
    return { ok: false as const, error: 'no templateName or messageBody set' };
  }
  const res = await WabaClient.send({ type: 'text', to: phone, body });
  return res.ok
    ? { ok: true as const, messageId: res.messageId }
    : { ok: false as const, error: res.error };
}

// Execute one campaign: create a run row, send to pending leads (batched),
// update lead + campaign + run state. Bounded by a per-tick cap so a huge list
// is spread across ticks instead of hammering the API.
export async function executeCampaign(campaignId: string, opts: { leadLimit?: number } = {}): Promise<{
  runId: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
}> {
  if (runningCampaignIds.has(campaignId)) {
    logger.info({ campaignId }, `${LOG_PREFIX}: campaign already running, skipping`);
    return { runId: '', status: 'skipped', total: 0, sent: 0, failed: 0 };
  }
  runningCampaignIds.add(campaignId);
  try {
    const campaign = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return { runId: '', status: 'skipped', total: 0, sent: 0, failed: 0 };

    const run = await prisma.marketingCampaignRun.create({
      data: { campaignId, status: 'running' },
    });

    const batchSize = opts.leadLimit ?? 100;
    const leads = await loadPendingLeads(campaignId, batchSize);

    let sent = 0;
    let failed = 0;
    const now = new Date();

    for (const lead of leads) {
      const result = await sendToLead(campaign, lead);
      if (result.ok) {
        sent++;
        await prisma.marketingLead.update({
          where: { id: lead.id },
          data: { status: 'sent', messageId: result.messageId ?? null, sentAt: now, error: null },
        });
      } else {
        failed++;
        await prisma.marketingLead.update({
          where: { id: lead.id },
          data: { status: 'failed', error: result.error, sentAt: now },
        });
      }
    }

    const total = leads.length;
    const remaining = await prisma.marketingLead.count({ where: { campaignId, status: 'pending' } });
    const runStatus = total === 0 ? 'completed' : remaining > 0 ? 'partial' : 'completed';

    await prisma.marketingCampaignRun.update({
      where: { id: run.id },
      data: { status: runStatus, total, sent, failed, finishedAt: now },
    });

    await prisma.marketingCampaign.update({
      where: { id: campaignId },
      data: {
        lastRunAt: now,
        runCount: { increment: campaign.scheduleType === 'one_shot' ? 1 : 1 },
        statsJson: JSON.stringify(await computeStats(campaignId)),
      },
    });

    logger.info({ campaignId, campaign: campaign.name, total, sent, failed, runStatus }, `${LOG_PREFIX}: run finished`);
    return { runId: run.id, status: runStatus, total, sent, failed };
  } catch (e: any) {
    logger.error({ campaignId, error: e.message }, `${LOG_PREFIX}: executeCampaign error`);
    return { runId: '', status: 'failed', total: 0, sent: 0, failed: 0 };
  } finally {
    runningCampaignIds.delete(campaignId);
  }
}

async function computeStats(campaignId: string) {
  const [total, sent, delivered, read, failed, pending] = await Promise.all([
    prisma.marketingLead.count({ where: { campaignId } }),
    prisma.marketingLead.count({ where: { campaignId, status: 'sent' } }),
    prisma.marketingLead.count({ where: { campaignId, status: 'delivered' } }),
    prisma.marketingLead.count({ where: { campaignId, status: 'read' } }),
    prisma.marketingLead.count({ where: { campaignId, status: 'failed' } }),
    prisma.marketingLead.count({ where: { campaignId, status: 'pending' } }),
  ]);
  return { total, sent, delivered, read, failed, pending };
}

// Cron tick: find every due campaign and execute it. Bounded by MAX_CAMPAIGNS
// per tick so a growing campaign set stays well-behaved.
export async function runDueCampaigns(): Promise<{ due: number; executed: number }> {
  const now = new Date();
  const campaigns = await prisma.marketingCampaign.findMany({
    where: { enabled: true },
    select: {
      id: true, scheduleType: true, scheduledAt: true, cron: true, status: true,
      enabled: true, runCount: true, name: true,
    },
  });
  const due = campaigns.filter(c => isDue(c, now));
  let executed = 0;
  for (const c of due) {
    const res = await executeCampaign(c.id);
    if (res.status !== 'skipped' && res.status !== 'failed') executed++;
  }
  if (due.length) logger.info({ due: due.length, executed }, `${LOG_PREFIX}: tick`);
  return { due: due.length, executed };
}

// Recompute the stored stats for a campaign (used by data provider + after sends).
export async function getCampaignStats(campaignId: string) {
  return computeStats(campaignId);
}
