// ─────────────────────────────────────────────────────────────────────────────
// crm/list-page.ts — one page of a dispatch tab (founder paging standard
// 2026-11-21): page numbers, 50/page (≤100), search over EVERY order, and the
// real total of the filtered list.
//
// The tab predicates (queues.ts#orderMatchesView) read per-item dispatch state,
// so they run in memory over the ONE cached, uncapped floor scan
// (store-parts/io.ts#selectOrders) — the scan IS the whole table, so search
// and totals cover every order. Only the returned page pays for proof docs.
//
// Never paged: "dispatch-floor" (today's dispatches + overdue) always comes
// back complete — the floor must see all of it at once.
// ─────────────────────────────────────────────────────────────────────────────
import { pageResult, type Paged, type PageRequest } from '../../shared/paging';
import { selectOrders, withProofDocs } from './store-parts/io';
import type { CrmOrderRow, View } from './types';

/** Tabs that always return every matching order on one page. */
export const UNPAGED_VIEWS: ReadonlySet<View> = new Set<View>(['dispatch-floor']);

export async function listOrdersPaged(
  args: { view: View; region: string; today?: string },
  req: PageRequest,
): Promise<Paged<CrmOrderRow>> {
  const all = await selectOrders({ view: args.view, region: args.region, q: req.q, today: args.today });
  if (UNPAGED_VIEWS.has(args.view)) {
    const limit = Math.max(1, all.length);
    return pageResult(await withProofDocs(all), all.length, { page: 1, limit });
  }
  const totalPages = Math.max(1, Math.ceil(all.length / req.limit));
  const page = Math.min(req.page, totalPages);
  const start = (page - 1) * req.limit;
  return pageResult(await withProofDocs(all.slice(start, start + req.limit)), all.length, { page, limit: req.limit });
}
