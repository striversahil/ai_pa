// ─────────────────────────────────────────────────────────────────────────────
// routes/auth.ts — Google OAuth + user/role/scope admin API.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, deps, publicOrigin, isSecure, AuthRoutes, type Bindings } from '../context';
import { listAccountants } from '../../automations/accounts/service';
import { listDigitalMarketingManagers } from '../../automations/digital-marketing/service';
import { listEmployees } from '../../automations/human-resources/employees';
import { DIRECTORY_HIDDEN_KEY } from '../../modules/auth/directory';
import { readBody } from '../http';

/** Shared roster snapshot loader (positions + directory reuse it — one home). */
async function loadRosterSnapshot() {
  const { prisma } = deps();
  const [tcs, accts, mkts, hrs] = await Promise.all([
    prisma.telecaller.findMany({}).catch(() => []),
    listAccountants(false).catch(() => []),
    listDigitalMarketingManagers(false).catch(() => []),
    listEmployees(false).catch(() => []),
  ]);
  return {
    telecallers: (tcs as any[]).map((t) => ({ id: t.id ?? null, email: t.email ?? null, name: t.name ?? null, type: t.type ?? null, region: t.region ?? null })),
    accountants: (accts as any[]).map((r) => ({ id: (r as any).id ?? null, email: r.email ?? null, name: r.name ?? null, role: r.role ?? null })),
    marketers: (mkts as any[]).map((r) => ({ id: (r as any).id ?? null, email: r.email ?? null, name: r.name ?? null, role: r.role ?? null })),
    hrMembers: (hrs as any[]).map((r) => ({ id: (r as any).id ?? null, email: r.email ?? null, loginEmail: r.loginEmail ?? null, name: r.name ?? null, designation: (r as any).designation ?? null })),
  };
}

async function loadHiddenEmails(): Promise<unknown> {
  try {
    const { prisma } = deps();
    const row = await (prisma as any).setting.findUnique({ where: { key: DIRECTORY_HIDDEN_KEY } }).catch(() => null);
    const v = (row as any)?.value;
    try { return JSON.parse(String(v ?? "[]")); } catch { return []; }
  } catch { return []; }
}

