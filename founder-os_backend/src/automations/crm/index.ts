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
// Outage survival: when no fresh snapshot exists (Zoho down / runner failing),
// serve the last-known snapshot up to 7 days old with an explicit stale badge
// instead of zeroing the pipeline. Must match the worker's KEEP TTL.
const SNAPSHOT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
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
  // Stale fallback (Zoho outage): last-known snapshot within retention, served
  // with stale:true + staleSince so the dashboard shows a badge, never zeros.
  // The points ledger below still reads live D1, so scores never go stale.
  let staleSnapshot: any = null;
  if (!fresh) {
    try {
      const kept = await cacheGet<any>(SNAPSHOT_KEY, SNAPSHOT_KEEP_MS);
      if (kept && kept.date) staleSnapshot = kept;
    } catch { /* no stale copy — zeros below */ }
  }
  const stale = !fresh && !!staleSnapshot;
  const src = fresh ? snapshot : staleSnapshot;
  const stages: Record<string, any> = src ? (src.stages || src.byProcess || {}) : {};

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

  const materials = fresh || stale ? (src.materials || []) : [];
  const totalMaterialQty = materials.reduce((s: number, m: any) => s + (m.qty || 0), 0);

  // SO document attachments (accounts uploads — invoice PDFs, LR copies).
  // Durable D1 rows keyed by SO number, merged onto display rows here so
  // snapshot refreshes can never wipe them. Best-effort: rows simply carry
  // no attachments when the read fails.
  try {
    const files: any[] = await prisma.soAttachment.findMany({ orderBy: { createdAt: 'desc' } }).catch(() => []);
    if (Array.isArray(files) && files.length > 0) {
      const bySo = new Map<string, any[]>();
      for (const f of files) {
        const so = String((f as any)?.soNumber || '');
        if (!so) continue;
        const item = {
          id: String((f as any).id),
          kind: String((f as any).kind || 'other'),
          fileName: String((f as any).fileName || ''),
          mime: String((f as any).mime || 'application/octet-stream'),
          size: Number((f as any).size || 0),
          uploadedBy: String((f as any).uploadedBy || ''),
          createdAt: (f as any).createdAt instanceof Date ? (f as any).createdAt.toISOString() : String((f as any).createdAt || ''),
          url: `/api/crm/files/${String((f as any).id)}`,
        };
        if (!bySo.has(so)) bySo.set(so, []);
        bySo.get(so)!.push(item);
      }
      if (bySo.size > 0) {
        for (const entry of Object.values(stages)) {
          for (const o of (entry as any)?.orders ?? []) {
            const list = o?.so ? bySo.get(String(o.so)) : null;
            if (list && list.length > 0) {
              o.attachments = list;
              o.attachmentCount = list.length;
            }
          }
        }
      }
    }
  } catch {
    /* attachments best-effort — pipeline still serves */
  }

  return {
    date: (fresh ? snapshot.date : stale ? src.date : today),
    computedAt: (fresh ? snapshot?.computedAt : stale ? (src.computedAt ?? null) : null) ?? null,
    // Zoho fetch time (when the runner pulled the data) vs computedAt (when
    // the Worker wrote the snapshot) — the dashboard shows fetchedAt.
    fetchedAt: (fresh ? snapshot?.fetchedAt : stale ? (src.fetchedAt ?? null) : null) ?? null,
    fresh,
    // Outage badge fields: staleSince = last successful Zoho pull (fetchedAt
    // is only stamped on real pulls — preservative heartbeats never touch it).
    stale,
    staleSince: stale ? ((src.fetchedAt ?? src.computedAt) ?? null) : null,
    totalActive: (fresh || stale) ? (src.totalActive || 0) : 0,
    totalValue: (fresh || stale) ? (src.totalValue || 0) : 0,
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
    salespeople: (fresh || stale) ? (src.salespeople || []) : [],
    closed: (fresh || stale) ? (src.closed || []) : [],
    meta: (fresh || stale) ? (src.meta || null) : null,
    scores,
  };
}

export async function data() {
  // Short TTL: collapses per-tab refetch storms into one compute; the snapshot
  // route busts this key on every runner refresh.
  return cached(DATA_CACHE_KEY, DATA_TTL_MS, computeCrmData);
}
