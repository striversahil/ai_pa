import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { cacheGet, cached } from '../../shared/cache';

/**
 * CRM — Active Sales Orders pipeline (department edition).
 *
 * The heavy Zoho Books fetch runs in scripts/crm-runner.js (GH Actions), which
 * computes each open sales order's next pending process step and POSTs the
 * snapshot to /api/runner/crm/snapshot (KV-cached). The Worker diffs every new
 * snapshot against the previous one and writes DepartmentScoreEvent points
 * (the department points game — mirrors TelecallerScoreEvent). This data()
 * reads the KV snapshot + aggregates the score ledger — the Worker never calls
 * Zoho directly.
 *
 * Lifecycle / stage → desk ownership:
 *   draft (not confirmed)         → "confirm"  (CRM desk)
 *   confirmed, not fully invoiced → "invoice"  (Accounts desk)
 *   invoiced, not shipped         → "ship"     (Dispatch desk)
 *   shipped, not paid             → "payment"  (Accounts desk — collections)
 *   fully paid/closed/cancelled   → "complete" (dropped from active pipeline)
 *
 * Points: +25 new SO (CRM) · +50 confirm (CRM) · +25 material allocated
 * (Procurement) · +50 invoice raised (Accounts) · +50 shipped (Dispatch) ·
 * +100 payment received (Accounts) · −20 cancelled (charged to the dept
 * owning the stage the order was in).
 */

export async function handler() {
  // Triggered via GH Actions → /api/trigger/crm. The actual work lives in
  // scripts/crm-runner.js (Zoho fetch + lifecycle compute + KV write) and the
  // snapshot route (diff → DepartmentScoreEvent points).
  logger.info('CRM automation triggered — runner handles Zoho fetch + snapshot + points.');
}

const SNAPSHOT_KEY = 'crm:salesorders_snapshot';
const DATA_CACHE_KEY = 'crm:data';
const SNAPSHOT_TTL_MS = 45 * 60 * 1000;
const DATA_TTL_MS = 60 * 1000;

function istDateString(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function istDateDaysAgo(n: number): string {
  return istDateString(new Date(Date.now() - n * 86400000));
}

async function computeCrmData() {
  const today = istDateString(new Date());
  const weekAgo = istDateDaysAgo(7);
  const snapshot = await cacheGet<any>(SNAPSHOT_KEY, SNAPSHOT_TTL_MS);
  const fresh = !!(snapshot && snapshot.date === today);
  const stages: Record<string, any> = fresh ? (snapshot.stages || snapshot.byProcess || {}) : {};

  // Department score ledger — today, last 7 days, CRM leaderboard, recent feed.
  // Two queries (not three): the 7-day window covers today, so today's
  // aggregates are derived in memory from the week rows.
  let scores: any = {
    today: { crm: 0, accounts: 0, dispatch: 0, procurement: 0 },
    todayByDeptCount: { crm: 0, accounts: 0, dispatch: 0, procurement: 0 },
    week: { crm: 0, accounts: 0, dispatch: 0, procurement: 0 },
    crmLeaderboard: [] as any[],
    recent: [] as any[],
    ledgerOk: true,
  };
  try {
    const [weekEvents, recent] = await Promise.all([
      prisma.departmentScoreEvent.findMany({ where: { day: { gte: weekAgo } } }),
      prisma.departmentScoreEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const todayEvents = weekEvents.filter((r: any) => r.day === today);
    const sumByDept = (rows: any[]) => {
      const points: Record<string, number> = { crm: 0, accounts: 0, dispatch: 0, procurement: 0 };
      const events: Record<string, number> = { crm: 0, accounts: 0, dispatch: 0, procurement: 0 };
      for (const r of rows) {
        if (points[r.dept] === undefined) continue;
        points[r.dept] += r.points || 0;
        events[r.dept] += 1;
      }
      return { points, events };
    };
    const t = sumByDept(todayEvents);
    const w = sumByDept(weekEvents);
    const lb = new Map<string, { actor: string; points: number; events: number; created: number; confirmed: number }>();
    for (const r of weekEvents) {
      if (r.dept !== 'crm') continue;
      const key = r.actor || 'Unassigned';
      const entry = lb.get(key) || { actor: key, points: 0, events: 0, created: 0, confirmed: 0 };
      entry.points += r.points || 0;
      entry.events += 1;
      if (String(r.reason || '').startsWith('New sales order')) entry.created += 1;
      if (String(r.reason || '').includes('confirmed')) entry.confirmed += 1;
      lb.set(key, entry);
    }
    scores = {
      today: t.points,
      todayByDeptCount: t.events,
      week: w.points,
      crmLeaderboard: [...lb.values()].sort((a, b) => b.points - a.points),
      recent: recent.map((r: any) => ({
        day: r.day, dept: r.dept, soNumber: r.soNumber, points: r.points,
        reason: r.reason, actor: r.actor, createdAt: r.createdAt,
      })),
      ledgerOk: true,
    };
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'crm data: score ledger aggregation failed');
    scores.ledgerOk = false;
  }

  const materials = fresh ? (snapshot.materials || []) : [];
  const totalMaterialQty = materials.reduce((s: number, m: any) => s + (m.qty || 0), 0);

  return {
    date: today,
    computedAt: snapshot?.computedAt ?? null,
    // Zoho fetch time (when the runner pulled the data) vs computedAt (when
    // the Worker wrote the snapshot) — the dashboard shows fetchedAt.
    fetchedAt: snapshot?.fetchedAt ?? null,
    fresh,
    totalActive: fresh ? (snapshot.totalActive || 0) : 0,
    totalValue: fresh ? (snapshot.totalValue || 0) : 0,
    // Raw stage groups (orders included) — the source for every department table.
    stages,
    // Department roll-ups (what each tab renders).
    departments: {
      crm: { pending: stages.confirm || { count: 0, value: 0, orders: [] } },
      accounts: {
        toInvoice: stages.invoice || { count: 0, value: 0, orders: [] },
        awaitingPayment: stages.payment || { count: 0, value: 0, orders: [] },
      },
      dispatch: { pending: stages.ship || { count: 0, value: 0, orders: [] } },
      procurement: {
        materials,
        distinctMaterials: materials.length,
        totalQty: Math.round(totalMaterialQty * 100) / 100,
        openOrders: (stages.confirm?.count || 0) + (stages.invoice?.count || 0),
      },
    },
    salespeople: fresh ? (snapshot.salespeople || []) : [],
    closed: fresh ? (snapshot.closed || []) : [],
    meta: fresh ? (snapshot.meta || null) : null,
    scores,
  };
}

export async function data() {
  // Short TTL: collapses per-tab refetch storms into one compute; the snapshot
  // route busts this key on every runner refresh.
  return cached(DATA_CACHE_KEY, DATA_TTL_MS, computeCrmData);
}
