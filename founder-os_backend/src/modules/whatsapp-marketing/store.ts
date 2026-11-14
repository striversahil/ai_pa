// ── WhatsApp Marketing campaigns + leads: persistence + input shaping ──────
//
// Moved verbatim from worker/routes/whatsapp-marketing.ts (pure input shaping:
// buildCampaignData / CSV+JSON lead extraction) plus the campaign/lead CRUD the
// route ran inline. Routes keep validation, stats enrichment (getCampaignStats
// from deps), execution and responses; no HTTP or authz here.
//
// extractLeads takes its phone normalizer as an argument (the route passes
// deps().normalizePhone) so this module stays framework-free.
export interface LeadInput {
  phoneNumber: string;
  name?: string;
  attributes?: Record<string, string>;
}

const PHONE_ALIASES = ['phone', 'phoneno', 'phonenumber', 'mobile', 'mobileno', 'number', 'whatsapp', 'whatsappno', 'contact', 'contactno', 'cell', 'cellno', 'telephone'];
const NAME_ALIASES = ['name', 'customername', 'companyname', 'company', 'clientname', 'client', 'leadname', 'contactname', 'businessname'];

export function buildCampaignData(body: any): Record<string, any> {
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
  if (body.templateLanguage !== undefined) data.templateLanguage = body.templateLanguage;
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

export function extractLeads(input: string, normalizePhone: (phone: string) => string | null): LeadInput[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const leads: LeadInput[] = [];
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

export async function listCampaigns(prisma: any): Promise<any[]> {
  return prisma.marketingCampaign.findMany({ orderBy: { createdAt: 'desc' } });
}

export async function createCampaign(prisma: any, data: Record<string, any>): Promise<any> {
  return prisma.marketingCampaign.create({ data });
}

export async function findCampaign(prisma: any, id: string): Promise<any | null> {
  return prisma.marketingCampaign.findUnique({ where: { id } });
}

export async function getCampaignDetail(prisma: any, id: string): Promise<{ campaign: any; leads: any[] } | null> {
  const campaign = await prisma.marketingCampaign.findUnique({
    where: { id },
    include: { runs: { orderBy: { startedAt: 'desc' }, take: 20 } },
  });
  if (!campaign) return null;
  const leads = await prisma.marketingLead.findMany({ where: { campaignId: campaign.id }, orderBy: { createdAt: 'desc' }, take: 200 });
  return { campaign, leads };
}

export async function updateCampaign(prisma: any, id: string, data: Record<string, any>): Promise<any> {
  return prisma.marketingCampaign.update({ where: { id }, data });
}

export async function deleteCampaign(prisma: any, id: string): Promise<void> {
  await prisma.marketingCampaign.delete({ where: { id } });
}

export async function importLeads(
  prisma: any,
  campaignId: string,
  leads: LeadInput[],
): Promise<{ created: number; skipped: number; total: number }> {
  let created = 0;
  let skipped = 0;
  for (const lead of leads) {
    try {
      await prisma.marketingLead.upsert({
        where: { campaignId_phoneNumber: { campaignId, phoneNumber: lead.phoneNumber } },
        update: { name: lead.name ?? undefined, attributes: lead.attributes ? JSON.stringify(lead.attributes) : undefined, status: 'pending', error: null, sentAt: null, deliveredAt: null, readAt: null },
        create: { campaignId, phoneNumber: lead.phoneNumber, name: lead.name, attributes: lead.attributes ? JSON.stringify(lead.attributes) : undefined },
      });
      created++;
    } catch { skipped++; }
  }
  return { created, skipped, total: leads.length };
}

export async function pageLeads(
  prisma: any,
  campaignId: string,
  opts: { status?: string; take: number; skip: number },
): Promise<{ leads: any[]; total: number }> {
  const where = { campaignId, ...(opts.status ? { status: opts.status } : {}) };
  const [leads, total] = await Promise.all([
    prisma.marketingLead.findMany({ where, orderBy: { createdAt: 'desc' }, take: opts.take, skip: opts.skip }),
    prisma.marketingLead.count({ where }),
  ]);
  return { leads, total };
}
