// ─────────────────────────────────────────────────────────────────────────────
// routes/view-as.ts — root "view as" (impersonation): enter, exit, audit log.
//
// READ-ONLY BY DESIGN. Entering sets the `fos_view_as` cookie; worker/viewer.ts
// overlays that identity for every subsequent request, and the middleware in
// worker/context.ts refuses ANY write while the overlay is active (so nothing is
// ever saved as — or attributed to — the person being watched).
//
// Every handler names the REAL root identity via getRealMe(): the overlay must
// never be able to name itself as the actor, and exit must work while it is on.
// ─────────────────────────────────────────────────────────────────────────────
import type { Hono } from 'hono';
import { createAuthStore } from '../../modules/auth/store';
import { getRealMe } from '../viewer';
import { readBody, writeError } from '../http';
import { AuthError } from '../../modules/auth/types';
import {
  clearViewAsCookieHeader,
  viewAsCookieHeader,
  viewAsBlocker,
  cleanViewAsId,
  applyActingAs,
} from '../../modules/auth/view-as-pure';
import { listViewAs, logViewAsEnd, logViewAsStart, targetMe } from '../../modules/auth/view-as';
import type { Bindings } from '../context';

function meta(c: any) {
  return {
    ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: (c.req.header('user-agent') || '').slice(0, 300) || null,
  };
}

function secure(c: any): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

function requireRoot(real: any) {
  if (!real) throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  if (!real.isRoot) throw new AuthError('FORBIDDEN', 'Root only', 403);
  return real;
}

export function registerViewAsRoutes(app: Hono<{ Bindings: Bindings }>): void {
  /** Enter: POST /api/auth/view-as { userId } */
  app.post('/api/auth/view-as', async (c) => {
    try {
      const real = requireRoot(await getRealMe(c));
      const body = await readBody(c);
      const userId = cleanViewAsId(body?.userId);
      if (!userId) return c.json({ error: 'userId required' }, 400);
      const store = createAuthStore(c.env);
      const user = await store.getUserById(userId);
      const target = user ? await targetMe(store, userId) : null;
      const blocker = viewAsBlocker(real, target ? { id: target.user.id, email: target.user.email, name: target.user.name, isRoot: target.isRoot } : null);
      if (blocker || !target) return c.json({ error: blocker || 'Employee not found' }, 400);
      c.header('Set-Cookie', viewAsCookieHeader(userId, secure(c)));
      await logViewAsStart(c.env.DB, real, target, meta(c));
      const me = applyActingAs(target, real);
      return c.json({ ok: true, me, actingAs: me.actingAs });
    } catch (e) {
      return writeError(c, e, 'could not start view-as');
    }
  });

  /** Exit: DELETE /api/auth/view-as — closes the audit row and clears the cookie.
   *  Works while impersonating (exempt from the read-only gate). */
  app.delete('/api/auth/view-as', async (c) => {
    try {
      const real = await getRealMe(c);
      c.header('Set-Cookie', clearViewAsCookieHeader(secure(c)));
      if (real) await logViewAsEnd(c.env.DB, real);
      return c.json({ ok: true });
    } catch (e) {
      return writeError(c, e, 'could not exit view-as');
    }
  });

  /** Audit: GET /api/auth/view-as — the last 50 root views (who → whom, when). */
  app.get('/api/auth/view-as', async (c) => {
    try {
      requireRoot(await getRealMe(c));
      const rows = await listViewAs(c.env.DB, Number(c.req.query('limit')) || 50);
      return c.json(rows);
    } catch (e) {
      return writeError(c, e, 'could not read view-as log');
    }
  });
}
