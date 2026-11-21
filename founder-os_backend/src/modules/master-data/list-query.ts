// list-query.ts — the Customer Master list, filtered/sorted/paged in SQL
// (founder paging standard 2026-11-21). Replaces the whole-book payload the
// browser used to filter: the screen now asks for one page of 50 plus COUNT
// totals, and the KPI tiles/filter options come from GROUP BY queries.
//
// Semantics mirror the retired client predicates (frontend master-data
// filters.ts `matchesFilters`/`matchesQuery`/`compareRows`/`summarizeRows`/
// `buildFilterOptions`) column for column — see the expressions below, which
// reproduce parse.ts `toCustomer` normalisation (trim, 'Unspecified' type,
// city fallback, inactive prefix, open review default).
import { cached, cacheDelPrefix } from '../../shared/cache';
import { likePattern, pagedQuery, searchClause, type Paged, type PageRequest } from '../../shared/paging';
import { toCustomer } from './parse';
import { LIST_COLUMNS, LIVE_WHERE, lastAuditAt, listRegions, masterDb } from './store';
import type { MasterCustomer, MasterSummary } from './types';

export type CustomerSortKey = 'name' | 'region' | 'city' | 'type' | 'est' | 'lastEst' | 'so' | 'lastSo' | 'status';

export interface CustomerFilters {
  region: string;
  status: string;
  pipeline: string;
  typeBase: string;
  state: string;
  district: string;
  subArea: string;
  owner: string;
  /** '' | 'all' | 'open' | 'reviewed' | a confidence tier. */
  duplicates: string;
  hasEmail: boolean;
  hasPhone: boolean;
  hasGstin: boolean;
  hasPincode: boolean;
  sort: CustomerSortKey;
  dir: 'asc' | 'desc';
}

// ── Column expressions (toCustomer normalisation, in SQL) ────────────────────
const T = (col: string) => `TRIM(COALESCE(${col}, ''))`;
const TYPE_BASE = `COALESCE(NULLIF(${T('customerTypeBase')}, ''), 'Unspecified')`;
const CITY = `COALESCE(NULLIF(${T('cityVerified')}, ''), ${T('cityZoho')})`;
const INACTIVE = `(LOWER(${T('status')}) LIKE 'inactive%')`;
const HAS_PHONE = `(${T('phonesJson')} NOT IN ('', '[]'))`;
const HAS_EMAIL = `(${T('emailsJson')} NOT IN ('', '[]'))`;
const REVIEW = `(CASE WHEN duplicateReview IN ('keep-master', 'ignored') THEN duplicateReview ELSE 'open' END)`;
const IS_DUP = `(${T('duplicateGroup')} <> '')`;
const NEVER_TOUCHED = `(COALESCE(estimateCount, 0) <= 0 AND COALESCE(salesOrderCount, 0) <= 0)`;

/** Search haystack — same fields as the retired client `haystack()`. */
const SEARCH_COLUMNS = [
  'displayName', 'companyName', 'contactPerson', 'designation', CITY, 'state', 'district',
  'subArea', 'pincode', 'gstin', 'owner', 'customerType', TYPE_BASE, 'customerTypeTag',
  'duplicateGroup', 'suggestedAction', 'emailsJson', 'phonesJson', 'zohoCustomerId',
];

const SORT_SQL: Record<CustomerSortKey, string> = {
  name: 'displayName COLLATE NOCASE',
  region: `${T('region')} COLLATE NOCASE`,
  city: `${CITY} COLLATE NOCASE`,
  type: `${TYPE_BASE} COLLATE NOCASE`,
  est: 'COALESCE(estimateCount, 0)',
  so: 'COALESCE(salesOrderCount, 0)',
  lastEst: `COALESCE(lastEstimateDate, '')`,
  lastSo: `COALESCE(lastSalesOrderDate, '')`,
  status: `(CASE WHEN ${INACTIVE} THEN 'Inactive' ELSE 'Active' END)`,
};

const truthy = (v: string | undefined) => v === '1' || v === 'true';

