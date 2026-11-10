// ─────────────────────────────────────────────────────────────────────────────
// routes/debtors-tracker.ts — Debtors Tracker automation API (paste imports +
// KV-cached dashboard payload). Worker-only: Express is frozen.
//
// Access (founder decision):
//   read + sales follow-up edits + customer phone/email/notes + daily remarks
//     → `debtors-tracker` OR the legacy `accounts`
//   imports / reset / deletes / region / WhatsApp opt-in / reminder run
//     → `accounts` only
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  authStore, getMe, requireScope, readSessionCookie, notifyLive, LiveEvent,
  type Bindings,
} from '../context';
import { AuthError } from '../../modules/auth/types';
import {
  importCollections, importDebtors, getDebtorsTrackerData, DebtorsTrackerError,
  updateInvoiceFields, deleteInvoice, deleteCollection, resetDebtorsTracker,
  INVOICE_EDITABLE_FIELDS, FOLLOW_UP_FIELDS, updateCustomerSituation, runReminderDryRun, updateCustomerContact, getCustomerLedger,
  recordReceivablesExport, addCustomerRemark, deleteCustomerRemark, listCustomerRemarks,
  addInvoiceAttachment, deleteInvoiceAttachment, listInvoiceAttachments, planZipMatches,
} from '../../automations/debtors-tracker/service';
import { parseCollectionsTsv, parseDebtorsTsv } from '../../automations/debtors-tracker/parse';

const TRACKER_SCOPES = ['debtors-tracker', 'payment-tracker', 'accounts'];

