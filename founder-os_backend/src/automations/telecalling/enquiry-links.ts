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

function normEst(s: unknown): string {
  return String(s ?? '').trim();
}

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
 * Daily self-heal for CONVERTED estimates: fill a blank createdBy from the
 * mapping enquiry and a blank region from the creator's roster region. Unlike
 * linkEnquiryEstimate this never re-owns a live/sent row — it only repairs
 * accepted/confirmed rows that already converted with incomplete attribution.
 * Safe/idempotent; used after the October close-credit reclassification so a
 * roster region fix (e.g. a previously unmapped creator) flows through to
 * their accepted deals without touching the ledger.
 */
export async function healConvertedAttribution(): Promise<{ scanned: number; creators: number; regions: number }> {
  let scanned = 0;
  let creators = 0;
  let regions = 0;
  try {
    const estimates = await prisma.estimate.findMany({
      where: { status: { in: ['accepted', 'confirmed'] } },
      select: { estimateId: true, estimateNumber: true, organizationId: true, createdBy: true, region: true },
    });
    const needing = ((estimates as any[]) ?? []).filter(
      (e) => !String(e?.createdBy ?? '').trim() || !String(e?.region ?? '').trim(),
    );
    scanned = needing.length;
    if (needing.length === 0) return { scanned, creators, regions };

    const [enquiries, telecallers] = await Promise.all([
      prisma.enquiry.findMany({ select: { estNumber: true, assignedAgentId: true, organizationId: true } }),
      prisma.telecaller.findMany({ select: { id: true, region: true } }),
    ]);
    const byNum = new Map<string, any[]>();
    for (const q of (enquiries as any[]) ?? []) {
      const num = normEst(q?.estNumber);
      if (!num) continue;
      const arr = byNum.get(num) ?? [];
      arr.push(q);
      byNum.set(num, arr);
    }
    const regionById = new Map<string, string>();
    for (const t of (telecallers as any[]) ?? []) {
      regionById.set(String(t.id), String(t.region ?? ''));
    }

    for (const e of needing) {
      const num = normEst(e?.estimateNumber);
      const matches = byNum.get(num) ?? [];
      const org = String((e as any)?.organizationId ?? '');
      const pick = (org && matches.find((m) => String((m as any)?.organizationId ?? '') === org)) || matches[0] || null;
      let creator = String((e as any)?.createdBy ?? '').trim();
      let region = String((e as any)?.region ?? '').trim();
      if (!creator && pick) creator = String((pick as any)?.assignedAgentId ?? '').trim();
      if (!region && creator) region = String(regionById.get(creator) ?? '');
      const data: Record<string, unknown> = {};
      if (creator && creator !== String((e as any)?.createdBy ?? '')) { data.createdBy = creator; creators += 1; }
      if (region && region !== String((e as any)?.region ?? '')) { data.region = region; regions += 1; }
      if (Object.keys(data).length > 0) {
        await prisma.estimate.update({ where: { estimateId: String((e as any).estimateId) }, data });
      }
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'healConvertedAttribution failed');
  }
  if (creators > 0 || regions > 0) logger.info({ scanned, creators, regions }, 'converted attribution healed');
  return { scanned, creators, regions };
}

/**
 * Daily self-heal for EVERY estimate with a blank region. Attribution order:
 *   1. creator (`createdBy`) → their roster region;
 *   2. mapping enquiry's assigned agent (the B2B creator) → createdBy + region;
 *   3. legacy `assignedTelecallerId` holder → region only (never invents a
 *      creator from the old individual-assignment model).
 * Rows with none of these signals stay in the privileged Unmapped bucket.
 * Idempotent; runs after the enquiry sweep.
 */
export async function healUnmappedEstimateRegions(): Promise<{ scanned: number; mapped: number }> {
  let scanned = 0;
  let mapped = 0;
  try {
    const estimates = await prisma.estimate.findMany({ where: { region: '' } });
    const needing = ((estimates as any[]) ?? []).filter((e) => !String(e?.region ?? '').trim());
    scanned = needing.length;
    if (needing.length === 0) return { scanned, mapped };

    const [enquiries, telecallers] = await Promise.all([
      prisma.enquiry.findMany({ select: { estNumber: true, assignedAgentId: true, organizationId: true } }),
      prisma.telecaller.findMany({ select: { id: true, region: true } }),
    ]);
    const byNum = new Map<string, any[]>();
    for (const q of (enquiries as any[]) ?? []) {
      const num = normEst(q?.estNumber);
      if (!num) continue;
      const arr = byNum.get(num) ?? [];
      arr.push(q);
      byNum.set(num, arr);
    }
    const regionById = new Map<string, string>();
    for (const t of (telecallers as any[]) ?? []) {
      const region = String(t?.region ?? '').trim();
      if (region) regionById.set(String(t.id), region);
    }

    for (const e of needing) {
      const data: Record<string, unknown> = {};
      let creator = String((e as any)?.createdBy ?? '').trim();
      let region = regionById.get(creator) ?? '';
      if (!creator) {
        // The mapping enquiry's agent is the B2B creator of this estimate.
        const matches = byNum.get(normEst(e.estimateNumber)) ?? [];
        const org = String((e as any)?.organizationId ?? '');
        const pick = (org && matches.find((m) => String((m as any)?.organizationId ?? '') === org)) || matches[0] || null;
        const agent = String((pick as any)?.assignedAgentId ?? '').trim();
        const agentRegion = agent ? regionById.get(agent) ?? '' : '';
        if (agentRegion) {
          creator = agent;
          region = agentRegion;
          data.createdBy = agent;
        }
      }
      if (!region) {
        // Legacy individual assignment is a region-only fallback.
        const holder = String((e as any)?.assignedTelecallerId ?? '').trim();
        if (holder) region = regionById.get(holder) ?? '';
      }
      if (region) data.region = region;
      if (Object.keys(data).length === 0) continue;
      await prisma.estimate.update({
        where: { estimateId: String(e.estimateId) },
        data,
      });
      mapped += 1;
    }
    if (mapped > 0) {
      try { await invalidateRiskCache(); } catch { /* non-fatal */ }
      logger.info({ scanned, mapped }, 'unmapped estimate regions healed');
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'healUnmappedEstimateRegions failed');
  }
  return { scanned, mapped };
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
  // Converted rows are never re-owned by linkEnquiryEstimate (it refuses
  // non-sent status); repair blank attribution/region separately.
  try { await healConvertedAttribution(); } catch { /* heal logs its own failure */ }
  try { await healUnmappedEstimateRegions(); } catch { /* heal logs its own failure */ }
  if (linked > 0) logger.info({ linked, scanned }, 'enquiry-estimate sweep linked estimates');
  return { linked, scanned };
}
