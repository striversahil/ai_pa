// ─────────────────────────────────────────────────────────────────────────────
// routes/accounts.ts — Accounts automation API (roster + templates + logging).
// Mirror: founder-os_backend/src/routes/accounts.ts (Express alt runtime).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { deps, adminGuard, notifyLive, LiveEvent, type Bindings } from '../context';
import { ScopeKeys } from '../../modules/auth/types';
import {
  listAccountants, createAccountant, updateAccountant,
  listTemplates, createTemplate, updateTemplate, logTask, getAccountsExport,
  resolveSelfAccountant, payDue, getThreadsExport,
  getThread, runThreadMaintenance, threadWindow, ISO_DAY, istDateStr, SLOT_MAIN,
} from '../../automations/accounts/service';
import {
  listCashEntries, createCashEntry, updateCashEntry, deleteCashEntry,
} from '../../automations/accounts/cash';
import { getViewerMe } from '../viewer';
import { readBody, writeError } from '../http';

export function registerAccountsRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Roster (root-only, like /api/telecallers: reads and writes) ──────────
  // The dashboard gets the names it needs via data().roster (no emails).
  app.get('/api/accounts/roster', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    const { prisma } = deps();
    void prisma;
    const rows = await listAccountants(c.req.query('deleted') === '1');
    return c.json({ accountants: rows });
  });

  app.post('/api/accounts/roster', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    const body = await readBody(c);
    try {
      const row = await createAccountant(body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e, 'create failed'); }
  });

  app.put('/api/accounts/roster/:id', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    const body = await readBody(c);
    try {
      const row = await updateAccountant(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return writeError(c, e, 'update failed'); }
  });

  app.delete('/api/accounts/roster/:id', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    await updateAccountant(c.req.param('id'), { deleted: true });
    notifyLive(c, { type: LiveEvent.Accounts });
    return c.json({ ok: true });
  });

  // ── Templates (root-only reads/writes; dashboard reads via data()) ──────
  app.get('/api/accounts/templates', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    const rows = await listTemplates(c.req.query('all') === '1');
    return c.json({ templates: rows });
  });

  app.post('/api/accounts/templates', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    const body = await readBody(c);
    try {
      const row = await createTemplate(body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e, 'create failed'); }
  });

  app.put('/api/accounts/templates/:id', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    const body = await readBody(c);
    try {
      const row = await updateTemplate(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return writeError(c, e, 'update failed'); }
  });

  app.delete('/api/accounts/templates/:id', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    await updateTemplate(c.req.param('id'), { active: false });
    notifyLive(c, { type: LiveEvent.Accounts });
    return c.json({ ok: true });
  });

  // ── Payment dues (Worker-only; Express is frozen — no mirror) ─────────────
  // Founder rule: ANY accountant manages dues (add/edit/remove), not just
  // root. Task templates stay root-only above; these endpoints force
  // kind='payment' and refuse task rows both ways.
  async function paymentGate(c: any) {
    const me = await getViewerMe(c).catch(() => null);
    if (!me) throw new Error('Authentication required');
    const scopes = ((me as any)?.scopes ?? []) as string[];
    if ((me as any)?.isAdmin || scopes.includes(ScopeKeys.Accounts)) return me;
    throw new Error("Requires 'accounts' permission");
  }

  app.post('/api/accounts/payments', async (c) => {
    try { await paymentGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await readBody(c);
    try {
      const row = await createTemplate({ ...(body || {}), kind: 'payment' });
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e, 'create failed'); }
  });

  app.put('/api/accounts/payments/:id', async (c) => {
    try { await paymentGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await readBody(c);
    try {
      const existing: any = await listTemplates(true).then((ts) => ts.find((t: any) => String(t.id) === c.req.param('id')));
      if (!existing) return c.json({ error: 'payment due not found' }, 404);
      if (String(existing.kind || 'task') !== 'payment') return c.json({ error: 'not a payment due' }, 400);
      if (body && body.kind !== undefined && String(body.kind) !== 'payment') {
        return c.json({ error: 'kind cannot be changed' }, 400);
      }
      const row = await updateTemplate(c.req.param('id'), { ...(body || {}), kind: 'payment' });
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return writeError(c, e, 'update failed'); }
  });

  app.delete('/api/accounts/payments/:id', async (c) => {
    try { await paymentGate(c); } catch (e: any) {
      const msg = String((e as any)?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    try {
      const existing: any = await listTemplates(true).then((ts) => ts.find((t: any) => String(t.id) === c.req.param('id')));
      if (!existing) return c.json({ error: 'payment due not found' }, 404);
      if (String(existing.kind || 'task') !== 'payment') return c.json({ error: 'not a payment due' }, 400);
      await updateTemplate(c.req.param('id'), { active: false });
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json({ ok: true });
    } catch (e: any) { return writeError(c, e, 'delete failed'); }
  });

  // Mark a billing cycle paid (amount + reference). Creates the cycle
  // instance on demand, so projected (future) dues pay in one call.
  // Identity credit mirrors the taskbar log route below.
  app.post('/api/accounts/payments/pay', async (c) => {
    let me: any;
    try { me = await paymentGate(c); } catch (e: any) {
      const msg = String((e as any)?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await readBody(c);
    try {
      const self = await resolveSelfAccountant(
        (body as any)?.as ?? c.req.query('as') ?? null, me as any,
      ).catch(() => null);
      const row = await payDue(
        String(body?.templateId || ''),
        String(body?.dueDate || '').slice(0, 10),
        { paidAmount: body?.paidAmount, paidRef: body?.paidRef, remark: body?.remark },
        (me as any)?.user?.name ?? (me as any)?.user?.email ?? null,
        self ? { selfId: self.selfId, selfName: self.selfName } : null,
      );
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return writeError(c, e, 'pay failed'); }
  });

  // ── Dispatch cash report (Worker-only) ────────────────────────────────
  // Simple in/out ledger. Reads + adds: accounts OR dispatch floor (the floor
  // records its own spends). Edits/deletes: accounts-department only, so history
  // can't be rewritten from the floor.
  async function accountsReadGate(c: any) {
    const me = await getViewerMe(c).catch(() => null);
    if (!me) throw new Error('Authentication required');
    const scopes = ((me as any)?.scopes ?? []) as string[];
    if ((me as any)?.isAdmin || scopes.includes(ScopeKeys.Accounts) || scopes.includes(ScopeKeys.Dispatch)) return me;
    throw new Error("Requires 'accounts' or 'dispatch' permission");
  }
  async function cashWriteGate(c: any) {
    const me = await getViewerMe(c).catch(() => null);
    if (!me) throw new Error('Authentication required');
    const scopes = ((me as any)?.scopes ?? []) as string[];
    if ((me as any)?.isAdmin || scopes.includes(ScopeKeys.Accounts)) return me;
    throw new Error("Requires 'accounts' permission");
  }

  app.get('/api/accounts/cash', async (c) => {
    try { await accountsReadGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    try {
      const { entries, summary } = await listCashEntries(1000);
      return c.json({ entries, summary });
    } catch (e: any) { return writeError(c, e, 'load failed'); }
  });

  app.post('/api/accounts/cash', async (c) => {
    let me: any;
    try { me = await accountsReadGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await readBody(c);
    try {
      const row = await createCashEntry(body || {}, me?.user?.name ?? me?.user?.email ?? null);
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row, 201);
    } catch (e: any) { return writeError(c, e, 'create failed'); }
  });

  app.patch('/api/accounts/cash/:id', async (c) => {
    try { await cashWriteGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const body = await readBody(c);
    try {
      const row = await updateCashEntry(c.req.param('id'), body || {});
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return writeError(c, e, 'update failed'); }
  });

  app.delete('/api/accounts/cash/:id', async (c) => {
    try { await cashWriteGate(c); } catch (e: any) {
      const msg = String(e?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    try {
      await deleteCashEntry(c.req.param('id'));
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json({ ok: true });
    } catch (e: any) { return writeError(c, e, 'delete failed'); }
  });

  // ── Root export: date-range full ledger (pending/inprogress/done + remarks + file links) ──
  app.get('/api/accounts/export', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    try {
      // shape=thread (default) = one row per task × lane with the window's
      // entries inline; shape=daily keeps the per-day cell grid.
      if (c.req.query('shape') === 'daily') {
        const origin = new URL(c.req.url).origin;
        return c.json(await getAccountsExport(c.req.query('days'), origin, c.req.query('from'), c.req.query('to')));
      }
      const today = istDateStr();
      const w = threadWindow(today);
      const from = String(c.req.query('from') || w.from).slice(0, 10);
      const to = String(c.req.query('to') || today).slice(0, 10);
      return c.json(await getThreadsExport(from, to));
    } catch (e: any) { return writeError(c, e, 'export failed'); }
  });

  // ── Taskbar logging (any signed-in accounts viewer) ──
  // Who is inferred server-side (session → roster, declared `as` first) —
  // the client never declares attribution.
  app.patch('/api/accounts/logs/:id', async (c) => {
    const body = await readBody(c);
    try {
      const me = await getViewerMe(c).catch(() => null);
      const self = await resolveSelfAccountant(
        (body as any)?.as ?? c.req.query('as') ?? null, me as any,
      ).catch(() => null);
      const row = await logTask(
        c.req.param('id'), body || {},
        (me as any)?.user?.name ?? (me as any)?.user?.email ?? null,
        self ? { selfId: self.selfId, selfName: self.selfName } : null,
      );
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(row);
    } catch (e: any) { return writeError(c, e, 'log failed'); }
  });

  // ── Task threads (migration 0166): one task = a thread of entries ────────
  // Read: dashboard access (accounts or dispatch), lane-scoped. With no
  // `from`/`to` the thread covers the current financial year up to today; the
  // page is capped in thread-io (THREAD_PAGE_MAX).
  app.get('/api/accounts/tasks/:templateId/thread', async (c) => {
    let me: any;
    try { me = await accountsReadGate(c); } catch (e: any) {
      const msg = String((e as any)?.message ?? '');
      return c.json({ error: msg }, msg.includes('Authentication') ? 401 : 403);
    }
    const today = istDateStr();
    const win = threadWindow(today);
    const qFrom = String(c.req.query('from') || '');
    const qTo = String(c.req.query('to') || '');
    const from = ISO_DAY.test(qFrom) ? qFrom : win.from;
    const to = ISO_DAY.test(qTo) ? qTo : today;
    const slot = String(c.req.query('slot') || SLOT_MAIN);
    // Lane enforcement mirrors the dashboard payload: a non-admin may only open
    // their own lane's copy of a shared task.
    if (!(me as any).isAdmin && (slot === 'senior' || slot === 'junior')) {
      const self = await resolveSelfAccountant(null, me as any).catch(() => null);
      if (!self || String((self as any).selfRole) !== slot) {
        return c.json({ error: 'That lane is not yours' }, 403);
      }
    }
    const thread = await getThread(c.req.param('templateId'), slot, from, to, today);
    if (!thread) return c.json({ error: 'task not found' }, 404);
    return c.json(thread);
  });

  // Year backfill / manual maintenance (root, idempotent). Pass from=YYYY-MM-DD
  // (body or query) to fill the financial year the first time; the daily Worker
  // cron then keeps it current with a 14-day lookback.
  app.post('/api/accounts/threads/sync', async (c) => {
    const denied = await adminGuard(c); if (denied) return denied;
    const body = await readBody(c);
    const today = istDateStr();
    const qFrom = String((body as any)?.from ?? c.req.query('from') ?? '');
    const from = ISO_DAY.test(qFrom) ? qFrom : threadWindow(today).from;
    try {
      const result = await runThreadMaintenance(today, { from });
      notifyLive(c, { type: LiveEvent.Accounts });
      return c.json(result);
    } catch (e: any) { return writeError(c, e, 'thread sync failed'); }
  });
}

