// rates-page.ts — the Rates tab list: one page of vendor quotes + COUNT total,
// searched across the WHOLE table (founder paging standard 2026-11-21).
// Replaces the old `take: 2000` rates slice in the dashboard payload.
import type { ProductSummary, RateRow } from "../types";
import { getD1Database } from "../../../shared/prisma-d1";
import { pagedQuery, searchClause, type Paged, type PageRequest } from "../../../shared/paging";
import { toRateRow } from "./pure";
import { getProductDetail } from "./io";

/** Detail screen header: identity + guide + counts, without the rate list
 *  (internal pricing/intake callers keep using getProductDetail for all rates). */
export async function getProductSummary(id: string): Promise<ProductSummary> {
  const d = await getProductDetail(id);
  return {
    product: { ...d.product, activeRateCount: d.rates.filter((r) => r.active).length },
    guide: d.guide,
  };
}

export interface RateListFilter {
  productId?: string;
  vendorId?: string;
  /** 'on' | 'off' | '' (all) */
  status?: string;
}

/** Columns the search box matches (every word must hit one of them). */
const SEARCH_COLUMNS = ["p.name", "v.name", "r.attrValues", "r.notes", "r.unit", "r.moq", "r.enquiryRef"] as const;

export async function listRatesPaged(req: PageRequest, filter: RateListFilter = {}): Promise<Paged<RateRow>> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.productId) { where.push("r.productId = ?"); binds.push(filter.productId); }
  if (filter.vendorId) { where.push("r.vendorId = ?"); binds.push(filter.vendorId); }
  if (filter.status === "on") where.push("r.active = 1");
  if (filter.status === "off") where.push("r.active = 0");
  const search = searchClause(SEARCH_COLUMNS, req.q);
  if (search.sql) { where.push(search.sql); binds.push(...search.binds); }
  const page = await pagedQuery<any>(getD1Database(), {
    select: "r.*, v.name AS _vendorName, v.vendorType AS _vendorType, p.name AS _productName",
    from: "VendorRate r LEFT JOIN Vendor v ON v.id = r.vendorId LEFT JOIN ProductItem p ON p.id = r.productId",
    where,
    binds,
    orderBy: "r.quotedAt DESC, r.id DESC",
  }, req);
  return {
    ...page,
    rows: page.rows.map((r) => toRateRow(r, {
      vendorName: r._vendorName != null ? String(r._vendorName) : null,
      vendorType: r._vendorType != null ? String(r._vendorType) : null,
      productId: r.productId != null ? String(r.productId) : null,
      productName: r._productName != null ? String(r._productName) : null,
    })),
  };
}
