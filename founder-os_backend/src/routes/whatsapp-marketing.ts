import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../shared/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { executeCampaign, getCampaignStats, normalizePhone } from '../automations/whatsapp-marketing/service';

const router = Router();

type CampaignInput = {
  name?: string;
  description?: string;
  type?: string;
  provider?: string;
  status?: string;
  scheduleType?: string;
  scheduledAt?: string | null;
  cron?: string | null;
  timezone?: string;
  templateName?: string | null;
  templateLanguage?: string;
  templateParams?: any;
  messageBody?: string | null;
  mediaUrl?: string | null;
  mediaFilename?: string | null;
  senderPhoneNumberId?: string | null;
  aisensyCampaignName?: string | null;
  enabled?: boolean;
};

function buildData(body: CampaignInput) {
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
  if (body.aisensyCampaignName !== undefined) data.aisensyCampaignName = body.aisensyCampaignName ? String(body.aisensyCampaignName) : null;
  if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
  return data;
}

// CSV parse (simple: header row + comma-separated values, supports quoted fields)
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
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

// Phone/name column aliases, matched case-insensitively after stripping
// non-alphanumerics (so "Phone no.", "Phone Number", "Mobile No.", "WhatsApp"
// all resolve to phone; "Name", "Customer Name", "Company" resolve to name).
const PHONE_ALIASES = ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'number', 'whatsapp', 'whatsappno', 'contact', 'contactno', 'cell', 'cellno', 'telephone'];
const NAME_ALIASES = ['name', 'customername', 'companyname', 'company', 'clientname', 'client', 'leadname', 'contactname', 'businessname'];

function normalizeKey(key: string): string {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Classify one lead row into { phone, name, attributes }. Any column that is
// not a phone/name alias is promoted into attributes (e.g. State, amount,
// email id.) so templates can use {{lead.State}} / {{lead.attributes.<key>}}.
function classifyLeadItem(item: Record<string, any>): { phone: string; name: string; attributes: Record<string, string> } {
  let phone = '';
  let name = '';
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(item)) {
    const nk = normalizeKey(k);
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

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: any;
    try { parsed = JSON.parse(trimmed); } catch { return []; }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of arr) {
      if (typeof item !== 'object' || item === null) continue;
      const c = classifyLeadItem(item);
      const phone = normalizePhone(c.phone);
      if (!phone) continue;
      leads.push({
        phoneNumber: phone,
        name: c.name || undefined,
        attributes: Object.keys(c.attributes).length ? c.attributes : undefined,
      });
    }
    return leads;
  }

  // CSV
  for (const row of parseCsv(trimmed)) {
    const c = classifyLeadItem(row);
    const phone = normalizePhone(c.phone);
    if (!phone) continue;
    leads.push({
      phoneNumber: phone,
      name: c.name || undefined,
      attributes: Object.keys(c.attributes).length ? c.attributes : undefined,
    });
  }
  return leads;
}

function str(v: any): string {
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
}

router.get('/campaigns', asyncHandler(async (_req, res) => {
  const campaigns = await prisma.marketingCampaign.findMany({ orderBy: { createdAt: 'desc' } });
  const rows = await Promise.all(campaigns.map(async (c) => ({
    ...c,
    stats: c.statsJson ? JSON.parse(c.statsJson) : await getCampaignStats(c.id),
  })));
  res.json(rows);
}));

router.post('/campaigns', asyncHandler(async (req, res) => {
  const data = buildData(req.body ?? {}) as Prisma.MarketingCampaignCreateInput;
  if (!data.name) { res.status(400).json({ error: 'name is required' }); return; }
  const campaign = await prisma.marketingCampaign.create({ data });
  res.status(201).json(campaign);
}));

router.get('/campaigns/:id', asyncHandler(async (req, res) => {
  const id = str(req.params.id);
  const campaign = await prisma.marketingCampaign.findUnique({
    where: { id },
    include: { runs: { orderBy: { startedAt: 'desc' }, take: 20 } },
  });
  if (!campaign) { res.status(404).json({ error: 'campaign not found' }); return; }
  const leads = await prisma.marketingLead.findMany({
    where: { campaignId: campaign.id },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json({ campaign, stats: await getCampaignStats(campaign.id), leads });
}));

router.patch('/campaigns/:id', asyncHandler(async (req, res) => {
  const id = str(req.params.id);
  const existing = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!existing) { res.status(404).json({ error: 'campaign not found' }); return; }
  const campaign = await prisma.marketingCampaign.update({
    where: { id },
    data: buildData(req.body ?? {}) as Prisma.MarketingCampaignUpdateInput,
  });
  res.json(campaign);
}));

router.delete('/campaigns/:id', asyncHandler(async (req, res) => {
  await prisma.marketingCampaign.delete({ where: { id: str(req.params.id) } });
  res.json({ ok: true });
}));

// Upload leads for a campaign — body is either raw JSON (array/object) or CSV text.
// Accepts text/plain, application/json, or multipart-free raw strings.
router.post('/campaigns/:id/leads', (req, res, next) => {
  // For text/plain the JSON body parser leaves req.body empty; read the stream.
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('text/plain') || contentType.includes('text/csv')) {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { raw += chunk; });
    req.on('end', () => {
      (req as any).rawBody = raw;
      next();
    });
    req.on('error', next);
  } else {
    next();
  }
}, asyncHandler(async (req, res) => {
  const id = str(req.params.id);
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!campaign) { res.status(404).json({ error: 'campaign not found' }); return; }

  const raw = (req as any).rawBody !== undefined
    ? (req as any).rawBody
    : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? ''));
  const leads = extractLeads(raw);
  if (!leads.length) { res.status(400).json({ error: 'no valid leads found (need phone column)' }); return; }

  let created = 0;
  let skipped = 0;
  for (const lead of leads) {
    try {
      await prisma.marketingLead.upsert({
        where: { campaignId_phoneNumber: { campaignId: campaign.id, phoneNumber: lead.phoneNumber } },
        update: {
          name: lead.name ?? undefined,
          attributes: lead.attributes ? JSON.stringify(lead.attributes) : undefined,
          status: 'pending',
          error: null,
          sentAt: null,
          deliveredAt: null,
          readAt: null,
        },
        create: {
          campaignId: campaign.id,
          phoneNumber: lead.phoneNumber,
          name: lead.name,
          attributes: lead.attributes ? JSON.stringify(lead.attributes) : undefined,
        },
      });
      created++;
    } catch (e: any) {
      skipped++;
    }
  }
  res.status(201).json({ created, skipped, total: leads.length });
}));

// Trigger a run immediately (manual send).
router.post('/campaigns/:id/run', asyncHandler(async (req, res) => {
  const id = str(req.params.id);
  const campaign = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!campaign) { res.status(404).json({ error: 'campaign not found' }); return; }
  const limit = req.body?.leadLimit ? Number(req.body.leadLimit) : 100;
  const result = await executeCampaign(campaign.id, { leadLimit: limit });
  res.json({ ok: result.status !== 'failed', result });
}));

router.get('/leads/:campaignId', asyncHandler(async (req, res) => {
  const campaignId = str(req.params.campaignId);
  const status = str(req.query.status) || undefined;
  const take = Math.min(Number(req.query.limit) || 100, 500);
  const skip = Number(req.query.offset) || 0;
  const leads = await prisma.marketingLead.findMany({
    where: { campaignId, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  });
  const total = await prisma.marketingLead.count({
    where: { campaignId, ...(status ? { status } : {}) },
  });
  res.json({ leads, total, offset: skip, limit: take });
}));

export default router;
