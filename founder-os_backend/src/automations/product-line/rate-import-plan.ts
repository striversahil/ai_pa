// rate-import-plan.ts — the pure SQL a bulk paste turns into.
//
// A paste lands 250–300 quotes at once. Doing that through `createRate()` per
// row meant ~14 network round trips PER ROW (vendor read, product read, INSERT,
// the shim's post-insert SELECT, one spec-index batch, 6 KV invalidations, 2
// KV catalogue reads) — 4k+ sequential round trips, which is why the button
// crawled. This module turns fully-validated rows into plain INSERT statements
// so one D1 `batch()` carries a whole chunk: no reads, no per-row invalidation.
//
// Pure on purpose (no prisma, no KV, no fetch): the guard bundles this file and
// counts the statements for a 300-row fixture.
import { specIndexRows } from './kyp-schema';

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

export interface PlannedRateRow {
  /** 1-based row number in the paste (for failure attribution). */
  index: number;
  /** Pre-generated id — D1 has no server default for it. */
  id: string;
  /** VendorRate columns, already mapped + schema-validated. */
  data: Record<string, unknown>;
}

/** Statements per `db.batch()` call. One batch is ONE round trip.
 *  Deliberately conservative: a paste of 300 quotes × ~7 specs is ~2.4k
 *  statements, i.e. ~48 round trips instead of ~4.2k. */
export const IMPORT_STATEMENT_CHUNK = 50;

const qid = (name: string) => `"${name.replace(/"/g, '')}"`;

/** D1 binds strings/numbers/null only — booleans become 1/0 here. */
function bindValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** `INSERT INTO VendorRate (cols) VALUES (?, …)` for one prepared row. */
export function rateInsertStatement(rate: PlannedRateRow): SqlStatement {
  const cols = Object.keys(rate.data);
  const params = cols.map((c) => bindValue(rate.data[c]));
  return {
    sql: `INSERT INTO VendorRate (${cols.map(qid).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    params,
  };
}

/** One VendorRateSpec row per answered spec value (the typed query mirror). */
export function specIndexInsertStatements(rateId: string, attrValues: unknown, updatedAt: string): SqlStatement[] {
  let specs: Record<string, unknown> = {};
  if (attrValues && typeof attrValues === 'object' && !Array.isArray(attrValues)) {
    specs = attrValues as Record<string, unknown>;
  } else if (typeof attrValues === 'string' && attrValues.trim()) {
    try {
      const parsed = JSON.parse(attrValues);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) specs = parsed;
    } catch {
      specs = {};
    }
  }
  return specIndexRows(specs).map((row) => ({
    sql: 'INSERT INTO VendorRateSpec (rateId, attrKey, valueText, valueNum, updatedAt) VALUES (?, ?, ?, ?, ?)',
    params: [rateId, row.attrKey, row.valueText, row.valueNum, updatedAt],
  }));
}

/** Every statement one paste row needs, kept together for failure attribution. */
export function planRateRow(rate: PlannedRateRow, updatedAt: string): { index: number; statements: SqlStatement[] } {
  return {
    index: rate.index,
    statements: [rateInsertStatement(rate), ...specIndexInsertStatements(rate.id, rate.data.attrValues, updatedAt)],
  };
}

/**
 * Group planned rows into `db.batch()` chunks by STATEMENT count. A row is
 * never split across chunks, so retrying one chunk cannot half-write a quote.
 */
export function chunkPlannedRows(
  rows: { index: number; statements: SqlStatement[] }[],
  size = IMPORT_STATEMENT_CHUNK,
): { index: number; statements: SqlStatement[] }[][] {
  const max = Math.max(1, Math.floor(size) || IMPORT_STATEMENT_CHUNK);
  const out: { index: number; statements: SqlStatement[] }[][] = [];
  let current: { index: number; statements: SqlStatement[] }[] = [];
  let count = 0;
  for (const row of rows) {
    const n = row.statements.length;
    if (current.length && count + n > max) {
      out.push(current);
      current = [];
      count = 0;
    }
    current.push(row);
    count += n;
  }
  if (current.length) out.push(current);
  return out;
}

/** `INSERT INTO Vendor (…)` for a vendor the operator approved (`create`). */
export function vendorInsertStatement(vendor: {
  id: string;
  name: string;
  location: string;
  contactPerson: string;
  contactPhone1: string;
  contactPhone2: string;
  address: string;
  yearEstablished: number | null;
  vendorType: string;
  now: string;
}): SqlStatement {
  return {
    sql:
      'INSERT INTO Vendor (id, name, contactPerson, contactPhone1, contactPhone2, location, address, ' +
      'yearEstablished, vendorType, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    params: [
      vendor.id,
      vendor.name,
      vendor.contactPerson || null,
      vendor.contactPhone1 || null,
      vendor.contactPhone2 || null,
      vendor.location || null,
      vendor.address || null,
      vendor.yearEstablished ?? null,
      vendor.vendorType || 'manufacturer',
      vendor.now,
      vendor.now,
    ],
  };
}
