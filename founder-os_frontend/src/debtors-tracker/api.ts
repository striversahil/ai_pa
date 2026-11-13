/**
 * Debtors Tracker — dashboard mutations (row editor + corrections).
 * Mirrors the worker routes in
 * founder-os_backend/src/worker/routes/debtors-tracker.ts (accounts scope).
 * `ZipPlan` mirrors `ZipMatchPlan` in
 * founder-os_backend/src/automations/debtors-tracker/attachments.ts — keep
 * the shapes identical (matching is FY + trailing number).
 */

import type { CustomerLedger, CustomerRemark, DebtorsTrackerPayload } from "./types";

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

/** Invoice PDF attachment (manual): single PDF per invoice row. */
export interface InvoicePdf {
  id: string;
  fileName: string;
  url: string;
  source: string;
  uploadedBy: string;
  createdAt: string;
}

export async function uploadInvoicePdf(invoiceId: string, file: File): Promise<InvoicePdf> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/debtors-tracker/invoices/${encodeURIComponent(invoiceId)}/attachment`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Upload failed (${res.status})`);
  }
  const body = (await res.json().catch(() => ({}))) as { attachment?: InvoicePdf };
  if (!body?.attachment?.id) throw new Error("Upload response was invalid");
  return body.attachment;
}

export async function deleteInvoiceAttachment(attachmentId: string): Promise<void> {
  await request(`/api/debtors-tracker/attachments/${encodeURIComponent(attachmentId)}`, {
    method: "DELETE",
  });
}

export interface ZipPlan {
  matched: { invoiceId: string; invoiceNo: string; customerName: string; fileName: string }[];
  ambiguous: { fileName: string; trailing: string; fileFy: string; candidates: { invoiceId: string; invoiceNo: string; invoiceFy: string; customerName: string }[] }[];
  unmapped: { fileName: string; trailing: string; fileFy: string; note: string }[];
  skippedAlreadyAttached: number;
}

/** Bulk-zip step 1: send unzipped PDF filenames, get the match plan. */
export async function planZipFiles(fileNames: string[]): Promise<ZipPlan> {
  const res = await fetch(`/api/debtors-tracker/invoices/plan-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: fileNames }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Plan failed (${res.status})`);
  }
  return res.json() as Promise<ZipPlan>;
}

/** Fresh start: wipes both ledgers (invoices + collections) + reminders. */
export async function resetDebtorsTracker(): Promise<void> {
  await request(`/api/debtors-tracker/data`, { method: "DELETE" });
}

/** Any tracker viewer may set phone/email/notes; accounts also set region + opt-in. */
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
  /** Required when situation = PROMISED_TO_PAY (0 = today, max 365). */
  promisedDays?: number | null;
  /** Alternative to promisedDays; must be today or later. */
  promisedDate?: string | null;
};

/** Sales or accounts: set the customer's situation + promised-to-pay date. */
export async function saveCustomerSituation(customerKey: string, patch: CustomerSituationPatch): Promise<void> {
  await request(`/api/debtors-tracker/customers/situation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerKey, ...patch }),
  });
}

/** Dated CRM remark history, newest first. */
export async function listCustomerRemarks(customerKey: string): Promise<CustomerRemark[]> {
  const res = await fetch(`/api/debtors-tracker/customers/${encodeURIComponent(customerKey)}/remarks`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  const body = (await res.json().catch(() => ({}))) as { remarks?: CustomerRemark[] };
  return Array.isArray(body?.remarks) ? body.remarks : [];
}

/** Append one dated remark; mirrors the latest onto the customer preview. */
export async function addCustomerRemark(
  customerKey: string,
  remark: string,
  customerName = "",
): Promise<CustomerRemark> {
  const res = await fetch(`/api/debtors-tracker/customers/${encodeURIComponent(customerKey)}/remarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remark, customerName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  const body = (await res.json().catch(() => ({}))) as { remark?: CustomerRemark };
  if (!body?.remark?.id) throw new Error("Remark response was invalid");
  return body.remark;
}

/** Accounts only: soft-delete a wrong history entry. */
export async function deleteCustomerRemark(customerKey: string, remarkId: string): Promise<void> {
  await request(
    `/api/debtors-tracker/customers/${encodeURIComponent(customerKey)}/remarks/${encodeURIComponent(remarkId)}`,
    { method: "DELETE" },
  );
}

/** TEMPORARY (2026-11-13): accounts-only Top pin. Drop with migration 0140. */
export async function addTopPick(customerKey: string): Promise<void> {
  await request(`/api/debtors-tracker/top-picks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerKey }),
  });
}

/** TEMPORARY (2026-11-13): accounts-only Top unpin. Drop with migration 0140. */
export async function removeTopPick(customerKey: string): Promise<void> {
  await request(`/api/debtors-tracker/top-picks/${encodeURIComponent(customerKey)}`, {
    method: "DELETE",
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