export function parseCustomerFilters(get: (key: string) => string | undefined): CustomerFilters {
  const s = (k: string) => String(get(k) ?? '').trim().slice(0, 120);
  const sort = s('sort') as CustomerSortKey;
  return {
    region: s('region'), status: s('status'), pipeline: s('pipeline'), typeBase: s('typeBase'),
    state: s('state'), district: s('district'), subArea: s('subArea'), owner: s('owner'),
    duplicates: s('duplicates'),
    hasEmail: truthy(get('hasEmail')), hasPhone: truthy(get('hasPhone')),
    hasGstin: truthy(get('hasGstin')), hasPincode: truthy(get('hasPincode')),
    sort: sort in SORT_SQL ? sort : 'name',
    dir: s('dir') === 'desc' ? 'desc' : 'asc',
  };
}

/** WHERE parts for a filter set + search (mirrors client matchesFilters). */
export function customerWhere(f: Partial<CustomerFilters>, q: string): { where: string[]; binds: unknown[] } {
  const where: string[] = [LIVE_WHERE];
  const binds: unknown[] = [];
  const eq = (expr: string, v: string | undefined) => { if (v) { where.push(`${expr} = ?`); binds.push(v); } };
  eq(T('region'), f.region);
  if (f.status === 'Inactive') where.push(INACTIVE);
  else if (f.status === 'Active') where.push(`NOT ${INACTIVE}`);
  eq(T('pipelineStage'), f.pipeline);
  eq(TYPE_BASE, f.typeBase);
  eq(T('state'), f.state);
  eq(T('district'), f.district);
  eq(T('subArea'), f.subArea);
  eq(T('owner'), f.owner);
  if (f.hasEmail) where.push(HAS_EMAIL);
  if (f.hasPhone) where.push(HAS_PHONE);
  if (f.hasGstin) where.push(`${T('gstin')} <> ''`);
  if (f.hasPincode) where.push(`${T('pincode')} <> ''`);
  if (f.duplicates) {
    where.push(IS_DUP);
    if (f.duplicates === 'open') where.push(`${REVIEW} = 'open'`);
    else if (f.duplicates === 'reviewed') where.push(`${REVIEW} <> 'open'`);
    else if (f.duplicates !== 'all') eq(T('duplicateConfidence'), f.duplicates);
  }
  // A numeric token also matches phone digits ("98765-43210" → 9876543210).
  const search = searchClause(SEARCH_COLUMNS, q, (word) => {
    const d = word.replace(/\D/g, '');
    return d.length >= 3 ? { sql: `phonesJson LIKE ? ESCAPE '\\'`, binds: [likePattern(d)] } : null;
  });
  if (search.sql) { where.push(search.sql); binds.push(...search.binds); }
  return { where, binds };
}

function orderBy(f: Pick<CustomerFilters, 'sort' | 'dir'>): string {
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  return `${SORT_SQL[f.sort] ?? SORT_SQL.name} ${dir}, displayName COLLATE NOCASE ASC, id ASC`;
}

/** One page of the book + the COUNT total for the same filters. */
export async function listCustomersPaged(req: PageRequest, f: CustomerFilters): Promise<Paged<MasterCustomer>> {
  const { where, binds } = customerWhere(f, req.q);
  const page = await pagedQuery<any>(masterDb(), {
    select: LIST_COLUMNS, from: 'core_customer', where, binds, orderBy: orderBy(f),
  }, req);
  return { ...page, rows: page.rows.map(toCustomer) };
}

/** Every row matching the filters — the CSV export ("download exactly what
 *  the filters show"). A download, not a list screen, so it is not paged. */
export async function exportCustomers(f: CustomerFilters, q: string): Promise<MasterCustomer[]> {
  const { where, binds } = customerWhere(f, q);
  const res = await masterDb()
    .prepare(`SELECT ${LIST_COLUMNS} FROM core_customer WHERE ${where.join(' AND ')} ORDER BY ${orderBy(f)} LIMIT 20000`)
    .bind(...binds).all();
  return ((res?.results ?? []) as any[]).map(toCustomer);
}

/** Duplicate-review rows for one region (the review tab groups them). */
export async function listDuplicateRows(region: string): Promise<MasterCustomer[]> {
  const { where, binds } = customerWhere({ region, duplicates: 'all' }, '');
  const res = await masterDb()
    .prepare(`SELECT ${LIST_COLUMNS} FROM core_customer WHERE ${where.join(' AND ')} ORDER BY duplicateGroup, displayName COLLATE NOCASE`)
    .bind(...binds).all();
  return ((res?.results ?? []) as any[]).map(toCustomer);
}

const SUMMARY_PREFIX = 'master:summary:v1:';
const SUMMARY_TTL_MS = 5 * 60 * 1000;

