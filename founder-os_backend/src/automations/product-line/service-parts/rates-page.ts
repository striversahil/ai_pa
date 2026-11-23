// rates-page.ts — the Rates sheet: one page of vendor quotes + COUNT total,
// searched and FILTERED server-side over the whole table (founder paging
// standard 2026-11-21, extended 2026-11-23 with the sheet filters + 500 cap).
// Replaces the old `take: 2000` rates slice in the dashboard payload.
import type { ProductSummary, RateRow } from "../types";
import { getD1Database } from "../../../shared/prisma-d1";
import { pagedQuery, searchClause, type Paged, type PageRequest } from "../../../shared/paging";
import { toRateRow } from "./pure";
import { getProductDetail } from "./io";
import { parseSpecFilters, specFilterSubquery } from "../spec-index";
import { findLiveProduct, getLiveCatalog } from "../catalog-live";
import { missingFieldsFor } from "./missing";

/** The sheet is a spreadsheet: 500 rows per page (founder decision 2026-11-23). */
export const RATES_PAGE_MAX = 500;

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
  category?: string;
  /** Only the quotes one paste created (the batch log's "view rates"). */
  batchId?: string;
  /** `?spec=brand:PIX&spec=width_mm:>=1000` — typed spec filters (indexed). */
  spec?: string | string[];
  priceMin?: string;
  priceMax?: string;
  netMin?: string;
  netMax?: string;
  leadMin?: string;
  leadMax?: string;
  from?: string;
  to?: string;
  /** '1' | 'any' → quotes that still miss a required field;
   *  'spec' → only spec gaps; 'envelope' → only unit/moq/price/delivery/date. */
  missing?: string;
  /** 'price' | 'net' | 'lead' | 'date' | 'vendor' | 'product' (+ '-asc' suffix). */
  sort?: string;
}

/** Columns the search box matches (every word must hit one of them). */
const SEARCH_COLUMNS = ["p.name", "v.name", "r.attrValues", "r.notes", "r.unit", "r.moq", "r.enquiryRef"] as const;

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const dateIso = (v: string | undefined): string | null => {
  if (!v || !String(v).trim()) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const ORDER: Record<string, string> = {
  date: "r.quotedAt DESC, r.id DESC",
  "date-asc": "r.quotedAt ASC, r.id ASC",
  price: "r.pricePerUnit DESC",
  "price-asc": "r.pricePerUnit ASC",
  net: "r.baseRate DESC",
  "net-asc": "r.baseRate ASC",
  lead: "r.deliveryDays DESC",
  "lead-asc": "r.deliveryDays ASC",
  vendor: "v.name ASC, r.quotedAt DESC",
  product: "p.name ASC, r.quotedAt DESC",
};

export async function listRatesPaged(req: PageRequest, filter: RateListFilter = {}): Promise<Paged<RateRow>> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.productId) { where.push("r.productId = ?"); binds.push(filter.productId); }
  if (filter.vendorId) { where.push("r.vendorId = ?"); binds.push(filter.vendorId); }
  if (filter.category) { where.push("p.category = ?"); binds.push(filter.category); }
  if (filter.batchId) { where.push("r.batchId = ?"); binds.push(filter.batchId); }
  if (filter.status === "on") where.push("r.active = 1");
  if (filter.status === "off") where.push("r.active = 0");

  const priceMin = num(filter.priceMin);
  if (priceMin !== null) { where.push("r.pricePerUnit >= ?"); binds.push(priceMin); }
  const priceMax = num(filter.priceMax);
  if (priceMax !== null) { where.push("r.pricePerUnit <= ?"); binds.push(priceMax); }
  const netMin = num(filter.netMin);
  if (netMin !== null) { where.push("r.baseRate >= ?"); binds.push(netMin); }
  const netMax = num(filter.netMax);
  if (netMax !== null) { where.push("r.baseRate <= ?"); binds.push(netMax); }
  const leadMin = num(filter.leadMin);
  if (leadMin !== null) { where.push("r.deliveryDays >= ?"); binds.push(leadMin); }
  const leadMax = num(filter.leadMax);
  if (leadMax !== null) { where.push("r.deliveryDays <= ?"); binds.push(leadMax); }
  const from = dateIso(filter.from);
  if (from) { where.push("r.quotedAt >= ?"); binds.push(from); }
  const to = dateIso(filter.to);
  if (to) { where.push("r.quotedAt <= ?"); binds.push(to); }
  const specGap = "(r.missingSpecs IS NOT NULL AND r.missingSpecs != '' AND r.missingSpecs != '[]')";
  const envelopeGap =
    "(r.unit IS NULL OR TRIM(r.unit) = '' OR r.moq IS NULL OR TRIM(r.moq) = '' " +
    "OR r.pricePerUnit IS NULL OR r.pricePerUnit <= 0 OR r.deliveryDays IS NULL OR r.quotedAt IS NULL)";
  if (filter.missing === "1" || filter.missing === "any") where.push(`(${specGap} OR ${envelopeGap})`);
  else if (filter.missing === "spec") where.push(specGap);
  else if (filter.missing === "envelope") where.push(envelopeGap);

  const specs = parseSpecFilters(filter.spec);
  const specSub = specFilterSubquery(specs);
  if (specSub) { where.push(`r.id IN (${specSub.sql})`); binds.push(...specSub.params); }

  const search = searchClause(SEARCH_COLUMNS, req.q);
  if (search.sql) { where.push(search.sql); binds.push(...search.binds); }

  const page = await pagedQuery<any>(getD1Database(), {
    select: "r.*, v.name AS _vendorName, v.vendorType AS _vendorType, p.name AS _productName, p.category AS _category",
    from: "VendorRate r LEFT JOIN Vendor v ON v.id = r.vendorId LEFT JOIN ProductItem p ON p.id = r.productId",
    where,
    binds,
    orderBy: ORDER[String(filter.sort ?? "date")] ?? ORDER.date,
  }, { ...req, limit: Math.min(RATES_PAGE_MAX, Math.max(1, req.limit)) });

  // The badge and its tooltip come from the LIVE contract, not the stored
  // snapshot: a spec made required five minutes ago must show up immediately.
  const catalog = await getLiveCatalog();
  return {
    ...page,
    rows: page.rows.map((r) => {
      const row = toRateRow(r, {
        vendorName: r._vendorName != null ? String(r._vendorName) : null,
        vendorType: r._vendorType != null ? String(r._vendorType) : null,
        productId: r.productId != null ? String(r.productId) : null,
        productName: r._productName != null ? String(r._productName) : null,
      });
      const product = findLiveProduct(catalog, { id: r.productId });
      const missingFields = missingFieldsFor(row, product);
      return {
        ...row,
        category: r._category != null ? String(r._category) : null,
        missingFields,
      };
    }),
  };
}

