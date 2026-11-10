/**
 * Debtors Tracker — invoice PDF attachments.
 *
 * Matcher (founder decision): trailing-number match. Filenames look like
 * `BUI_26-27_719.pdf` or `Invoices FY 2024-25-945.pdf`; invoiceNos look like
 * `BUI/26-27/704`, `1836`, `BUI/TI0476/17-18`. We compare the trailing digit
 * run (leading zeros ignored): `719` matches `BUI/26-27/719`.
 * Exact normalized matches win first; ambiguous trailing numbers (2+ live
 * invoices sharing the digits) never auto-attach — they go to review.
 */
import { prisma } from '../../shared/prisma';
import { invalidateDebtorsCache } from './cache';
import { DebtorsTrackerError } from './errors';
import { normalizeInvoiceNo } from './types';

export interface InvoicePdfRef {
  id: string;
  fileName: string;
  url: string;
  source: string;
  uploadedBy: string;
  createdAt: string;
}

/** Trailing digit run of a filename or invoice no (no leading zeros). */
export function trailingNumber(s: string): string {
  const base = String(s || '').replace(/\.pdf$/i, '').trim();
  const m = base.match(/(\d+)\s*$/);
  if (!m) return '';
  return m[1].replace(/^0+/, '') || '0';
}

/** Normalized full-text key for exact matching (separators unified). */
export function exactKey(s: string): string {
  return String(s || '')
    .replace(/\.pdf$/i, '')
    .toLowerCase()
    .replace(/[\s_\-/\\]+/g, '')
    .trim();
}

export function toPdfRef(row: any): InvoicePdfRef {
  return {
    id: String(row?.id ?? ''),
    fileName: String(row?.fileName ?? ''),
    url: `/api/debtors-tracker/invoice-files/${String(row?.id ?? '')}`,
    source: String(row?.source ?? 'manual'),
    uploadedBy: String(row?.uploadedBy ?? ''),
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : String(row?.createdAt ?? ''),
  };
}