export async function invalidateMasterSummaries(): Promise<void> {
  try { await cacheDelPrefix(SUMMARY_PREFIX); } catch { /* best-effort */ }
}

const sortedText = (rows: any[]) => rows.map((r) => String(r.v ?? '')).filter(Boolean).sort((a, b) => a.localeCompare(b));

/** Header + region tabs (whole book) and the region-scoped KPI tiles and
 *  filter options (mirrors client summarizeRows/buildFilterOptions). */
export async function getMasterSummary(region: string, state: string): Promise<MasterSummary> {
  return cached(`${SUMMARY_PREFIX}${region}|${state}`, SUMMARY_TTL_MS, async () => {
    const db = masterDb();
    const scope = customerWhere({ region }, '');
    const W = scope.where.join(' AND ');
    const b = scope.binds;
    const distinct = (expr: string, extra = '', extraBinds: unknown[] = []) =>
      db.prepare(`SELECT DISTINCT ${expr} AS v FROM core_customer WHERE ${W}${extra}`).bind(...b, ...extraBinds);
    const [byRegion, tiles, dups, types, states, districts, subAreas, owners, pipelines] = await db.batch([
      db.prepare(`SELECT ${T('region')} AS r, COUNT(*) AS n FROM core_customer WHERE ${LIVE_WHERE} GROUP BY 1`),
      db.prepare(
        `SELECT COUNT(*) AS total, SUM(${INACTIVE}) AS inactive, SUM(${NEVER_TOUCHED}) AS neverTouched,
                SUM(COALESCE(salesOrderCount, 0) > 0) AS withOrders, SUM(NOT ${HAS_PHONE}) AS noPhone,
                SUM(NOT ${HAS_EMAIL}) AS noEmail, SUM(${T('gstin')} = '') AS noGstin, SUM(${T('pincode')} = '') AS noPincode
           FROM core_customer WHERE ${W}`,
      ).bind(...b),
      db.prepare(
        `SELECT COUNT(*) AS groups, COALESCE(SUM(open), 0) AS openGroups FROM (
           SELECT ${T('duplicateGroup')} AS g, MAX(${REVIEW} = 'open') AS open
             FROM core_customer WHERE ${W} AND ${IS_DUP} GROUP BY g)`,
      ).bind(...b),
      distinct(TYPE_BASE),
      distinct(T('state')),
      // No state picked → no district list (districts belong to a state).
      state ? distinct(T('district'), ` AND ${T('state')} = ?`, [state]) : distinct(T('district'), ' AND 0'),
      distinct(T('subArea')),
      distinct(T('owner')),
      distinct(T('pipelineStage')),
    ]);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of ((byRegion as any)?.results ?? []) as any[]) {
      const n = Number(r.n) || 0;
      total += n;
      if (r.r) counts[String(r.r)] = n;
    }
    const t = (((tiles as any)?.results ?? [])[0] ?? {}) as any;
    const d = (((dups as any)?.results ?? [])[0] ?? {}) as any;
    const scopedTotal = Number(t.total) || 0;
    const rowsOf = (x: any) => ((x as any)?.results ?? []) as any[];
    const [regions, updatedAt] = await Promise.all([listRegions(), lastAuditAt()]);
    return {
      updatedAt,
      regions,
      total,
      byRegion: counts,
      regionIds: Object.keys(counts).sort(),
      summary: {
        total: scopedTotal,
        inactive: Number(t.inactive) || 0,
        active: scopedTotal - (Number(t.inactive) || 0),
        neverTouched: Number(t.neverTouched) || 0,
        withOrders: Number(t.withOrders) || 0,
        duplicateGroups: Number(d.groups) || 0,
        duplicateOpenGroups: Number(d.openGroups) || 0,
        noPhone: Number(t.noPhone) || 0,
        noEmail: Number(t.noEmail) || 0,
        noGstin: Number(t.noGstin) || 0,
        noPincode: Number(t.noPincode) || 0,
      },
      options: {
        types: sortedText(rowsOf(types)),
        states: sortedText(rowsOf(states)),
        districts: state ? sortedText(rowsOf(districts)) : [],
        subAreas: sortedText(rowsOf(subAreas)),
        owners: sortedText(rowsOf(owners)),
        pipelines: sortedText(rowsOf(pipelines)),
      },
    };
  });
}
