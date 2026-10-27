// accepted.ts — accepted-estimate aggregation (wins / ₹ / points).
//
// SINGLE SOURCE OF TRUTH for the Sales Leaderboard. Every accepted/confirmed
// estimate is counted ONCE, on the IST day it BECAME accepted (`acceptedAt`),
// and attributed to the lead region on the estimate itself.
//
// Why this module exists (2026-10 diagnosis): the board used to count
// TelecallerScoreEvent ledger rows instead of accepted estimates, so any close
// whose event write failed simply vanished. October showed 66 wins / ₹40.71L
// while the true acceptance cohort was 88 / ₹51.62L — 22 accepted estimates
// (₹10.9L) had no ledger row, and the two numbers on the same screen (region
// cards vs KPI header) disagreed by ₹17.79L because one filtered on
// `Estimate.date` and the other on ledger days. The ledger is still written and
// read for history/export, but the dashboard no longer depends on it.
//
// Buckets (founder rule, 2026-10-26):
//   region   — the creator resolves to a roster region (R1–R4); counts toward
//              that region's target.
//   direct   — the creator exists on the roster but holds NO region (Sales
//              Head / HQ). Shown so the total reconciles with Zoho, NEVER
//              counted toward a region target.
//   unlinked — no creator, or a creator id that is not on the roster at all.
//              Shown + flagged for EST→region mapping, never counted toward a
//              target.
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { closePointsFor } from './scoring';

export type AcceptedBucketKind = 'region' | 'direct' | 'unlinked';

export interface AcceptedAgg {
  count: number;
  value: number;
  points: number;
}

export interface AcceptedEstimate {
  estimateId: string;
  estimateNumber: string;
  customerName: string;
  total: number;
  /** Estimate.region ('' for direct/unlinked). */
  region: string;
  createdBy: string;
  createdByName: string | null;
  /** IST day the estimate became accepted (backfilled from date when unknown). */
  acceptedAt: string;
  status: string;
}

export interface AcceptedBucket extends AcceptedAgg {
  /** Highest-value rows first, capped (dashboard drill-down). */
  items: AcceptedEstimate[];
}

export interface AcceptedSnapshot extends AcceptedAgg {
  byRegion: Map<string, AcceptedAgg>;
  /** The accepted rows behind `byRegion` (region drill-down: "what closed?"). */
  byRegionItems: Map<string, AcceptedEstimate[]>;
  byCreator: Map<string, AcceptedAgg>;
  direct: AcceptedBucket;
  unlinked: AcceptedBucket;
  /** Every row in the window (callers group them per day/week). */
  rows: AcceptedEstimate[];
}

/** Roster identity used to resolve a creator to a region. Includes DELETED
 *  staff: a sale still belongs to the region that made it, long after the
 *  person left. */
export interface CreatorIndex {
  /** creator id → region (R1–R4, '' when the person holds no region). */
  regionById: Map<string, string>;
  nameById: Map<string, string>;
  /** Every roster id ever seen — distinguishes "HQ" from "unknown id". */
  knownIds: Set<string>;
}

const EMPTY_AGG = (): AcceptedAgg => ({ count: 0, value: 0, points: 0 });

function addTo(map: Map<string, AcceptedAgg>, key: string, value: number, points: number): void {
  const cur = map.get(key) ?? EMPTY_AGG();
  cur.count += 1;
  cur.value += value;
  cur.points += points;
  map.set(key, cur);
}

/** Load the roster index used for creator→region resolution. */
export async function loadCreatorIndex(): Promise<CreatorIndex> {
  const index: CreatorIndex = { regionById: new Map(), nameById: new Map(), knownIds: new Set() };
  try {
    // NO deleted filter on purpose (see CreatorIndex). The roster is tiny.
    const rows = await prisma.telecaller.findMany({ select: { id: true, name: true, region: true } });
    for (const t of (rows as any[]) ?? []) {
      const id = String(t.id ?? '');
      if (!id) continue;
      index.knownIds.add(id);
      index.regionById.set(id, String(t.region ?? ''));
      index.nameById.set(id, String(t.name ?? ''));
    }
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'accepted: creator index read failed — every creator reads as direct');
  }
  return index;
}

/**
 * Accepted/confirmed estimates whose acceptance day falls in [from, to], with
 * the per-region / per-creator / direct / unlinked rollups already applied.
 *
 * Falls back to `Estimate.date` for rows whose `acceptedAt` was never stamped
 * (pre-migration rows only — every new close is stamped by applyStatusUpdates).
 */
