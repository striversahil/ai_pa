// status-sync.ts — Zoho status transitions, shared by Worker + Express.
// Every move in any direction flows through applyStatusUpdates so
// accepted/confirmed flips always (a) stamp `Estimate.acceptedAt` — the
// leaderboard's won-on day — and (b) credit the telecalling close ledger
// (recordConversionClose is idempotent — safe on replays/duplicates).
// Nothing else may write `Estimate.status`: bulk-upsert routes any real change
// through here, and the legacy Express analyzer does too.
// Declines carry no ledger entry (penalty retired) — status sync only.
// Non-draft Zoho statuses (sent/accepted/declined/etc.) also auto-mark the
// linked B2B Enquiry row as `rateStatus='sent'` so the Sales dashboard no
// longer needs a manual "Mark as sent" button — Zoho is the source of truth.
import { prisma } from '../../shared/prisma';
import { istDate } from '../../automations/telecalling/util';

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
    const estimateId = String(u.estimateId);
    const nextStatus = String(u.status).trim();
    // acceptedAt is the leaderboard's "won on" day, so the transition has to
    // know whether this is an ENTRY into a close status. Read the prior state
    // (cheap: transitions are a handful per sync tick).
    const prev: any = await (prisma as any).estimate
      .findUnique({ where: { estimateId }, select: { status: true, acceptedAt: true } })
      .catch(() => null);
    const isClose = CLOSE_STATUSES.has(nextStatus.toLowerCase());
    const wasClose = CLOSE_STATUSES.has(String(prev?.status ?? '').toLowerCase());
    const data: Record<string, unknown> = { status: nextStatus, lastSyncTime: new Date() };
    if (isClose) {
      // Stamp on entry — and also when a close row somehow has no stamp yet
      // (defensive). A replay of an already-accepted row never moves the day.
      if (!wasClose || !prev?.acceptedAt) data.acceptedAt = istDate();
    } else if (wasClose) {
      // Left the close status (revision / reversal): drop the won-on day so a
      // later re-acceptance stamps afresh instead of inheriting a stale date.
      data.acceptedAt = null;
    }
    await (prisma as any).estimate.update({ where: { estimateId }, data });
    if (isClose) {
      try {
        const { recordConversionClose } = await import('../../automations/telecalling/service');
        if (await recordConversionClose(estimateId)) closesCredited++;
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
              // Open sent-revision: the row loops again — never auto-promote
              // mid-revision (management owns it until re-sent).
              sentRevisionAt: '',
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
