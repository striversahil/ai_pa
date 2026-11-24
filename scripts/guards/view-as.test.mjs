// view-as.test.mjs — Guards for root "view as" (read-only impersonation).
//
// Locks the parts that must never drift:
//   1. who may impersonate (root only, never root→root, never self);
//   2. the overlay is not root, and names the REAL root as the actor;
//   3. the write gate (reads pass, every write is refused, exit stays open);
//   4. cookie shape (HttpOnly/Path/SameSite/Max-Age, Secure only over https);
//   5. the wiring that makes it real: one choke point in viewer.ts, the gate in
//      context.ts, /api/auth/me resolved through the viewer, BE↔FE mirror.
//
// Run: `node --test "scripts/guards/*.test.mjs"`
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKEND_DIR, FRONTEND_SRC, bundleToFile } from './_bundle.mjs';

const fsRoot = join(FRONTEND_SRC, '..', '..');

const pure = await import(pathToFileURL(bundleToFile(join(BACKEND_DIR, 'src/modules/auth/view-as-pure.ts'))).href);

const read = (p) => readFileSync(p, 'utf8');
const be = (p) => read(join(BACKEND_DIR, p));
const rootMe = {
  user: { id: 'u-root', email: 'root@x.test', name: 'Root', picture: null, isRoot: true },
  scopes: ['admin'],
  roles: [],
  isRoot: true,
  isAdmin: true,
};
const agentMe = {
  user: { id: 'u-agent', email: 'ravi@x.test', name: 'Ravi', picture: null, isRoot: false },
  scopes: ['telecalling'],
  roles: ['telecalling'],
  isRoot: false,
  isAdmin: false,
};

describe('view-as: who may impersonate', () => {
  it('is root-only', () => {
    assert.equal(pure.viewAsBlocker(null, { id: 'u-agent' }), 'Authentication required');
    assert.equal(pure.viewAsBlocker(agentMe, { id: 'u-agent2' }), 'Root only — impersonation is a founder tool');
  });

  it('refuses the root user and self', () => {
    assert.match(pure.viewAsBlocker(rootMe, { id: 'u-root2', isRoot: true }), /root user cannot be impersonated/);
    assert.match(pure.viewAsBlocker(rootMe, { id: 'u-root' }), /your own login/);
  });

  it('allows root → any other non-root login', () => {
    assert.equal(pure.viewAsBlocker(rootMe, { id: 'u-agent', isRoot: false }), null);
    assert.equal(pure.viewAsBlocker(rootMe, { id: 'u-agent' }), null);
  });

  it('refuses an unknown target', () => {
    assert.equal(pure.viewAsBlocker(rootMe, null), 'Employee not found');
  });
});

describe('view-as: the overlay', () => {
  it('takes the target identity and can never be root', () => {
    // Even if the snapshot wrongly claims root, the overlay pins isRoot=false.
    const bogusRootTarget = { ...agentMe, isRoot: true, isAdmin: true, scopes: ['admin'] };
    const me = pure.applyActingAs(bogusRootTarget, rootMe);
    assert.equal(me.user.id, 'u-agent');
    assert.equal(me.isRoot, false);
    assert.equal(me.isAdmin, true); // admin scope still honoured (scoped the target's way)
    assert.deepEqual(me.actingAs, { id: 'u-root', email: 'root@x.test', name: 'Root' });
  });

  it('keeps the target scopes/roles untouched (that is what changes the sidebar)', () => {
    const me = pure.applyActingAs(agentMe, rootMe);
    assert.deepEqual(me.scopes, ['telecalling']);
    assert.deepEqual(me.roles, ['telecalling']);
    assert.equal(me.isAdmin, false);
  });
});

describe('view-as: the write gate', () => {
  it('lets every read through', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      assert.equal(pure.isReadOnlyViewAsRequest(m, '/api/notifications'), false, m);
    }
  });

  it('refuses every write, including marking THEIR notifications read', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(pure.isReadOnlyViewAsRequest(m, '/api/notifications/n1/read'), true, m);
      assert.equal(pure.isReadOnlyViewAsRequest(m, '/api/enquiries/e1'), true, m);
    }
  });

  it('keeps enter/exit open, so you can always leave', () => {
    assert.equal(pure.isReadOnlyViewAsRequest('POST', '/api/auth/view-as'), false);
    assert.equal(pure.isReadOnlyViewAsRequest('DELETE', '/api/auth/view-as'), false);
  });
});

