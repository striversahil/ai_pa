// status-sync.ts — Zoho status transitions, shared by Worker + Express.
// Every move in any direction flows through applyStatusUpdates so
// accepted/confirmed flips always credit the telecalling close ledger
// (recordConversionClose is idempotent — safe on replays/duplicates).
// Declines carry no ledger entry (penalty retired) — status sync only.
import { prisma } from '../../shared/prisma';

export interface StatusTransition {
  estimateId: string;
  status: string;
}

const CLOSE_STATUSES = new Set(['accepted', 'confirmed']);

export async function applyStatusUpdates(
  updates: StatusTransition[],
): Promise<{ updated: number; closesCredited: number }> {
  let updated = 0;
  let closesCredited = 0;
  for (const u of updates || []) {
    if (!u?.estimateId || !u?.status) continue;
    await (prisma as any).estimate.update({
      where: { estimateId: String(u.estimateId) },
      data: { status: String(u.status), lastSyncTime: new Date() },
    });
    if (CLOSE_STATUSES.has(String(u.status).toLowerCase())) {
      try {
        const { recordConversionClose } = await import('../../automations/telecalling/service');
        if (await recordConversionClose(String(u.estimateId))) closesCredited++;
      } catch (e: any) {
        console.warn({ err: e?.message, estimateId: u.estimateId }, 'status-sync: recordConversionClose failed');
      }
    }
    updated++;
  }
  return { updated, closesCredited };
}
