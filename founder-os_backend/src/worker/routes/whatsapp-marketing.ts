// ─────────────────────────────────────────────────────────────────────────────
// routes/whatsapp-marketing.ts — WhatsApp Marketing campaigns + leads.
//
// Moved verbatim from routes/automations.ts (it never belonged to the
// automation registry API). Endpoints unchanged: /api/whatsapp-marketing/*.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, type Bindings } from '../context';
import { readBody } from '../http';
import {
  buildCampaignData,
  createCampaign,
  deleteCampaign,
  extractLeads,
  findCampaign,
  getCampaignDetail,
  importLeads,
  listCampaigns,
  pageLeads,
  updateCampaign,
} from '../../modules/whatsapp-marketing/store';

export function registerMarketingRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/whatsapp-marketing/campaigns', async (c) => {
    const { prisma, getCampaignStats } = deps();
    const campaigns = await listCampaigns(prisma);
    const rows = await Promise.all(campaigns.map(async (cc: any) => ({
      ...cc,
      stats: cc.statsJson ? JSON.parse(cc.statsJson) : await getCampaignStats(cc.id),
    })));
    return c.json(rows);
  });

  app.post('/api/whatsapp-marketing/campaigns', async (c) => {
    const { prisma } = deps();
    const body = await readBody(c);
    const data = buildCampaignData(body);
    if (!data.name) return c.json({ error: 'name is required' }, 400);
    const campaign = await createCampaign(prisma, data);
    return c.json(campaign, 201);
  });

  app.get('/api/whatsapp-marketing/campaigns/:id', async (c) => {
    const { prisma, getCampaignStats } = deps();
    const id = c.req.param('id');
    const detail = await getCampaignDetail(prisma, id);
    if (!detail) return c.json({ error: 'campaign not found' }, 404);
    return c.json({ campaign: detail.campaign, stats: await getCampaignStats(detail.campaign.id), leads: detail.leads });
  });

  app.patch('/api/whatsapp-marketing/campaigns/:id', async (c) => {
    const { prisma } = deps();
    const id = c.req.param('id');
    const existing = await findCampaign(prisma, id);
    if (!existing) return c.json({ error: 'campaign not found' }, 404);
    const body = await readBody(c);
    const campaign = await updateCampaign(prisma, id, buildCampaignData(body));
    return c.json(campaign);
  });

  app.delete('/api/whatsapp-marketing/campaigns/:id', async (c) => {
    const { prisma } = deps();
    await deleteCampaign(prisma, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/whatsapp-marketing/campaigns/:id/leads', async (c) => {
    const { prisma } = deps();
    const id = c.req.param('id');
    const campaign = await findCampaign(prisma, id);
    if (!campaign) return c.json({ error: 'campaign not found' }, 404);
    const contentType = c.req.header('content-type') || '';
    const raw = contentType.includes('text/plain') || contentType.includes('text/csv')
      ? await c.req.text()
      : JSON.stringify(await c.req.json().catch(() => ''));
    const { normalizePhone } = deps();
    const leads = extractLeads(raw, normalizePhone);
    if (!leads.length) return c.json({ error: 'no valid leads found (need phone column)' }, 400);
    const { created, skipped, total } = await importLeads(prisma, campaign.id, leads);
    return c.json({ created, skipped, total }, 201);
  });

  app.post('/api/whatsapp-marketing/campaigns/:id/run', async (c) => {
    const { prisma, executeCampaign } = deps();
    const id = c.req.param('id');
    const campaign = await findCampaign(prisma, id);
    if (!campaign) return c.json({ error: 'campaign not found' }, 404);
    const body = await readBody(c);
    const limit = body?.leadLimit ? Number(body.leadLimit) : 100;
    const result = await executeCampaign(campaign.id, { leadLimit: limit });
    return c.json({ ok: result.status !== 'failed', result });
  });

  app.get('/api/whatsapp-marketing/leads/:campaignId', async (c) => {
    const { prisma } = deps();
    const campaignId = c.req.param('campaignId');
    const status = c.req.query('status') || undefined;
    const take = Math.min(Number(c.req.query('limit')) || 100, 500);
    const skip = Number(c.req.query('offset')) || 0;
    const { leads, total } = await pageLeads(prisma, campaignId, { status, take, skip });
    return c.json({ leads, total, offset: skip, limit: take });
  });
}