/**
 * Debtors Tracker — invoice PDF attachments.
 *
 * Matcher (founder decision 2026-11-12): financial-year + trailing-number.
 * Invoice serials restart every FY, so the number alone is NOT unique:
 * `BUI/24-25/751` and `BUI/26-27/751` are different invoices. Filenames look
 * like `BUI_26-27_719.pdf` (FY 26-27) or `Invoices FY 2024-25-945.pdf`
 * (FY 24-25); invoiceNos look like `BUI/26-27/704`, `BUI/TI0476/17-18`,
 * `1836` (no FY). A file matches a live invoice only when the trailing
 * numbers agree AND the FYs agree (either side missing its FY = legacy row,
 * falls back to number-only). Exact normalized matches win first; anything
 * hitting 2+ same-FY invoices never auto-attaches — it goes to review.
 * Mirror: frontend shows the plan verbatim (`src/debtors-tracker/api.ts`
 * `ZipPlan`) — keep the shapes identical.
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

/**
 * Financial year of an invoiceNo or filename (`BUI/24-25/751` → `24-25`,
 * `BUI/TI0476/17-18` → `17-18`, `BUI_26_27_719.pdf` → `26-27`,
 * `1836` → ``). Serials restart every FY, so this is the other half of the
 * match key. The separator may be `/`, `-`, `_`, `.`, space or anything
 * else non-alphanumeric (founder note: the two sides don't always use the
 * same one) — every overlapping `YY<sep>YY` run is a candidate and only a
 * CONSECUTIVE pair (second = first + 1, e.g. 24-25, never 25/10 from a year
 * fragment glued to a serial) counts, so `BUI/TI0476/17-18` can't misread
 * as FY 76-17. `20XX<sep>YY` (`Invoices FY 2024-25-945`) resolves the same
 * way. Last valid win (matches the old dash-only behavior on dash data).
 */
function fyCandidates(s: string): string[] {
  const out: string[] = [];
  const str = String(s || '');
  for (let i = 0; i + 4 < str.length + 1; i++) {
    const a = str.slice(i, i + 2);
    const sep = str[i + 2];
    const b = str.slice(i + 3, i + 5);
    if (a.length === 2 && b.length === 2 && /^[0-9]+$/.test(a) && /^[0-9]+$/.test(b) && sep && !/[A-Za-z0-9]/.test(sep)) {
      if ((parseInt(a, 10) + 1) % 100 === parseInt(b, 10)) out.push(`${a}-${b}`);
    }
  }
  for (const m of str.matchAll(/20(\d{2})([^A-Za-z0-9])(\d{2})/g)) {
    if ((parseInt(m[1], 10) + 1) % 100 === parseInt(m[3], 10)) out.push(`${m[1]}-${m[3]}`);
  }
  return out;
}

function lastFy(s: string): string {
  const c = fyCandidates(s);
  return c.length ? c[c.length - 1] : '';
}

/** Financial year of an invoiceNo (`BUI/24-25/751` → `24-25`, `1836` → ``). */
export function fyOfInvoiceNo(s: string): string {
  return lastFy(s);
}

/** Financial year of a zip filename (`BUI_26-27_751.pdf` → `26-27`). */
export function fyOfFileName(s: string): string {
  return lastFy(String(s || '').replace(/\.pdf$/i, ''));
}

/** Normalized full-text key for exact matching (separators unified: spaces,
 *  underscores, slashes, dashes, backslashes AND dots — `BUI/26-27/719`,
 *  `BUI_26-27_719.pdf` and `BUI.26-27.719.pdf` are the same invoice). */
export function exactKey(s: string): string {
  return String(s || '')
    .replace(/\.pdf$/i, '')
    .toLowerCase()
    .replace(/[\s_\-/\\.]+/g, '')
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
  /** invoiceId → filename (safe to auto-attach: FY + number both agree). */
  matched: { invoiceId: string; invoiceNo: string; customerName: string; fileName: string }[];
  /** number hit 2+ same-FY invoices — needs a manual pick. */
  ambiguous: { fileName: string; trailing: string; fileFy: string; candidates: { invoiceId: string; invoiceNo: string; invoiceFy: string; customerName: string }[] }[];
  /** no live invoice carries this FY + number. `note` says why. */
  unmapped: { fileName: string; trailing: string; fileFy: string; note: string }[];
  /** Files skipped because their invoice already carries a PDF. */
  skippedAlreadyAttached: number;
}

/**
 * Re-link orphaned PDFs after a wipe + re-paste (founder decision
 * 2026-11-13: a reset never deletes invoice PDFs).
 *
 * `resetDebtorsTracker` hard-deletes the invoice rows but keeps the
 * attachment rows + KV bytes; the re-paste creates NEW invoice ids, so the
 * old rows point at dead ids and their PDFs would silently vanish. This
 * re-points orphans (same normalized invoiceNo) at the live row — but ONLY
 * when exactly one live invoice carries that number AND it has no PDF yet,
 * so a fresh manual attach and same-number-different-customer conflicts are
 * never clobbered. Returns the re-linked count for the import report.
 */
