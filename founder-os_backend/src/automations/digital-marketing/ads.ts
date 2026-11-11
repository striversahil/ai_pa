import { prisma } from '../../shared/prisma';
import { cached } from '../../shared/cache';
import { invalidateDigitalMarketingCache } from './service';

// ── ADS tab: manual ad-run registry (migration 0113) ─────────────────────────
// Registry-only: the executive creates each run via New Ad Run (type, title,
// mandatory start/end dates, spend, data description + data file). Results
// (leads + enquiries totals) are edited daily in place on the same row.
// Status: planned | live | completed (auto-derived from dates, manually
// overridable). Mirror: frontend src/components/DigitalMarketingAds.tsx.

export const AD_TYPES = ['google', 'meta', 'whatsapp', 'email', 'twitter', 'other'] as const;
export type AdType = (typeof AD_TYPES)[number];
export type AdStatus = 'planned' | 'live' | 'completed';

export interface AdAttachmentJson {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  uploadedBy: string;
  createdAt: string;
  url: string;
}

export interface AdRow {
  id: string;
  type: AdType;
  title: string;
  startDate: string;
  endDate: string;
  durationDays: number | null;
  amountSpent: number;
  leads: number;
  enquiries: number;
  dataDescription: string;
  status: AdStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AdAttachmentJson[];
}

const ADS_TTL_MS = 5 * 60 * 1000;
const ADS_CACHE_KEY = 'digital-marketing:dashboard:ads:registry';

export function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).slice(0, 10);
}

function isDay(s: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').slice(0, 10));
}

function durationDaysBetween(from: string, end: string): number | null {
  if (!isDay(from) || !isDay(end)) return null;
  const ms = Date.parse(end.slice(0, 10)) - Date.parse(from.slice(0, 10));
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 86400000) + 1;
}

export function deriveStatus(startDate: string, endDate: string, today = istToday()): AdStatus {
  if (today < startDate) return 'planned';
  if (today > endDate) return 'completed';
  return 'live';
}

/** Effective status: `completed` is sticky (manual early close never reopens);
 *  planned/live always follow the dates, so a run flips to completed the day
 *  after its endDate passes with no edit needed.
 */
export function effectiveStatus(stored: unknown, startDate: string, endDate: string, today = istToday()): AdStatus {
  if (stored === 'completed') return 'completed';
  return deriveStatus(startDate, endDate, today);
}

function toAttachmentJson(row: any): AdAttachmentJson {
  return {
    id: String(row?.id ?? ''),
    fileName: String(row?.fileName ?? ''),
    mime: String(row?.mime ?? 'application/octet-stream'),
    size: Number(row?.size ?? 0),
    uploadedBy: String(row?.uploadedBy ?? ''),
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : String(row?.createdAt ?? ''),
    url: `/api/digital-marketing/ads/files/${String(row?.id ?? '')}`,
  };
}

function toAdJson(ad: any, files: any[]): AdRow {
  const start = String(ad.startDate ?? '').slice(0, 10);
  const end = String(ad.endDate ?? '').slice(0, 10);
  const rawStatus = (['planned', 'live', 'completed'] as string[]).includes(String(ad.status))
    ? ad.status as AdStatus
    : deriveStatus(start, end);
  return {
    id: String(ad.id),
    type: (AD_TYPES as readonly string[]).includes(String(ad.type)) ? ad.type as AdType : 'other',
    title: String(ad.title ?? ''),
    startDate: start,
    endDate: end,
    durationDays: durationDaysBetween(start, end),
    amountSpent: Number(ad.amountSpent ?? 0),
    leads: Number(ad.leads ?? 0),
    enquiries: Number(ad.enquiries ?? 0),
    dataDescription: String(ad.dataDescription ?? ''),
    status: effectiveStatus(rawStatus, start, end),
    createdBy: ad.createdBy ?? null,
    createdAt: ad.createdAt instanceof Date ? ad.createdAt.toISOString() : String(ad.createdAt ?? ''),
    updatedAt: ad.updatedAt instanceof Date ? ad.updatedAt.toISOString() : String(ad.updatedAt ?? ''),
    attachments: (files as any[]).map(toAttachmentJson),
  };
}