export async function loadAcceptedSnapshot(
  from: string,
  to: string,
  opts?: { creatorIndex?: CreatorIndex; itemsCap?: number; regionItemsCap?: number },
): Promise<AcceptedSnapshot> {
  const cap = opts?.itemsCap ?? 25;
  const regionCap = opts?.regionItemsCap ?? 60;
  const index = opts?.creatorIndex ?? (await loadCreatorIndex());
  const snapshot: AcceptedSnapshot = {
    count: 0,
    value: 0,
    points: 0,
    byRegion: new Map(),
    byRegionItems: new Map(),
    byCreator: new Map(),
    direct: { ...EMPTY_AGG(), items: [] },
    unlinked: { ...EMPTY_AGG(), items: [] },
    rows: [],
  };
  if (!from || !to || to < from) return snapshot;

  let rows: any[] = [];
  try {
    rows = (await prisma.estimate.findMany({
      where: {
        status: { in: ['accepted', 'confirmed'] },
        // acceptedAt is the authoritative day; the date fallback only ever
        // matches rows the backfill could not reach (defensive, not a path).
        OR: [
          { acceptedAt: { gte: from, lte: to } },
          { acceptedAt: null, date: { gte: from, lte: to } },
        ],
      },
      select: {
        estimateId: true,
        estimateNumber: true,
        customerName: true,
        total: true,
        region: true,
        createdBy: true,
        acceptedAt: true,
        date: true,
        status: true,
      },
      orderBy: { acceptedAt: 'desc' },
    })) as any[];
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'accepted: window read failed — wins read 0');
    return snapshot;
  }

  for (const r of rows) {
    const total = Number(r.total ?? 0) || 0;
    const points = closePointsFor(total);
    const creator = String(r.createdBy ?? '').trim();
    const estimateRegion = String(r.region ?? '').trim();
    const acceptedAt = String(r.acceptedAt ?? r.date ?? '').slice(0, 10);
    const row: AcceptedEstimate = {
      estimateId: String(r.estimateId ?? ''),
      estimateNumber: String(r.estimateNumber ?? ''),
      customerName: String(r.customerName ?? ''),
      total,
      region: estimateRegion,
      createdBy: creator,
      createdByName: creator ? index.nameById.get(creator) ?? null : null,
      acceptedAt,
      status: String(r.status ?? ''),
    };
    snapshot.rows.push(row);
    snapshot.count += 1;
    snapshot.value += total;
    snapshot.points += points;

    // Bucket resolution: estimate region first (authoritative — a founder
    // mapping overrides inference), then the creator's roster region.
    let kind: AcceptedBucketKind;
    let regionId = estimateRegion;
    if (!regionId && creator && index.knownIds.has(creator)) {
      regionId = index.regionById.get(creator) ?? '';
    }
    if (regionId) kind = 'region';
    else if (creator && index.knownIds.has(creator)) kind = 'direct';
    else kind = 'unlinked';

    if (kind === 'region') {
      addTo(snapshot.byRegion, regionId, total, points);
      if (creator) addTo(snapshot.byCreator, creator, total, points);
      // Keep the rows themselves so the board can list what a region closed.
      const regionRows = snapshot.byRegionItems.get(regionId) ?? [];
      regionRows.push(row);
      snapshot.byRegionItems.set(regionId, regionRows);
      continue;
    }
    const bucket = kind === 'direct' ? snapshot.direct : snapshot.unlinked;
    bucket.count += 1;
    bucket.value += total;
    bucket.points += points;
    bucket.items.push(row);
  }

  for (const bucket of [snapshot.direct, snapshot.unlinked]) {
    bucket.items.sort((a, b) => b.total - a.total);
    bucket.items = bucket.items.slice(0, cap);
  }
  // Region drill-down: newest close first (the board shows a running list);
  // ties break on value so a same-day pair still reads biggest-first.
  for (const [region, rows] of snapshot.byRegionItems) {
    rows.sort((a, b) => (b.acceptedAt.localeCompare(a.acceptedAt)) || b.total - a.total);
    snapshot.byRegionItems.set(region, rows.slice(0, regionCap));
  }
  return snapshot;
}

/** Accepted ₹ grouped weekStart → region → value (targets.ts ledger input). */
export function groupAcceptedByWeek(
  rows: AcceptedEstimate[],
  weekStartOf: (day: string) => string,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.region) continue; // direct / unlinked never feed a region target
    const week = weekStartOf(row.acceptedAt);
    if (!week) continue;
    let byRegion = out.get(week);
    if (!byRegion) { byRegion = new Map(); out.set(week, byRegion); }
    byRegion.set(row.region, (byRegion.get(row.region) ?? 0) + row.total);
  }
  return out;
}

/** Round the ₹ fields of an agg for JSON (D1 floats carry cents). */
export function roundAgg(agg: AcceptedAgg): AcceptedAgg {
  return { count: agg.count, value: Math.round(agg.value), points: agg.points };
}


