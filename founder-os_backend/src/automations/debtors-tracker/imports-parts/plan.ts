// Debtors Tracker — SQL statement builders for paste imports.
//
// Pure (no DB access): `io.ts` collects one statement per mutated row and
// flushes them through batch-write.ts#runStatements, so 1,000 pasted lines
// cost ~20 D1 round trips instead of ~2,000. Money semantics stay in `io.ts`;
// this file only expresses one write as one prepared statement.
import type { SqlStatement } from '../batch-write';

/** Same threshold as received-events.ts#MIN_DELTA. */
export const MIN_RECEIVED_DELTA = 0.005;

/** Statements per `db.batch()` round trip. The product-line rate import
 *  proved 50 (rate-import-write.ts); D1 accepts far more, latency says don't. */
export const STATEMENTS_PER_BATCH = 50;

export function chunkStatements<T>(list: readonly T[], size = STATEMENTS_PER_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const quote = (id: string): string => `"${id}"`;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Bind a value the way the d1-prisma shim does (booleans -> 0/1, Dates -> ISO). */
export function bindValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Never overwritten by an upsert that hits the unique key. */
const IMMUTABLE = new Set(['id', 'createdAt']);

/** INSERT ... ON CONFLICT(<unique>) DO UPDATE SET <every other supplied column>. */
export function upsertStatement(
  table: string,
  data: Record<string, unknown>,
  conflictColumns: string[],
): SqlStatement {
  const columns = Object.keys(data);
  const assignments = columns
    .filter((c) => !IMMUTABLE.has(c) && !conflictColumns.includes(c))
    .map((c) => `${quote(c)} = excluded.${quote(c)}`);
  const sql = [
    `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')})`,
    `VALUES (${columns.map(() => '?').join(', ')})`,
    `ON CONFLICT (${conflictColumns.map(quote).join(', ')}) DO UPDATE SET ${assignments.join(', ')}`,
  ].join(' ');
  return { sql, params: columns.map((c) => bindValue(data[c])) };
}

/** UPDATE <table> SET <data> WHERE <where>. */
export function updateStatement(
  table: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): SqlStatement {
  const set = Object.keys(data);
  const match = Object.keys(where);
  const sql = [
    `UPDATE ${quote(table)} SET ${set.map((c) => `${quote(c)} = ?`).join(', ')}`,
    `WHERE ${match.map((c) => `${quote(c)} = ?`).join(' AND ')}`,
  ].join(' ');
  return {
    sql,
    params: [...set.map((c) => bindValue(data[c])), ...match.map((c) => bindValue(where[c]))],
  };
}

/** New invoice (or a re-paste landing on the composite unique key). */
export function debtorInvoiceInsert(data: Record<string, unknown>): SqlStatement {
  return upsertStatement('DebtorInvoice', data, ['invoiceNo', 'customerName']);
}

export function debtorInvoiceUpdate(id: string, data: Record<string, unknown>): SqlStatement {
  return updateStatement('DebtorInvoice', { id }, data);
}

/** New receipt (or the same receipt re-pasted: dedupKey is unique). */
export function paymentCollectionInsert(data: Record<string, unknown>): SqlStatement {
  return upsertStatement('PaymentCollection', data, ['dedupKey']);
}

export function paymentCollectionUpdate(id: string, data: Record<string, unknown>): SqlStatement {
  return updateStatement('PaymentCollection', { id }, data);
}

export function paymentCustomerInsert(data: Record<string, unknown>): SqlStatement {
  return upsertStatement('PaymentCustomer', data, ['customerKey']);
}

export function paymentCustomerUpdate(customerKey: string, data: Record<string, unknown>): SqlStatement {
  return updateStatement('PaymentCustomer', { customerKey }, data);
}

/**
 * One dated sheet-received movement — the SAME rule as
 * received-events.ts#recordReceivedDelta: a no-op under Rs 0.005, and the
 * statement is only produced for a real change (a re-paste that changes
 * nothing writes nothing).
 */
export function receivedEventStatement(input: {
  invoiceId: string;
  day: string;
  /** Prior row exists: keep the existing id policy (uuid per movement). */
  amountDelta: number;
  importedBy?: string;
  source?: 'import' | 'backfill' | 'manual';
}): SqlStatement | null {
  const invoiceId = String(input.invoiceId ?? '');
  const amountDelta = round2(Number(input.amountDelta) || 0);
  if (!invoiceId || Math.abs(amountDelta) < MIN_RECEIVED_DELTA) return null;
  return {
    sql: 'INSERT INTO "DebtorInvoiceReceivedEvent" ("id", "invoiceId", "day", "amountDelta", "source", "importedBy") VALUES (?, ?, ?, ?, ?, ?)',
    params: [
      crypto.randomUUID(),
      invoiceId,
      input.day,
      amountDelta,
      input.source ?? 'import',
      String(input.importedBy ?? '').slice(0, 200),
    ],
  };
}
