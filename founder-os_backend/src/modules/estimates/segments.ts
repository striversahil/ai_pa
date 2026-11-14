// segments.ts — per-estimate consumer/reseller classification for the Analyzer.
//
// The Analyzer scope bar filters to end-consumer vs reseller vs unclassified
// using the SAME resolution as the leaderboard (rules + sales-head manual
// overrides + Customer-Master exact match via classifyClients — never guessed).
// Served as a per-estimateId map so the client needs no normalization mirror.
//
// KV-cached (30-min TTL, same as the estimates payload); segment writes bust
// it alongside the telecalling dashboard cache (client-segments-parts/io.ts).
import { prisma } from '../../shared/prisma';
import { cached } from '../../shared/cache';
import { classifyClients } from '../../automations/telecalling/client-segments-parts/io';
import { normalizeClientKey } from '../../automations/telecalling/client-segments-parts/pure';

export type EstimateSegment = 'consumer' | 'reseller' | '';

export async function getEstimateSegments(): Promise<Record<string, EstimateSegment>> {
  return cached<Record<string, EstimateSegment>>('zoho:segments', 30 * 60 * 1000, async () => {
    const db = prisma as any;
    const rows = (await db.estimate.findMany({
      select: { estimateId: true, customerName: true },
    }).catch(() => [])) as any[];
    const names = [...new Set((rows ?? []).map((r) => String(r?.customerName ?? '')).filter(Boolean))];
    const cls = names.length > 0 ? await classifyClients(names).catch(() => new Map()) : new Map<string, { segment?: unknown }>();
    const out: Record<string, EstimateSegment> = {};
    for (const r of rows ?? []) {
      const seg = cls.get(normalizeClientKey((r as any)?.customerName))?.segment;
      out[String((r as any)?.estimateId)] = seg === 'consumer' || seg === 'reseller' ? seg : '';
    }
    return out;
  });
}
