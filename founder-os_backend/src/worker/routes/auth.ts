// ─────────────────────────────────────────────────────────────────────────────
// routes/auth.ts — Google OAuth + user/role/scope admin API.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { authStore, publicOrigin, isSecure, AuthRoutes, type Bindings } from '../context';

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
  app.get('/api/auth/scopes', async (c) => {
    const r = await AuthRoutes.authListScopes(authStore(c), c.req.header('cookie') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/auth/scopes', async (c) => {
    const r = await AuthRoutes.authCreateScope(authStore(c), c.req.header('cookie') ?? null, await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as any);
  });
  app.delete('/api/auth/scopes/:key', async (c) => {
    const r = await AuthRoutes.authDeleteScope(authStore(c), c.req.header('cookie') ?? null, c.req.param('key') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.put('/api/auth/users/:id/scopes', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = await AuthRoutes.authSetUserScopes(authStore(c), c.req.header('cookie') ?? null, c.req.param('id') ?? null, body.keys || []);
    return c.json(r.body, r.status as any);
  });
  app.get('/api/auth/roles', async (c) => {
    const r = await AuthRoutes.authListRoles(authStore(c), c.req.header('cookie') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.post('/api/auth/roles', async (c) => {
    const r = await AuthRoutes.authCreateRole(authStore(c), c.req.header('cookie') ?? null, await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as any);
  });
  app.delete('/api/auth/roles/:key', async (c) => {
    const r = await AuthRoutes.authDeleteRole(authStore(c), c.req.header('cookie') ?? null, c.req.param('key') ?? null);
    return c.json(r.body, r.status as any);
  });
  app.put('/api/auth/users/:id/roles', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = await AuthRoutes.authSetUserRoles(authStore(c), c.req.header('cookie') ?? null, c.req.param('id') ?? null, body.keys || []);
    return c.json(r.body, r.status as any);
  });
}