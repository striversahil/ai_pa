// queues-cache.ts — KV-cached Management Review queues (single source of truth).
//
// Why this exists: the Active / Unprocessed tabs must be COMPLETE (every open
// row, however old — a Geetu-style miss is unacceptable) WITHOUT scanning D1
// on every render. The cursor-capped list endpoint bills a flat ~100 rows per
// page, so it can never serve a complete open queue once the table outgrows
// one page. Instead this module scans once per TTL (single-flight coalesced
// across isolates via `cached()`), partitions with the backend `queues.ts`
// predicates, and serves every render from KV after that.
//
// Cost contract:
//   - Per render (Active/Unprocessed/History page): ONE KV read, zero D1.
//   - Per TTL window (60s): at most ONE full scan, however many viewers.
//   - On any enquiry write: `invalidateManagementQueues()` deletes the key so
//     the next read recomputes immediately (stale window only between a write
//     and the next read, and live events trigger that refetch at once).
//
// Frontend mirror: `ManagementReview.tsx` reads Active/Unprocessed whole and
// History whole (`GET /api/enquiries/queues?queue=history&all=1`).
// Queue semantics live in `queues.ts` — this file only caches + partitions.
import { cached, cacheDel } from '../../shared/cache';
import { estimateStatusByNumbers } from './estimate-link';
import {
  isManagementPendingEnquiry,
  isManagementHistoryEnquiry,
  isProcurementPendingEnquiry,
  isProcurementHistoryEnquiry,
  isSentReopened,
} from './queues';
import type { EnquiryStore } from './types';

export const MGMT_QUEUES_KEY = 'enquiries:queues:v2';
export const MGMT_QUEUES_TTL_MS = 60_000;

export interface ManagementQueues {
  active: any[];
  unprocessed: any[];
  history: any[];
  historyTotal: number;
  /** Item-less rows: in NO predicate queue (every predicate needs items), so
   *  they ship separately and the dashboard renders them as their own
   *  "waiting on sales" section — otherwise a fresh enquiry is invisible. */
  empty: any[];
  /** Procurement partitions (same scan — the redacted queue endpoints serve
   *  these; redaction itself is applied at serve time, never cached). */
  procPending: any[];
  procHistory: any[];
  computedAt: string;
}

/** What actually sits in KV: rows stored ONCE keyed by id, queues as id
 *  lists. Item bodies carry embedded media (a single row can be ~2.5MB), so
 *  caching the same row inside 5+ queue arrays duplicates ~17MB past KV's
 *  25MB value cap — the write then fails on every compute and each isolate
 *  re-scans D1+Zoho every TTL. Store-once keeps the value small enough to
 *  persist, which is what makes the flat-cost contract above real. */
interface CachedQueues {
  byId: Record<string, any>;
  active: string[];
  unprocessed: string[];
  history: string[];
  empty: string[];
  procPending: string[];
  procHistory: string[];
  historyTotal: number;
  computedAt: string;
}

/** Attach live Zoho status onto rows (org-preferring rule, same as
 *  `enquiryList`): Estimate.status from the 5-min sync rides each linked row,
 *  and any non-draft status derives `rateStatus: 'sent'` for the response so
 *  terminal rows never sit in an open queue. Skipped while a sent-revision is
 *  open — the row loops again and must NOT read as sent mid-revision. */
