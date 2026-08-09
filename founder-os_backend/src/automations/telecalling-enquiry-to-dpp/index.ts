import { prisma } from '../../shared/prisma';
import type { AutomationContext, ScanRecord } from '../../modules/automation/types';

/**
 * Fallback scanner: when the backend missed the live event (was down at ingest),
 * pick up recent inbound messages in the telecalling group. Dedup on
 * wahaMessageId means anything already forwarded is skipped.
 */
export async function scanner(ctx: AutomationContext): Promise<ScanRecord[]> {
  const teleGroup = String(ctx.config.teleGroupChatId ?? '');
  if (!teleGroup) return [];

  const since = new Date(Date.now() - 15 * 60 * 1000);
  const rows = await prisma.message.findMany({
    where: { chatId: teleGroup, timestamp: { gte: since } },
    orderBy: { timestamp: 'asc' },
    take: 50,
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
