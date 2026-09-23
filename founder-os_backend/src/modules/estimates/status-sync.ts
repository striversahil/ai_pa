// status-sync.ts — Zoho status transitions, shared by Worker + Express.
// Every move in any direction flows through applyStatusUpdates so
// accepted/confirmed flips always credit the telecalling close ledger
// (recordConversionClose is idempotent — safe on replays/duplicates).
// Declines carry no ledger entry (penalty retired) — status sync only.
// Non-draft Zoho statuses (sent/accepted/declined/etc.) also auto-mark the
// linked B2B Enquiry row as `rateStatus='sent'` so the Sales dashboard no
// longer needs a manual "Mark as sent" button — Zoho is the source of truth.
import { prisma } from '../../shared/prisma';

export interface StatusTransition {
  estimateId: string;
  status: string;
}

const CLOSE_STATUSES = new Set(['accepted', 'confirmed']);

export async function applyStatusUpdates(
  updates: StatusTransition[],
): Promise<{ updated: number; closesCredited: number; enquiriesAutoSent?: number }> {
  let updated = 0;
  let closesCredited = 0;
  let enquiriesAutoSent = 0;
  for (const u of updates || []) {
    if (!u?.estimateId || !u?.status) continue;
    const nextStatus = String(u.status).trim();
    await (prisma as any).estimate.update({
      where: { estimateId: String(u.estimateId) },
      data: { status: nextStatus, lastSyncTime: new Date() },
    });
    if (CLOSE_STATUSES.has(nextStatus.toLowerCase())) {
      try {
        const { recordConversionClose } = await import('../../automations/telecalling/service');
        if (await recordConversionClose(String(u.estimateId))) closesCredited++;
      } catch (e: any) {
        console.warn({ err: e?.message, estimateId: u.estimateId }, 'status-sync: recordConversionClose failed');
      }
    }
    // Auto-mark linked enquiry as sent when Zoho is no longer draft.
    // Draft → sent/accepted/declined all count as "sent" in the internal
    // pipeline (the manual button is being eliminated). Reverts are NOT
    // auto- undone — going back to draft keeps the internal `sent` sticky.
    if (nextStatus.toLowerCase() !== 'draft' && nextStatus !== '') {
      try {
        // Resolve estimateNumber + org for this estimateId (the enquiry key is
        // estNumber; the org scopes it on cross-org number clashes — a DPG
        // flip must never auto-mark a BUI enquiry sharing the number).
        const row: any = await (prisma as any).estimate.findUnique({
          where: { estimateId: String(u.estimateId) },
          select: { estimateNumber: true, organizationId: true },
        }).catch(() => null);
        const num = String(row?.estimateNumber ?? '').trim();
        const org = String(row?.organizationId ?? '').trim();
        if (num) {
          const res: any = await (prisma as any).enquiry.updateMany({
            where: {
              estNumber: num,
              rateStatus: { not: 'sent' } as any,
              // Same-org enquiries plus untagged legacy rows ('' = primary).
              // An enquiry explicitly tagged to the OTHER org is left alone.
              ...(org ? { OR: [{ organizationId: org }, { organizationId: '' }] } as any : {}),
            },
            data: { rateStatus: 'sent' },
          }).catch(() => null);
          const n = Number(res?.count ?? 0);
          if (n > 0) enquiriesAutoSent += n;
        }
      } catch (e: any) {
        console.warn({ err: e?.message, estimateId: u.estimateId }, 'status-sync: auto-mark enquiry sent failed');
      }
    }
    updated++;
  }
  return { updated, closesCredited, enquiriesAutoSent } as any;
}
