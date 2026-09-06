// ─────────────────────────────────────────────────────────────────────────────
// routes/automations.ts — automation admin API + WhatsApp Marketing.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, getEntryOrReload, DASHBOARD_SLUGS, type Bindings } from '../context';

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function registerAutomationRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/automations', async (c) => {
    const { prisma } = deps();
    const rows = await prisma.automation.findMany({ orderBy: { createdAt: 'asc' } });
    const withDashboard = DASHBOARD_SLUGS;
    return c.json(rows.map((r: any) => ({
      id: r.id, slug: r.slug, name: r.name, description: r.description, type: r.type,
      enabled: r.enabled, cooldownMs: r.cooldownMs, lastRunAt: r.lastRunAt, runCount: r.runCount,
      hasDashboard: withDashboard.has(r.slug),
      trigger: parseJson(r.triggerJson), condition: parseJson(r.conditionJson),
      actions: parseJson(r.actionsJson), config: parseJson(r.configJson),
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    })));
  });

  app.get('/api/automations/:slug', async (c) => {
    const { prisma } = deps();
    const row = await prisma.automation.findUnique({
      where: { slug: c.req.param('slug') },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!row) return c.json({ error: 'automation not found' }, 404);
    return c.json({
      ...row,
      trigger: parseJson(row.triggerJson), condition: parseJson(row.conditionJson),
      actions: parseJson(row.actionsJson), config: parseJson(row.configJson),
    });
  });

  app.patch('/api/automations/:slug', async (c) => {
    const { prisma, AutomationEngine } = deps();
    const body = await c.req.json().catch(() => ({}));
    const data: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') { data.enabled = body.enabled; AutomationEngine.setEnabled(c.req.param('slug'), body.enabled); }
    if (typeof body.cooldownMs === 'number') { data.cooldownMs = Math.max(0, Math.floor(body.cooldownMs)); }
    if (Object.keys(data).length === 0) return c.json({ error: 'nothing to update (use enabled or cooldownMs)' }, 400);
    const row = await prisma.automation.update({ where: { slug: c.req.param('slug') }, data });
    return c.json(row);
  });

  app.get('/api/automations/:slug/data', async (c) => {
    const { AutomationEngine } = deps();
    try {
      if (!AutomationEngine.get(c.req.param('slug'))) await getEntryOrReload(c.req.param('slug'));
      const data = await AutomationEngine.getData(c.req.param('slug'), c.req.query());
      return c.json(data);
    } catch (e: any) {
      return c.json({ error: e?.message ?? 'no data provider' }, 404);
    }
  });
}

// ── WhatsApp Marketing (port of routes/whatsapp-marketing.ts) ───────────────
const PHONE_ALIASES = ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'number', 'whatsapp', 'whatsappno', 'contact', 'contactno', 'cell', 'cellno', 'telephone'];
const NAME_ALIASES = ['name', 'customername', 'companyname', 'company', 'clientname', 'client', 'leadname', 'contactname', 'businessname'];

function buildCampaignData(body: any): Record<string, any> {
  const data: Record<string, any> = {};
  if (body.name !== undefined) data.name = String(body.name);
  if (body.description !== undefined) data.description = body.description ? String(body.description) : null;
  if (body.type !== undefined) data.type = String(body.type);
  if (body.provider !== undefined) data.provider = String(body.provider);
  if (body.status !== undefined) data.status = String(body.status);
  if (body.scheduleType !== undefined) data.scheduleType = String(body.scheduleType);
  if (body.scheduledAt !== undefined) data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (body.cron !== undefined) data.cron = body.cron ? String(body.cron) : null;
  if (body.timezone !== undefined) data.timezone = String(body.timezone);
  if (body.templateName !== undefined) data.templateName = body.templateName ? String(body.templateName) : null;
  if (body.templateLanguage !== undefined) data.templateLanguage = String(body.templateLanguage);
  if (body.templateParams !== undefined) data.templateParams = typeof body.templateParams === 'string' ? body.templateParams : JSON.stringify(body.templateParams ?? []);
  if (body.messageBody !== undefined) data.messageBody = body.messageBody ? String(body.messageBody) : null;
  if (body.mediaUrl !== undefined) data.mediaUrl = body.mediaUrl ? String(body.mediaUrl) : null;
  if (body.mediaFilename !== undefined) data.mediaFilename = body.mediaFilename ? String(body.mediaFilename) : null;
  if (body.senderPhoneNumberId !== undefined) data.senderPhoneNumberId = body.senderPhoneNumberId ? String(body.senderPhoneNumberId) : null;
  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
  return data;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else current += ch;
    }
    values.push(current.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] ?? '').replace(/^"|"$/g, ''); });
    rows.push(row);
  }
  return rows;
}

function classifyLeadItem(item: Record<string, any>): { phone: string; name: string; attributes: Record<string, string> } {
  let phone = '';
  let name = '';
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(item)) {
    const nk = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    const val = (typeof v === 'string' || typeof v === 'number') ? String(v) : '';
    if (!phone && PHONE_ALIASES.includes(nk) && val) { phone = val; continue; }
    if (!name && NAME_ALIASES.includes(nk) && val) { name = val; continue; }
    if (val) attributes[k] = val;
  }
  return { phone, name, attributes };
}

