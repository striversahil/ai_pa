// spec-index.ts — typed mirror of `VendorRate.attrValues` for spec queries.
//
// Founder decision 2026-11-23: the spec document stays ONE JSON column
// (schema `specs`, D1 `VendorRate.attrValues`), and query speed comes from this
// index table — one row per (quote, spec key) with a text and a numeric value.
// That answers any spec query on any key in milliseconds without one index per
// product/key (366 keys x 103 products would be absurd), and keeps the JSON as
// the single truth:
//
//   SELECT rateId FROM VendorRateSpec
//   WHERE (attrKey = 'brand' AND valueText = 'PIX')
//      OR (attrKey = 'width_mm' AND valueNum BETWEEN 900 AND 1100)
//   GROUP BY rateId HAVING COUNT(DISTINCT attrKey) = 2;
//
// Writes are synced in ONE D1 batch with the quote row (see rate-specs.ts).
import { prisma } from '../../shared/prisma-d1';
import { specIndexRows } from './kyp-schema';

const TABLE = 'VendorRateSpec';

export interface SpecStatement {
  sql: string;
  params: unknown[];
}

/** DELETE + one INSERT per spec value, ready for `prisma.batch(...)`. */
export function specIndexStatements(rateId: string, specs: Record<string, unknown>): SpecStatement[] {
  const stmts: SpecStatement[] = [{ sql: `DELETE FROM ${TABLE} WHERE rateId = ?`, params: [rateId] }];
  const now = new Date().toISOString();
  for (const row of specIndexRows(specs)) {
    stmts.push({
      sql: `INSERT INTO ${TABLE} (rateId, attrKey, valueText, valueNum, updatedAt) VALUES (?, ?, ?, ?, ?)`,
      params: [rateId, row.attrKey, row.valueText, row.valueNum, now],
    });
  }
  return stmts;
}

export async function syncSpecIndex(rateId: string, specs: Record<string, unknown>): Promise<void> {
  const stmts = specIndexStatements(rateId, specs);
  if (!stmts.length) return;
  await (prisma as any).batch(stmts);
}

export async function clearSpecIndex(rateId: string): Promise<void> {
  await (prisma as any).$executeRawUnsafe(`DELETE FROM ${TABLE} WHERE rateId = ?`, rateId);
}

export type SpecOp = 'eq' | 'in' | 'gte' | 'lte' | 'between';

export interface SpecFilter {
  key: string;
  op: SpecOp;
  values: string[];
  nums: number[];
}

const KEY_RE = /^[a-z0-9_]{1,64}$/;
const num = (v: string): number => Number(v);

/**
 * `?spec=brand:PIX&spec=width_mm:>=1000&spec=material:in:ss,gi&spec=thickness_mm:2..5`
 * (repeatable; every filter must match → AND across keys).
 */
export function parseSpecFilters(raw: unknown): SpecFilter[] {
  const list = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
  const out: SpecFilter[] = [];
  for (const entry of list.slice(0, 12)) {
    const text = String(entry);
    const i = text.indexOf(':');
    if (i <= 0) continue;
    const key = text.slice(0, i).trim().toLowerCase();
    if (!KEY_RE.test(key)) continue;
    const expr = text.slice(i + 1).trim();
    if (!expr) continue;
    if (expr.startsWith('>=')) out.push({ key, op: 'gte', values: [expr.slice(2)], nums: [num(expr.slice(2))] });
    else if (expr.startsWith('<=')) out.push({ key, op: 'lte', values: [expr.slice(2)], nums: [num(expr.slice(2))] });
    else if (expr.includes('..')) {
      const [a, b] = expr.split('..');
      out.push({ key, op: 'between', values: [a, b], nums: [num(a), num(b)] });
    } else if (expr.toLowerCase().startsWith('in:')) {
      const vals = expr.slice(3).split(',').map((v) => v.trim()).filter(Boolean);
      if (vals.length) out.push({ key, op: 'in', values: vals, nums: vals.map(num) });
    } else out.push({ key, op: 'eq', values: [expr], nums: [num(expr)] });
  }
  return out.filter((f) => (f.op === 'eq' || f.op === 'in' ? f.values.every((v) => v !== '') : f.nums.every((n) => Number.isFinite(n))));
}

/** `(rateId IN (…))` fragment for the rates list; null when there are no filters. */
export function specFilterSubquery(filters: SpecFilter[]): { sql: string; params: unknown[] } | null {
  if (!filters.length) return null;
  const alts: string[] = [];
  const params: unknown[] = [];
  for (const f of filters) {
    if (f.op === 'eq') {
      alts.push('(attrKey = ? AND valueText = ?)');
      params.push(f.key, f.values[0]);
    } else if (f.op === 'in') {
      alts.push(`(attrKey = ? AND valueText IN (${f.values.map(() => '?').join(',')}))`);
      params.push(f.key, ...f.values);
    } else if (f.op === 'between') {
      alts.push('(attrKey = ? AND valueNum BETWEEN ? AND ?)');
      params.push(f.key, f.nums[0], f.nums[1]);
    } else {
      alts.push(`(attrKey = ? AND valueNum ${f.op === 'gte' ? '>=' : '<='} ?)`);
      params.push(f.key, f.nums[0]);
    }
  }
  return {
    sql: `SELECT rateId FROM ${TABLE} WHERE ${alts.join(' OR ')} GROUP BY rateId HAVING COUNT(DISTINCT attrKey) = ${filters.length}`,
    params,
  };
}

/** Quote ids matching every filter (used by the rates list + ad-hoc lookups). */
export async function rateIdsMatchingSpecs(filters: SpecFilter[], limit = 500): Promise<string[]> {
  const sub = specFilterSubquery(filters);
  if (!sub) return [];
  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT rateId FROM (${sub.sql}) LIMIT ${Math.max(1, Math.min(5000, Number(limit) || 500))}`,
    ...sub.params,
  );
  return (rows ?? []).map((r: any) => String(r.rateId)).filter(Boolean);
}
