// ─────────────────────────────────────────────────────────────────────────────
// routes/payment-tracker.ts — Payment Tracker automation API (paste imports +
// KV-cached dashboard payload). Worker-only: Express is frozen (no parallel
// mirror for new endpoints). Access: the `accounts` scope (root/admin
// included via requireScope).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  authStore, getMe, requireScope, readSessionCookie, notifyLive, LiveEvent,
  type Bindings,
} from '../context';
import { AuthError } from '../../modules/auth/types';
import {
  importCollections, importDebtors, getPaymentTrackerData, PaymentTrackerError,
} from '../../automations/payment-tracker/service';
import { parseCollectionsTsv, parseDebtorsTsv } from '../../automations/payment-tracker/parse';

async function requireAccountsScope(c: any) {
  return requireScope(authStore(c), c.req.header('cookie') ?? null, 'accounts');
}

function scopeError(c: any, e: unknown) {
  if (e instanceof AuthError) return c.json({ error: e.message }, (e as any).status ?? 403);
  throw e;
}

async function actorName(c: any): Promise<string> {
  try {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    return me?.user?.name ?? me?.user?.email ?? 'accounts';
  } catch { return 'accounts'; }
}

function errorResponse(c: any, e: unknown) {
  if (e instanceof PaymentTrackerError) return c.json({ error: e.message }, e.status as any);
  return c.json({ error: (e as any)?.message ?? 'request failed' }, 400);
}

export function registerPaymentTrackerRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Data: KV-cached payload (accounts scope) ──
  app.get('/api/payment-tracker/data', async (c) => {
    try {
      await requireAccountsScope(c);
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
}
