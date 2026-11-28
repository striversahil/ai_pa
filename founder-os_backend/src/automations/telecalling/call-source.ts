// ── Connected-call source switch: manual | device ───────────────────────────
// The leaderboard reads exactly one source. `device` = Android auto-dialer call
// log rows (the default); `manual` = the hand-counted log with screenshot proof.
import { prisma } from '../../shared/prisma';
import { cacheDelPrefix } from '../../shared/cache';

export const CALL_SOURCE_KEY = 'call_source';
export type CallSource = 'manual' | 'device';

export async function getCallSource(): Promise<CallSource> {
  try {
    const row: any = await prisma.setting.findUnique({ where: { key: CALL_SOURCE_KEY } });
    return String(row?.value ?? '').trim() === 'manual' ? 'manual' : 'device';
  } catch {
    return 'device';
  }
}

export async function setCallSource(value: unknown): Promise<CallSource> {
  const next: CallSource = value === 'manual' ? 'manual' : 'device';
  const now = new Date().toISOString();
  await prisma.setting.upsert({
    where: { key: CALL_SOURCE_KEY },
    update: { value: next, updatedAt: new Date(now) as any },
    create: { key: CALL_SOURCE_KEY, value: next, updatedAt: new Date(now) as any } as any,
  });
  await Promise.all([cacheDelPrefix('telecalling:dashboard'), cacheDelPrefix('device-calls:')]);
  return next;
}