export async function relinkOrphanAttachments(
  liveInvoices: { id: string; invoiceNo: string }[],
): Promise<number> {
  if (!liveInvoices.length) return 0;
  const liveIds = new Set(liveInvoices.map((i) => String(i.id)));
  const primaries = await loadPrimaryPdfByInvoice().catch(() => new Map());
  const all: any[] = await (prisma as any).debtorInvoiceAttachment.findMany({}).catch(() => []);
  const orphans = all.filter((o) => !liveIds.has(String(o?.invoiceId ?? '')));
  if (!orphans.length) return 0;
  const liveByNo = new Map<string, { id: string; invoiceNo: string }[]>();
  for (const inv of liveInvoices) {
    const k = normalizeInvoiceNo(String(inv?.invoiceNo ?? ''));
    if (!k) continue;
    if (!liveByNo.has(k)) liveByNo.set(k, []);
    liveByNo.get(k)!.push(inv);
  }
  let relinked = 0;
  for (const [key, cands] of liveByNo) {
    if (cands.length !== 1) continue; // same no under several customers — manual
    const inv = cands[0];
    if (primaries.has(String(inv.id))) continue; // already carries a PDF
    const mine = orphans.filter(
      (o) => normalizeInvoiceNo(String(o?.invoiceNo ?? '')) === key,
    );
    if (!mine.length) continue;
    for (const o of mine) {
      await (prisma as any).debtorInvoiceAttachment.update({
        where: { id: String(o.id) },
        data: { invoiceId: String(inv.id) },
      }).catch(() => {});
      relinked++;
    }
  }
  if (relinked) await invalidateDebtorsCache();
  return relinked;
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
  const plan: ZipMatchPlan = { matched: [], ambiguous: [], unmapped: [] as ZipMatchPlan['unmapped'], skippedAlreadyAttached: 0 };
  const seenFiles = new Set<string>();
  for (const f of files) {
    const name = String(f?.fileName ?? '').trim();
    if (!name || seenFiles.has(name.toLowerCase())) continue;
    seenFiles.add(name.toLowerCase());
    const fileFy = fyOfFileName(name);
    const exact = byExact.get(exactKey(name)) ?? [];
    // Exact hits carry the FY inside the normalized key (e.g. `bui2627751`),
    // so a wrong-year row can never exact-match. Only drop attached ones.
    const liveExact = exact.filter((inv) => !primaries.has(String(inv.id)));
    if (exact.length > 0 && liveExact.length === 0) { plan.skippedAlreadyAttached++; continue; }
    if (liveExact.length === 1) {
      const inv = liveExact[0];
      plan.matched.push({ invoiceId: String(inv.id), invoiceNo: String(inv.invoiceNo), customerName: String(inv.customerName ?? ''), fileName: name });
      continue;
    }
    if (liveExact.length > 1) {
      plan.ambiguous.push({
        fileName: name, trailing: trailingNumber(name), fileFy,
        candidates: liveExact.map((inv: any) => ({ invoiceId: String(inv.id), invoiceNo: String(inv.invoiceNo), invoiceFy: fyOfInvoiceNo(String(inv?.invoiceNo ?? '')), customerName: String(inv.customerName ?? '') })),
      });
      continue;
    }
    const t = trailingNumber(name);
    if (!t) {
      plan.unmapped.push({ fileName: name, trailing: '', fileFy, note: 'no number found in filename' });
      continue;
    }
    const raw = byTrail.get(t) ?? [];
    if (raw.length === 0) {
      plan.unmapped.push({
        fileName: name, trailing: t, fileFy,
        note: fileFy ? `FY ${fileFy} has no live invoice for #${t}` : `no live invoice ends in ${t}`,
      });
      continue;
    }
    // FY gate: a known file FY only matches the same invoice FY. Either side
    // missing its FY (legacy rows like `1836`) falls back to number-only.
    const sameFy = raw.filter((inv) => {
      const ify = fyOfInvoiceNo(String(inv?.invoiceNo ?? ''));
      if (!fileFy || !ify) return true;
      return ify === fileFy;
    });
    const live = sameFy.filter((inv) => !primaries.has(String(inv.id)));
    if (sameFy.length > 0 && live.length === 0) { plan.skippedAlreadyAttached++; continue; }
    if (live.length === 1) {
      const inv = live[0];
      plan.matched.push({ invoiceId: String(inv.id), invoiceNo: String(inv.invoiceNo), customerName: String(inv.customerName ?? ''), fileName: name });
    } else if (live.length > 1) {
      plan.ambiguous.push({
        fileName: name, trailing: t, fileFy,
        candidates: live.map((inv: any) => ({ invoiceId: String(inv.id), invoiceNo: String(inv.invoiceNo), invoiceFy: fyOfInvoiceNo(String(inv?.invoiceNo ?? '')), customerName: String(inv.customerName ?? '') })),
      });
    } else {
      // Every same-FY candidate is attached elsewhere, or the number exists
      // only under a different FY — either way there is nothing to attach.
      const otherFys = [...new Set(raw.map((inv: any) => fyOfInvoiceNo(String(inv?.invoiceNo ?? ''))).filter(Boolean))];
      const sameFyHasPdf = raw.some((inv: any) => {
        const same = fileFy && fyOfInvoiceNo(String(inv?.invoiceNo ?? '')) === fileFy;
        return same && primaries.has(String(inv.id));
      });
      const note = otherFys.length > 0 && fileFy && !otherFys.includes(fileFy)
        ? `FY ${fileFy} has no live invoice for #${t} (ledger has ${otherFys.map((y) => `FY ${y}`).join(', ')})`
        : fileFy
          ? `FY ${fileFy} has no live invoice for #${t}${sameFyHasPdf ? ' (same-FY row already has a PDF)' : ''}`
          : `no live invoice ends in ${t}`;
      plan.unmapped.push({ fileName: name, trailing: t, fileFy, note });
    }
  }
  return plan;
}
