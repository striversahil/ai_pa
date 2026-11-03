// ── Manual connected-call log (TEMPORARY, founder 2026-11-04) ───────────────
// Backfill while NeoDove is unreliable: hand-counted connected calls per agent
// per IST day + screenshot proof. The leaderboard reads these rows INSTEAD of
// NeoDove while Setting `manual_calls_mode` = 'manual' (see service.ts).
// Delete this module + routes + tab when NeoDove is trusted again.
import { prisma } from '../../shared/prisma';
import { cached, cacheDelPrefix } from '../../shared/cache';

export const MANUAL_CALLS_MODE_KEY = 'manual_calls_mode';
export type ManualCallsMode = 'manual' | 'neodove';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDay(day: unknown): day is string {
  return typeof day === 'string' && DAY_RE.test(day);
}

export async function getManualCallsMode(): Promise<ManualCallsMode> {
  try {
    const row: any = await prisma.setting.findUnique({ where: { key: MANUAL_CALLS_MODE_KEY } });
    return String(row?.value ?? '').trim() === 'manual' ? 'manual' : 'neodove';
  } catch {
    return 'neodove';
  }
}

export async function setManualCallsMode(mode: unknown): Promise<ManualCallsMode> {
  const next: ManualCallsMode = mode === 'manual' ? 'manual' : 'neodove';
  const now = new Date().toISOString();
  try {
    await prisma.setting.upsert({
      where: { key: MANUAL_CALLS_MODE_KEY },
      update: { value: next, updatedAt: new Date(now) as any },
      create: { key: MANUAL_CALLS_MODE_KEY, value: next, updatedAt: new Date(now) as any } as any,
    });
  } catch {
    // D1 shim upsert may not support this shape — fall back to raw write.
    const db: any = (prisma as any).db ?? null;
    if (db?.prepare) {
      await db.prepare(
        `INSERT INTO Setting(key, value, updatedAt) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      ).bind(MANUAL_CALLS_MODE_KEY, next, now).run();
    }
  }
  await invalidateManualCallsCache();
  return next;
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