function heldScopes(me: any): Set<string> {
  return new Set(((me?.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
}

async function meFor(c: any) {
  return getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
}

/** Any tracker viewer: sales (`debtors-tracker`) or accounts. */
async function requireTrackerRead(c: any) {
  const me = await meFor(c);
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  if (me.isAdmin) return me;
  const held = heldScopes(me);
  if (!TRACKER_SCOPES.some((s) => held.has(s))) {
    throw new AuthError('FORBIDDEN', "Requires 'debtors-tracker' permission", 403);
  }
  return me;
}

/** Accounts-only mutations (imports, deletes, contacts, reminder run). */
async function requireAccountsScope(c: any) {
  return requireScope(authStore(c), c.req.header('cookie') ?? null, 'accounts');
}

function hasAccounts(me: any): boolean {
  return !!me?.isAdmin || heldScopes(me).has('accounts');
}

function scopeError(c: any, e: unknown) {
  if (e instanceof AuthError) return c.json({ error: e.message }, (e as any).status ?? 403);
  throw e;
}

async function actorName(c: any): Promise<string> {
  try {
    const me = await meFor(c);
    return me?.user?.name ?? me?.user?.email ?? 'accounts';
  } catch { return 'accounts'; }
}

function errorResponse(c: any, e: unknown) {
  if (e instanceof DebtorsTrackerError) return c.json({ error: e.message }, e.status as any);
  return c.json({ error: (e as any)?.message ?? 'request failed' }, 400);
}

const ROUTE_PREFIXES = ['/api/debtors-tracker', '/api/payment-tracker'] as const;

export function registerDebtorsTrackerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  for (const prefix of ROUTE_PREFIXES) registerDebtorsTrackerPrefix(app, prefix);
}

/** Register the same handlers under the canonical and legacy prefixes. */
function registerDebtorsTrackerPrefix(app: Hono<{ Bindings: Bindings }>, prefix: string): void {
  // ── Data: KV-cached payload (sales or accounts) ──
  app.get(`${prefix}/data`, async (c) => {
    try {
      await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    try {
      return c.json(await getDebtorsTrackerData());
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Export log: global "Count" stamped into every receivables CSV row ──
  // POST (not GET) because it increments; any tracker viewer may download.
  app.post(`${prefix}/exports`, async (c) => {
    try {
      await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const rowCount = Number((body as any)?.rowCount) || 0;
    try {
      const stats = await recordReceivablesExport({
        actor: await actorName(c),
        rowCount,
      });
      return c.json(stats);
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Preview: parse a paste without persisting (dashboard confirm UI) ──
  app.post(`${prefix}/preview`, async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const text = String((body as any)?.text ?? '');
    const kind = (body as any)?.kind === 'collections' ? 'collections' : 'debtors';
    try {
      const out = kind === 'collections' ? parseCollectionsTsv(text) : parseDebtorsTsv(text);
      const { rows, ...rest } = out;
      return c.json({ ...rest, kind, sample: rows.slice(0, 10), count: rows.length });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Debtors ageing-sheet paste import ──
  app.post(`${prefix}/import/debtors`, async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const text = String((body as any)?.text ?? '');
    if (text.trim().length < 8) return c.json({ error: 'Nothing pasted' }, 400);
    const importedBy = await actorName(c);
    try {
      const report = await importDebtors(text, importedBy);
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true, report });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Collections receipts-sheet paste import ──
  app.post(`${prefix}/import/collections`, async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const text = String((body as any)?.text ?? '');
    if (text.trim().length < 8) return c.json({ error: 'Nothing pasted' }, 400);
    const importedBy = await actorName(c);
    try {
      const report = await importCollections(text, importedBy);
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true, report });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Fresh start: wipe ledgers (hard delete) + reminders + KV cache ──
  app.delete(`${prefix}/data`, async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    try {
      const report = await resetDebtorsTracker();
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true, report });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Row editor: accounts edit all; sales edit follow-up fields only ──
  app.patch(`${prefix}/invoices/:id`, async (c) => {
    let me: any;
    try {
      me = await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    const allowed = hasAccounts(me) ? INVOICE_EDITABLE_FIELDS : FOLLOW_UP_FIELDS;
    const body = await c.req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    for (const field of allowed) {
      if (body && typeof body === 'object' && field in (body as any)) {
        patch[field] = (body as any)[field];
      }
    }
    try {
      await updateInvoiceFields(c.req.param('id'), patch, allowed);
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Correct a mis-imported invoice (soft delete; its collections unlink) ──
  app.delete(`${prefix}/invoices/:id`, async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    try {
      await deleteInvoice(c.req.param('id'));
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Correct a mis-imported collection (soft delete) ──
  app.delete(`${prefix}/collections/:id`, async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    try {
      await deleteCollection(c.req.param('id'));
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Customer contact master: phone/email/notes for sales; region + opt-in accounts ──
  app.put(`${prefix}/customers/contact`, async (c) => {
    let me: any;
    try {
      me = await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const key = String((body as any)?.customerKey ?? '');
    const patch: Record<string, unknown> = {};
    const allowed = hasAccounts(me)
      ? ['phone', 'email', 'region', 'notes', 'whatsappOptIn']
      : ['phone', 'email', 'notes'];
    for (const field of allowed) {
      if (body && typeof body === 'object' && field in (body as any)) patch[field] = (body as any)[field];
    }
    try {
      const contact = await updateCustomerContact(key, patch, await actorName(c));
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true, contact });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── CRM situation + promise + legacy remarks (sales or accounts) ──
  app.put(`${prefix}/customers/situation`, async (c) => {
    try {
      await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const key = String((body as any)?.customerKey ?? '');
    const patch: Record<string, unknown> = {};
    for (const field of ['situation', 'situationRemarks', 'promisedDays', 'promisedDate']) {
      if (body && typeof body === 'object' && field in (body as any)) patch[field] = (body as any)[field];
    }
    try {
      const contact = await updateCustomerSituation(key, patch, await actorName(c));
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true, contact });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Dated CRM remarks: append-only (sales or accounts) ──
  app.get(`${prefix}/customers/:customerKey/remarks`, async (c) => {
    try {
      await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    try {
      return c.json({ remarks: await listCustomerRemarks(c.req.param('customerKey'), 100) });
    } catch (e) { return errorResponse(c, e); }
  });

  app.post(`${prefix}/customers/:customerKey/remarks`, async (c) => {
    try {
      await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    try {
      const remark = await addCustomerRemark({
        customerKey: c.req.param('customerKey'),
        customerName: String((body as any)?.customerName ?? ''),
        remark: String((body as any)?.remark ?? ''),
        actor: await actorName(c),
      });
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true, remark });
    } catch (e) { return errorResponse(c, e); }
  });

  // Accounts cleanup only: append-only means nobody edits history, but a wrong
  // entry can be soft-deleted by accounts.
  app.delete(`${prefix}/customers/:customerKey/remarks/:remarkId`, async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    try {
      await deleteCustomerRemark(c.req.param('remarkId'), await actorName(c));
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Complete customer statement (sales or accounts) ──
  app.get(`${prefix}/customers/:customerKey/ledger`, async (c) => {
    try {
      await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    try {
      return c.json(await getCustomerLedger(c.req.param('customerKey')));
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Manual dry-run trigger (accounts); daily cron does this automatically ──
  app.post(`${prefix}/reminders/run`, async (c) => {
    let me: any;
    try {
      me = await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    try {
      const report = await runReminderDryRun({
        trigger: 'manual',
        actor: me?.user?.name ?? me?.user?.email ?? 'accounts',
      });
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true, report });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Invoice PDF attachments (bulk-zip + manual; Worker-only) ──
  // Reads: any tracker viewer. Writes: accounts only.
  app.get(`${prefix}/invoices/:id/attachments`, async (c) => {
    try { await requireTrackerRead(c); } catch (e) { return scopeError(c, e); }
    try {
      return c.json({ attachments: await listInvoiceAttachments(c.req.param('id')) });
    } catch (e) { return errorResponse(c, e); }
  });

  app.post(`${prefix}/invoices/:id/attachment`, async (c) => {
    try { await requireAccountsScope(c); } catch (e) { return scopeError(c, e); }
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    let form: FormData;
    try { form = await c.req.formData(); } catch { return c.json({ error: 'Expected multipart/form-data' }, 400); }
    const file = form.get('file');
    if (!(file instanceof File)) return c.json({ error: 'file field required' }, 400);
    const mime = file.type || 'application/pdf';
    if (mime !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      return c.json({ error: 'Invoice attachment must be a PDF file' }, 400);
    }
    if (file.size > 20 * 1024 * 1024) return c.json({ error: 'File too large (max 20MB)' }, 413);
    if (file.size <= 0) return c.json({ error: 'Empty file' }, 400);
    const invoiceId = c.req.param('id');
    const key = `inv/${String(invoiceId).replace(/[^A-Za-z0-9_-]/g, '_')}/${crypto.randomUUID()}.pdf`;
    await c.env.CHAT_FILES.put(key, await file.arrayBuffer(), {
      metadata: { name: file.name, type: mime, invoice: invoiceId },
    });
    try {
      const row = await addInvoiceAttachment({
        invoiceId, fileName: file.name.slice(0, 200), mime, size: file.size,
        kvKey: key, source: 'manual', uploadedBy: await actorName(c),
      });
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true, attachment: row }, 201);
    } catch (e) {
      try { await c.env.CHAT_FILES.delete(key); } catch { /* orphan bytes */ }
      return errorResponse(c, e);
    }
  });

  // Bulk ZIP import, step 1 (planning): the dashboard unzips locally (browser)
  // and POSTs `{ files: [fileName...] }`. Matching is by trailing number;
  // ambiguous/unmapped entries are reported for manual follow-up — the client
  // then uploads only the matched PDFs one by one to the single-attach route
  // above. Server-side zip parsing is avoided on purpose (Worker-safe).
  app.post(`${prefix}/invoices/plan-zip`, async (c) => {
    try { await requireAccountsScope(c); } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const files = Array.isArray((body as any)?.files) ? (body as any).files : [];
    if (files.length === 0) return c.json({ error: 'files[] required (unzip the archive in the browser first)' }, 400);
    if (files.length > 2000) return c.json({ error: 'Too many files (max 2000)' }, 400);
    try {
      const plan = await planZipMatches(
        files.slice(0, 2000).map((f: any) => ({ fileName: String(typeof f === 'string' ? f : f?.fileName ?? '').slice(0, 200) })),
      );
      return c.json({ ok: true, ...plan });
    } catch (e) { return errorResponse(c, e); }
  });

  // Serve PDF bytes by attachment id (never exposes raw KV keys). Open bearer
  // URL like /api/crm/files/:id so View/Download links just work.
  app.get(`${prefix}/invoice-files/:id`, async (c) => {
    try { await requireTrackerRead(c); } catch (e) { return scopeError(c, e); }
    if (!c.env.CHAT_FILES) return c.json({ error: 'File storage is not configured' }, 501);
    const { deps } = await import('../context');
    const { prisma } = deps();
    const row: any = await (prisma as any).debtorInvoiceAttachment.findUnique({
      where: { id: c.req.param('id') ?? '' },
    }).catch(() => null);
    if (!row?.kvKey) return c.json({ error: 'Attachment not found' }, 404);
    const obj = await c.env.CHAT_FILES.getWithMetadata(String(row.kvKey), 'arrayBuffer');
    if (obj.value === null) return c.json({ error: 'File not found' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', 'application/pdf');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    if (String(c.req.query('download') || '') === '1') {
      headers.set('Content-Disposition', `attachment; filename="${String(row.fileName || 'invoice.pdf').replace(/["\\]/g, '')}"`);
    }
    return new Response(obj.value, { headers });
  });

  app.delete(`${prefix}/attachments/:id`, async (c) => {
    try { await requireAccountsScope(c); } catch (e) { return scopeError(c, e); }
    try {
      const { kvKey } = await deleteInvoiceAttachment(c.req.param('id'));
      if (c.env.CHAT_FILES && kvKey) {
        try { await c.env.CHAT_FILES.delete(String(kvKey)); } catch { /* best-effort */ }
      }
      notifyLive(c, { type: LiveEvent.Debtors });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });
}
