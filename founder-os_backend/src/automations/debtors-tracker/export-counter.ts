/**
 * Debtors Tracker — global receivables-export counter.
 *
 * Every "Download as CSV" click writes ONE row; the number stamped into the
 * CSV is COUNT(*) over the log. INSERT-only by design: a read-modify-write
 * counter (e.g. a Setting row) silently drops increments when two people
 * download at the same moment, and this one also keeps who/when/rows.
 *
 * The count is global across all users and devices (founder decision) because
 * the CSV is used as a WhatsApp reminder worklist — the number tells you how
 * many times that worklist has been pulled.
 */
import { prisma } from '../../shared/prisma';

/** Only exports of the overdue-receivables CSV count (per-client ledger does not). */
export const RECEIVABLES_EXPORT_SOURCE = 'receivables-csv';

export interface ReceivablesExportStats {
  /** Total receivables CSV downloads, inclusive of the just-recorded one. */
  count: number;
}

const ACTOR_MAX = 120;

/** Current global count (0 before the first download). */
export async function getReceivablesExportCount(): Promise<number> {
  const n = await (prisma as any).debtorsExportEvent.count();
  return Number(n) || 0;
}

/**
 * Log one download, then return the new global count so the CSV can show the
 * download we are about to hand over (first click → 1, not 0).
 */
export async function recordReceivablesExport(
  opts: { actor?: string; rowCount?: number } = {},
): Promise<ReceivablesExportStats> {
  const rows = Number(opts.rowCount);
  await (prisma as any).debtorsExportEvent.create({
    data: {
      actor: String(opts.actor ?? '').trim().slice(0, ACTOR_MAX),
      source: RECEIVABLES_EXPORT_SOURCE,
      rowCount: Number.isFinite(rows) && rows > 0 ? Math.trunc(rows) : 0,
    },
  });
  return { count: await getReceivablesExportCount() };
}