/** Latest attachment per invoice id (newest wins as the primary PDF). */
export async function loadPrimaryPdfByInvoice(): Promise<Map<string, InvoicePdfRef>> {
  const rows: any[] = await (prisma as any).debtorInvoiceAttachment.findMany({
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  const out = new Map<string, InvoicePdfRef>();
  for (const r of rows) {
    const k = String(r?.invoiceId ?? '');
    if (!k || out.has(k)) continue;
    out.set(k, toPdfRef(r));
  }
  return out;
}

async function getInvoiceOrThrow(invoiceId: string): Promise<any> {
  const inv: any = await (prisma as any).debtorInvoice.findUnique({
    where: { id: String(invoiceId) },
  }).catch(() => null);
  if (!inv || inv.deleted) throw new DebtorsTrackerError('Invoice not found', 404);
  return inv;
}

export async function listInvoiceAttachments(invoiceId: string): Promise<InvoicePdfRef[]> {
  await getInvoiceOrThrow(invoiceId);
  const rows: any[] = await (prisma as any).debtorInvoiceAttachment.findMany({
    where: { invoiceId: String(invoiceId) },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);
  return rows.map(toPdfRef);
}

export async function addInvoiceAttachment(input: {
  invoiceId: string;
  fileName: string;
  mime: string;
  size: number;
  kvKey: string;
  source: 'bulk-zip' | 'manual';
  uploadedBy: string;
}): Promise<InvoicePdfRef> {
  const inv = await getInvoiceOrThrow(input.invoiceId);
  const mime = String(input.mime || 'application/pdf');
  if (mime !== 'application/pdf' && !/\.pdf$/i.test(input.fileName)) {
    throw new DebtorsTrackerError('Invoice attachment must be a PDF file', 400);
  }
  const row: any = await (prisma as any).debtorInvoiceAttachment.create({
    data: {
      id: crypto.randomUUID(),
      invoiceId: String(inv.id),
      invoiceNo: String(inv.invoiceNo ?? ''),
      fileName: String(input.fileName).slice(0, 200),
      mime,
      size: Math.max(0, Math.floor(Number(input.size) || 0)),
      kvKey: String(input.kvKey),
      source: input.source === 'bulk-zip' ? 'bulk-zip' : 'manual',
      uploadedBy: String(input.uploadedBy || '').slice(0, 200),
      createdAt: new Date(),
    },
  });
  await invalidateDebtorsCache();
  return toPdfRef(row);
}

export async function deleteInvoiceAttachment(attachmentId: string): Promise<{ kvKey: string }> {
  const row: any = await (prisma as any).debtorInvoiceAttachment.findUnique({
    where: { id: String(attachmentId) },
  }).catch(() => null);
  if (!row) throw new DebtorsTrackerError('Attachment not found', 404);
  await (prisma as any).debtorInvoiceAttachment.delete({
    where: { id: String(row.id) },
  }).catch(() => {});
  await invalidateDebtorsCache();
  return { kvKey: String(row.kvKey || '') };
}

export interface ZipMatchPlan {
  /** invoiceId → filename (safe to auto-attach). */
  matched: { invoiceId: string; invoiceNo: string; customerName: string; fileName: string }[];
  /** trailing number hit 2+ invoices — needs a manual pick. */
  ambiguous: { fileName: string; trailing: string; candidates: { invoiceId: string; invoiceNo: string; customerName: string }[] }[];
  /** no live invoice carries these digits. */
  unmapped: { fileName: string; trailing: string }[];
}

/** Plan a bulk-zip import without writing anything (dry-run + real import). */
export async function planZipMatches(files: { fileName: string }[]): Promise<ZipMatchPlan> {
  const invoices: any[] = await (prisma as any).debtorInvoice.findMany({
    where: { deleted: false },
  }).catch(() => []);
  const byExact = new Map<string, any[]>();
  const byTrail = new Map<string, any[]>();
  for (const inv of invoices) {
    const no = normalizeInvoiceNo(String(inv?.invoiceNo ?? ''));
    if (!no) continue;
    const ek = exactKey(no);
    if (!byExact.has(ek)) byExact.set(ek, []);
    byExact.get(ek)!.push(inv);
    const t = trailingNumber(no);
    if (!t) continue;
    if (!byTrail.has(t)) byTrail.set(t, []);
    byTrail.get(t)!.push(inv);
  }
  // Invoices that already carry a PDF are skipped — re-uploads go manual.
  const primaries = await loadPrimaryPdfByInvoice().catch(() => new Map());
  const plan: ZipMatchPlan = { matched: [], ambiguous: [], unmapped: [] };
  const seenFiles = new Set<string>();
  for (const f of files) {
    const name = String(f?.fileName ?? '').trim();
    if (!name || seenFiles.has(name.toLowerCase())) continue;
    seenFiles.add(name.toLowerCase());
    const exact = byExact.get(exactKey(name)) ?? [];
    const liveExact = exact.filter((inv) => !primaries.has(String(inv.id)));
    if (liveExact.length === 1) {
      const inv = liveExact[0];
      plan.matched.push({ invoiceId: String(inv.id), invoiceNo: String(inv.invoiceNo), customerName: String(inv.customerName ?? ''), fileName: name });
      continue;
    }
    if (liveExact.length > 1) {
      plan.ambiguous.push({
        fileName: name, trailing: trailingNumber(name),
        candidates: liveExact.map((inv: any) => ({ invoiceId: String(inv.id), invoiceNo: String(inv.invoiceNo), customerName: String(inv.customerName ?? '') })),
      });
      continue;
    }
    const t = trailingNumber(name);
    if (!t) {
      plan.unmapped.push({ fileName: name, trailing: '' });
      continue;
    }
    const cands = (byTrail.get(t) ?? []).filter((inv) => !primaries.has(String(inv.id)));
    if (cands.length === 1) {
      const inv = cands[0];
      plan.matched.push({ invoiceId: String(inv.id), invoiceNo: String(inv.invoiceNo), customerName: String(inv.customerName ?? ''), fileName: name });
    } else if (cands.length > 1) {
      plan.ambiguous.push({
        fileName: name, trailing: t,
        candidates: cands.map((inv: any) => ({ invoiceId: String(inv.id), invoiceNo: String(inv.invoiceNo), customerName: String(inv.customerName ?? '') })),
      });
    } else {
      plan.unmapped.push({ fileName: name, trailing: t });
    }
  }
  return plan;
}
