/**
 * Debtors Tracker — customer contact master.
 *
 * Customers are derived from the invoice/receipt ledgers (no customer code in
 * the paste), so the identity key is the normalized customer name. Contacts are
 * stored once per customer and drive the daily WhatsApp reminder.
 */
import { prisma } from '../../shared/prisma';
import { DebtorsTrackerError } from './errors';
import { invalidateDebtorsCache } from './cache';
import { normalizeCustomerKey, normalizeCustomerName } from './types';
import { isValidCustomerSituationInput, normalizeCustomerSituation } from './situation';
import {
  MAX_PROMISE_DAYS, normalizePromiseDays, promiseDateFromDays, promiseDaysFromDate,
} from './promise';
import { isIsoDate, todayIST } from './shared';
import { isValidRegion } from '../telecalling/regions';

export type CustomerContact = {
  id: string;
  customerKey: string;
  customerName: string;
  phone: string;
  email: string;
  region: string;
  whatsappOptIn: boolean;
  optInAt: string | null;
  notes: string;
  /** CRM follow-up state ('' = unset). Editable by sales + accounts. */
  situation: string;
  /** Free-text CRM remarks for the situation. Editable by sales + accounts. */
  situationRemarks: string;
  situationUpdatedAt: string | null;
  situationUpdatedBy: string;
  /** Current promised-to-pay date (IST) — survives a situation change. */
  promisedDate: string | null;
  promisedDays: number | null;
  promisedAt: string | null;
  promisedBy: string;
  updatedBy: string;
};

export type CustomerSeed = { customerName: string; phone?: string; email?: string; region?: string };

/** Human-friendly store: digits with country code where we can infer it. */
export function normalizePhone(raw: unknown): string {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export function isValidPhone(normalized: string): boolean {
  return normalized === '' || (normalized.length >= 8 && normalized.length <= 15);
}

export function normalizeRegion(raw: unknown): string {
  const region = String(raw ?? '').trim().toUpperCase();
  return region === '' || isValidRegion(region) ? region : '';
}

export function isValidRegionInput(raw: unknown): boolean {
  const region = String(raw ?? '').trim().toUpperCase();
  return region === '' || isValidRegion(region);
}

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim();
}

