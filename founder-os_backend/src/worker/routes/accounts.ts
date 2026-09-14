// ─────────────────────────────────────────────────────────────────────────────
// routes/accounts.ts — Accounts automation API (roster + templates + logging).
// Mirror: founder-os_backend/src/routes/accounts.ts (Express alt runtime).
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import {
  deps, requireMisScope, misScopeError, notifyLive,
  authStore, getMe, readSessionCookie, type Bindings,
} from '../context';
import {
  listAccountants, createAccountant, updateAccountant,
  listTemplates, createTemplate, updateTemplate, logTask,
} from '../../automations/accounts/service';

async function actorName(c: any): Promise<string | null> {
  try {
    const me = await getMe(authStore(c), readSessionCookie(c.req.header('cookie') ?? null));
    return me?.user?.name ?? me?.user?.email ?? null;
  } catch { return null; }
}

export function registerAccountsRoutes(app: Hono<{ Bindings: Bindings }>): void {
  // ── Roster (reads: accounts scope; writes: MIS-only, like telecallers) ──
  app.get('/api/accounts/roster', async (c) => {
    const { prisma } = deps();
    void prisma;
    const rows = await listAccountants(c.req.query('deleted') === '1');
    return c.json({ accountants: rows });
  });

  app.post('/api/accounts/roster', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createAccountant(body || {});
      notifyLive(c, { type: 'accounts' });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.put('/api/accounts/roster/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateAccountant(c.req.param('id'), body || {});
      notifyLive(c, { type: 'accounts' });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/accounts/roster/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    await updateAccountant(c.req.param('id'), { deleted: true });
    notifyLive(c, { type: 'accounts' });
    return c.json({ ok: true });
  });

  // ── Templates (reads: accounts scope; writes: MIS-only) ──
  app.get('/api/accounts/templates', async (c) => {
    const rows = await listTemplates(c.req.query('all') === '1');
    return c.json({ templates: rows });
  });

  app.post('/api/accounts/templates', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await createTemplate(body || {});
      notifyLive(c, { type: 'accounts' });
      return c.json(row, 201);
    } catch (e: any) { return c.json({ error: e?.message ?? 'create failed' }, 400); }
  });

  app.put('/api/accounts/templates/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await updateTemplate(c.req.param('id'), body || {});
      notifyLive(c, { type: 'accounts' });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'update failed' }, 400); }
  });

  app.delete('/api/accounts/templates/:id', async (c) => {
    try { await requireMisScope(c); } catch (e) { return misScopeError(c, e); }
    await updateTemplate(c.req.param('id'), { active: false });
    notifyLive(c, { type: 'accounts' });
    return c.json({ ok: true });
  });

  // ── Taskbar logging (any signed-in accounts viewer; MIS included) ──
  app.patch('/api/accounts/logs/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const row = await logTask(c.req.param('id'), body || {}, await actorName(c));
      notifyLive(c, { type: 'accounts' });
      return c.json(row);
    } catch (e: any) { return c.json({ error: e?.message ?? 'log failed' }, 400); }
  });
}