export function registerAuthRoutes(app: Hono<{ Bindings: Bindings }>): void {
  app.get('/api/auth/google', async (c) => {
    const r = await AuthRoutes.authLogin(c.env, publicOrigin(c));
    if (r.redirect) return c.redirect(r.redirect);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/auth/google/callback', async (c) => {
    const r = await AuthRoutes.authCallback(c.env, authStore(c), c.req.query('code') ?? null, publicOrigin(c), isSecure(c));
    if (r.setCookie) c.header('Set-Cookie', r.setCookie);
    if (r.redirect) return c.redirect(r.redirect);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/auth/me', async (c) => {
    const r = await AuthRoutes.authMe(authStore(c), c.req.header('cookie') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/auth/logout', async (c) => {
    const r = await AuthRoutes.authLogout(authStore(c), c.req.header('cookie') ?? null, isSecure(c));
    if (r.setCookie) c.header('Set-Cookie', r.setCookie);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/auth/users', async (c) => {
    const r = await AuthRoutes.authListUsers(authStore(c), c.req.header('cookie') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/auth/positions', async (c) => {    // Worker-only (Express is frozen — no mirror). Roster reads run AFTER the
    // manager gate inside authUserPositions, via this loader closure.
    const r = await AuthRoutes.authUserPositions(authStore(c), c.req.header('cookie') ?? null, loadRosterSnapshot, async () => {
      // Phase 1 shadow: core-backed snapshot for diff logging only. Any
      // failure → null → endpoint serves pure roster values as before.
      try {
        const { prisma } = deps();
        const p: any = prisma as any;
        if (typeof p.coreEmployee?.findMany !== 'function') return null;
        const [emps, links] = await Promise.all([
          p.coreEmployee.findMany({}).catch(() => []),
          p.coreEmpPosition.findMany({}).catch(() => []),
        ]);
        const primaryByEmp = new Map<string, string>();
        for (const a of links as any[]) {
          if (a?.employeeId && a?.positionId && !a?.validTo && !primaryByEmp.has(a.employeeId)) {
            primaryByEmp.set(a.employeeId, a.positionId);
          }
        }
        return {
          employees: (emps as any[]).map((e) => ({
            workEmail: e.workEmail ?? null,
            positionCode: String(primaryByEmp.get(e.id) ?? '').replace(/^pos-/, '').replace(/-/g, '_'),
            grade: e.grade ?? null,
          })),
        };
      } catch { return null; }
    });
    return c.json(r.body, r.status as any);
  });
  // ── Unified employee directory (view-first; Worker-only, no Express mirror) ─
  // One entry per non-root login: position + roster source links. Root sees
  // all incl. hidden (flagged); managers + HR-scope holders see all-minus-hidden.
  app.get('/api/auth/directory', async (c) => {
    const r = await AuthRoutes.authDirectory(authStore(c), c.req.header('cookie') ?? null, loadRosterSnapshot, loadHiddenEmails);
    return c.json(r.body, r.status as any);
  });
  // Root-defined hidden-login list (root-only read/write; HR never sees it).
  app.get('/api/auth/hidden-logins', async (c) => {
    const r = await AuthRoutes.authGetHiddenLogins(authStore(c), c.req.header('cookie') ?? null, loadHiddenEmails);
    return c.json(r.body, r.status as any);
  });
  app.put('/api/auth/hidden-logins', async (c) => {
    const body = await readBody(c);
    const { prisma } = deps();
    const r = await AuthRoutes.authSetHiddenLogins(authStore(c), c.req.header('cookie') ?? null, body ?? {}, async (emails) => {
      const value = JSON.stringify(emails);
      await (prisma as any).setting.upsert({ where: { key: DIRECTORY_HIDDEN_KEY }, update: { value }, create: { key: DIRECTORY_HIDDEN_KEY, value } });
    });
    return c.json(r.body, r.status as any);
  });
  app.delete('/api/auth/users/:id', async (c) => {
    // Worker-only (Express is frozen — no mirror).
    const r = await AuthRoutes.authDeleteUser(authStore(c), c.req.header('cookie') ?? null, c.req.param('id') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/auth/scopes', async (c) => {
    const r = await AuthRoutes.authListScopes(authStore(c), c.req.header('cookie') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/auth/scopes', async (c) => {
    const r = await AuthRoutes.authCreateScope(authStore(c), c.req.header('cookie') ?? null, await readBody(c));
    return c.json(r.body, r.status as any);
  });
  app.delete('/api/auth/scopes/:key', async (c) => {
    const r = await AuthRoutes.authDeleteScope(authStore(c), c.req.header('cookie') ?? null, c.req.param('key') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.put('/api/auth/users/:id/scopes', async (c) => {
    const body = await readBody(c);
    const r = await AuthRoutes.authSetUserScopes(authStore(c), c.req.header('cookie') ?? null, c.req.param('id') ?? null, body.keys || []);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/auth/roles', async (c) => {
    const r = await AuthRoutes.authListRoles(authStore(c), c.req.header('cookie') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/auth/roles', async (c) => {
    const r = await AuthRoutes.authCreateRole(authStore(c), c.req.header('cookie') ?? null, await readBody(c));
    return c.json(r.body, r.status as any);
  });
  app.delete('/api/auth/roles/:key', async (c) => {
    const r = await AuthRoutes.authDeleteRole(authStore(c), c.req.header('cookie') ?? null, c.req.param('key') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.put('/api/auth/users/:id/roles', async (c) => {
    const body = await readBody(c);
    const r = await AuthRoutes.authSetUserRoles(authStore(c), c.req.header('cookie') ?? null, c.req.param('id') ?? null, body.keys || []);
    return c.json(r.body, r.status as any);
  });
  app.put('/api/auth/users/:id/profile', async (c) => {
    // Worker-only (Express is frozen — no mirror). Identity overrides:
    // display name + position. Display/grouping only, never access.
    const body = await readBody(c);
    const r = await AuthRoutes.authSetUserProfile(authStore(c), c.req.header('cookie') ?? null, c.req.param('id') ?? null, body ?? {});
    return c.json(r.body, r.status as any);
  });
}