async function computeAds(): Promise<{ rows: AdRow[]; total: number; generatedAt: string }> {
  const ads = await (prisma as any).digitalMarketingAd.findMany({
    orderBy: { startDate: 'desc' },
    take: 500,
  }).catch(() => []);
  const ids = (ads as any[]).map((a) => String(a.id)).filter(Boolean);
  const files = ids.length
    ? await (prisma as any).digitalMarketingAdAttachment.findMany({
      where: { adId: { in: ids } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => [])
    : [];
  const byAd = new Map<string, any[]>();
  for (const f of files as any[]) {
    const k = String(f.adId);
    if (!byAd.has(k)) byAd.set(k, []);
    byAd.get(k)!.push(f);
  }
  const rows = (ads as any[]).map((a) => toAdJson(a, byAd.get(String(a.id)) ?? []));
  // Live first, then newest start.
  const rank = (s: AdStatus) => (s === 'live' ? 0 : s === 'planned' ? 1 : 2);
  rows.sort((a, b) => rank(a.status) - rank(b.status) || (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  return { rows, total: rows.length, generatedAt: new Date().toISOString() };
}

export async function getDigitalMarketingAds(): Promise<{ rows: AdRow[]; total: number; generatedAt: string }> {
  return cached(ADS_CACHE_KEY, ADS_TTL_MS, computeAds);
}

function cleanNum(v: unknown, field: string): number {
  if (v === null || v === undefined || v === '') throw new Error(`${field} required`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a number >= 0`);
  return field === 'amountSpent' ? n : Math.floor(n);
}

function cleanAdInput(input: Record<string, any>, partial = false) {
  const data: Record<string, any> = {};
  if (input.type !== undefined || !partial) {
    const t = String(input.type || '').toLowerCase().trim();
    if (!(AD_TYPES as readonly string[]).includes(t)) throw new Error(`type must be ${AD_TYPES.join('|')}`);
    data.type = t;
  }
  if (input.title !== undefined || !partial) {
    const title = String(input.title || '').trim().slice(0, 200);
    if (!title && !partial) throw new Error('title required');
    if (title) data.title = title;
  }
  if (input.startDate !== undefined || !partial) {
    const s = String(input.startDate || '').slice(0, 10);
    if (!isDay(s) && !partial) throw new Error('startDate required (YYYY-MM-DD)');
    if (s) {
      if (!isDay(s)) throw new Error('startDate must be YYYY-MM-DD');
      data.startDate = s;
    }
  }
  if (input.endDate !== undefined || !partial) {
    const e = String(input.endDate || '').slice(0, 10);
    if (!isDay(e) && !partial) throw new Error('endDate required (YYYY-MM-DD)');
    if (e) {
      if (!isDay(e)) throw new Error('endDate must be YYYY-MM-DD');
      data.endDate = e;
    }
  }
  if (input.amountSpent !== undefined) data.amountSpent = cleanNum(input.amountSpent, 'amountSpent');
  else if (!partial) data.amountSpent = 0;
  if (input.leads !== undefined) data.leads = cleanNum(input.leads, 'leads');
  else if (!partial) data.leads = 0;
  if (input.enquiries !== undefined) data.enquiries = cleanNum(input.enquiries, 'enquiries');
  else if (!partial) data.enquiries = 0;
  if (input.dataDescription !== undefined || !partial) {
    const d = String(input.dataDescription || '').trim().slice(0, 2000);
    if (!d && !partial) throw new Error('dataDescription required (describe the data used)');
    if (d || !partial) data.dataDescription = d;
  }
  if (input.status !== undefined) {
    const s = String(input.status);
    if (!['planned', 'live', 'completed'].includes(s)) throw new Error('status must be planned|live|completed');
    data.status = s;
  }
  return data;
}

export async function createAd(input: Record<string, any>, createdBy: string | null) {
  const data = cleanAdInput(input);
  const end = String(data.endDate ?? input.endDate ?? '').slice(0, 10);
  const start = String(data.startDate ?? input.startDate ?? '').slice(0, 10);
  if (end < start) throw new Error('endDate must be on or after startDate');
  if (!data.status) data.status = deriveStatus(start, end);
  const row = await (prisma as any).digitalMarketingAd.create({
    data: { ...data, createdBy: createdBy ? String(createdBy).slice(0, 200) : null },
  });
  await invalidateDigitalMarketingCache();
  return row;
}

export async function updateAd(id: string, input: Record<string, any>) {
  const current: any = await (prisma as any).digitalMarketingAd.findUnique({ where: { id } });
  if (!current) throw new Error('ad not found');
  const data = cleanAdInput(input, true);
  const start = String(data.startDate ?? current.startDate ?? '').slice(0, 10);
  const end = String(data.endDate ?? current.endDate ?? '').slice(0, 10);
  if (end < start) throw new Error('endDate must be on or after startDate');
  // Keep status in sync with dates unless explicitly overridden. `completed`
  // stays sticky (manual early close); otherwise re-derive so a past-due run
  // flips live → completed on any edit, and the list view derives it anyway.
  if (data.status === undefined) {
    data.status = String(current.status) === 'completed' ? 'completed' : deriveStatus(start, end);
  }
  const row = await (prisma as any).digitalMarketingAd.update({ where: { id }, data });
  await invalidateDigitalMarketingCache();
  return row;
}

export async function deleteAd(id: string) {
  const files: any[] = await (prisma as any).digitalMarketingAdAttachment.findMany({ where: { adId: id } }).catch(() => []);
  await (prisma as any).digitalMarketingAdAttachment.deleteMany({ where: { adId: id } }).catch(() => {});
  await (prisma as any).digitalMarketingAd.delete({ where: { id } });
  await invalidateDigitalMarketingCache();
  return { ok: true as const, attachments: files };
}

export async function createAdAttachment(input: {
  adId: string; fileName: string; mime: string; size: number; kvKey: string; uploadedBy: string | null;
}) {
  const ad: any = await (prisma as any).digitalMarketingAd.findUnique({ where: { id: input.adId } });
  if (!ad) throw new Error('ad not found');
  const row = await (prisma as any).digitalMarketingAdAttachment.create({
    data: {
      adId: input.adId,
      fileName: input.fileName.slice(0, 200),
      mime: input.mime,
      size: Math.max(0, Math.floor(input.size)),
      kvKey: input.kvKey,
      uploadedBy: String(input.uploadedBy || '').slice(0, 200),
      createdAt: new Date(),
    },
  });
  await invalidateDigitalMarketingCache();
  return row;
}

export async function getAdAttachment(id: string) {
  return (prisma as any).digitalMarketingAdAttachment.findUnique({ where: { id } });
}

export async function deleteAdAttachment(id: string) {
  const row: any = await (prisma as any).digitalMarketingAdAttachment.findUnique({ where: { id } });
  if (!row) throw new Error('Attachment not found');
  await (prisma as any).digitalMarketingAdAttachment.delete({ where: { id } });
  await invalidateDigitalMarketingCache();
  return row;
}

export { toAttachmentJson as toAdAttachmentJson };