function extractLeads(input: string): { phoneNumber: string; name?: string; attributes?: Record<string, string> }[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const leads: { phoneNumber: string; name?: string; attributes?: Record<string, string> }[] = [];
  const { normalizePhone } = deps();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: any;
    try { parsed = JSON.parse(trimmed); } catch { return []; }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of arr) {
      if (typeof item !== 'object' || item === null) continue;
      const cl = classifyLeadItem(item);
      const phone = normalizePhone(cl.phone);
      if (!phone) continue;
      leads.push({ phoneNumber: phone, name: cl.name || undefined, attributes: Object.keys(cl.attributes).length ? cl.attributes : undefined });
    }
    return leads;
  }
  for (const row of parseCsv(trimmed)) {
    const cl = classifyLeadItem(row);
    const phone = normalizePhone(cl.phone);
    if (!phone) continue;
    leads.push({ phoneNumber: phone, name: cl.name || undefined, attributes: Object.keys(cl.attributes).length ? cl.attributes : undefined });
  }
  return leads;
}

export function registerMarketingRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/whatsapp-marketing/campaigns', async (c) => {
    const { prisma, getCampaignStats } = deps();
    const campaigns = await prisma.marketingCampaign.findMany({ orderBy: { createdAt: 'desc' } });
    const rows = await Promise.all(campaigns.map(async (cc: any) => ({
      ...cc,
      stats: cc.statsJson ? JSON.parse(cc.statsJson) : await getCampaignStats(cc.id),
    })));
    return c.json(rows);
  });

  app.post('/api/whatsapp-marketing/campaigns', async (c) => {
    const { prisma } = deps();
    const body = await c.req.json().catch(() => ({}));
    const data = buildCampaignData(body);
    if (!data.name) return c.json({ error: 'name is required' }, 400);
    const campaign = await prisma.marketingCampaign.create({ data });
    return c.json(campaign, 201);
  });

  app.get('/api/whatsapp-marketing/campaigns/:id', async (c) => {
    const { prisma, getCampaignStats } = deps();
    const id = c.req.param('id');
    const campaign = await prisma.marketingCampaign.findUnique({
      where: { id },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 20 } },
    });
    if (!campaign) return c.json({ error: 'campaign not found' }, 404);
    const leads = await prisma.marketingLead.findMany({ where: { campaignId: campaign.id }, orderBy: { createdAt: 'desc' }, take: 200 });
    return c.json({ campaign, stats: await getCampaignStats(campaign.id), leads });
  });

  app.patch('/api/whatsapp-marketing/campaigns/:id', async (c) => {
    const { prisma } = deps();
    const id = c.req.param('id');
    const existing = await prisma.marketingCampaign.findUnique({ where: { id } });
    if (!existing) return c.json({ error: 'campaign not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const campaign = await prisma.marketingCampaign.update({ where: { id }, data: buildCampaignData(body) });
    return c.json(campaign);
  });

  app.delete('/api/whatsapp-marketing/campaigns/:id', async (c) => {
    const { prisma } = deps();
    await prisma.marketingCampaign.delete({ where: { id: c.req.param('id') } });
    return c.json({ ok: true });
  });

  app.post('/api/whatsapp-marketing/campaigns/:id/leads', async (c) => {
    const { prisma } = deps();
    const id = c.req.param('id');
    const campaign = await prisma.marketingCampaign.findUnique({ where: { id } });
    if (!campaign) return c.json({ error: 'campaign not found' }, 404);
    const contentType = c.req.header('content-type') || '';
    const raw = contentType.includes('text/plain') || contentType.includes('text/csv')
      ? await c.req.text()
      : JSON.stringify(await c.req.json().catch(() => ''));
    const leads = extractLeads(raw);
    if (!leads.length) return c.json({ error: 'no valid leads found (need phone column)' }, 400);
    let created = 0;
    let skipped = 0;
    for (const lead of leads) {
      try {
        await prisma.marketingLead.upsert({
          where: { campaignId_phoneNumber: { campaignId: campaign.id, phoneNumber: lead.phoneNumber } },
          update: { name: lead.name ?? undefined, attributes: lead.attributes ? JSON.stringify(lead.attributes) : undefined, status: 'pending', error: null, sentAt: null, deliveredAt: null, readAt: null },
          create: { campaignId: campaign.id, phoneNumber: lead.phoneNumber, name: lead.name, attributes: lead.attributes ? JSON.stringify(lead.attributes) : undefined },
        });
        created++;
      } catch (e: any) { skipped++; }
    }
    return c.json({ created, skipped, total: leads.length }, 201);
  });

  app.post('/api/whatsapp-marketing/campaigns/:id/run', async (c) => {
    const { prisma, executeCampaign } = deps();
    const id = c.req.param('id');
    const campaign = await prisma.marketingCampaign.findUnique({ where: { id } });
    if (!campaign) return c.json({ error: 'campaign not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
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
    const leads = await prisma.marketingLead.findMany({ where: { campaignId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' }, take, skip });
    const total = await prisma.marketingLead.count({ where: { campaignId, ...(status ? { status } : {}) } });
    return c.json({ leads, total, offset: skip, limit: take });
  });
}