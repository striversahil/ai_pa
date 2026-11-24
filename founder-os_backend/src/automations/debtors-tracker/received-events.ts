/**
 * Debtors Tracker — dated history of the ageing sheet's "Amount Received".
 *
 * `DebtorInvoice.baseReceived` is a cumulative snapshot overwritten on every
 * paste, so it cannot answer "how much had the sheet recorded on 31 Oct?".
 * Every import now appends the DELTA here (migration 0162), and an as-of view
 * sums the events with `day <= asOf`.
 *
 * Deploy-order safety: the table may not exist yet on a fresh isolate right
 * after the Worker ships. Both helpers swallow that error — reads then fall
 * back to the `lastImportAt` cutoff rule in as-of.ts, which is conservative.
 */
import { prisma } from '../../shared/prisma';
import { dayOf } from './as-of';

export interface ReceivedEvent {
  day: string;
  amount: number;
}

const MIN_DELTA = 0.005;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** invoiceId → dated deltas (invalid stored days are dropped, not guessed). */
export async function loadReceivedEvents(): Promise<Map<string, ReceivedEvent[]>> {
  const out = new Map<string, ReceivedEvent[]>();
  try {
    const rows: any[] = await (prisma as any).debtorInvoiceReceivedEvent.findMany({});
    for (const row of rows ?? []) {
      const invoiceId = String(row.invoiceId ?? '');
      const day = dayOf(row.day);
      if (!invoiceId || !day) continue;
      const list = out.get(invoiceId) ?? [];
      list.push({ day, amount: Number(row.amountDelta) || 0 });
      out.set(invoiceId, list);
    }
  } catch {
    /* pre-migration / storage hiccup — caller falls back */
  }
  return out;
}

/** Append one sheet-received movement (no-op for an unchanged figure). */
export async function recordReceivedDelta(input: {
  invoiceId: string;
  /** IST day the figure became known (the import day). */
  day: string;
  amountDelta: number;
  importedBy?: string;
  source?: 'import' | 'backfill' | 'manual';
}): Promise<void> {
  const invoiceId = String(input.invoiceId ?? '');
  const amountDelta = round2(Number(input.amountDelta) || 0);
  if (!invoiceId || Math.abs(amountDelta) < MIN_DELTA) return;
  try {
    await (prisma as any).debtorInvoiceReceivedEvent.create({
      data: {
        id: crypto.randomUUID(),
        invoiceId,
        day: input.day,
        amountDelta,
        source: input.source ?? 'import',
        importedBy: String(input.importedBy ?? '').slice(0, 200),
      },
    });
  } catch {
    /* never fail an import because history could not be stamped */
  }
}
