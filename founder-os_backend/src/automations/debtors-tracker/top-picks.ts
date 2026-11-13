/**
 * Debtors Tracker — TEMPORARY Top-receivables pins (2026-11-13).
 *
 * The accountant hand-pins priority customers for a collection drive. These
 * rows are the MANUAL pins only; the dashboard's auto top-N (by gross due,
 * client-side) unions with them for the Top chip. Drop this module with
 * migration 0140 when the drive ends.
 */
import { prisma } from '../../shared/prisma';
import { DebtorsTrackerError } from './errors';
import { invalidateDebtorsCache } from './cache';
import type { TopPick } from './types';

export type { TopPick };

const ACTOR_MAX = 120;

/** Shared auto Top-N size (Setting row — every dashboard reads the same N). */
export const TOP_N_KEY = 'debtors:top_n';
export const TOP_DEFAULT_N = 20;
const TOP_N_MAX = 500;

function normalizeTopN(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return TOP_DEFAULT_N;
  return Math.min(TOP_N_MAX, Math.max(0, Math.floor(n)));
}

/** Shared Top-N (accountant-set; defaults to 20 before the first save). */
export async function getTopN(): Promise<number> {
  try {
    const row: any = await prisma.setting.findUnique({ where: { key: TOP_N_KEY } });
    const v = row ? String((row as any).value ?? '') : '';
    if (!v.trim()) return TOP_DEFAULT_N;
    return normalizeTopN(v);
  } catch {
    return TOP_DEFAULT_N;
  }
}

/** Accounts-only: set the shared Top-N for every dashboard. */
export async function setTopN(n: unknown): Promise<number> {
  const value = normalizeTopN(n);
  await prisma.setting.upsert({
    where: { key: TOP_N_KEY },
    update: { value: String(value) },
    create: { key: TOP_N_KEY, value: String(value) },
  });
  await invalidateDebtorsCache();
  return value;
}

function pickView(row: any): TopPick {
  return {
    customerKey: String(row.customerKey || ''),
    customerName: String(row.customerName || ''),
    pickedBy: String(row.pickedBy || ''),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ''),
  };
}

/** All manual pins (customer keys), oldest first. */
export async function listTopPicks(): Promise<TopPick[]> {
  const rows: any[] = await (prisma as any).debtorsTopPick.findMany({
    orderBy: { createdAt: 'asc' },
  }).catch(() => []);
  return rows.map(pickView);
}

/** Pin one customer (idempotent — re-pinning keeps the original row). */
export async function addTopPick(customerKey: string, pickedBy: string): Promise<TopPick> {
  const key = String(customerKey || '').trim().toLowerCase();
  if (!key) throw new DebtorsTrackerError('Customer key is required', 400);
  const contact: any = await prisma.paymentCustomer.findFirst({ where: { customerKey: key } });
  if (!contact) throw new DebtorsTrackerError('Customer not found', 404);
  const actor = String(pickedBy ?? '').trim().slice(0, ACTOR_MAX);
  const existing: any = await (prisma as any).debtorsTopPick.findUnique({ where: { customerKey: key } }).catch(() => null);
  if (existing) return pickView(existing);
  const created: any = await (prisma as any).debtorsTopPick.create({
    data: {
      customerKey: key,
      customerName: String(contact.customerName || ''),
      pickedBy: actor,
    },
  });
  await invalidateDebtorsCache();
  return pickView(created);
}

/** Unpin one customer (idempotent). */
export async function removeTopPick(customerKey: string): Promise<void> {
  const key = String(customerKey || '').trim().toLowerCase();
  if (!key) throw new DebtorsTrackerError('Customer key is required', 400);
  await (prisma as any).debtorsTopPick.deleteMany({ where: { customerKey: key } }).catch(() => null);
  await invalidateDebtorsCache();
}
