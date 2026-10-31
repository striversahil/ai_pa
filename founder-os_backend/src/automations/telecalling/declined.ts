// declined.ts — declined-estimate aggregation for the Sales Leaderboard.
//
// The Declined figure on a region row is the counterpart of Won: estimates
// that BECAME declined inside the selected period, attributed to the region
// that owns the estimate. The drawer behind it lists the actual rows, so the
// number is always explainable.
//
// Period clock: `Estimate.declinedAt` (IST day stamped by status-sync.ts on
// entry into `declined`), with a defensive `date` fallback for rows that never
// got a stamp. Never `lastSyncTime` — that is a sync watermark that moves for
// metadata/AI/lead-details updates, not a decline event.
//
// Attribution mirrors accepted.ts exactly (single rule, two consumers):
//   1. `Estimate.region` (authoritative — a founder mapping wins), else
//   2. the creator's roster region (deleted staff included: the loss still
//      belongs to the team that chased it).
// Anything unresolved is excluded from region rows and counted in
// `unattributed` so callers can explain a gap without inventing a region.

import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import type { CreatorIndex } from './accepted';
import { loadCreatorIndex } from './accepted';

export interface DeclinedAgg {
  count: number;
  value: number;
}

/** One declined estimate shown in a region's drill-down. */
export interface DeclinedEstimate {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  total: number;
  /** `Estimate.region` as stored ('' when the row relies on creator inference). */
  region: string;
  createdBy: string;
  createdByName: string | null;
  /** IST day the estimate became declined (backfilled from date when unknown). */
  declinedAt: string;
  status: string;
}

export interface DeclinedSnapshot {
  byRegion: Map<string, DeclinedAgg>;
  /** The rows behind `byRegion`, newest decline first, capped per region. */
  byRegionItems: Map<string, DeclinedEstimate[]>;
  /** Declines no region can claim (no stored region + unknown/HQ creator). */
  unattributed: DeclinedAgg;
  /** Every resolved + unresolved decline in the window. */
  total: DeclinedAgg;
}

const EMPTY_AGG = (): DeclinedAgg => ({ count: 0, value: 0 });

function addTo(map: Map<string, DeclinedAgg>, key: string, value: number): void {
  const cur = map.get(key) ?? EMPTY_AGG();
  cur.count += 1;
  cur.value += value;
  map.set(key, cur);
}

export async function loadDeclinedSnapshot(
  from: string,
  to: string,
  opts?: { creatorIndex?: CreatorIndex; regionItemsCap?: number },
): Promise<DeclinedSnapshot> {
  const regionCap = opts?.regionItemsCap ?? 60;
  const index = opts?.creatorIndex ?? (await loadCreatorIndex());
  const snapshot: DeclinedSnapshot = {
    byRegion: new Map(),
    byRegionItems: new Map(),
    unattributed: EMPTY_AGG(),
    total: EMPTY_AGG(),
  };
  if (!from || !to || to < from) return snapshot;

  let rows: any[] = [];
  try {
    rows = (await prisma.estimate.findMany({
      where: {
        status: 'declined',
        // declinedAt is the authoritative day; the date fallback only ever
        // matches rows written by a path that bypassed status-sync (defensive).
        OR: [
          { declinedAt: { gte: from, lte: to } },
          { declinedAt: null, date: { gte: from, lte: to } },
        ],
      },
      select: {
        estimateId: true,
        estimateNumber: true,
        customerName: true,
        total: true,
        region: true,
        createdBy: true,
        declinedAt: true,
        date: true,
        status: true,
      },
      orderBy: { declinedAt: 'desc' },
    })) as any[];
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'declined: window read failed — declines read 0');
    return snapshot;
  }

  for (const r of rows) {
    const total = Number(r.total ?? 0) || 0;
    const creator = String(r.createdBy ?? '').trim();
    const estimateRegion = String(r.region ?? '').trim();
    const declinedAt = String(r.declinedAt ?? r.date ?? '').slice(0, 10);
    const row: DeclinedEstimate = {
      estimateId: String(r.estimateId ?? ''),
      estimateNumber: String(r.estimateNumber ?? ''),
      customerName: String(r.customerName ?? ''),
      total,
      region: estimateRegion,
      createdBy: creator,
      createdByName: creator ? index.nameById.get(creator) ?? null : null,
      declinedAt,
      status: String(r.status ?? ''),
    };

    snapshot.total.count += 1;
    snapshot.total.value += total;

    let regionId = estimateRegion;
    if (!regionId && creator && index.knownIds.has(creator)) {
      regionId = index.regionById.get(creator) ?? '';
    }
    if (!regionId) {
      snapshot.unattributed.count += 1;
      snapshot.unattributed.value += total;
      continue;
    }

    addTo(snapshot.byRegion, regionId, total);
    const list = snapshot.byRegionItems.get(regionId) ?? [];
    list.push(row);
    snapshot.byRegionItems.set(regionId, list);
  }

  // Newest decline first (the drawer reads like a feed); ties break on value
  // so a same-day pair still reads biggest-first.
  for (const [region, list] of snapshot.byRegionItems) {
    list.sort((a, b) => (b.declinedAt.localeCompare(a.declinedAt)) || b.total - a.total);
    snapshot.byRegionItems.set(region, list.slice(0, regionCap));
  }
  return snapshot;
}
