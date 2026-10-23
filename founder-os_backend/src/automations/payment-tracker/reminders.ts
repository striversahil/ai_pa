/**
 * Payment Tracker — daily reminder dry-run.
 *
 * Live business-initiated WhatsApp messages need an approved Meta template and
 * recorded opt-in, neither of which is provisioned yet. Until then this module
 * records exactly what WOULD be sent (one row per customer per IST day) so the
 * dashboard can show eligibility, contact gaps and message previews.
 */
import { prisma } from '../../shared/prisma';
import { invalidatePaymentCache } from './cache';
import { loadCustomerContacts } from './customers';
import { buildCustomerAgeing, buildLiveInvoices } from './ledger';
import { round2, todayIST } from './shared';
import { customerKeyOf } from './customers';

function envVal(key: string): string {
  const g = globalThis as any;
  // Worker secrets are mirrored onto globalThis by bootstrapEnv; Express uses
  // process.env. Both are read lazily so this module stays framework-free.
  const v = g?.__WORKER_ENV__?.[key];
  if (v !== undefined) return String(v ?? '');
  try {
    return String((globalThis as any)?.process?.env?.[key] ?? '');
  } catch {
    return '';
  }
}

export function reminderConfigured(): boolean {
  return !!(envVal('WHATSAPP_CLOUD_ACCESS_TOKEN') && envVal('WHATSAPP_CLOUD_PHONE_NUMBER_ID'));
}

/** Live sending is deliberately opt-in and separate from credentials. */
export function reminderMode(): 'dry_run' | 'live' {
  return reminderConfigured() && envVal('PAYMENT_REMINDER_LIVE') === 'true' ? 'live' : 'dry_run';
}

function inr(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));
}

export function buildReminderMessage(args: {
  customerName: string;
  amount: number;
  invoiceCount: number;
  oldestDueDate: string | null;
}): string {
  const invoices = args.invoiceCount === 1 ? '1 invoice' : `${args.invoiceCount} invoices`;
  const oldest = args.oldestDueDate ? ` (oldest due ${args.oldestDueDate})` : '';
  return [
    `Dear ${args.customerName},`,
    `a gentle reminder that ₹${inr(args.amount)} is pending across ${invoices}${oldest}.`,
    'Kindly arrange the payment at your earliest convenience. Thank you.',
  ].join(' ');
}

export type ReminderRunResult = {
  runDay: string;
  mode: 'dry_run' | 'live';
  configured: boolean;
  eligible: number;
  logged: number;
  skippedAlreadyLogged: number;
  skippedNoPhone: number;
};

/**
 * Compute eligible overdue customers and log one dry-run row each for today.
 * Idempotent per day via dedupKey = customerKey|runDay|channel.
 */
export async function runReminderDryRun(
  opts: { trigger?: string; actor?: string } = {},
): Promise<ReminderRunResult> {
  const runDay = todayIST();
  const mode = reminderMode();
  const configured = reminderConfigured();

  const [invoiceRows, collRows, contacts, existing] = await Promise.all([
    prisma.debtorInvoice.findMany({ where: { deleted: false } }) as Promise<any[]>,
    prisma.paymentCollection.findMany({ where: { deleted: false } }) as Promise<any[]>,
    loadCustomerContacts(),
    prisma.paymentReminder.findMany({ where: { runDay, channel: 'whatsapp' } }) as Promise<any[]>,
  ]);

  const already = new Set((existing || []).map((r: any) => String(r.customerKey)));
  const { liveInvoices, advanceByCustomer } = buildLiveInvoices(invoiceRows, collRows, runDay);
  const customers = buildCustomerAgeing(liveInvoices, advanceByCustomer);

  let eligible = 0;
  let logged = 0;
  let skippedAlreadyLogged = 0;
  let skippedNoPhone = 0;

  for (const row of customers) {
    if (row.grossDue <= 0.005 || row.netDue <= 0.005) continue;
    const key = customerKeyOf(row.customerName);
    const contact = contacts.get(key);
    const phone = String(contact?.phone || '');
    eligible++;
    if (!phone) { skippedNoPhone++; continue; }
    if (already.has(key)) { skippedAlreadyLogged++; continue; }

    const open = liveInvoices.filter(
      (inv) => inv.customerName === row.customerName && inv.balance > 0.005 && inv.bucket !== 'NOT_DUE',
    );
    const oldestDueDate = open
      .map((inv) => inv.dueDate || inv.invoiceDate || '')
      .filter(Boolean)
      .sort()[0] || row.oldestDueDate || null;
    const invoiceNos = open.map((inv) => inv.invoiceNo).filter(Boolean).slice(0, 20).join(', ');
    const amount = row.netDue;
    const message = buildReminderMessage({
      customerName: row.customerName,
      amount,
      invoiceCount: open.length || row.invoiceCount,
      oldestDueDate,
    });

    // Live branch is intentionally unimplemented until an approved template +
    // opt-in are provisioned. Never silently send from a dry-run deployment.
    const status = mode === 'live' && contact?.whatsappOptIn ? 'dry_run' : 'dry_run';
    const dedupKey = `${key}|${runDay}|whatsapp`;

    await prisma.paymentReminder.create({
      data: {
        customerKey: key,
        customerName: row.customerName,
        phone,
        channel: 'whatsapp',
        kind: 'due',
        status,
        amount: round2(amount),
        invoiceCount: open.length || row.invoiceCount,
        invoiceNos,
        oldestDueDate,
        message,
        error: mode === 'live' && !contact?.whatsappOptIn ? 'whatsapp_opt_in_missing' : '',
        runDay,
        trigger: opts.trigger || 'cron',
        dedupKey,
      },
    });
    already.add(key);
    logged++;
  }

  if (logged > 0) await invalidatePaymentCache();

  return { runDay, mode, configured, eligible, logged, skippedAlreadyLogged, skippedNoPhone };
}

export async function loadRecentReminders(limit = 200): Promise<any[]> {
  const rows: any[] = await prisma.paymentReminder.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  }) as any[];
  return rows;
}

/** Latest reminder per customer key (for the ageing rows). */
export function latestReminderByCustomer(reminders: any[]): Map<string, any> {
  const out = new Map<string, any>();
  for (const r of reminders) {
    const key = String(r.customerKey || '');
    if (key && !out.has(key)) out.set(key, r);
  }
  return out;
}
