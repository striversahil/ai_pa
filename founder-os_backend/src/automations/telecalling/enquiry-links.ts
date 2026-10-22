// enquiry-links.ts — enquiry→estimate lead attribution (region model).
//
// Linking a Zoho estimate number (Enquiry.estNumber) on an enquiry row to the
// enquiry's agent stamps the estimate's ownership: `createdBy` (generator
// credit 20%) when empty, and `region` from the agent's roster region —
// region-ownership, not an individual assignment. Assigns ONLY `sent`
// estimates; never steals a converted estimate.
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { invalidateRiskCache } from './risk';

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
    if (!tc || (tc as any).deleted) {
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
    const hasCreator = !!(est as any).createdBy;
    const estRegion = String((est as any).region ?? '');
    const staffRegion = String((tc as any).region ?? '');
    const updates: Record<string, unknown> = {};
    if (!hasCreator) updates.createdBy = agentId;
    if (staffRegion && !estRegion) updates.region = staffRegion;
    if (Object.keys(updates).length === 0) return { linked: false, reason: 'already-linked' };
    await prisma.estimate.update({ where: { estimateId: est.estimateId }, data: updates });
    try { await invalidateRiskCache(); } catch { /* non-fatal */ }
    logger.info({ estimateNumber: est.estimateNumber, agentId, region: staffRegion }, 'enquiry-estimate link applied');
    return { linked: true, reason: 'linked' };
  } catch (e: any) {
    logger.warn({ err: e?.message, estNo }, 'linkEnquiryEstimate failed');
    return { linked: false, reason: 'error' };
  }
}

/**
 * Daily self-heal: resolve every enquiry→estimate link whose estimate has
 * since synced (or that predates this feature). Idempotent — already-linked
 * rows no-op. Runs inside runLeadConversion so no new cron or sync-code hook
 * is needed; the pending queue is simply "enquiries with an estNumber whose
 * estimate isn't linked yet".
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
