import { prisma } from '../../shared/prisma';
import type { AutomationContext, ScanRecord } from '../../modules/automation/types';

/**
 * Lenient price-line parser. Accepts common DPP formats:
 *   "Brick - 4500", "Cement: ₹380", "Steel – 5200"
 * Format is documented in README.md; adjust here to match the real messages.
 */
function parsePriceLine(line: string): { item: string; price: number; raw: string } | null {
  const m = line.match(/^(.+?)\s*[-:–]\s*([₹$]?\s*[\d,]+(?:\.\d+)?)$/i);
  if (!m) return null;
  const item = m[1].trim();
  const price = parseFloat(m[2].replace(/[₹$,]/g, '').trim());
  if (!item || Number.isNaN(price)) return null;
  return { item, price, raw: line };
}

/** Fallback scanner: catch DPP price messages if the live event was missed. */
export async function scanner(ctx: AutomationContext): Promise<ScanRecord[]> {
  const dppChatId = String(ctx.config.dppChatId ?? '');
  if (!dppChatId) return [];

  const since = new Date(Date.now() - 10 * 60 * 1000);
  const rows = await prisma.message.findMany({
    where: { chatId: dppChatId, timestamp: { gte: since } },
    orderBy: { timestamp: 'asc' },
    take: 20,
    select: { id: true, wahaMessageId: true, chatId: true, sender: true, body: true, timestamp: true },
  });

  return rows.map((r) => ({
    wahaMessageId: r.wahaMessageId ?? r.id,
    chatId: r.chatId,
    sender: r.sender,
    body: r.body,
    timestamp: r.timestamp.toISOString(),
  }));
}

export const actions = {
  async storePrices(ctx: AutomationContext) {
    const subject = ctx.subject as any;
    const body = String(subject.body ?? '');
    const messageId = String(subject.wahaMessageId ?? subject.id ?? `m_${Date.now()}`);
    const dppChatId = String(subject.chatId ?? ctx.config.dppChatId ?? '');
    const quotedAt = subject.timestamp ? new Date(subject.timestamp) : new Date();

    let saved = 0;
    for (const line of body.split('\n').map((l: string) => l.trim()).filter(Boolean)) {
      const parsed = parsePriceLine(line);
      if (!parsed) continue;
      await prisma.priceQuote.upsert({
        where: { messageId: `${messageId}:${parsed.item}` },
        create: {
          messageId: `${messageId}:${parsed.item}`,
          dppChatId,
          itemName: parsed.item,
          unitPrice: parsed.price,
          rawLine: parsed.raw,
          quotedAt,
        },
        update: {},
      });
      saved++;
    }
    ctx.log('info', 'DPP price message parsed', { dppChatId, saved, body });
  },
};

/** Dashboard data provider: `GET /api/automations/dpp-prices-dashboard/data`. */
export async function data() {
  const totalQuotes = await prisma.priceQuote.count();
  const latest = await prisma.priceQuote.findFirst({ orderBy: { quotedAt: 'desc' } });
  const byItem = await prisma.priceQuote.groupBy({
    by: ['itemName'],
    _count: { _all: true },
    _avg: { unitPrice: true },
    orderBy: { _count: { itemName: 'desc' } },
    take: 100,
  });

  return {
    totalQuotes,
    distinctItems: byItem.length,
    latestQuoteAt: latest?.quotedAt ?? null,
    lastQuote: latest ? { item: latest.itemName, price: latest.unitPrice, currency: latest.currency } : null,
    items: byItem.map((i) => ({ itemName: i.itemName, timesQuoted: i._count._all, avgPrice: i._avg.unitPrice })),
  };
}
