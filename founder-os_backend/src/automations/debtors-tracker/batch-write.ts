/**
 * Debtors Tracker — bulk D1 writes.
 *
 * The d1-prisma shim's `create`/`update` cost TWO round trips each (the write
 * plus a `SELECT *` read-back the tracker never reads). A paste writes one
 * invoice row per line, so that read-back doubled every import: a 1,000-row
 * paste spent ~2,000 sequential round trips in one Worker invocation and was
 * killed by the platform (HTTP 503 with a partially applied paste).
 *
 * `runStatements` ships prepared statements through ONE `db.batch()` per
 * chunk instead, so an import costs ~1 round trip per 50 rows.
 */
import { prisma } from '../../shared/prisma';
import { chunkStatements } from './imports-parts/plan';

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

/** Re-exported so callers can size their own work without importing io. */
export { STATEMENTS_PER_BATCH, chunkStatements } from './imports-parts/plan';

/**
 * Flush statements IN ORDER. A failed chunk is retried statement by statement
 * so one bad row cannot take the other 49 down with it; `bestEffort` swallows
 * the remainder (derived history must never fail an import).
 */
export async function runStatements(
  statements: readonly SqlStatement[],
  opts: { bestEffort?: boolean } = {},
): Promise<void> {
  if (!statements.length) return;
  const db = prisma as any;
  if (typeof db.batch !== 'function') {
    // Express/Postgres fallback (frozen runtime): same SQL, ? -> $n.
    for (const s of statements) {
      let n = 0;
      await db.$executeRawUnsafe(s.sql.replace(/\?/g, () => `$${++n}`), ...s.params);
    }
    return;
  }
  let firstError: unknown = null;
  for (const chunk of chunkStatements(statements)) {
    try {
      await db.batch(chunk);
      continue;
    } catch {
      /* fall through to the per-statement retry */
    }
    for (const statement of chunk) {
      try {
        await db.batch([statement]);
      } catch (e) {
        firstError = firstError ?? e;
      }
    }
  }
  if (firstError && !opts.bestEffort) throw firstError;
}
