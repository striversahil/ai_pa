// enquiry-links.ts — enquiry→estimate lead attribution.
//
// Verbatim extract from service.ts (Phase-3 split): linking a Zoho estimate
// number on an enquiry row to the enquiry's agent (Lead By), plus the daily
// self-heal sweep. Assigns ONLY free estimates; fills createdBy (generator
// credit) ONLY when empty.
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { invalidateRiskCache } from './risk';
import { recordAssignment } from './rotation';

// ── Creator resolution ───────────────────────────────────────────────────────
// REMOVED (founder rule): first-Zoho-comment creator inference
// (normName/creatorMatches/inferEstimateCreator). Estimate.createdBy ("Lead
// of" / "By") is written ONLY from the mapping B2B enquiry
// (modules/enquiries/estimate-link.ts) — never inferred from comments.

// ── Enquiry-linked lead attribution ──────────────────────────────────────────
// Lead-by-estimate flows through the Sales Enquiries dashboard (NOT NeoDove and
// NOT Zoho comment signatures): an enquiry carrying a Zoho estimate number
// (Enquiry.estNumber — optional in the New Enquiry form, mandatory at
// Mark-as-sent) links that estimate to the enquiry's agent
// (Enquiry.assignedAgentId, a Telecaller id auto-resolved from the creator's
// login). Rules: assign ONLY when the estimate is free (unassigned `sent`);
// never steal a held/converted/locked/skipped estimate; fill `createdBy`
// (generator credit) ONLY when empty so historical AI-signature credits stand.
// A missing estimate (Zoho hasn't synced it yet) is simply skipped here — the
// daily sweep below picks it up once it arrives.

export interface EnquiryLinkResult {
  linked: boolean;
  reason: string;
}

export async function linkEnquiryEstimate(opts: {
  estimateNumber: string;
  agentId: string;
  label?: string;
  /** Pins the row on cross-org number clashes (the enquiry's org). */
  organizationId?: string;
}): Promise<EnquiryLinkResult> {
  const estNo = String(opts.estimateNumber ?? '').trim();
  const agentId = String(opts.agentId ?? '').trim();
  if (!estNo) return { linked: false, reason: 'empty-estimate-number' };
  if (!agentId) return { linked: false, reason: 'empty-agent' };
  try {
    const tc = await prisma.telecaller.findUnique({ where: { id: agentId } });
    if (!tc || (tc as any).deleted || (tc as any).absentSince) {
      return { linked: false, reason: 'agent-invalid' };
    }
    // Exact match first, then an uppercase fallback for typo'd entries. On a
    // cross-org clash the pinned org wins, else legacy first-match.
    const org = String(opts.organizationId ?? '').trim();
    const pickBest = (rows: any[]) => {
      if (!rows?.length) return null;
      if (org) {
        const hit = rows.find((r) => String((r as any)?.organizationId ?? '') === org);
        if (hit) return hit;
      }
      return rows[0];
    };
    let est: any = pickBest(await prisma.estimate.findMany({ where: { estimateNumber: estNo } }).catch(() => []));
    if (!est && estNo !== estNo.toUpperCase()) {
      est = pickBest(await prisma.estimate.findMany({ where: { estimateNumber: estNo.toUpperCase() } }).catch(() => []));
    }
    if (!est) return { linked: false, reason: 'not-synced' };
    if (est.status !== 'sent') return { linked: false, reason: `status-${est.status}` };
    if ((est as any).skipAssignment) return { linked: false, reason: 'skip-assignment' };
    if ((est as any).lockedTelecallerId) return { linked: false, reason: 'locked' };
    const holder = (est as any).assignedTelecallerId ? String((est as any).assignedTelecallerId) : null;
    if (holder && holder !== agentId) return { linked: false, reason: 'held' };
    const updates: Record<string, unknown> = {};
    if (!holder) updates.assignedTelecallerId = agentId;
    if (!(est as any).createdBy) updates.createdBy = agentId;
    if (Object.keys(updates).length === 0) return { linked: false, reason: 'already-linked' };
    await prisma.estimate.update({ where: { estimateId: est.estimateId }, data: updates });
    if (!holder) {
      await recordAssignment(
        est.estimateId,
        agentId,
        `Enquiry link — ${est.estimateNumber}${opts.label ? ` (${opts.label})` : ''}`,
      );
    }
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    logger.info({ estimateNumber: est.estimateNumber, agentId }, 'enquiry-estimate link applied');
    return { linked: true, reason: 'linked' };
  } catch (e: any) {
    logger.warn({ err: e?.message, estNo }, 'linkEnquiryEstimate failed');
    return { linked: false, reason: 'error' };
  }
}

/**
 * Daily self-heal: resolve every enquiry→estimate link whose estimate has
 * since synced (or that predates this feature). Idempotent — already-held or
 * already-linked rows no-op. Runs inside runLeadConversion so no new cron or
 * sync-code hook is needed; the pending queue is simply "enquiries with an
 * estNumber whose estimate isn't linked yet".
 */
export async function sweepEnquiryEstimateLinks(): Promise<{ linked: number; scanned: number }> {
  let linked = 0;
  let scanned = 0;
  try {
    const enquiries = await prisma.enquiry.findMany({
      select: { estNumber: true, assignedAgentId: true, enquiryNumber: true, organizationId: true },
    });
    const withEst = ((enquiries as any[]) ?? []).filter(
      (e) => String(e?.estNumber ?? '').trim() && String(e?.assignedAgentId ?? '').trim(),
    );
    scanned = withEst.length;
    for (const e of withEst) {
      const r = await linkEnquiryEstimate({
        estimateNumber: String(e.estNumber).trim(),
        agentId: String(e.assignedAgentId).trim(),
        label: `enquiry ${String(e.enquiryNumber ?? '').trim() || 'row'}`,
        organizationId: String((e as any)?.organizationId ?? ''),
      });
      if (r.linked) linked += 1;
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'sweepEnquiryEstimateLinks failed');
  }
  if (linked > 0) logger.info({ linked, scanned }, 'enquiry-estimate sweep linked estimates');
  return { linked, scanned };
}
