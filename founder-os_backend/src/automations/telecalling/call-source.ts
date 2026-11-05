// ── Connected-call source switch: neodove | manual | device ─────────────────
// The leaderboard reads exactly one source. `device` = Android call log rows.
import { prisma } from '../../shared/prisma';
import { cacheDelPrefix } from '../../shared/cache';

export const CALL_SOURCE_KEY = 'call_source';
export type CallSource = 'neodove' | 'manual' | 'device';

export async function getCallSource(): Promise<CallSource> {
  try {
    const row: any = await prisma.setting.findUnique({ where: { key: CALL_SOURCE_KEY } });
    const value = String(row?.value ?? '').trim();
    if (value === 'manual' || value === 'device') return value;
    return 'neodove';
  } catch {
    return 'neodove';
  }
}

export async function setCallSource(value: unknown): Promise<CallSource> {
  const next: CallSource = value === 'manual' ? 'manual' : value === 'device' ? 'device' : 'neodove';
  const now = new Date().toISOString();
  await prisma.setting.upsert({
    where: { key: CALL_SOURCE_KEY },
    update: { value: next, updatedAt: new Date(now) as any },
    create: { key: CALL_SOURCE_KEY, value: next, updatedAt: new Date(now) as any } as any,
  });
  await Promise.all([cacheDelPrefix('telecalling:dashboard'), cacheDelPrefix('device-calls:')]);
  return next;
}
