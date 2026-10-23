// ─────────────────────────────────────────────────────────────────────────────
// routes/payment-tracker.ts — Payment Tracker automation API (paste imports +
// KV-cached dashboard payload). Worker-only: Express is frozen.
//
// Access (founder decision):
//   read + sales follow-up edits → `payment-tracker` OR the legacy `accounts`
//   imports / reset / deletes / contacts / reminder run → `accounts` only
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  authStore, getMe, requireScope, readSessionCookie, notifyLive, LiveEvent,
  type Bindings,
} from '../context';
import { AuthError } from '../../modules/auth/types';
import {
  importCollections, importDebtors, getPaymentTrackerData, PaymentTrackerError,
  updateInvoiceFields, deleteInvoice, deleteCollection, resetPaymentTracker,
  INVOICE_EDITABLE_FIELDS, FOLLOW_UP_FIELDS, runReminderDryRun, updateCustomerContact, getCustomerLedger,
} from '../../automations/payment-tracker/service';
import { parseCollectionsTsv, parseDebtorsTsv } from '../../automations/payment-tracker/parse';

const TRACKER_SCOPES = ['payment-tracker', 'accounts'];

function heldScopes(me: any): Set<string> {
  return new Set(((me?.scopes ?? []) as string[]).map((s) => String(s).toLowerCase()));
}

async function meFor(c: any) {
  return getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
}

/** Any tracker viewer: sales (`payment-tracker`) or accounts. */
async function requireTrackerRead(c: any) {
  const me = await meFor(c);
  if (!me) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  if (me.isAdmin) return me;
  const held = heldScopes(me);
  if (!TRACKER_SCOPES.some((s) => held.has(s))) {
    throw new AuthError('FORBIDDEN', "Requires 'payment-tracker' permission", 403);
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
  if (e instanceof PaymentTrackerError) return c.json({ error: e.message }, e.status as any);
  return c.json({ error: (e as any)?.message ?? 'request failed' }, 400);
}

export function registerPaymentTrackerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Data: KV-cached payload (sales or accounts) ──
  app.get('/api/payment-tracker/data', async (c) => {
    try {
      await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    try {
      return c.json(await getPaymentTrackerData());
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Preview: parse a paste without persisting (dashboard confirm UI) ──
  app.post('/api/payment-tracker/preview', async (c) => {
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
  app.post('/api/payment-tracker/import/debtors', async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const text = String((body as any)?.text ?? '');
    if (text.trim().length < 8) return c.json({ error: 'Nothing pasted' }, 400);
    const importedBy = await actorName(c);
    try {
      const report = await importDebtors(text, importedBy);
      notifyLive(c, { type: LiveEvent.Payments });
      return c.json({ ok: true, report });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Collections receipts-sheet paste import ──
  app.post('/api/payment-tracker/import/collections', async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const text = String((body as any)?.text ?? '');
    if (text.trim().length < 8) return c.json({ error: 'Nothing pasted' }, 400);
    const importedBy = await actorName(c);
    try {
      const report = await importCollections(text, importedBy);
      notifyLive(c, { type: LiveEvent.Payments });
      return c.json({ ok: true, report });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Fresh start: wipe ledgers (hard delete) + reminders + KV cache ──
  app.delete('/api/payment-tracker/data', async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    try {
      const report = await resetPaymentTracker();
      notifyLive(c, { type: LiveEvent.Payments });
      return c.json({ ok: true, report });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Row editor: accounts edit all; sales edit follow-up fields only ──
  app.patch('/api/payment-tracker/invoices/:id', async (c) => {
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
      notifyLive(c, { type: LiveEvent.Payments });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Correct a mis-imported invoice (soft delete; its collections unlink) ──
  app.delete('/api/payment-tracker/invoices/:id', async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    try {
      await deleteInvoice(c.req.param('id'));
      notifyLive(c, { type: LiveEvent.Payments });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Correct a mis-imported collection (soft delete) ──
  app.delete('/api/payment-tracker/collections/:id', async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    try {
      await deleteCollection(c.req.param('id'));
      notifyLive(c, { type: LiveEvent.Payments });
      return c.json({ ok: true });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Customer contact master (accounts): phone/email/region + WhatsApp opt-in ──
  app.put('/api/payment-tracker/customers/contact', async (c) => {
    try {
      await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    const key = String((body as any)?.customerKey ?? '');
    const patch: Record<string, unknown> = {};
    for (const field of ['phone', 'email', 'region', 'notes', 'whatsappOptIn']) {
      if (body && typeof body === 'object' && field in (body as any)) patch[field] = (body as any)[field];
    }
    try {
      const contact = await updateCustomerContact(key, patch, await actorName(c));
      notifyLive(c, { type: LiveEvent.Payments });
      return c.json({ ok: true, contact });
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Complete customer statement (sales or accounts) ──
  app.get('/api/payment-tracker/customers/:customerKey/ledger', async (c) => {
    try {
      await requireTrackerRead(c);
    } catch (e) { return scopeError(c, e); }
    try {
      return c.json(await getCustomerLedger(c.req.param('customerKey')));
    } catch (e) { return errorResponse(c, e); }
  });

  // ── Manual dry-run trigger (accounts); daily cron does this automatically ──
  app.post('/api/payment-tracker/reminders/run', async (c) => {
    let me: any;
    try {
      me = await requireAccountsScope(c);
    } catch (e) { return scopeError(c, e); }
    try {
      const report = await runReminderDryRun({
        trigger: 'manual',
        actor: me?.user?.name ?? me?.user?.email ?? 'accounts',
      });
      notifyLive(c, { type: LiveEvent.Payments });
      return c.json({ ok: true, report });
    } catch (e) { return errorResponse(c, e); }
  });
}