/** One quote + the live spec contract for its product (the drawer). */
export async function getRateDetail(id: string) {
  const db = getD1Database();
  const row = await db
    .prepare(
      "SELECT r.*, v.name AS _vendorName, v.vendorType AS _vendorType, v.contactPerson AS _contactPerson, " +
        "v.contactPhone1 AS _phone1, v.contactPhone2 AS _phone2, v.location AS _vendorLocation, " +
        "p.name AS _productName, p.category AS _category " +
        "FROM VendorRate r LEFT JOIN Vendor v ON v.id = r.vendorId LEFT JOIN ProductItem p ON p.id = r.productId " +
        "WHERE r.id = ?",
    )
    .bind(String(id))
    .first();
  if (!row) throw new Error('rate not found');
  const catalog = await getLiveCatalog();
  const product = findLiveProduct(catalog, { id: row.productId });
  return {
    rate: {
      ...toRateRow(row, {
        vendorName: row._vendorName != null ? String(row._vendorName) : null,
        vendorType: row._vendorType != null ? String(row._vendorType) : null,
        productId: row.productId != null ? String(row.productId) : null,
        productName: row._productName != null ? String(row._productName) : null,
      }),
      category: row._category != null ? String(row._category) : null,
      missingFields: missingFieldsFor(
        {
          attrValues: row.attrValues,
          unit: row.unit,
          moq: row.moq,
          pricePerUnit: row.pricePerUnit,
          deliveryDays: row.deliveryDays,
          quotedAt: row.quotedAt,
        },
        product,
      ),
      vendor: row._vendorName
        ? {
            id: String(row.vendorId ?? ''),
            name: String(row._vendorName),
            vendorType: row._vendorType != null ? String(row._vendorType) : '',
            contactPerson: row._contactPerson != null ? String(row._contactPerson) : null,
            contactPhone1: row._phone1 != null ? String(row._phone1) : null,
            contactPhone2: row._phone2 != null ? String(row._phone2) : null,
            location: row._vendorLocation != null ? String(row._vendorLocation) : null,
          }
        : null,
    },
    product: product
      ? { id: product.id, key: product.key, label: product.label, category: product.category, props: product.props, required: product.required }
      : null,
  };
}
