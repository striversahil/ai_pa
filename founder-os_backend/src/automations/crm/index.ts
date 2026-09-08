import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { cacheGet } from '../../shared/cache';

/**
 * CRM — Active Sales Orders pipeline.
 *
 * The heavy Zoho Books fetch runs in scripts/crm-runner.js (GH Actions), which
 * computes each open sales order's next pending process step and POSTs the
 * snapshot to /api/runner/crm/snapshot (KV-cached). This data() just reads that
 * KV snapshot — the Worker never calls Zoho directly.
 *
 * Lifecycle / "process after that needs to be done":
 *   draft (not confirmed)        → "confirm"
 *   confirmed, not fully invoiced → "invoice"
 *   invoiced, not shipped        → "ship"
 *   shipped, not paid             → "payment"
 *   fully paid/closed             → "complete" (dropped from active pipeline)
 */

export async function handler() {
  // Triggered via GH Actions → /api/trigger/crm. The actual work lives in
  // scripts/crm-runner.js (Zoho fetch + lifecycle compute + KV write).
  logger.info('CRM automation triggered — runner handles Zoho fetch + snapshot.');
}

const SNAPSHOT_KEY = 'crm:salesorders_snapshot';
const SNAPSHOT_TTL_MS = 45 * 60 * 1000;

function istDateString(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function data() {
  const today = istDateString(new Date());
  const snapshot = await cacheGet<{
    date: string;
    totalActive: number;
    totalValue: number;
    byProcess: Record<string, { count: number; value: number; orders: any[] }>;
    computedAt: string;
  }>(SNAPSHOT_KEY, SNAPSHOT_TTL_MS);

  if (snapshot && snapshot.date === today) {
    return {
      date: snapshot.date,
      totalActive: snapshot.totalActive,
      totalValue: snapshot.totalValue,
      byProcess: snapshot.byProcess,
      computedAt: snapshot.computedAt,
      fresh: true,
    };
  }

  // Stale/absent snapshot — return empty pipeline (runner will refresh).
  return {
    date: today,
    totalActive: 0,
    totalValue: 0,
    byProcess: {},
    computedAt: null,
    fresh: false,
  };
}