export function isValidEmail(email: string): boolean {
  return email === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function customerKeyOf(name: string): string {
  return normalizeCustomerKey(name);
}

function contactView(row: any): CustomerContact {
  return {
    id: String(row.id),
    customerKey: String(row.customerKey),
    customerName: String(row.customerName || ''),
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    region: String(row.region || ''),
    whatsappOptIn: !!row.whatsappOptIn,
    optInAt: row.optInAt ? String(row.optInAt) : null,
    notes: String(row.notes || ''),
    situation: String((row as any).situation || ''),
    situationRemarks: String((row as any).situationRemarks || ''),
    situationUpdatedAt: (row as any).situationUpdatedAt ? String((row as any).situationUpdatedAt) : null,
    situationUpdatedBy: String((row as any).situationUpdatedBy || ''),
    promisedDate: (row as any).promisedDate ? String((row as any).promisedDate) : null,
    promisedDays: (row as any).promisedDays === null || (row as any).promisedDays === undefined
      ? null
      : Number((row as any).promisedDays),
    promisedAt: (row as any).promisedAt ? String((row as any).promisedAt) : null,
    promisedBy: String((row as any).promisedBy || ''),
    updatedBy: String(row.updatedBy || ''),
  };
}

export async function loadCustomerContacts(): Promise<Map<string, CustomerContact>> {
  const rows: any[] = await prisma.paymentCustomer.findMany({}) as any[];
  const out = new Map<string, CustomerContact>();
  for (const row of rows) out.set(String(row.customerKey), contactView(row));
  return out;
}

/**
 * Ensure a contact row exists for every imported customer and backfill blank
 * phone/email/region from the source sheet. Never overwrites a manually-set value.
 */
export async function ensureCustomers(seeds: CustomerSeed[], updatedBy = ''): Promise<void> {
  const rows: any[] = await prisma.paymentCustomer.findMany({}) as any[];
  const byKey = new Map<string, any>();
  for (const row of rows) byKey.set(String(row.customerKey), row);

  for (const seed of seeds) {
    const name = normalizeCustomerName(seed.customerName);
    if (!name) continue;
    const key = customerKeyOf(name);
    const phone = normalizePhone(seed.phone);
    const email = normalizeEmail(seed.email);
    const region = normalizeRegion(seed.region);
    const existing = byKey.get(key);

    if (!existing) {
      const created = await prisma.paymentCustomer.create({
        data: {
          customerKey: key,
          customerName: name,
          phone: isValidPhone(phone) ? phone : '',
          email: isValidEmail(email) ? email : '',
          region,
          updatedBy,
        },
      }) as any;
      byKey.set(key, created);
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (!existing.phone && phone && isValidPhone(phone)) patch.phone = phone;
    if (!existing.email && email && isValidEmail(email)) patch.email = email;
    if (!existing.region && region) patch.region = region;
    if (!existing.customerName && name) patch.customerName = name;
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date();
      await prisma.paymentCustomer.update({ where: { customerKey: key }, data: patch });
      Object.assign(existing, patch);
    }
  }
}

export async function updateCustomerContact(
  customerKey: string,
  patch: Record<string, unknown>,
  updatedBy: string,
): Promise<CustomerContact> {
  const key = String(customerKey || '').trim().toLowerCase();
  if (!key) throw new DebtorsTrackerError('Customer key is required', 400);

  const existing: any = await prisma.paymentCustomer.findFirst({ where: { customerKey: key } });
  if (!existing) throw new DebtorsTrackerError('Customer not found', 404);

  const data: Record<string, unknown> = { updatedBy: updatedBy || '', updatedAt: new Date() };
  let region: string | undefined;

  if ('phone' in patch) {
    const phone = normalizePhone(patch.phone);
    if (!isValidPhone(phone)) throw new DebtorsTrackerError('Enter a valid phone number (8–15 digits)', 400);
    data.phone = phone;
  }
  if ('email' in patch) {
    const email = normalizeEmail(patch.email).slice(0, 320);
    if (!isValidEmail(email)) throw new DebtorsTrackerError('Enter a valid email address', 400);
    data.email = email;
  }
  if ('region' in patch) {
    if (!isValidRegionInput(patch.region)) throw new DebtorsTrackerError('Region must be R1–R4 (or blank)', 400);
    region = normalizeRegion(patch.region);
    data.region = region;
  }
  if ('notes' in patch) data.notes = String(patch.notes ?? '').slice(0, 2000);
  if ('whatsappOptIn' in patch) {
    const optIn = !!patch.whatsappOptIn;
    data.whatsappOptIn = optIn;
    data.optInAt = optIn ? (existing.whatsappOptIn ? existing.optInAt : new Date().toISOString()) : null;
  }

  const updated: any = await prisma.paymentCustomer.update({ where: { customerKey: key }, data });
  if (region !== undefined) {
    await prisma.debtorInvoice.updateMany({
      where: { customerName: existing.customerName },
      data: { region, updatedAt: new Date() },
    });
  }
  await invalidateDebtorsCache();
  return contactView(updated);
}

/**
 * CRM follow-up state: situation dropdown, promised-to-pay date and legacy
 * free-text remarks.
 * Sales (`debtors-tracker` scope) and accounts may both write this —
 * unlike region / WhatsApp opt-in, which stay accounts-only.
 *
 * Promise semantics (founder decision):
 *   Promised to pay → days/date mandatory
 *   Not answering / Busy / Callback / Disputed → promise STAYS (Last promise)
 *   Paid / Closed → promise cleared
 *   A newer promise replaces the previous one.
 */
export async function updateCustomerSituation(
  customerKey: string,
  patch: Record<string, unknown>,
  updatedBy: string,
): Promise<CustomerContact> {
  const key = String(customerKey || '').trim().toLowerCase();
  if (!key) throw new DebtorsTrackerError('Customer key is required', 400);

  const existing: any = await prisma.paymentCustomer.findFirst({ where: { customerKey: key } });
  if (!existing) throw new DebtorsTrackerError('Customer not found', 404);

  const hasSituation = 'situation' in patch;
  const hasRemarks = 'situationRemarks' in patch;
  const hasPromise = 'promisedDays' in patch || 'promisedDate' in patch;
  if (!hasSituation && !hasRemarks && !hasPromise) {
    throw new DebtorsTrackerError('Nothing to update (situation / promise / remarks)', 400);
  }

  const data: Record<string, unknown> = { updatedBy: updatedBy || '', updatedAt: new Date() };
  let situation = String(existing.situation || '');
  if (hasSituation) {
    if (!isValidCustomerSituationInput(patch.situation)) {
      throw new DebtorsTrackerError('Situation must be one of the dropdown options (or blank)', 400);
    }
    situation = normalizeCustomerSituation(patch.situation);
    data.situation = situation;
  }
  if (hasRemarks) {
    data.situationRemarks = String(patch.situationRemarks ?? '').slice(0, 2000);
  }
  if (hasSituation || hasRemarks) {
    data.situationUpdatedAt = new Date().toISOString();
    data.situationUpdatedBy = updatedBy || '';
  }

  if (situation === 'PROMISED_TO_PAY') {
    const today = todayIST();
    const actor = updatedBy || '';
    let days: number | null = null;
    let date = '';
    let keepExisting = false;

    if ('promisedDays' in patch) {
      days = normalizePromiseDays(patch.promisedDays);
      if (days === null) {
        throw new DebtorsTrackerError(`Enter promised days between 0 and ${MAX_PROMISE_DAYS}`, 400);
      }
      date = promiseDateFromDays(today, days);
    } else if ('promisedDate' in patch) {
      const rawDate = String(patch.promisedDate ?? '').trim();
      if (!isIsoDate(rawDate)) {
        throw new DebtorsTrackerError('Choose a valid promise date', 400);
      }
      days = promiseDaysFromDate(today, rawDate);
      if (days === null) {
        throw new DebtorsTrackerError(`Promise date must be today or within ${MAX_PROMISE_DAYS} days`, 400);
      }
      date = rawDate;
    } else {
      // Re-saving the dropdown without a new pick keeps an existing promise,
      // even if that promise is already overdue.
      const existingDate = String(existing.promisedDate || '');
      if (!isIsoDate(existingDate)) {
        throw new DebtorsTrackerError('Choose in how many days the client promised to pay', 400);
      }
      date = existingDate;
      days = normalizePromiseDays(existing.promisedDays) ?? promiseDaysFromDate(today, existingDate);
      keepExisting = true;
    }

    data.promisedDate = date;
    data.promisedDays = days;
    if (!keepExisting) {
      data.promisedAt = new Date().toISOString();
      data.promisedBy = actor;
    }
  } else if (hasSituation && situation === 'PAID_CLOSED') {
    // Settled customers should not carry a stale promise into future imports.
    data.promisedDate = null;
    data.promisedDays = null;
    data.promisedAt = null;
    data.promisedBy = '';
  } else if (hasPromise) {
    throw new DebtorsTrackerError('Select Promised to pay before setting a promise date', 400);
  }
  // Any other situation keeps the stored promise (badge shows "Last promise").

  const updated: any = await prisma.paymentCustomer.update({ where: { customerKey: key }, data });
  await invalidateDebtorsCache();
  return contactView(updated);
}
