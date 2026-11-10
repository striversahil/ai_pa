/**
 * Dispatch cash ledger — simple in/out cash report for the dispatch floor.
 *
 * One row per movement; the running balance is derived server-side ordered by
 * (day, createdAt). Opening balance = kind 'opening' rows; credits/top-ups =
 * direction 'in'. Writes bust the accounts dashboard KV cache.
 */
import { prisma } from '../../shared/prisma';
import { invalidateAccountsCache, istDateStr } from './service';

export interface CashEntry {
  id: string;
  day: string;
  direction: 'in' | 'out';
  kind: string;
  amount: number;
  party: string;
  purpose: string;
  mode: string;
  ref: string;
  note: string;
  enteredBy: string;
  runningBalance: number;
  createdAt: string;
}

export interface CashSummary {
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  count: number;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function isDay(s: unknown): boolean {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function toCashEntry(row: any, running: number): CashEntry {
  return {
    id: String(row?.id ?? ''),
    day: String(row?.day ?? ''),
    direction: String(row?.direction) === 'in' ? 'in' : 'out',
    kind: String(row?.kind ?? 'expense'),
    amount: round2(Number(row?.amount) || 0),
    party: String(row?.party ?? ''),
    purpose: String(row?.purpose ?? ''),
    mode: String(row?.mode ?? ''),
    ref: String(row?.ref ?? ''),
    note: String(row?.note ?? ''),
    enteredBy: String(row?.enteredBy ?? ''),
    runningBalance: round2(running),
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : String(row?.createdAt ?? ''),
  };
}

export async function listCashEntries(limit = 1000): Promise<{ entries: CashEntry[]; summary: CashSummary }> {
  const rows: any[] = await (prisma as any).dispatchCashEntry.findMany({
    where: { deleted: false },
    orderBy: [{ day: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(2000, Math.floor(limit) || 1000)),
  }).catch(() => []);
  let running = 0;
  let opening = 0;
  let totalIn = 0;
  let totalOut = 0;
  const entries = rows.map((r) => {
    const amt = round2(Number(r?.amount) || 0);
    if (String(r?.direction) === 'in') {
      running = round2(running + amt);
      totalIn = round2(totalIn + amt);
      if (String(r?.kind) === 'opening') opening = round2(opening + amt);
    } else {
      running = round2(running - amt);
      totalOut = round2(totalOut + amt);
    }
    return toCashEntry(r, running);
  });
  // Newest first for the UI; running balance stays in chronological order.
  entries.reverse();
  return {
    entries,
    summary: { opening, totalIn, totalOut, closing: running, count: rows.length },
  };
}

function cleanCashInput(input: any, partial: boolean) {
  const data: Record<string, unknown> = {};
  if (input.day !== undefined) {
    const d = String(input.day || '').slice(0, 10);
    if (!isDay(d)) throw new Error('day must be YYYY-MM-DD');
    data.day = d;
  } else if (!partial) {
    data.day = istDateStr();
  }
  if (input.direction !== undefined) {
    const dir = String(input.direction).toLowerCase();
    if (dir !== 'in' && dir !== 'out') throw new Error("direction must be 'in'|'out'");
    data.direction = dir;
  } else if (!partial) {
    data.direction = 'out';
  }
  if (input.kind !== undefined) {
    const k = String(input.kind).toLowerCase().slice(0, 20) || 'expense';
    if (!['opening', 'credit', 'expense', 'other'].includes(k)) throw new Error('kind must be opening|credit|expense|other');
    data.kind = k;
  } else if (!partial) {
    data.kind = 'expense';
  }
  if (input.amount !== undefined) {
    const n = Number(input.amount);
    if (!Number.isFinite(n) || n <= 0) throw new Error('amount must be > 0');
    data.amount = round2(n);
  } else if (!partial) {
    throw new Error('amount is required');
  }
  for (const f of ['party', 'purpose', 'mode', 'ref', 'note'] as const) {
    if ((input as any)[f] !== undefined) data[f] = String((input as any)[f] ?? '').slice(0, 300);
  }
  if (!partial && !String((data.purpose ?? '') || (data.party ?? '')).trim()) {
    throw new Error('purpose or party is required');
  }
  return data;
}

export async function createCashEntry(input: any, enteredBy: string | null): Promise<CashEntry> {
  const data = cleanCashInput(input || {}, false);
  const row: any = await (prisma as any).dispatchCashEntry.create({
    data: {
      id: crypto.randomUUID(),
      ...(data as any),
      party: String((data as any).party ?? ''),
      purpose: String((data as any).purpose ?? ''),
      enteredBy: String(enteredBy || '').slice(0, 200),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await invalidateAccountsCache();
  const { entries } = await listCashEntries();
  return entries.find((e) => e.id === String(row.id)) ?? toCashEntry(row, 0);
}

export async function updateCashEntry(id: string, input: any): Promise<CashEntry> {
  const existing: any = await (prisma as any).dispatchCashEntry.findUnique({
    where: { id: String(id) },
  }).catch(() => null);
  if (!existing || existing.deleted) throw new Error('cash entry not found');
  const data = cleanCashInput(input || {}, true);
  if (Object.keys(data).length === 0) throw new Error('nothing to update');
  await (prisma as any).dispatchCashEntry.update({
    where: { id: String(existing.id) },
    data: { ...data, updatedAt: new Date() },
  });
  await invalidateAccountsCache();
  const { entries } = await listCashEntries();
  const found = entries.find((e) => e.id === String(existing.id));
  if (!found) throw new Error('cash entry not found');
  return found;
}

export async function deleteCashEntry(id: string): Promise<void> {
  const existing: any = await (prisma as any).dispatchCashEntry.findUnique({
    where: { id: String(id) },
  }).catch(() => null);
  if (!existing || existing.deleted) throw new Error('cash entry not found');
  await (prisma as any).dispatchCashEntry.update({
    where: { id: String(existing.id) },
    data: { deleted: true, updatedAt: new Date() },
  });
  await invalidateAccountsCache();
}
