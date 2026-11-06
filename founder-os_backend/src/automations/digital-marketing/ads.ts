import { prisma } from '../../shared/prisma';
import { cached } from '../../shared/cache';

// ── ADS tab: unified read-only ad history (DMM logs only) ────────────────────
// Sources (per founder decision):
//   Meta     = dmm-06 logs → Start=metricsJson.fromDate, End=metricsJson.toDate
//              (fallback to dueDate single-day when the window is blank/invalid)
//   WhatsApp = dmm-08 logs → Start=End=dueDate (single-day rows)
//   Email    = dmm-09 logs → Start=End=dueDate (single-day rows)
// No new writes — derived from existing DigitalMarketingTaskLog rows.
// Mirror: frontend src/components/DigitalMarketingAds.tsx renders this shape.

export type AdType = 'meta' | 'whatsapp' | 'email';

export interface AdRow {
  id: string;
  type: AdType;
  title: string;
  startDate: string;
  endDate: string;
  durationDays: number | null;
  spend: number | null;
  volume: number | null;
  volumeLabel: string;
  leads: number | null;
  inquiries: number | null;
  category: string | null;
  dataSource: string | null;
  status: string;
  dueDate: string;
  logId: string;
  doneBy: string | null;
  remark: string | null;
  proofCount: number;
}

const ADS_TTL_MS = 5 * 60 * 1000;
const ADS_CACHE_KEY = 'digital-marketing:dashboard:ads:all';

function parseMetricsJson(raw: unknown): Record<string, any> {
  if (!raw) return {};
  try {
    const o = typeof raw === 'string' ? JSON.parse(String(raw)) : raw;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, any>) : {};
  } catch { return {}; }
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isDay(s: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').slice(0, 10));
}

function durationDaysBetween(from: string, to: string): number | null {
  if (!isDay(from) || !isDay(to)) return null;
  const ms = Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10));
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 86400000) + 1;
}

async function computeAds(): Promise<{ rows: AdRow[]; total: number; generatedAt: string }> {
  const logs = await (prisma as any).digitalMarketingTaskLog.findMany({
    where: { templateId: { in: ['dmm-06', 'dmm-08', 'dmm-09'] } },
    orderBy: { dueDate: 'desc' },
    take: 1000,
  }).catch(() => []);
  const ids = (logs as any[]).map((l) => String(l.id)).filter(Boolean);
  const files = ids.length
    ? await (prisma as any).digitalMarketingTaskAttachment.findMany({
      where: { logId: { in: ids } },
      select: { logId: true },
    }).catch(() => [])
    : [];
  const proofByLog = new Map<string, number>();
  for (const f of files as any[]) {
    const k = String((f as any).logId);
    proofByLog.set(k, (proofByLog.get(k) ?? 0) + 1);
  }
  const rows: AdRow[] = [];
  for (const l of logs as any[]) {
    const tid = String((l as any).templateId);
    const m = parseMetricsJson((l as any).metricsJson);
    const due = String((l as any).dueDate).slice(0, 10);
    const logId = String((l as any).id);
    const base = {
      id: logId,
      logId,
      dueDate: due,
      status: String((l as any).status ?? 'pending'),
      doneBy: (l as any).doneBy ?? null,
      remark: (l as any).remark ?? null,
      proofCount: proofByLog.get(logId) ?? 0,
    };
    if (tid === 'dmm-06') {
      const f = String((m as any).fromDate ?? '').slice(0, 10);
      const t = String((m as any).toDate ?? '').slice(0, 10);
      const hasWindow = isDay(f) && isDay(t) && f <= t;
      const start = hasWindow ? f : due;
      const end = hasWindow ? t : due;
      rows.push({
        ...base,
        type: 'meta',
        title: 'Meta Ads Run',
        startDate: start,
        endDate: end,
        durationDays: durationDaysBetween(start, end),
        spend: numOrNull((m as any).amountSpent ?? (m as any).amount),
        volume: numOrNull((m as any).inquiries),
        volumeLabel: 'Inquiries',
        leads: numOrNull((m as any).leads),
        inquiries: numOrNull((m as any).inquiries),
        category: (m as any).category ?? null,
        dataSource: null,
      });
    } else if (tid === 'dmm-08') {
      rows.push({
        ...base,
        type: 'whatsapp',
        title: 'Whatsapp Marketing',
        startDate: due,
        endDate: due,
        durationDays: 1,
        spend: numOrNull((m as any).amountSpent ?? (m as any).amount),
        volume: numOrNull((m as any).whatsappCount),
        volumeLabel: 'Sent',
        leads: numOrNull((m as any).whatsappLeads ?? (m as any).leads),
        inquiries: null,
        category: null,
        dataSource: (m as any).dataSource ?? null,
      });
    } else if (tid === 'dmm-09') {
      rows.push({
        ...base,
        type: 'email',
        title: 'Email Marketing',
        startDate: due,
        endDate: due,
        durationDays: 1,
        spend: null,
        volume: numOrNull((m as any).emailCount),
        volumeLabel: 'Sent',
        leads: numOrNull((m as any).emailLeads ?? (m as any).leads),
        inquiries: null,
        category: null,
        dataSource: (m as any).dataSource ?? null,
      });
    }
  }
  rows.sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : 0));
  return { rows, total: rows.length, generatedAt: new Date().toISOString() };
}

export async function getDigitalMarketingAds(): Promise<{ rows: AdRow[]; total: number; generatedAt: string }> {
  return cached(ADS_CACHE_KEY, ADS_TTL_MS, computeAds);
}