describe('view-as: cookie transport', () => {
  it('reads its own cookie out of a crowded header', () => {
    const header = 'fos_session=abc123; fos_view_as=user_42; theme=dark';
    assert.equal(pure.readViewAsCookie(header), 'user_42');
    assert.equal(pure.readViewAsCookie('fos_session=abc123'), null);
    assert.equal(pure.readViewAsCookie(null), null);
  });

  it('fails closed on junk values', () => {
    for (const junk of ['fos_view_as=', 'fos_view_as=root', 'fos_view_as=<script>', `fos_view_as=${'x'.repeat(80)}`]) {
      assert.equal(pure.readViewAsCookie(junk), null, junk);
    }
  });

  it('sets an HttpOnly, path-scoped, 2h cookie and can clear it', () => {
    const set = pure.viewAsCookieHeader('user_42', true);
    assert.match(set, /^fos_view_as=user_42/);
    assert.match(set, /HttpOnly/);
    assert.match(set, /Path=\//);
    assert.match(set, /SameSite=Lax/);
    assert.match(set, new RegExp(`Max-Age=${pure.VIEW_AS_MAX_AGE}`));
    assert.match(set, /Secure/);
    assert.doesNotMatch(pure.viewAsCookieHeader('user_42', false), /Secure/);
    assert.match(pure.clearViewAsCookieHeader(false), /Max-Age=0/);
  });
});

describe('view-as: wiring', () => {
  it('overlays identity in exactly one place (worker/viewer.ts)', () => {
    const viewer = be('src/worker/viewer.ts');
    assert.match(viewer, /readViewAsCookie/);
    assert.match(viewer, /resolveViewAs/);
    assert.match(viewer, /getRealMe/);
  });

  it('enforces read-only in the app middleware', () => {
    const ctx = be('src/worker/context.ts');
    assert.match(ctx, /isReadOnlyViewAsRequest/);
    assert.match(ctx, /VIEW_AS_READONLY/);
  });

  it('/api/auth/me resolves through the viewer (so the UI sees the target)', () => {
    const auth = be('src/worker/routes/auth.ts');
    assert.match(auth, /app\.get\('\/api\/auth\/me'[\s\S]{0,400}getViewerMe\(c\)/);
    assert.doesNotMatch(auth, /AuthRoutes\.authMe\(/);
  });

  it('is registered on the app and ships its audit table', () => {
    assert.match(be('src/worker.ts'), /registerViewAsRoutes\(app\)/);
    const sql = be('migrations/0163_view_as.sql');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS hlp_view_as/);
    assert.match(sql, /endedAt/);
  });

  it('mirrors actingAs on the frontend (MeResponse ↔ AuthUserMe)', () => {
    assert.match(be('src/modules/auth/types.ts'), /actingAs\?: \{ id: string; email: string; name: string \}/);
    assert.match(read(join(FRONTEND_SRC, 'auth/permissions.ts')), /actingAs\?: \{ id: string; email: string; name: string \}/);
  });
});

describe('view-as: the notification bell follows the impersonated identity', () => {
  const provider = read(join(FRONTEND_SRC, 'notifications/NotificationProvider.tsx'));
  const drawer = read(join(FRONTEND_SRC, 'components/notifications/NotificationDrawer.tsx'));

  it('remounts the provider on identity change (no previous inbox left on screen)', () => {
    // Without this key the bell keeps root's payload for up to a poll and the
    // target's backlog all looks "new" → a toast burst on entry.
    const page = read(join(FRONTEND_SRC, 'app/page.tsx'));
    assert.match(page, /<NotificationProvider key=\{me\.user\.id\}>/);
  });

  it('still seeds the toast baseline from the first payload (history never toasts)', () => {
    assert.match(provider, /seen\.current === null/);
    assert.match(provider, /First paint/);
  });

  it('never marks THEIR notifications read while viewing as', () => {
    assert.match(provider, /const viewOnly = !!me\?\.actingAs/);
    assert.match(provider, /if \(viewOnly\) return; \/\/ viewing someone else/);
    assert.match(provider, /viewOnly,/);
    assert.match(drawer, /readOnly=\{viewOnly\}/);
    assert.match(drawer, /viewOnly \? null :/); // no "Mark all read" button
  });
});
