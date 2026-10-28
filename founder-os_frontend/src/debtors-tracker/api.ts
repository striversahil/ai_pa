/**
 * Debtors Tracker — dashboard mutations (row editor + corrections).
 * Mirrors the worker routes in
 * founder-os_backend/src/worker/routes/debtors-tracker.ts (accounts scope).
 */

import type { CustomerLedger, DebtorsTrackerPayload } from "./types";

/** Fields the row editor may set (must match INVOICE_EDITABLE_FIELDS). */
export const INVOICE_EDITABLE_FIELDS = [
  "contactName", "contactPhone", "contactMail", "lastCallDate", "callStatus",
  "paymentStatus", "remarks", "accountStatus", "mis", "accountsRemarks",
  "employee", "state", "region", "ledgerLink",
] as const;

/** Sales (`debtors-tracker` scope) may only edit the follow-up subset. */
export const FOLLOW_UP_FIELDS = [
  "lastCallDate", "callStatus", "paymentStatus", "remarks",
] as const;

export type InvoiceEditableField = (typeof INVOICE_EDITABLE_FIELDS)[number];

export type InvoicePatch = Partial<Record<InvoiceEditableField, string | null>>;

export type CustomerContactPatch = {
  phone?: string;
  email?: string;
  region?: string;
  notes?: string;
  whatsappOptIn?: boolean;
};

async function request(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
}

/** Full live dashboard payload (same endpoint the screen uses). */
export async function getDebtorsTrackerData(): Promise<DebtorsTrackerPayload> {
  const res = await fetch(`/api/debtors-tracker/data`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<DebtorsTrackerPayload>;
}

export async function patchInvoice(id: string, patch: InvoicePatch): Promise<void> {
  await request(`/api/debtors-tracker/invoices/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function deleteInvoice(id: string): Promise<void> {
  await request(`/api/debtors-tracker/invoices/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function deleteCollection(id: string): Promise<void> {
  await request(`/api/debtors-tracker/collections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Fresh start: wipes both ledgers (invoices + collections) + reminders. */
export async function resetDebtorsTracker(): Promise<void> {
  await request(`/api/debtors-tracker/data`, { method: "DELETE" });
}

/** Accounts only: store the customer's phone/email + WhatsApp opt-in. */
export async function saveCustomerContact(customerKey: string, patch: CustomerContactPatch): Promise<void> {
  await request(`/api/debtors-tracker/customers/contact`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerKey, ...patch }),
  });
}

export type CustomerSituationPatch = {
  situation?: string;
  situationRemarks?: string;
};

/** Sales or accounts: set the customer's situation dropdown + CRM remarks. */
export async function saveCustomerSituation(customerKey: string, patch: CustomerSituationPatch): Promise<void> {
  await request(`/api/debtors-tracker/customers/situation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerKey, ...patch }),
  });
}

/** Accounts only: log today's reminder dry-run previews. */
export async function runReminderDryRun(): Promise<void> {
  await request(`/api/debtors-tracker/reminders/run`, { method: "POST" });
}

/** Complete statement for one customer (sales or accounts). */
export async function getCustomerLedger(customerKey: string): Promise<CustomerLedger> {
  const res = await fetch(`/api/debtors-tracker/customers/${encodeURIComponent(customerKey)}/ledger`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<CustomerLedger>;
}

/**
 * Log one receivables CSV download (the dashboard's Download as CSV button).
 * Returns the new GLOBAL export count, which is stamped into the CSV "Count"
 * column — inclusive of this download, so the first ever file shows 1.
 * INSERT-only server-side (DebtorsExportEvent), so concurrent clicks cannot
 * lose an increment.
 */
export async function recordReceivablesExport(rowCount: number): Promise<{ count: number }> {
  const res = await fetch(`/api/debtors-tracker/exports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rowCount }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  const body = (await res.json().catch(() => ({}))) as { count?: unknown };
  const count = Number(body?.count);
  if (!Number.isFinite(count)) throw new Error("Export counter response was invalid");
  return { count };
}