async function attachQueueZoho(rows: any[]): Promise<void> {
  const nums = rows.map((e) => String((e as any)?.estNumber ?? '').trim()).filter(Boolean);
  if (!nums.length) {
    for (const e of rows) {
      if ((e as any).zohoStatus === undefined) (e as any).zohoStatus = null;
      if ((e as any).zohoCustomerName === undefined) (e as any).zohoCustomerName = null;
    }
    return;
  }
  const orgByNum = new Map<string, string>();
  for (const e of rows) {
    const n = String((e as any)?.estNumber ?? '').trim();
    const o = String((e as any)?.organizationId ?? '').trim();
    if (n && o && !orgByNum.has(n)) orgByNum.set(n, o);
  }
  let byNum: Map<string, { status: string; customerName: string }>;
  try {
    byNum = await estimateStatusByNumbers(nums, orgByNum);
  } catch {
    for (const e of rows) if ((e as any).zohoStatus === undefined) (e as any).zohoStatus = null;
    return;
  }
  for (const e of rows) {
    const n = String((e as any)?.estNumber ?? '').trim();
    const o = String((e as any)?.organizationId ?? '').trim();
    const hit = (o && byNum.get(`${o}||${n}`)) || byNum.get(n);
    (e as any).zohoStatus = hit ? hit.status : null;
    (e as any).zohoCustomerName = hit ? hit.customerName || null : null;
    const reopened = isSentReopened(e as any);
    const zs = String(hit?.status ?? '').toLowerCase();
    if (!reopened && zs && zs !== 'draft' && String((e as any)?.rateStatus ?? '') !== 'sent') {
      (e as any).rateStatus = 'sent';
    }
  }
}

async function computeManagementQueues(store: EnquiryStore): Promise<CachedQueues> {
  // Newest-first (store contract) — every queue below inherits the order.
  const all = await store.listEnquiries();
  await attachQueueZoho(all as any[]);
  // Same partition as the frontend (`ManagementReview.tsx`): pending ⊂ open,
  // history disjoint, unprocessed = every non-history row carrying items.
  // Procurement partitions use the procurement predicates (`ProcurementQueue.tsx`).
  const id = (e: any) => String((e as any)?.id ?? '');
  const byId: Record<string, any> = {};
  for (const e of (all as any[])) { const k = id(e); if (k) byId[k] = e; }
  const ids = (rows: any[]) => rows.map(id).filter((k) => k && byId[k]);
  const active = (all as any[]).filter((e) => isManagementPendingEnquiry(e as any));
  const history = (all as any[]).filter((e) => isManagementHistoryEnquiry(e as any));
  const unprocessed = (all as any[]).filter(
    (e) => !isManagementHistoryEnquiry(e as any) && (((e as any).items ?? []).length > 0),
  );
  const empty = (all as any[]).filter((e) => (((e as any).items ?? []).length === 0));
  const procPending = (all as any[]).filter((e) => isProcurementPendingEnquiry(e as any));
  const procHistory = (all as any[]).filter((e) => isProcurementHistoryEnquiry(e as any));
  return {
    byId,
    active: ids(active),
    unprocessed: ids(unprocessed),
    history: ids(history),
    empty: ids(empty),
    procPending: ids(procPending),
    procHistory: ids(procHistory),
    historyTotal: history.length,
    computedAt: new Date().toISOString(),
  };
}

/** Cached read: at most one full scan per TTL no matter how many viewers.
 *  Expands the store-once KV value back into row arrays (same shapes as
 *  before — consumers are untouched). */
export async function getManagementQueues(store: EnquiryStore): Promise<ManagementQueues> {
  const c = await cached<CachedQueues>(MGMT_QUEUES_KEY, MGMT_QUEUES_TTL_MS, () =>
    computeManagementQueues(store),
  );
  const rows = (keys: string[]) => keys.map((k) => c.byId[k]).filter(Boolean);
  return {
    active: rows(c.active),
    unprocessed: rows(c.unprocessed),
    history: rows(c.history),
    historyTotal: c.historyTotal,
    empty: rows(c.empty),
    procPending: rows(c.procPending),
    procHistory: rows(c.procHistory),
    computedAt: c.computedAt,
  };
}

/** Call after every enquiry write (create/update/delete/claim/requirement). */
export async function invalidateManagementQueues(): Promise<void> {
  try {
    await cacheDel(MGMT_QUEUES_KEY);
  } catch { /* best-effort */ }
}
