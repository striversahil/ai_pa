// ── Manual connected-call log ───────────────────────────────────────────────
// Hand-counted connected calls per agent per IST day + screenshot proof. The
// leaderboard reads these rows when Setting `call_source` = 'manual'; the
// default source is the auto dialer's DeviceCall rows.
import { prisma } from '../../shared/prisma';
import { cached, cacheDelPrefix } from '../../shared/cache';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDay(day: unknown): day is string {
  return typeof day === 'string' && DAY_RE.test(day);
}

export async function invalidateManualCallsCache(): Promise<void> {
  await Promise.all([
    cacheDelPrefix('manual-calls:'),
    cacheDelPrefix('telecalling:dashboard'),
  ]);
}

/** Raw rows for an inclusive IST range (no roster join — callers merge). */
export async function listManualCallRows(from: string, to: string): Promise<Array<Record<string, unknown>>> {
  const key = `manual-calls:range:${from}:${to}`;
  return cached(key, 60 * 1000, async () => {
    try {
      const rows: any[] = await (prisma as any).manualCallLog.findMany({
        where: { day: { gte: from, lte: to } },
        orderBy: [{ day: 'asc' }, { telecallerId: 'asc' }],
      });
      return (rows ?? []).map((r: any) => ({
        id: String(r.id ?? ''),
        telecallerId: String(r.telecallerId ?? ''),
        day: String(r.day ?? ''),
        connectedCalls: Math.max(0, Math.floor(Number(r.connectedCalls ?? 0) || 0)),
        note: String(r.note ?? ''),
        hasScreenshot: !!String(r.screenshotKvKey ?? ''),
        screenshotName: String(r.screenshotName ?? ''),
        screenshotMime: String(r.screenshotMime ?? ''),
        screenshotSize: Number(r.screenshotSize ?? 0) || 0,
        createdByName: String(r.createdByName ?? ''),
        updatedAt: r.updatedAt ?? null,
      }));
    } catch {
      return [];
    }
  });
}

/** Per-agent connected-call totals for a range: Map<telecallerId, sum>. */
export async function getManualCallsSum(from: string, to: string): Promise<Map<string, number>> {
  const rows = await listManualCallRows(from, to);
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = String((r as any).telecallerId ?? '');
    if (!id) continue;
    out.set(id, (out.get(id) ?? 0) + (Number((r as any).connectedCalls ?? 0) || 0));
  }
  return out;
}

/** Single-day lookup: Map<telecallerId, row>. */
export async function getManualCallsForDay(day: string): Promise<Map<string, Record<string, unknown>>> {
  const rows = await listManualCallRows(day, day);
  const out = new Map<string, Record<string, unknown>>();
  for (const r of rows) out.set(String((r as any).telecallerId ?? ''), r as Record<string, unknown>);
  return out;
}
