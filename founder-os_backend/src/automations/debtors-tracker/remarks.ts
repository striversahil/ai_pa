/**
 * Debtors Tracker — dated, append-only CRM remarks per customer.
 *
 * A single editable text field loses yesterday's context, so every save writes
 * one row here. PaymentCustomer.situationRemarks mirrors the latest row for the
 * compact ageing preview; the full trail is loaded by the CRM modal.
 *
 * Append-only: nobody edits history. Accounts may soft-delete a wrong entry.
 */
import { prisma } from '../../shared/prisma';
import { DebtorsTrackerError } from './errors';
import { invalidateDebtorsCache } from './cache';
import { normalizeCustomerName } from './types';
import { todayIST } from './shared';

export interface CustomerRemark {
  id: string;
  customerKey: string;
  customerName: string;
  /** IST calendar day of the call (YYYY-MM-DD). */
  day: string;
  remark: string;
  actor: string;
  createdAt: string;
}

const ACTOR_MAX = 120;
const REMARK_MAX = 2000;

function remarkView(row: any): CustomerRemark {
  return {
    id: String(row.id),
    customerKey: String(row.customerKey || ''),
    customerName: String(row.customerName || ''),
    day: String(row.day || ''),
    remark: String(row.remark || ''),
    actor: String(row.actor || ''),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ''),
  };
}

/** Add one dated remark and mirror it onto the contact for compact previews. */
export async function addCustomerRemark(input: {
  customerKey: string;
  customerName?: string;
  remark: string;
  actor?: string;
}): Promise<CustomerRemark> {
  const key = String(input.customerKey || '').trim().toLowerCase();
  if (!key) throw new DebtorsTrackerError('Customer key is required', 400);
  const remark = String(input.remark ?? '').trim().slice(0, REMARK_MAX);
  if (!remark) throw new DebtorsTrackerError('Remark cannot be empty', 400);

  const actor = String(input.actor ?? '').trim().slice(0, ACTOR_MAX);
  let contact: any = await prisma.paymentCustomer.findFirst({ where: { customerKey: key } });
  if (!contact) {
    // Legacy customer rows can be missing when only invoices were imported.
    contact = await prisma.paymentCustomer.create({
      data: {
        customerKey: key,
        customerName: normalizeCustomerName(String(input.customerName || key)),
        updatedBy: actor,
      },
    });
  }

  const created: any = await prisma.paymentCustomerRemark.create({
    data: {
      customerKey: key,
      customerName: String(contact.customerName || input.customerName || ''),
      day: todayIST(),
      remark,
      actor,
    },
  });

  const now = new Date().toISOString();
  await prisma.paymentCustomer.update({
    where: { customerKey: key },
    data: {
      situationRemarks: remark,
      situationUpdatedAt: now,
      situationUpdatedBy: actor,
      updatedAt: new Date(),
    },
  });

  await invalidateDebtorsCache();
  return remarkView(created);
}

/** Newest first. */
export async function listCustomerRemarks(customerKey: string, limit = 100): Promise<CustomerRemark[]> {
  const key = String(customerKey || '').trim().toLowerCase();
  if (!key) throw new DebtorsTrackerError('Customer key is required', 400);
  const take = Math.min(Math.max(Math.trunc(Number(limit) || 100), 1), 500);
  const rows: any[] = await prisma.paymentCustomerRemark.findMany({
    where: { customerKey: key, deleted: false },
    orderBy: { createdAt: 'desc' },
    take,
  }) as any[];
  return rows.map(remarkView);
}

/** Accounts-only cleanup. Soft-deletes and re-mirrors the previous latest. */
export async function deleteCustomerRemark(id: string, actor = ''): Promise<void> {
  const rid = String(id || '').trim();
  if (!rid) throw new DebtorsTrackerError('Remark id is required', 400);
  const row: any = await prisma.paymentCustomerRemark.findFirst({ where: { id: rid } });
  if (!row || row.deleted) throw new DebtorsTrackerError('Remark not found', 404);

  await prisma.paymentCustomerRemark.update({
    where: { id: rid },
    data: {
      deleted: true,
      deletedAt: new Date(),
      deletedBy: String(actor || '').slice(0, ACTOR_MAX),
    },
  });

  const key = String(row.customerKey || '');
  const latest: any = await prisma.paymentCustomerRemark.findFirst({
    where: { customerKey: key, deleted: false },
    orderBy: { createdAt: 'desc' },
  });
  await prisma.paymentCustomer.update({
    where: { customerKey: key },
    data: {
      situationRemarks: latest ? String(latest.remark || '') : '',
      updatedAt: new Date(),
    },
  });

  await invalidateDebtorsCache();
}

export interface RemarkSummary {
  count: number;
  latest: CustomerRemark;
}

/**
 * One query → { customerKey → count + newest remark } for the dashboard payload.
 * Rows are newest-first, so the first row seen per customer is the latest.
 */
export async function loadRemarkIndex(): Promise<Map<string, RemarkSummary>> {
  const rows: any[] = await prisma.paymentCustomerRemark.findMany({
    where: { deleted: false },
    orderBy: { createdAt: 'desc' },
  }) as any[];
  const out = new Map<string, RemarkSummary>();
  for (const row of rows) {
    const key = String(row.customerKey || '');
    if (!key) continue;
    const cur = out.get(key);
    if (cur) cur.count += 1;
    else out.set(key, { count: 1, latest: remarkView(row) });
  }
  return out;
}
